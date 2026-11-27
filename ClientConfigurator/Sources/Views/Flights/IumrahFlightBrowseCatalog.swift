import SwiftUI

/// Browse the existing published catalogue plus cached supplier fares before
/// the traveler supplies exact dates. No per-card supplier calls.
struct IumrahFlightBrowseCatalog: View {
    @EnvironmentObject private var journey: JourneyStore
    @EnvironmentObject private var settings: AppSettingsStore
    let direction: Int
    let refreshSignal: Int
    @ObservedObject var model: IumrahFlightBrowseModel
    var tripOverride: TripDraft? = nil
    var requestedDay: String? = nil
    var requestedSaudiAirport: String? = nil
    var selectedID: String? = nil
    var pairedContextID: String? = nil
    var onAdd: ((LocalJourneyFlight) -> Void)? = nil
    var onSelectionContextChange: (() -> Void)? = nil
    let onChoose: (LocalJourneyFlight) -> Void
    private var trip: TripDraft { tripOverride ?? journey.trip }
    @State private var filters = IumrahFlightFilterState()
    @State private var visibleCount = 20
    private struct SnapshotKey: Equatable {
        let revision: Int
        let origin: String
        let makkahOnly: Bool
        let direction: Int
        let airport: String?
        let selected: String?
        let pair: String?
        let filters: IumrahFlightFilterState
    }
    private struct Snapshot {
        let airlines: [String]
        let days: [IumrahFlightPriceDay]
        let filtered: [LocalJourneyFlight]
    }
    @State private var memo = IumrahViewMemo<SnapshotKey, Snapshot>()
    private var identity: String { "\(trip.originCode):\(trip.effectiveFlightFilters.cabinClass.rawValue):\(refreshSignal)" }
    private var directionFlights: [LocalJourneyFlight] {
        let candidates = model.flights.filter { flight in
            let route = direction == 0 ? flight.origin == trip.originCode : flight.destination == trip.originCode
            let saudi = direction == 0 ? flight.destination : flight.origin
            return route && (trip.scope != .makkahOnly || saudi == "JED") && (requestedSaudiAirport == nil || requestedSaudiAirport == saudi)
        }
        // Keep the chosen exact provider identity and the matching paired itinerary
        // visible, without showing duplicate physical flights in the catalogue.
        func priority(_ flight: LocalJourneyFlight) -> Int {
            if flight.id == selectedID { return 0 }
            if let pairedContextID, flight.publishedID == pairedContextID { return 1 }
            return flight.publishedIsPair == true ? 3 : 2
        }
        var unique: [String: LocalJourneyFlight] = [:]
        for flight in candidates {
            let key = "\(flight.origin):\(flight.destination):\(flight.airlineCode):\(flight.flightNumber):\(String(IumrahFlightClock.local(flight.departureAt, airport: flight.origin).prefix(10)))"
            if let old = unique[key] {
                if priority(flight) < priority(old) { unique[key] = flight }
            } else { unique[key] = flight }
        }
        return Array(unique.values)
    }
    private func filtered(_ flights: [LocalJourneyFlight]) -> [LocalJourneyFlight] {
        flights.filter { filters.accepts(stops: $0.stops, airline: $0.airlineCode, departure: IumrahFlightClock.local($0.departureAt, airport: $0.origin)) }.sorted { a, b in
            if filters.sort == 1, a.displayedPrice != b.displayedPrice { return (a.displayedPrice ?? .infinity) < (b.displayedPrice ?? .infinity) }
            if filters.sort == 2, a.durationMinutes != b.durationMinutes { return (a.durationMinutes > 0 ? a.durationMinutes : Int.max) < (b.durationMinutes > 0 ? b.durationMinutes : Int.max) }
            return a.departureAt == b.departureAt ? a.id < b.id : a.departureAt < b.departureAt
        }
    }
    private func calendarFlights(_ flights: [LocalJourneyFlight]) -> [LocalJourneyFlight] {
        flights.filter { filters.accepts(stops: $0.stops, airline: $0.airlineCode, departure: $0.departureAt, includeDay: false) }
    }
    private func addAction(_ flight: LocalJourneyFlight) -> (() -> Void)? {
        guard let onAdd else { return nil }
        return { onAdd(flight) }
    }
    var body: some View {
        let key = SnapshotKey(revision: model.revision, origin: trip.originCode,
            makkahOnly: trip.scope == .makkahOnly, direction: direction, airport: requestedSaudiAirport,
            selected: selectedID, pair: pairedContextID, filters: filters)
        let snapshot = memo.value(for: key) {
            let flights = directionFlights
            return Snapshot(airlines: Array(Set(flights.map(\.airlineCode))).sorted(),
                days: IumrahFlightSearchControls.priceDays(calendarFlights(flights).map { (IumrahFlightClock.local($0.departureAt, airport: $0.origin), $0.displayedPrice) }),
                filtered: filtered(flights))
        }
        LazyVStack(spacing: 14) {
            IumrahFlightSearchControls(filters: $filters,
                airlines: snapshot.airlines,
                days: snapshot.days,
                onSelectDay: { day in
                    filters.day = day
                    Task { await model.loadDay(day, trip: trip, direction: direction, language: settings.language) }
                })
            if model.loading && snapshot.filtered.isEmpty { ProgressView().frame(maxWidth: .infinity).padding(18) }
            if let error = model.error {
                Text(error).font(.footnote).foregroundStyle(.secondary)
                Button(NuiteeCopy.text("Повторить", "Qayta urinish", "Retry", settings.language)) { Task { await model.load(trip: trip, language: settings.language, force: true) } }
            } else if !model.loading && snapshot.filtered.isEmpty {
                Text(NuiteeCopy.text("Пока нет рейсов на выбранном направлении", "Bu yo‘nalishda reyslar hali yo‘q", "No flights available for this direction", settings.language))
                    .foregroundStyle(.secondary).padding(.vertical, 24)
            }
            ForEach(snapshot.filtered) { flight in
                IumrahFlightResultCard(airline: flight.airline, airlineCode: flight.airlineCode,
                    flightNumber: flight.flightNumber, origin: flight.origin, destination: flight.destination,
                    departureAt: flight.departureAt, arrivalAt: flight.arrivalAt,
                    duration: flight.durationMinutes, stops: flight.stops, price: flight.displayedPrice,
                    isAviasales: flight.id.hasPrefix("feed:"), isRoundTripFare: flight.publishedIsPair == true, selected: selectedID == flight.id, selectedSearchDay: filters.day,
                    onSelect: addAction(flight)) { onChoose(flight) }

            }
        }
        .tint(Color.primary)
        .task(id: identity) {
            filters.day = requestedDay
            await model.load(trip: trip, language: settings.language)
            if let day = requestedDay, !Task.isCancelled { await model.loadDay(day, trip: trip, direction: direction, language: settings.language) }
        }
        .onChange(of: direction) { _, _ in
            visibleCount = 20; filters = IumrahFlightFilterState(); filters.day = requestedDay
        }
        .onChange(of: filters) { _, _ in visibleCount = 20; onSelectionContextChange?() }
        .onChange(of: identity) { _, _ in visibleCount = 20 }
    }
    private var outboundTitle: String {
        switch settings.language { case .russian: return "Туда"; case .uzbek: return "Borish"; case .uzbekCyrillic: return "Бориш"; default: return "Outbound" }
    }
    private var returnTitle: String {
        switch settings.language { case .russian: return "Обратно"; case .uzbek: return "Qaytish"; case .uzbekCyrillic: return "Қайтиш"; default: return "Return" }
    }
}

@MainActor
final class IumrahFlightBrowseModel: ObservableObject {
    @Published private(set) var flights: [LocalJourneyFlight] = [] {
        didSet { revision &+= 1 }
    }
    private(set) var revision = 0
    @Published private(set) var loading = false
    @Published private(set) var error: String?
    private var requestID = UUID()
    private var loadedScope: String?
    private var loadedAt: Date?
    private var activeScope: String?
    private var loadedDays: Set<String> = []
    private func scope(_ trip: TripDraft) -> String { trip.originCode.uppercased() + ":" + trip.effectiveFlightFilters.cabinClass.rawValue }
    func load(trip: TripDraft, language: AppSettingsStore.Language, force: Bool = false) async {
        let key = scope(trip)
        if !force, loadedScope == key, let loadedAt, Date().timeIntervalSince(loadedAt) < 300 { return }
        let same = activeScope == key
        if !same { loadedDays = []; flights = [] }
        activeScope = key
        let trace = IumrahPerformanceTrace.begin("Flight catalogue load")
        defer { IumrahPerformanceTrace.end("Flight catalogue load", trace) }
        let token = UUID(); requestID = token
        loading = true; error = nil
        defer { if requestID == token { loading = false } }
        let origin = trip.originCode.uppercased()
        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: Date())) ?? Date()
        let day = IumrahFlightDiscoveryStore.dayFormatter.string(from: tomorrow)
        var result: [LocalJourneyFlight] = same ? flights : []
        var failures = 0
        do {
            let items = try await CuratedFlightRecommendationService.shared.load(trip: trip, from: Date(), days: 365, force: force)
            for item in items where item.cabinClass.lowercased().replacingOccurrences(of: " ", with: "_") == trip.effectiveFlightFilters.cabinClass.rawValue.lowercased() {
                for leg in [item.outbound, item.inbound].compactMap({ $0 }) where String(leg.departureAt.prefix(10)) >= day {
                    result.append(LocalJourneyFlight(id: "published:\(item.id):\(leg.origin):\(leg.departureAt)",
                        origin: leg.origin, destination: leg.destination, airline: leg.airline,
                        flightNumber: leg.flightNumber, airlineCode: leg.airlineCode,
                        durationMinutes: leg.durationMinutes, stops: leg.stops, departureAt: leg.departureAt,
                        arrivalAt: leg.arrivalAt, displayedPrice: item.fareUsdPerTraveler, publishedID: item.id, publishedIsPair: item.inbound != nil, publishedCabin: leg.cabinClass))
                }
            }
        } catch { failures += 1 }
        guard requestID == token, !Task.isCancelled else { return }
        await publishSorted(result, token: token)
        guard requestID == token, !Task.isCancelled else { return }
        // Both Saudi airports, both directions. Cached monthly feeds include
        // tomorrow onward; published rows above cover the full available year.
        guard trip.effectiveFlightFilters.cabinClass == .economy else { if failures == 0 { loadedScope = key; loadedAt = Date() }; return }
        let months = Set([tomorrow, Calendar.current.date(byAdding: .month, value: 1, to: tomorrow) ?? tomorrow]
            .map { IumrahFlightDiscoveryStore.monthFormatter.string(from: $0) })
        for airport in ["JED", "MED"] {
            for route in [(origin, airport), (airport, origin)] {
                for month in months.sorted() {
                    guard requestID == token, !Task.isCancelled else { return }
                    do {
                        let response = try await AviasalesFlightDiscoveryService().offers(origin: route.0, destination: route.1,
                            departure: month, direct: false, limit: 200)
                        for offer in response.offers where !offer.isRoundTrip && offer.origin == route.0 && offer.destination == route.1
                            && String(offer.departureAt.prefix(10)) >= day {
                            result.append(LocalJourneyFlight(id: "feed:\(offer.id)", origin: offer.origin,
                                destination: offer.destination, airline: offer.airlineName, flightNumber: offer.flightNumber,
                                airlineCode: offer.airlineCode, durationMinutes: offer.durationMinutes, stops: offer.transfers,
                                departureAt: offer.departureAt, arrivalAt: offer.arrivalAt ?? FlightDiscoveryItineraryValidator.verified(offer.outboundSegments, origin: offer.origin, destination: offer.destination, transfers: offer.transfers)?.last?.arrivalAt, displayedPrice: offer.price > 0 ? offer.price : nil, discoveryOffer: offer))
                        }
                    } catch { failures += 1 }
                    guard requestID == token, !Task.isCancelled else { return }
                }
                // Publish once per route instead of rebuilding the calendar twice per route.
                await publishSorted(result, token: token)
                guard requestID == token, !Task.isCancelled else { return }
            }
        }
        if failures == 0 { loadedScope = key; loadedAt = Date() }
        if failures > 0 && result.isEmpty {
            error = NuiteeCopy.text("Не удалось загрузить рейсы. Нажмите «Повторить».", "Reyslar yuklanmadi. «Qayta urinish» tugmasini bosing.", "Could not load flights. Tap Retry.", language)
        }
    }
    func loadDay(_ day: String, trip: TripDraft, direction: Int, language: AppSettingsStore.Language) async {
        let trace = IumrahPerformanceTrace.begin("Flight day load")
        defer { IumrahPerformanceTrace.end("Flight day load", trace) }
        guard trip.effectiveFlightFilters.cabinClass == .economy else { return }
        let dayKey = scope(trip) + ":" + String(direction) + ":" + day
        if loadedDays.contains(dayKey), let loadedAt, Date().timeIntervalSince(loadedAt) < 300 { return }
        let token = UUID(); requestID = token
        loading = true; error = nil
        defer { if requestID == token { loading = false } }
        var result = flights
        var failures = 0
        let origin = trip.originCode.uppercased()
        for airport in ["JED", "MED"] {
            guard requestID == token, !Task.isCancelled else { return }
            let from = direction == 0 ? origin : airport
            let to = direction == 0 ? airport : origin
            do {
                let response = try await AviasalesFlightDiscoveryService().offers(origin: from, destination: to, departure: day, direct: false, limit: 200)
                for offer in response.offers where !offer.isRoundTrip && offer.origin == from && offer.destination == to {
                    result.append(LocalJourneyFlight(id: "feed:\(offer.id)", origin: offer.origin, destination: offer.destination,
                        airline: offer.airlineName, flightNumber: offer.flightNumber, airlineCode: offer.airlineCode,
                        durationMinutes: offer.durationMinutes, stops: offer.transfers, departureAt: offer.departureAt,
                        arrivalAt: offer.arrivalAt ?? FlightDiscoveryItineraryValidator.verified(offer.outboundSegments, origin: offer.origin, destination: offer.destination, transfers: offer.transfers)?.last?.arrivalAt,
                        displayedPrice: offer.price > 0 ? offer.price : nil, discoveryOffer: offer))
                }
            } catch { failures += 1 }
        }
        guard requestID == token, !Task.isCancelled else { return }
        await publishSorted(result, token: token)
        guard requestID == token, !Task.isCancelled else { return }
        if failures == 0 { loadedDays.insert(dayKey) }
        if failures == 2 {
            error = NuiteeCopy.text("Не удалось загрузить рейсы на эту дату.", "Bu sana uchun reyslar yuklanmadi.", "Could not load flights for this date.", language)
        }
    }
    private func publishSorted(_ values: [LocalJourneyFlight], token: UUID) async {
        // The input is an immutable value snapshot; only the final assignment
        // touches the MainActor. A superseded search must never publish.
        let sorted = await Task.detached(priority: .userInitiated) {
            Self.sortedUnique(values)
        }.value
        guard requestID == token, !Task.isCancelled else { return }
        if flights != sorted { flights = sorted }
    }
    nonisolated private static func sortedUnique(_ values: [LocalJourneyFlight]) -> [LocalJourneyFlight] {
        var unique: [String: LocalJourneyFlight] = [:]
        for flight in values {
            let source = flight.publishedIsPair == true ? "pair:" + (flight.publishedID ?? flight.id) : "independent"
            let key = "\(flight.origin):\(flight.destination):\(flight.airlineCode):\(flight.flightNumber):\(flight.departureAt.prefix(10)):\(source)"
            if unique[key] == nil || (unique[key]?.displayedPrice == nil && flight.displayedPrice != nil) { unique[key] = flight }
        }
        return unique.values.sorted { $0.departureAt < $1.departureAt }
    }
}
