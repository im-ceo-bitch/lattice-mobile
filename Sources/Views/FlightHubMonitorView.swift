import Foundation
import SwiftUI

// Read-only operator dashboard. No API keys are embedded in the iOS build.
// Prices are never represented as bookable until revalidated by the source.
private struct FlightHubStatus: Decodable {
    struct Counts: Decodable {
        let flights: Int
        let offers: Int
        let unmatched: Int
    }
    struct Run: Decodable {
        let checked_at: String
        let status: String
        let accepted: Int
        let unmatched: Int
        let rejected: Int
    }
    struct Source: Decodable, Identifiable {
        let name: String
        let configured: Bool
        let last_run: Run?
        var id: String { name }
    }
    let ok: Bool
    let counts: Counts
    let sources: [Source]
    let generated_at: String
}

private struct FlightHubCatalog: Decodable {
    struct Flight: Decodable, Identifiable {
        struct Offer: Decodable, Identifiable {
            let provider: String
            let fare_brand: String
            let amount_minor: Int64
            let currency: String
            let checked_at: String
            let price_scope: String
            let fresh: Bool
            let baggage_checked_kg: Double?
            let baggage_cabin_kg: Double?
            let seats_left: Int?
            var id: String { "\(provider):\(fare_brand):\(currency)" }
        }
        let flight_key: String
        let airline_code: String
        let flight_number: String
        let origin: String
        let destination: String
        let departure_date: String
        let departure_at: String?
        let offers: [Offer]
        var id: String { flight_key }
    }
    let ok: Bool
    let flights: [Flight]
}

struct FlightHubMonitorView: View {
    @State private var status: FlightHubStatus?
    @State private var flights: [FlightHubCatalog.Flight] = []
    @State private var loading = false
    @State private var error: String?
    @State private var lastLoaded: Date?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Единая авиационная база").font(.headline)
                    Text("Ignav · AeroDataBox · Centrum Air · Uzbekistan Airways · Flynas")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Button { Task { await reload() } } label: {
                    if loading { ProgressView() }
                    else { Label("Обновить", systemImage: "arrow.clockwise") }
                }
                .disabled(loading)
                .buttonStyle(.bordered)
            }
            if let error {
                HStack(alignment: .top, spacing: 9) {
                    Image(systemName: "wifi.exclamationmark").foregroundStyle(.orange)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Новая авиабаза ещё не подключена").font(.subheadline.weight(.semibold))
                        Text(error).font(.caption).foregroundStyle(.secondary)
                        Text("После создания D1 и настройки маршрута Cloudflare монитор появится здесь автоматически.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 14))
            }
            if let status {
                HStack(spacing: 8) {
                    metric("Рейсы", value: status.counts.flights)
                    metric("Тарифы", value: status.counts.offers)
                    metric("На проверке", value: status.counts.unmatched)
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Источники данных").font(.subheadline.weight(.semibold))
                    ForEach(status.sources) { source in
                        HStack(spacing: 9) {
                            Image(systemName: source.last_run?.status == "ok" ? "checkmark.circle.fill" : "clock.arrow.circlepath")
                                .foregroundStyle(source.last_run?.status == "ok" ? Color.green : Color.secondary)
                            Text(sourceTitle(source.name)).font(.subheadline)
                            Spacer()
                            Text(sourceText(source))
                                .font(.caption).foregroundStyle(.secondary)
                                .multilineTextAlignment(.trailing)
                        }
                        .padding(.vertical, 5)
                    }
                }
                .padding(14)
                .background(BusinessDesign.card, in: RoundedRectangle(cornerRadius: 14))
            }
            if !flights.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Рейсы в базе").font(.headline)
                    ForEach(flights.prefix(35)) { flight in
                        flightRow(flight)
                    }
                }
            } else if status != nil {
                ContentUnavailableView("Авиарейсов пока нет", systemImage: "airplane",
                    description: Text("Сначала перенесите опубликованные рейсы или загрузите результаты Ignav. Боты обновляют цены только существующих рейсов."))
            }
            if let lastLoaded {
                Text("Последняя загрузка: \(lastLoaded.formatted(date: .omitted, time: .shortened))")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .task { if lastLoaded == nil { await reload() } }
    }

    private func metric(_ name: String, value: Int) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(name).font(.caption2).foregroundStyle(.secondary)
            Text(value.formatted()).font(.title3.weight(.bold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(BusinessDesign.card, in: RoundedRectangle(cornerRadius: 12))
    }

    private func flightRow(_ flight: FlightHubCatalog.Flight) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(flight.origin) → \(flight.destination)").font(.subheadline.weight(.semibold))
                Spacer()
                Text(flight.departure_date).font(.caption).foregroundStyle(.secondary)
            }
            Text("\(flight.airline_code) · \(flight.flight_number)")
                .font(.caption).foregroundStyle(.secondary)
            if flight.offers.isEmpty {
                Text("Цена ещё не подтверждена").font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(flight.offers) { offer in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(sourceTitle(offer.provider)).font(.caption).foregroundStyle(.secondary)
                        if !offer.fare_brand.isEmpty {
                            Text(offer.fare_brand).font(.caption2).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(formattedPrice(offer)).font(.subheadline.weight(.semibold))
                            .foregroundStyle(offer.fresh ? Color.primary : Color.secondary)
                    }
                    if !offer.fresh {
                        Text("Устаревшая цена — перепроверить").font(.caption2).foregroundStyle(.orange)
                    }
                }
            }
        }
        .padding(14)
        .background(BusinessDesign.card, in: RoundedRectangle(cornerRadius: 14))
    }

    private func formattedPrice(_ offer: FlightHubCatalog.Flight.Offer) -> String {
        let denominator: Double = offer.currency == "UZS" ? 1 : 100
        let amount = Double(offer.amount_minor) / denominator
        return String(format: denominator == 1 ? "%.0f %@" : "%.2f %@", amount, offer.currency)
    }
    private func sourceTitle(_ key: String) -> String {
        switch key {
        case "ignav": return "Ignav"
        case "aerodatabox": return "AeroDataBox"
        case "centrum": return "Centrum Air"
        case "uzbekistan": return "Uzbekistan Airways"
        case "flynas": return "Flynas"
        case "legacy_import": return "Импорт"
        default: return key
        }
    }
    private func sourceText(_ source: FlightHubStatus.Source) -> String {
        guard source.configured else { return "Нет API-ключа" }
        guard let run = source.last_run else { return "Не запускался" }
        return "\(run.status) · \(run.accepted) обновлено"
    }
    @MainActor private func reload() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            var request = URLRequest(url: AppConfig.flightHubBaseURL.appending(path: "v1/public/status"))
            request.timeoutInterval = 15
            request.cachePolicy = .reloadIgnoringLocalCacheData
            let (statusData, sresponse) = try await URLSession.shared.data(for: request)
            guard let http = sresponse as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                throw URLError(.badServerResponse)
            }
            let parsed = try JSONDecoder().decode(FlightHubStatus.self, from: statusData)
            guard parsed.ok else { throw URLError(.cannotParseResponse) }
            var listRequest = URLRequest(url: AppConfig.flightHubBaseURL.appending(path: "v1/public/flights"))
            listRequest.timeoutInterval = 15
            let (listData, fresponse) = try await URLSession.shared.data(for: listRequest)
            guard let http2 = fresponse as? HTTPURLResponse, (200...299).contains(http2.statusCode) else {
                throw URLError(.badServerResponse)
            }
            let catalog = try JSONDecoder().decode(FlightHubCatalog.self, from: listData)
            self.status = parsed
            self.flights = catalog.flights
            self.error = nil
            self.lastLoaded = Date()
        } catch {
            self.error = error.localizedDescription
            self.status = nil
            self.flights = []
        }
    }
}
