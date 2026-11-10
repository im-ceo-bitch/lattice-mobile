import Foundation
import SwiftUI

// Production operator catalog: flight identity is stable; prices remain source observations.
// No provider or Cloudflare secrets are ever shipped to an iOS client.
private struct FlightHubStatus: Decodable {
    struct Counts: Decodable {
        let flights: Int
        let offers: Int
        let unmatched: Int
        let priced_flights: Int?
        let review: Int?
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
        let tracked_flights: Int?
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
            let adults: Int
            let children: Int
            let infants: Int
            let amount_minor: Int64
            let previous_amount_minor: Int64?
            let currency: String
            let checked_at: String
            let price_scope: String
            let fresh: Bool
            let baggage_checked_kg: Double?
            let baggage_cabin_kg: Double?
            let seats_left: Int?
            let source_url: String?
            var id: String { "\(provider)|\(fare_brand)|\(currency)|\(adults)|\(children)|\(infants)" }
        }
        let flight_key: String
        let airline_code: String
        let flight_number: String
        let origin: String
        let destination: String
        let departure_date: String
        let departure_at: String?
        let arrival_at: String?
        let offers: [Offer]
        var id: String { flight_key }
        var activeOffers: [Offer] {
            offers.filter { $0.fresh }.sorted { $0.checked_at > $1.checked_at }
        }
    }
    let ok: Bool
    let flights: [Flight]
    let total: Int?
    let has_more: Bool?
}

struct FlightHubMonitorView: View {
    @State private var status: FlightHubStatus?
    @State private var flights: [FlightHubCatalog.Flight] = []
    @State private var loading = false
    @State private var loadingMore = false
    @State private var error: String?
    @State private var lastLoaded: Date?
    @State private var searchText = ""
    @State private var airline = "ALL"
    @State private var onlyFresh = false
    @State private var nextPage = 0
    @State private var hasMore = false
    @State private var totalFlights = 0

    // One backend endpoint; legacy saved Flight Hub URLs are never used.
    private var activeHubURL: URL { AppConfig.flightHubBaseURL }

    private let pageSize = 50
    private let airlineOptions = ["ALL", "C6", "HY", "XY"]

    private var visibleFlights: [FlightHubCatalog.Flight] {
        flights.filter { flight in
            let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            return (airline == "ALL" || flight.airline_code == airline)
                && (!onlyFresh || !flight.activeOffers.isEmpty)
                && (q.isEmpty || [flight.flight_number, flight.origin, flight.destination,
                                  flight.departure_date, flight.airline_code].contains { $0.uppercased().contains(q) })
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Авиакаталог iumrah").font(.title3.weight(.bold))
                    Text("Единая D1 · рейсы на 30 дней · цены от поставщиков")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 4)
                Button { Task { await reload() } } label: {
                    if loading { ProgressView() }
                    else { Image(systemName: "arrow.clockwise").font(.headline) }
                }
                .buttonStyle(.bordered)
                .accessibilityLabel("Обновить авиакаталог")
                .disabled(loading || loadingMore)
            }

            if let error {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "wifi.exclamationmark").foregroundStyle(.orange)
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Авиабаза недоступна").font(.subheadline.weight(.semibold))
                        Text(error).font(.caption).foregroundStyle(.secondary)
                        Text("Проверьте подключение к единому iumrah Backend.")
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
                    metric("С актуальной ценой", value: status.counts.priced_flights ?? 0)
                    metric("Требуют проверки", value: status.counts.unmatched + (status.counts.review ?? 0))
                }
                sourcesSection(status.sources)
            }

            if status != nil {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Каталог рейсов").font(.headline)
                        Spacer()
                        Text("Загружено \(flights.count) из \(totalFlights)")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                        TextField("Рейс, аэропорт или дата", text: $searchText)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 11)
                    .background(BusinessDesign.card, in: RoundedRectangle(cornerRadius: 12))

                    Picker("Авиакомпания", selection: $airline) {
                        Text("Все").tag("ALL")
                        Text("Centrum").tag("C6")
                        Text("Uzbekistan").tag("HY")
                        Text("Flynas").tag("XY")
                    }
                    .pickerStyle(.segmented)

                    Toggle("Только рейсы с актуальной ценой", isOn: $onlyFresh)
                        .font(.caption)
                        .tint(.green)

                    if visibleFlights.isEmpty {
                        ContentUnavailableView("Нет подходящих рейсов", systemImage: "airplane",
                            description: Text(flights.isEmpty
                                ? "Добавьте действующие рейсы из каталога Business или Ignav. Боты обновляют только существующие рейсы."
                                : "Измените фильтры. У некоторых рейсов цена ещё не проверена."))
                    } else {
                        LazyVStack(spacing: 10) {
                            ForEach(visibleFlights) { flight in flightRow(flight) }
                        }
                    }
                    if hasMore {
                        Button {
                            Task { await loadMore() }
                        } label: {
                            if loadingMore { ProgressView() }
                            else { Label("Показать ещё рейсы", systemImage: "arrow.down.circle") }
                        }
                        .buttonStyle(.bordered)
                        .frame(maxWidth: .infinity)
                        .disabled(loadingMore || loading)
                    }
                }
            }
            if let lastLoaded {
                Text("Каталог обновлён: \(lastLoaded.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .task { if lastLoaded == nil { await reload() } }
    }

    private func metric(_ title: String, value: Int) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Text(value.formatted()).font(.title3.weight(.bold))
        }
        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
        .padding(10)
        .background(BusinessDesign.card, in: RoundedRectangle(cornerRadius: 12))
    }

    private func sourcesSection(_ sources: [FlightHubStatus.Source]) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("Состояние источников").font(.subheadline.weight(.semibold))
            ForEach(sources) { source in
                HStack(spacing: 9) {
                    Image(systemName: sourceIcon(source))
                        .foregroundStyle(sourceColor(source))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(sourceTitle(source.name)).font(.subheadline.weight(.medium))
                        if let tracked = source.tracked_flights {
                            Text("В каталоге: \(tracked) рейсов").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 3)
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(sourceState(source)).font(.caption.weight(.medium))
                        if let run = source.last_run {
                            Text("\(run.accepted) обновлено · \(run.checked_at.prefix(10))")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(.vertical, 5)
            }
            Text("Цены сайтов — наблюдаемые, не гарантированные для оплаты. При оформлении требуется повторная проверка.")
                .font(.caption2).foregroundStyle(.secondary)
        }
        .padding(14)
        .background(BusinessDesign.card, in: RoundedRectangle(cornerRadius: 14))
    }

    private func flightRow(_ flight: FlightHubCatalog.Flight) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(flight.origin)  →  \(flight.destination)")
                        .font(.subheadline.weight(.bold))
                    Text("\(sourceTitle(sourceCode(flight.airline_code))) · \(flight.flight_number)")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 4)
                VStack(alignment: .trailing, spacing: 4) {
                    Text(flight.departure_date).font(.caption.weight(.medium))
                    if flight.activeOffers.isEmpty {
                        Text("Нет свежей цены").font(.caption2).foregroundStyle(.orange)
                    } else {
                        Label("Цена проверена", systemImage: "checkmark.circle")
                            .font(.caption2).foregroundStyle(.green)
                    }
                }
            }
            Divider()
            if flight.offers.isEmpty {
                Label("Ожидается первое обновление цены", systemImage: "clock.arrow.circlepath")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                let ranked = flight.offers.sorted {
                    if $0.fresh != $1.fresh { return $0.fresh && !$1.fresh }
                    return $0.checked_at > $1.checked_at
                }
                ForEach(Array(ranked.prefix(4))) { offer in offerRow(offer) }
                if flight.offers.count > 4 {
                    Text("Ещё \(flight.offers.count - 4) тарифов в базе")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .padding(14)
        .background(BusinessDesign.card, in: RoundedRectangle(cornerRadius: 14))
    }

    private func offerRow(_ offer: FlightHubCatalog.Flight.Offer) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(sourceTitle(offer.provider)).font(.caption.weight(.medium))
                    Text("\(offer.adults) взр.\(offer.fare_brand.isEmpty ? "" : " · \(offer.fare_brand)")")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                Spacer(minLength: 4)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(formattedPrice(offer.amount_minor, currency: offer.currency))
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(offer.fresh ? Color.primary : Color.secondary)
                    if let previous = offer.previous_amount_minor, previous != offer.amount_minor {
                        let difference = offer.amount_minor - previous
                        Text("\(difference > 0 ? "+" : "")\(formattedPrice(difference, currency: offer.currency))")
                            .font(.caption2)
                            .foregroundStyle(difference > 0 ? Color.orange : Color.green)
                    }
                }
            }
            HStack(spacing: 10) {
                if let checked = offer.baggage_checked_kg {
                    Label("Багаж \(checked.formatted()) кг", systemImage: "suitcase")
                }
                if let carry = offer.baggage_cabin_kg {
                    Label("Ручная \(carry.formatted()) кг", systemImage: "bag")
                }
                if offer.fresh, let seats = offer.seats_left {
                    Label("Мест по тарифу: \(seats)", systemImage: "person.2")
                }
            }
            .font(.caption2).foregroundStyle(.secondary)
            Text(offer.fresh ? "Проверено: \(offer.checked_at.prefix(16).replacingOccurrences(of: "T", with: " "))" : "Данные устарели — перепроверить цену")
                .font(.caption2).foregroundStyle(offer.fresh ? Color.secondary : Color.orange)
        }
        .padding(.vertical, 3)
    }

    private func formattedPrice(_ minor: Int64, currency: String) -> String {
        let divisor: Double = currency == "UZS" ? 1 : 100
        return String(format: divisor == 1 ? "%.0f %@" : "%.2f %@", Double(minor) / divisor, currency)
    }

    private func sourceCode(_ code: String) -> String {
        switch code { case "C6": return "centrum"; case "HY": return "uzbekistan"; case "XY": return "flynas"; default: return code }
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
    private func sourceIcon(_ source: FlightHubStatus.Source) -> String {
        if !source.configured { return "exclamationmark.circle" }
        if let run = source.last_run, run.status == "ok" { return "checkmark.circle.fill" }
        if source.last_run != nil { return "exclamationmark.triangle" }
        return "clock.arrow.circlepath"
    }
    private func sourceColor(_ source: FlightHubStatus.Source) -> Color {
        if !source.configured { return .orange }
        if source.last_run?.status == "ok" { return .green }
        return .secondary
    }
    private func sourceState(_ source: FlightHubStatus.Source) -> String {
        if !source.configured { return "Не подключён" }
        guard let run = source.last_run else { return "Не запускался" }
        switch run.status {
        case "ok": return "Проверено"
        case "partial": return "Частично"
        case "no_tasks": return "Нет рейсов"
        case "blocked": return "Блокировка сайта"
        case "site_changed": return "Сайт изменился"
        default: return "Требует проверки"
        }
    }

    @MainActor private func fetchPage(_ page: Int) async throws -> FlightHubCatalog {
        var parts = URLComponents(url: activeHubURL.appending(path: "v1/public/flights"), resolvingAgainstBaseURL: false)
        parts?.queryItems = [URLQueryItem(name: "limit", value: String(pageSize)), URLQueryItem(name: "page", value: String(page))]
        guard let url = parts?.url else { throw URLError(.badURL) }
        var req = URLRequest(url: url)
        req.timeoutInterval = 20
        req.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { throw URLError(.badServerResponse) }
        let result = try JSONDecoder().decode(FlightHubCatalog.self, from: data)
        guard result.ok else { throw URLError(.cannotParseResponse) }
        return result
    }

    @MainActor private func reload() async {
        guard !loading && !loadingMore else { return }
        loading = true
        defer { loading = false }
        do {
            var req = URLRequest(url: activeHubURL.appending(path: "v1/public/status"))
            req.timeoutInterval = 20
            req.cachePolicy = .reloadIgnoringLocalCacheData
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { throw URLError(.badServerResponse) }
            let newStatus = try JSONDecoder().decode(FlightHubStatus.self, from: data)
            guard newStatus.ok else { throw URLError(.cannotParseResponse) }
            let page = try await fetchPage(0)
            status = newStatus
            flights = page.flights
            hasMore = page.has_more ?? false
            totalFlights = page.total ?? page.flights.count
            nextPage = 1
            error = nil
            lastLoaded = Date()
        } catch {
            self.error = error.localizedDescription
            status = nil
            flights = []
            hasMore = false
        }
    }

    @MainActor private func loadMore() async {
        guard hasMore && !loading && !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        do {
            let page = try await fetchPage(nextPage)
            let previous = Set(flights.map(\.flight_key))
            flights.append(contentsOf: page.flights.filter { !previous.contains($0.flight_key) })
            hasMore = page.has_more ?? false
            nextPage += 1
        } catch { self.error = error.localizedDescription }
    }
}
