import SwiftUI

/// Staff-published D1 catalogue only. Never calls the live flight discovery API.
@MainActor final class IumrahPublishedCarouselCatalog: ObservableObject {
    static let shared = IumrahPublishedCarouselCatalog()
    @Published private(set) var rows: [String: [CuratedFlightRecommendation]] = [:]
    @Published private(set) var failures: Set<String> = []
    private var fetched: [String: Date] = [:]
    private var inFlight: [String: Task<Void, Never>] = [:]
    func load(_ trip: TripDraft, force: Bool = false) async {
        let key = trip.originCode.uppercased()
        if let running = inFlight[key] { await running.value; return }
        if !force, let date = fetched[key], Date().timeIntervalSince(date) < 300 { return }
        let task = Task { @MainActor in
            defer { inFlight[key] = nil }
            do {
                let result = try await CuratedFlightRecommendationService.shared.load(trip: trip, from: Date(), days: 365, force: force)
                if rows[key] != result { rows[key] = result }
                fetched[key] = Date(); failures.remove(key)
            } catch { failures.insert(key) }
        }
        inFlight[key] = task
        await task.value
    }
    func flights(_ trip: TripDraft, direction: Int, selected: LocalJourneyFlight?, other: LocalJourneyFlight?) -> [LocalJourneyFlight] {
        let origin = trip.originCode.uppercased()
        let saudi = direction == 0 ? trip.outboundDestinationCode : trip.returnOriginCode
        let cabin = trip.effectiveFlightFilters.cabinClass.rawValue.lowercased()
        let today = Calendar.current.startOfDay(for: Date())
        var items: [LocalJourneyFlight] = []
        for row in rows[origin] ?? [] where row.nonstop && row.cabinClass.lowercased().replacingOccurrences(of: " ", with: "_") == cabin {
            for leg in [row.outbound, row.inbound].compactMap({ $0 }) where leg.stops == 0 && leg.cabinClass.lowercased().replacingOccurrences(of: " ", with: "_") == cabin {
                guard direction == 0 ? (leg.origin == origin && leg.destination == saudi) : (leg.origin == saudi && leg.destination == origin) else { continue }
                guard let date = Self.day(leg.departureAt, leg.origin), date >= today, let price = row.fareUsdPerTraveler, price.isFinite, price > 0 else { continue }
                let flight = LocalJourneyFlight(id: "published:\(row.id):\(leg.origin):\(leg.departureAt)", origin: leg.origin.uppercased(), destination: leg.destination.uppercased(), airline: leg.airline, flightNumber: leg.flightNumber, airlineCode: leg.airlineCode, durationMinutes: leg.durationMinutes, stops: leg.stops, departureAt: leg.departureAt, arrivalAt: leg.arrivalAt, displayedPrice: price, publishedID: row.id, publishedIsPair: row.inbound != nil, publishedCabin: leg.cabinClass)
                if direction == 1, let other, !Self.compatible(other, flight, scope: trip.scope) { continue }
                items.append(flight)
            }
        }
        // Preserve canonical pair IDs; only deduplicate truly identical publications.
        var seen = Set<String>()
        return items.sorted { a,b in
            return a.departureAt == b.departureAt ? a.id < b.id : a.departureAt < b.departureAt
        }.filter { seen.insert($0.id).inserted }
    }
    static func day(_ value: String, _ airport: String) -> Date? {
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.calendar = Calendar(identifier: .gregorian); formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: String(IumrahFlightClock.local(value, airport: airport).prefix(10)))
    }
    static func compatible(_ outbound: LocalJourneyFlight, _ inbound: LocalJourneyFlight, scope: JourneyScope) -> Bool {
        guard outbound.origin == inbound.destination, let raw = outbound.arrivalAt,
              let arrival = day(raw, outbound.destination), let returning = day(inbound.departureAt, inbound.origin), returning > arrival else { return false }
        if scope == .makkahAndMadinah && (Calendar.current.dateComponents([.day], from: arrival, to: returning).day ?? 0) < 2 { return false }
        if scope == .makkahOnly && (outbound.destination != "JED" || inbound.origin != "JED") { return false }
        if outbound.publishedIsPair == true || inbound.publishedIsPair == true { return outbound.publishedIsPair == true && inbound.publishedIsPair == true && outbound.publishedID == inbound.publishedID }
        return outbound.publishedID != inbound.publishedID
    }
}

struct IumrahPublishedFlightCarousel: View {
    @EnvironmentObject private var settings: AppSettingsStore
    @ObservedObject private var catalog = IumrahPublishedCarouselCatalog.shared
    let trip: TripDraft
    let direction: Int
    var selected: LocalJourneyFlight?
    var other: LocalJourneyFlight?
    var showTitle = true
    let onSelect: (LocalJourneyFlight) -> Void
    let onOpen: (LocalJourneyFlight) -> Void
    private func t(_ r: String,_ e: String,_ u: String,_ c: String) -> String { IumrahFlightCopy.text(settings.language,r,e,u,c) }
    var body: some View {
        let flights = catalog.flights(trip, direction: direction, selected: selected, other: other)
        VStack(alignment: .leading, spacing: 12) {
            if showTitle { Text(t("Прямые рейсы", "Direct flights", "To‘g‘ri reyslar", "Тўғри рейслар")).font(.system(.title2, design: .rounded, weight: .bold)) }
            if flights.isEmpty {
                if catalog.failures.contains(trip.originCode.uppercased()) {
                    Button(t("Обновить рейсы", "Refresh flights", "Reyslarni yangilash", "Рейсларни янгилаш")) { Task { await catalog.load(trip, force: true) } }.buttonStyle(.bordered)
                } else if catalog.rows[trip.originCode.uppercased()] != nil {
                    Text(t("Нет опубликованных рейсов по этому направлению", "No published flights for this route", "Bu yo‘nalishda e’lon qilingan reyslar yo‘q", "Бу йўналишда эълон қилинган рейслар йўқ")).font(.footnote).foregroundStyle(.secondary)
                } else { Text(t("Получаем расписание рейсов", "Getting flight schedules", "Reyslar jadvali olinmoqda", "Рейслар жадвали олинмоқда")).font(.footnote).foregroundStyle(.secondary) }
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: 12) {
                        ForEach(flights) { flight in
                            IumrahFlightResultCard(airline: flight.airline, airlineCode: flight.airlineCode, flightNumber: flight.flightNumber, origin: flight.origin, destination: flight.destination, departureAt: flight.departureAt, arrivalAt: flight.arrivalAt, duration: flight.durationMinutes, stops: flight.stops, price: flight.displayedPrice, isAviasales: false, isRoundTripFare: flight.publishedIsPair == true, selected: selected?.id == flight.id, selectionAccent: .primary, onSelect: { onSelect(flight) }, action: { onOpen(flight) })
                                .containerRelativeFrame(.horizontal) { width, _ in min(330, width * 0.86) }
                        }
                    }.scrollTargetLayout()
                }.scrollTargetBehavior(.viewAligned)
            }
        }.task(id: trip.originCode.uppercased()) { await catalog.load(trip) }
    }
}

@MainActor final class IumrahHomePublishedSelection: ObservableObject {
    @Published var outbound: LocalJourneyFlight?
    @Published var inbound: LocalJourneyFlight?
    var complete: Bool { outbound != nil && inbound != nil }
    func clear() { outbound = nil; inbound = nil }
    func canContinue(_ trip: TripDraft) -> Bool {
        guard let a = outbound, let b = inbound, trip.canContinue,
              IumrahAllPublishedFlightStore.isFuture(a), IumrahAllPublishedFlightStore.isFuture(b),
              a.origin == trip.originCode, a.destination == trip.outboundDestinationCode,
              b.origin == trip.returnOriginCode, b.destination == trip.originCode,
              let departure = IumrahPublishedCarouselCatalog.day(a.departureAt, a.origin),
              let returning = IumrahPublishedCarouselCatalog.day(b.departureAt, b.origin),
              Calendar.current.isDate(departure, inSameDayAs: trip.departureDate),
              Calendar.current.isDate(returning, inSameDayAs: trip.returnDate) else { return false }
        let cabin = trip.effectiveFlightFilters.cabinClass.rawValue.lowercased()
        return [a,b].allSatisfy { $0.publishedCabin?.lowercased().replacingOccurrences(of: " ", with: "_") == cabin }
            && IumrahPublishedCarouselCatalog.compatible(a,b,scope: trip.scope)
    }
    func reconcile(_ trip: TripDraft) {
        if let f = outbound, f.origin != trip.originCode || f.destination != trip.outboundDestinationCode || f.publishedCabin?.lowercased().replacingOccurrences(of: " ", with: "_") != trip.effectiveFlightFilters.cabinClass.rawValue.lowercased() || IumrahPublishedCarouselCatalog.day(f.departureAt, f.origin).map({ !Calendar.current.isDate($0, inSameDayAs: trip.departureDate) }) != false { outbound = nil }
        if let f = inbound, f.destination != trip.originCode || f.origin != trip.returnOriginCode || f.publishedCabin?.lowercased().replacingOccurrences(of: " ", with: "_") != trip.effectiveFlightFilters.cabinClass.rawValue.lowercased() || IumrahPublishedCarouselCatalog.day(f.departureAt, f.origin).map({ !Calendar.current.isDate($0, inSameDayAs: trip.returnDate) }) != false { inbound = nil }
    }
    @discardableResult func choose(_ flight: LocalJourneyFlight, direction: Int, journey: JourneyStore) -> Bool {
        // Selection is reversible, and an incompatible second leg never silently discards the first.
        if direction == 0, outbound?.id == flight.id { outbound = nil; IumrahHaptics.selection(); return true }
        if direction == 1, inbound?.id == flight.id { inbound = nil; IumrahHaptics.selection(); return true }
        guard let next = proposedTrip(flight, direction: direction, trip: journey.trip) else { return false }
        if direction == 0 { outbound = flight } else { inbound = flight }
        journey.trip = next
        IumrahHaptics.selection(); return true
    }

    private func proposedTrip(_ flight: LocalJourneyFlight, direction: Int, trip: TripDraft) -> TripDraft? {
        guard IumrahAllPublishedFlightStore.direction(of: flight) == direction,
              flight.publishedID != nil, flight.stops == 0, IumrahAllPublishedFlightStore.isFuture(flight),
              let price = flight.displayedPrice, price.isFinite, price > 0,
              let cabin = FlightCabinClass(rawValue: flight.publishedCabin?.lowercased().replacingOccurrences(of: " ", with: "_") ?? ""),
              let day = IumrahPublishedCarouselCatalog.day(flight.departureAt, flight.origin),
              let rawArrival = flight.arrivalAt, IumrahPublishedCarouselCatalog.day(rawArrival, flight.destination) != nil else { return nil }
        var next = trip
        let origin = direction == 0 ? flight.origin : flight.destination
        let saudi = direction == 0 ? flight.destination : flight.origin
        guard let airport = SaudiArrivalAirport(rawValue: saudi) else { return nil }
        let other = direction == 0 ? inbound : outbound
        if let other {
            guard other.publishedCabin?.lowercased().replacingOccurrences(of: " ", with: "_") == cabin.rawValue,
                  IumrahAllPublishedFlightStore.isFuture(other) else { return nil }
        }
        // The full Home catalogue is not filtered by the search form. Selecting a leg
        // updates the form's actual airport, cabin and dates, preserving family/room settings.
        if next.originCode != origin { next.origin = origin; next.originAirport = AirportMapBootstrapCatalog.airport(code: origin) }
        var filters = next.effectiveFlightFilters; filters.cabinClass = cabin; next.flightFilters = filters
        next.flightTripType = .roundTrip; next.flexibility = .exact; next.saudiArrivalDate = nil
        if airport == .madinah { next.scope = .makkahAndMadinah }
        if direction == 0 {
            next.arrivalAirport = airport; next.departureDate = day
            if let other {
                guard IumrahPublishedCarouselCatalog.compatible(flight, other, scope: next.scope),
                      let back = IumrahPublishedCarouselCatalog.day(other.departureAt, other.origin) else { return nil }
                next.returnDate = back; next.selectedReturnAirport = SaudiArrivalAirport(rawValue: other.origin)
            } else {
                next.selectedReturnAirport = nil
                let arrival = IumrahPublishedCarouselCatalog.day(rawArrival, flight.destination) ?? day
                let minimum = Calendar.current.date(byAdding: .day, value: next.scope == .makkahAndMadinah ? 2 : 1, to: arrival) ?? arrival
                if next.returnDate < minimum { next.returnDate = Calendar.current.date(byAdding: .day, value: 7, to: arrival) ?? minimum }
            }
        } else {
            next.selectedReturnAirport = airport; next.returnDate = day
            if let other {
                guard IumrahPublishedCarouselCatalog.compatible(other, flight, scope: next.scope),
                      let departure = IumrahPublishedCarouselCatalog.day(other.departureAt, other.origin) else { return nil }
                next.departureDate = departure; next.arrivalAirport = SaudiArrivalAirport(rawValue: other.destination) ?? .jeddah
            } else {
                if next.scope == .makkahOnly { next.arrivalAirport = .jeddah }
                if next.departureDate >= day {
                    let today = Calendar.current.startOfDay(for: Date())
                    guard let earlier = Calendar.current.date(byAdding: .day, value: -7, to: day), day > today else { return nil }
                    next.departureDate = max(today, earlier)
                }
            }
        }
        guard next.canContinue else { return nil }
        return next
    }
    func commit(_ journey: JourneyStore) -> Bool {
        guard canContinue(journey.trip), let a = outbound, let b = inbound, let aID = a.publishedID, let bID = b.publishedID,
              IumrahAllPublishedFlightStore.isFuture(a), IumrahAllPublishedFlightStore.isFuture(b),
              a.origin == journey.trip.originCode, b.destination == journey.trip.originCode,
              a.destination == journey.trip.outboundDestinationCode, b.origin == journey.trip.returnOriginCode,
              a.publishedCabin?.lowercased().replacingOccurrences(of: " ", with: "_") == journey.trip.effectiveFlightFilters.cabinClass.rawValue,
              b.publishedCabin?.lowercased().replacingOccurrences(of: " ", with: "_") == journey.trip.effectiveFlightFilters.cabinClass.rawValue,
              IumrahPublishedCarouselCatalog.compatible(a,b,scope: journey.trip.scope),
              let departure = IumrahPublishedCarouselCatalog.day(a.departureAt,a.origin), let raw = a.arrivalAt,
              let arrival = IumrahPublishedCarouselCatalog.day(raw,a.destination), let back = IumrahPublishedCarouselCatalog.day(b.departureAt,b.origin), journey.trip.canContinue else { return false }
        if journey.localJourneyFlights.map(\.id) == [a.id,b.id] && journey.hasCompleteStagedFlightSelection { return true }
        journey.resetAfterTripChange(); journey.clearStagedUmrahFlights()
        journey.trip.departureDate = departure; journey.trip.returnDate = back; journey.trip.saudiArrivalDate = arrival
        journey.trip.flightTripType = .roundTrip; journey.trip.flexibility = .exact
        journey.trip.selectedReturnAirport = SaudiArrivalAirport(rawValue: b.origin)
        journey.packageFlightPath = .publishedDirect
        func stage(_ f: LocalJourneyFlight, _ kind: StagedUmrahFlightKind, pair: LocalJourneyFlight? = nil) {
            journey.stageUmrahFlight(.init(id: f.id, kind: kind, origin: f.origin, destination: f.destination, airline: f.airline, flightNumber: f.flightNumber, departureAt: f.departureAt, returnAt: pair?.departureAt, returnAirline: pair?.airline, returnFlightNumber: pair?.flightNumber, source: "iumrah"))
        }
        if a.publishedIsPair == true { journey.selectedPublishedCompleteID = aID; stage(a,.roundTrip,pair:b) }
        else { journey.selectedPublishedOutboundID = aID; journey.selectedPublishedReturnID = bID; stage(a,.outbound); stage(b,.inbound) }
        journey.prepareFlightFirstHotelStage(); journey.usesLocalJourney = true; journey.localJourneyFlights = [a,b]
        return true
    }
}

// Home discovery keeps the complete catalogue, but ranks the current trip first.
// The original route-scoped carousel remains available to all configurators.
@MainActor final class IumrahAllPublishedFlightStore: ObservableObject {
    static let shared = IumrahAllPublishedFlightStore()
    @Published private(set) var flights: [LocalJourneyFlight] = []
    @Published private(set) var loaded = false
    @Published private(set) var loading = false
    @Published private(set) var failed = false
    @Published private(set) var complete = false
    private var fetched: Date?
    private var departureInstants: [String: Date] = [:]
    private var request: Task<Void, Never>?

    func load(force: Bool = false) async {
        if let request { await request.value; return }
        if !force, let fetched, Date().timeIntervalSince(fetched) < 300 { return }
        let task = Task { @MainActor in
            loading = true
            defer { loading = false; request = nil }
            do {
                let board = try await HotelStorefrontService().flightBoard(allPublished: true)
                guard board.ok else { throw APIError.invalidResponse }
                let next = Self.flatten(board.options)
                departureInstants = Dictionary(uniqueKeysWithValues: next.compactMap { flight in
                    Self.departureInstant(flight).map { (flight.id, $0) }
                })
                flights = next
                complete = board.catalogComplete == true
                loaded = true; failed = false; fetched = Date()
            } catch {
                failed = true
            }
        }
        request = task
        await task.value
    }

    nonisolated static func direction(of flight: LocalJourneyFlight) -> Int? {
        let saudi: Set<String> = ["JED", "MED"]
        if saudi.contains(flight.destination) && !saudi.contains(flight.origin) { return 0 }
        if saudi.contains(flight.origin) && !saudi.contains(flight.destination) { return 1 }
        return nil
    }

    func visibleFlights(direction: Int?, now: Date = Date()) -> [LocalJourneyFlight] {
        flights.filter { flight in
            (departureInstants[flight.id].map { $0 >= now } ?? false) &&
            (direction == nil || Self.direction(of: flight) == direction)
        }
    }

    // Keep the requested route chronological, including dates before the anchor.
    // Other published flights remain after that group; selection does not hide them.
    static func prioritized(_ flights: [LocalJourneyFlight], trip: TripDraft, direction: Int,
                            other: LocalJourneyFlight?, departureInstants: [String: Date]) -> [LocalJourneyFlight] {
        let origin = direction == 0 ? trip.originCode : trip.returnOriginCode
        let destination = direction == 0 ? trip.outboundDestinationCode : trip.originCode
        let cabin = trip.effectiveFlightFilters.cabinClass.rawValue.lowercased()
        func rank(_ flight: LocalJourneyFlight) -> Int {
            guard flight.origin == origin, flight.destination == destination else { return 2 }
            return flight.publishedCabin?.lowercased().replacingOccurrences(of: " ", with: "_") == cabin ? 0 : 1
        }
        return flights.sorted { a,b in
            let ar = rank(a), br = rank(b)
            if ar != br { return ar < br }
            let first = departureInstants[a.id] ?? .distantFuture
            let second = departureInstants[b.id] ?? .distantFuture
            return first == second ? a.id < b.id : first < second
        }
    }

    static func dateAnchor(_ flights: [LocalJourneyFlight], trip: TripDraft, direction: Int, other: LocalJourneyFlight?) -> String? {
        let origin = direction == 0 ? trip.originCode : trip.returnOriginCode
        let destination = direction == 0 ? trip.outboundDestinationCode : trip.originCode
        let cabin = trip.effectiveFlightFilters.cabinClass.rawValue.lowercased()
        var target = Calendar.current.startOfDay(for: direction == 0 ? trip.departureDate : trip.returnDate)
        if direction == 1, let other, let raw = other.arrivalAt,
           let arrival = IumrahPublishedCarouselCatalog.day(raw, other.destination),
           let minimum = Calendar.current.date(byAdding: .day, value: trip.scope == .makkahAndMadinah ? 2 : 1, to: arrival) {
            target = max(target, Calendar.current.startOfDay(for: minimum))
        }
        let route = flights.filter { $0.origin == origin && $0.destination == destination }
        let sameCabin = route.filter { $0.publishedCabin?.lowercased().replacingOccurrences(of: " ", with: "_") == cabin }
        for group in [sameCabin, route, flights] {
            let onOrAfter = group.filter { f in
                IumrahPublishedCarouselCatalog.day(f.departureAt, f.origin).map { $0 >= target } ?? false
            }
            if let match = onOrAfter.first(where: { f in
                guard let other else { return true }
                return direction == 0 ? IumrahPublishedCarouselCatalog.compatible(f, other, scope: trip.scope) : IumrahPublishedCarouselCatalog.compatible(other, f, scope: trip.scope)
            }) { return match.id }
            // Discovery remains usable even if the opposite leg must be changed.
            if let first = onOrAfter.first { return first.id }
        }
        return sameCabin.last?.id ?? route.last?.id ?? flights.last?.id
    }

    func prioritizedFlights(trip: TripDraft, direction: Int?, other: LocalJourneyFlight?) -> [LocalJourneyFlight] {
        let rows = visibleFlights(direction: direction)
        guard let direction else { return rows }
        return Self.prioritized(rows, trip: trip, direction: direction, other: other, departureInstants: departureInstants)
    }

    nonisolated static func isFuture(_ flight: LocalJourneyFlight, now: Date = Date()) -> Bool {
        departureInstant(flight).map { $0 >= now } ?? false
    }

    nonisolated static func departureInstant(_ flight: LocalJourneyFlight) -> Date? {
        let iso = ISO8601DateFormatter()
        if let date = iso.date(from: flight.departureAt) { return date }
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: flight.departureAt) { return date }
        // Legacy publications may carry airport-local times rather than an ISO offset.
        let parser = DateFormatter(); parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = FlightReferenceCatalog.timeZone(for: flight.origin) ?? TimeZone(secondsFromGMT: 0)
        parser.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        if let date = parser.date(from: String(flight.departureAt.prefix(19))) { return date }
        parser.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return parser.date(from: String(flight.departureAt.prefix(16)))
    }

    static func flatten(_ options: [StorefrontFlightOption]) -> [LocalJourneyFlight] {
        var seen = Set<String>()
        return options.flatMap { option -> [LocalJourneyFlight] in
            let price: Double? = option.currency.uppercased() == "USD" && option.perTravelerFare.isFinite && option.perTravelerFare > 0 ? option.perTravelerFare : nil
            return [Optional(option.outbound), option.inbound].compactMap { leg -> LocalJourneyFlight? in
                guard let leg, leg.stops == 0 else { return nil }
                return LocalJourneyFlight(id: "published:\(option.id):\(leg.origin):\(leg.departureAt)", origin: leg.origin.uppercased(), destination: leg.destination.uppercased(), airline: leg.airline, flightNumber: leg.flightNumber, airlineCode: leg.airlineCode, durationMinutes: leg.durationMinutes, stops: leg.stops, departureAt: leg.departureAt, arrivalAt: leg.arrivalAt, displayedPrice: price, publishedID: option.id, publishedIsPair: option.inbound != nil, publishedCabin: leg.cabinClass)
            }
        }.sorted { a, b in
            a.departureAt == b.departureAt ? a.id < b.id : a.departureAt < b.departureAt
        }.filter { seen.insert($0.id).inserted }
    }
}

struct IumrahAllPublishedFlightBoard: View {
    @EnvironmentObject private var settings: AppSettingsStore
    @EnvironmentObject private var journey: JourneyStore
    @ObservedObject private var store = IumrahAllPublishedFlightStore.shared
    @ObservedObject var selection: IumrahHomePublishedSelection
    let horizontal: Bool
    var direction: Int? = nil
    var onAllFlights: (() -> Void)? = nil
    let onOpen: (LocalJourneyFlight) -> Void
    @State private var selectionError = false
    @State private var scrollID: String?
    @ScaledMetric(relativeTo: .body) private var terminalHeight: CGFloat = 224

    private func t(_ r: String, _ e: String, _ u: String, _ c: String) -> String { IumrahFlightCopy.text(settings.language, r, e, u, c) }
    private var title: String {
        direction == 0 ? t("Прямые рейсы туда", "Direct outbound flights", "Borish uchun to‘g‘ri reyslar", "Бориш учун тўғри рейслар") : t("Прямые рейсы обратно", "Direct return flights", "Qaytish uchun to‘g‘ri reyslar", "Қайтиш учун тўғри рейслар")
    }
    var body: some View {
        let other = direction == 0 ? selection.inbound : selection.outbound
        let flights = store.prioritizedFlights(trip: journey.trip, direction: direction, other: other)
        let rankKey = "\(journey.trip.originCode)|\(journey.trip.outboundDestinationCode)|\(journey.trip.returnOriginCode)|\(journey.trip.departureDate)|\(journey.trip.returnDate)|\(journey.trip.effectiveFlightFilters.cabinClass.rawValue)|\(other?.id ?? "")"
        VStack(alignment: .leading, spacing: 12) {
            if let onAllFlights {
                Button(action: onAllFlights) {
                    HStack(spacing: 7) {
                        Text(title).font(.system(size: 26, weight: .bold, design: .rounded)).tracking(-0.5)
                            .fixedSize(horizontal: false, vertical: true)
                        Image(systemName: "chevron.right").font(.system(size: 17, weight: .semibold))
                    }.foregroundStyle(.primary).frame(maxWidth: .infinity, alignment: .leading)
                }.buttonStyle(.plain)
            }
            if store.loading && !store.loaded { ProgressView().frame(maxWidth: .infinity).padding(18) }
            if store.failed || (store.loaded && !store.complete) {
                Text(store.failed ? t("Не удалось обновить рейсы", "Could not refresh flights", "Reyslar yangilanmadi", "Рейслар янгиланмади") : t("Полный каталог пока недоступен", "Complete catalogue not available yet", "To‘liq katalog hozircha mavjud emas", "Тўлиқ каталог ҳозирча мавжуд эмас"))
                    .font(.footnote).foregroundStyle(.secondary)
                Button(t("Обновить рейсы", "Refresh flights", "Reyslarni yangilash", "Рейсларни янгилаш")) { Task { await store.load(force: true) } }.buttonStyle(.bordered)
            }
            if store.loaded && store.complete && !store.failed && flights.isEmpty {
                Text(t("Нет опубликованных рейсов", "No published flights", "E’lon qilingan reyslar yo‘q", "Эълон қилинган рейслар йўқ")).font(.footnote).foregroundStyle(.secondary)
            }
            if horizontal {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: 12) {
                        ForEach(flights) { flight in
                            card(flight).containerRelativeFrame(.horizontal) { width, _ in min(330, width * 0.86) }.id(flight.id)
                        }
                        if let onAllFlights {
                            terminalCard(onAllFlights).containerRelativeFrame(.horizontal) { width, _ in min(330, width * 0.86) }.id("all-tickets-\(direction ?? 0)")
                        }
                    }.scrollTargetLayout()
                }.scrollTargetBehavior(.viewAligned)
                    .scrollPosition(id: $scrollID, anchor: .leading)
                    .task(id: rankKey + "|" + flights.map(\.id).joined(separator: "|")) {
                        // Run on first load as well as when route/dates change. Allow the lazy layout to register its IDs.
                        await Task.yield()
                        guard !Task.isCancelled, let direction else { return }
                        let selected = direction == 0 ? selection.outbound : selection.inbound
                        scrollID = selected.flatMap { chosen in flights.contains(where: { $0.id == chosen.id }) ? chosen.id : nil }
                            ?? IumrahAllPublishedFlightStore.dateAnchor(flights, trip: journey.trip, direction: direction, other: other)
                    }
            } else {
                LazyVStack(spacing: 12) { ForEach(flights) { flight in card(flight) } }
            }
        }.task { await store.load() }
            .alert(t("Проверьте совместимость рейсов", "Check flight compatibility", "Reyslar mosligini tekshiring", "Рейслар мослигини текширинг"), isPresented: $selectionError) {
                Button(t("Понятно", "OK", "Tushunarli", "Тушунарли"), role: .cancel) { }
            } message: {
                Text(t("Выберите совместимые даты, аэропорты, класс и опубликованный тариф. Чтобы заменить несовместимый рейс, сначала снимите его выбор.", "Choose compatible dates, airports, cabin and published fare. Deselect an incompatible leg before replacing it.", "Mos sana, aeroport, klass va tarifni tanlang. Mos kelmagan reysni almashtirishdan oldin tanlovni bekor qiling.", "Мос сана, аэропорт, класс ва тарифни танланг. Мос келмаган рейсни алмаштиришдан олдин танловни бекор қилинг."))
            }
            .accessibilityIdentifier(horizontal ? (direction == 0 ? "iumrah.home.directFlights.outbound" : "iumrah.home.directFlights.return") : "iumrah.home.allDirectFlights")
    }

    private func terminalCard(_ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 12) {
                Image(systemName: "arrow.right").font(.system(size: 24, weight: .semibold))
                    .frame(width: 56, height: 56).background(.white.opacity(0.12), in: Circle())
                Text(t("Все авиабилеты", "All flight tickets", "Barcha aviachiptalar", "Барча авиачипталар"))
                    .font(.system(.title2, design: .rounded, weight: .bold)).multilineTextAlignment(.center)
                Text(t("Перейти к выбору рейсов", "Go to flight selection", "Reyslarni tanlashga o‘tish", "Рейсларни танлашга ўтиш"))
                    .font(.footnote).foregroundStyle(.white.opacity(0.7)).multilineTextAlignment(.center)
            }.padding(16).frame(maxWidth: .infinity).frame(height: max(IumrahFlightResultCard.standardHeight, terminalHeight))
                .foregroundStyle(.white).background(Color(white: 0.125), in: RoundedRectangle(cornerRadius: 22))
        }.buttonStyle(.plain).accessibilityIdentifier("iumrah.home.allTickets.\(direction ?? 0)")
    }

    private func select(_ flight: LocalJourneyFlight) {
        guard let leg = IumrahAllPublishedFlightStore.direction(of: flight), selection.choose(flight, direction: leg, journey: journey) else {
            IumrahHaptics.error(); selectionError = true; return
        }
    }

    private func card(_ flight: LocalJourneyFlight) -> some View {
        IumrahFlightResultCard(airline: flight.airline, airlineCode: flight.airlineCode, flightNumber: flight.flightNumber, origin: flight.origin, destination: flight.destination, departureAt: flight.departureAt, arrivalAt: flight.arrivalAt, duration: flight.durationMinutes, stops: flight.stops, price: flight.displayedPrice, isAviasales: false, isRoundTripFare: flight.publishedIsPair == true, selected: selection.outbound?.id == flight.id || selection.inbound?.id == flight.id, selectionAccent: .primary, onSelect: { select(flight) }, action: { onOpen(flight) })
    }
}

struct IumrahHomePublishedFlightDetail: View {
    @EnvironmentObject private var settings: AppSettingsStore
    @EnvironmentObject private var journey: JourneyStore
    @ObservedObject var selection: IumrahHomePublishedSelection
    let flight: LocalJourneyFlight
    init(flight: LocalJourneyFlight, selection: IumrahHomePublishedSelection) { self.flight = flight; self.selection = selection }
    var body: some View {
        IumrahManualFlightDetail(flight: flight, onConfirm: {
            if selection.outbound?.id == flight.id || selection.inbound?.id == flight.id { return true }
            guard selection.canChoose(flight, trip: journey.trip) else { return false }
            guard let direction = IumrahAllPublishedFlightStore.direction(of: flight) else { return false }
            return selection.choose(flight, direction: direction, journey: journey)
        }, selectedOverride: selection.outbound?.id == flight.id || selection.inbound?.id == flight.id,
        selectionUnavailableMessage: selection.canChoose(flight, trip: journey.trip) ? nil : IumrahFlightCopy.text(settings.language, "Рейс недоступен для текущей пары. Проверьте даты, аэропорты, класс и опубликованный тариф.", "This flight cannot be selected for the current pair. Check dates, airports, cabin and published fare.", "Bu reys joriy juftlikka mos emas. Sana, aeroport, klass va tarifni tekshiring.", "Бу рейс жорий жуфтликка мос эмас. Сана, аэропорт, класс ва тарифни текширинг."))
    }
}

extension IumrahHomePublishedSelection {
    func canChoose(_ flight: LocalJourneyFlight, trip: TripDraft) -> Bool {
        guard let direction = IumrahAllPublishedFlightStore.direction(of: flight) else { return false }
        return proposedTrip(flight, direction: direction, trip: trip) != nil
    }
}
