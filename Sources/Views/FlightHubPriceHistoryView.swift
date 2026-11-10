import Foundation
import SwiftUI
import Charts

// Reads the existing Flight Hub; never embeds bot/API/APNs credentials in the app.
private struct FlightHubPriceHistoryResponse: Decodable {
    struct Flight: Decodable {
        let flight_key: String
        let airline_code: String
        let flight_number: String
        let origin: String
        let destination: String
        let departure_date: String
    }
    struct Observation: Decodable, Identifiable {
        let offer_id: String
        let provider: String
        let amount_minor: Int64
        let currency: String
        let observed_at: String
        var id: String { "\(offer_id)-\(observed_at)-\(amount_minor)" }
    }
    struct Event: Decodable, Identifiable {
        let id: String
        let previous_amount_minor: Int64
        let new_amount_minor: Int64
        let currency: String
        let source: String
        let observed_at: String
        let delivery_state: String
    }
    struct Attempt: Decodable, Identifiable {
        let provider: String
        let attempted_at: String
        let outcome: String
        let message: String?
        var id: String { "\(provider)-\(attempted_at)-\(outcome)" }
    }
    let ok: Bool
    let flight: Flight
    let observations: [Observation]
    let events: [Event]
    let attempts: [Attempt]
}

struct FlightHubPriceHistoryView: View {
    let flightKey: String
    @Environment(\.dismiss) private var dismiss
    @State private var history: FlightHubPriceHistoryResponse?
    @State private var loading = true
    @State private var errorMessage: String?
    @State private var selectedProvider = "Все"
    @State private var selectedCurrency = ""

    private struct ChartPoint: Identifiable {
        let id: String
        let provider: String
        let date: Date
        let amount: Double
    }

    private var providerOptions: [String] {
        ["Все"] + Array(Set(history?.observations.map(\.provider) ?? [])).sorted()
    }
    private var currencyOptions: [String] {
        Array(Set(history?.observations.map(\.currency) ?? [])).sorted()
    }
    private var chartPoints: [ChartPoint] {
        (history?.observations ?? []).compactMap { observation in
            guard (selectedProvider == "Все" || observation.provider == selectedProvider),
                  observation.currency == selectedCurrency,
                  let when = Self.parseDate(observation.observed_at) else { return nil }
            let scale: Double = observation.currency == "UZS" ? 1 : 100
            return ChartPoint(id: observation.id, provider: observation.provider, date: when,
                              amount: Double(observation.amount_minor) / scale)
        }.sorted { $0.date < $1.date }
    }

    var body: some View {
        NavigationStack {
            Group {
                if loading { ProgressView("Загрузка истории цен…").frame(maxWidth: .infinity, maxHeight: .infinity) }
                else if let errorMessage {
                    ContentUnavailableView("История недоступна", systemImage: "wifi.exclamationmark", description: Text(errorMessage))
                } else if let history {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 18) {
                            VStack(alignment: .leading, spacing: 5) {
                                Text("\(history.flight.origin)  →  \(history.flight.destination)")
                                    .font(.title2.bold())
                                Text("\(history.flight.flight_number) · \(history.flight.departure_date)")
                                    .font(.subheadline).foregroundStyle(.secondary)
                            }
                            if !history.observations.isEmpty {
                                VStack(alignment: .leading, spacing: 12) {
                                    Text("История подтверждённых источниками цен").font(.headline)
                                    Picker("Поставщик", selection: $selectedProvider) {
                                        ForEach(providerOptions, id: \.self) { Text($0).tag($0) }
                                    }.pickerStyle(.menu)
                                    if currencyOptions.count > 1 {
                                        Picker("Валюта", selection: $selectedCurrency) {
                                            ForEach(currencyOptions, id: \.self) { Text($0).tag($0) }
                                        }.pickerStyle(.segmented)
                                    }
                                    if chartPoints.count > 1 {
                                        Chart(chartPoints) { item in
                                            LineMark(x: .value("Дата", item.date), y: .value("Цена", item.amount))
                                                .foregroundStyle(by: .value("Источник", item.provider))
                                            PointMark(x: .value("Дата", item.date), y: .value("Цена", item.amount))
                                                .foregroundStyle(by: .value("Источник", item.provider))
                                        }
                                        .chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) }
                                        .frame(height: 215)
                                        .accessibilityLabel("График истории стоимости рейса")
                                    } else {
                                        Text("Для графика требуется минимум два наблюдения.")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    Text("Цены — наблюдения поставщиков, не гарантия покупки. Разные валюты не конвертируются.")
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                                .padding(16)
                                .background(.white, in: RoundedRectangle(cornerRadius: 17))
                            } else {
                                ContentUnavailableView("История пока пустая", systemImage: "chart.xyaxis.line",
                                                       description: Text("График появится после первого подтверждённого источником наблюдения."))
                            }
                            VStack(alignment: .leading, spacing: 12) {
                                Text("Изменения цен").font(.headline)
                                ForEach(history.events) { event in
                                    HStack(alignment: .top, spacing: 10) {
                                        Image(systemName: "arrow.left.arrow.right").foregroundStyle(Color(red: 0.40, green: 0.21, blue: 0.85))
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text("\(Self.price(event.previous_amount_minor, event.currency)) → \(Self.price(event.new_amount_minor, event.currency))")
                                                .font(.subheadline.bold())
                                            Text("\(event.source) · \(Self.displayDate(event.observed_at))")
                                                .font(.caption).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        let delta = event.new_amount_minor - event.previous_amount_minor
                                        Text("\(delta > 0 ? "+" : "")\(Self.price(delta, event.currency))")
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(delta > 0 ? Color.orange : Color.green)
                                    }
                                    if event.id != history.events.last?.id { Divider() }
                                }
                                if history.events.isEmpty {
                                    Text("Изменений пока не было. Первоначальные цены сохраняются в наблюдениях.")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .padding(16)
                            .background(.white, in: RoundedRectangle(cornerRadius: 17))
                            VStack(alignment: .leading, spacing: 10) {
                                Text("Последние проверки ботов").font(.headline)
                                ForEach(history.attempts.prefix(25)) { attempt in
                                    HStack {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(attempt.provider).font(.subheadline.weight(.medium))
                                            Text(Self.displayDate(attempt.attempted_at))
                                                .font(.caption2).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Text(Self.attemptTitle(attempt.outcome))
                                            .font(.caption).foregroundStyle(attempt.outcome == "verified" ? Color.green : Color.secondary)
                                    }
                                    if let text = attempt.message, !text.isEmpty {
                                        Text(text).font(.caption2).foregroundStyle(.secondary)
                                    }
                                    Divider()
                                }
                                if history.attempts.isEmpty {
                                    Text("Нет зарегистрированных проверок.").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .padding(16)
                            .background(.white, in: RoundedRectangle(cornerRadius: 17))
                        }
                        .padding(16)
                    }.background(Color(red: 242/255, green: 243/255, blue: 245/255))
                }
            }
            .navigationTitle("История цен")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Закрыть") { dismiss() } } }
        }
        .task(id: flightKey) { await load() }
    }

    @MainActor private func load() async {
        loading = true
        defer { loading = false }
        do {
            var components = URLComponents(url: AppConfig.flightHubBaseURL.appending(path: "v1/public/price-history"), resolvingAgainstBaseURL: false)
            components?.queryItems = [URLQueryItem(name: "flight_key", value: flightKey)]
            guard let url = components?.url else { throw URLError(.badURL) }
            var request = URLRequest(url: url)
            request.timeoutInterval = 20
            request.cachePolicy = .reloadIgnoringLocalCacheData
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let response = response as? HTTPURLResponse, (200...299).contains(response.statusCode) else { throw URLError(.badServerResponse) }
            let value = try JSONDecoder().decode(FlightHubPriceHistoryResponse.self, from: data)
            guard value.ok else { throw URLError(.cannotParseResponse) }
            history = value
            selectedCurrency = Array(Set(value.observations.map(\.currency))).sorted().first ?? ""
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }
    private static func parseDate(_ text: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: text) ?? ISO8601DateFormatter().date(from: text)
    }
    private static func displayDate(_ value: String) -> String {
        guard let date = parseDate(value) else { return value }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
    private static func price(_ minor: Int64, _ currency: String) -> String {
        let divisor: Double = currency == "UZS" ? 1 : 100
        return String(format: currency == "UZS" ? "%.0f %@" : "%.2f %@", Double(minor) / divisor, currency)
    }
    private static func attemptTitle(_ value: String) -> String {
        switch value {
        case "verified": return "Проверено"
        case "unchanged": return "Без изменений"
        case "no_fares": return "Не найдено"
        case "blocked": return "Блокировка"
        case "site_changed": return "Сайт изменился"
        default: return "Ошибка"
        }
    }
}
