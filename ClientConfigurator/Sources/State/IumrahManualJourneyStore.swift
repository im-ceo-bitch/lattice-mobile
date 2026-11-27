import Foundation
import SwiftUI

/// The manually assembled package is independent of the guided journey.
/// No local package price, fare markup, or booking proof is generated here.
@MainActor
final class IumrahManualJourneyStore: ObservableObject {
    private var cachedRevisionKey: String?
    @Published var guidePreference: IumrahGuidePreference? = nil { didSet { cachedRevisionKey = nil } }
    @Published var outbound: LocalJourneyFlight? = nil { didSet { cachedRevisionKey = nil } }
    @Published var inbound: LocalJourneyFlight? = nil { didSet { cachedRevisionKey = nil } }
    @Published var rooms: [String: LocalJourneyRoom] = [:] { didSet { cachedRevisionKey = nil } }
    @Published var transfer: TransferVehicleKind? = nil { didSet { cachedRevisionKey = nil } }
    @Published var haramainSelected = false { didSet { cachedRevisionKey = nil } }
    @Published var haramainFareClass: HaramainFareClass = .economy { didSet { cachedRevisionKey = nil } }
    @Published var haramainAdultTickets = 1 { didSet { cachedRevisionKey = nil } }
    @Published var scope: JourneyScope = .makkahAndMadinah { didSet { cachedRevisionKey = nil } }
    @Published var routeConfigured = false { didSet { cachedRevisionKey = nil } }
    @Published var plannedOrigin = "TAS" { didSet { cachedRevisionKey = nil } }
    @Published var plannedArrival: SaudiArrivalAirport = .jeddah { didSet { cachedRevisionKey = nil } }
    @Published var plannedDeparture = Calendar.current.date(byAdding: .day, value: 14, to: Date()) ?? Date() { didSet { cachedRevisionKey = nil } }
    @Published var plannedReturn = Calendar.current.date(byAdding: .day, value: 21, to: Date()) ?? Date() { didSet { cachedRevisionKey = nil } }
    @Published var adults = 2 { didSet { cachedRevisionKey = nil } }
    @Published var cabin: FlightCabinClass = .economy { didSet { cachedRevisionKey = nil } }

    var componentCount: Int { (outbound == nil ? 0 : 1) + (inbound == nil ? 0 : 1) + rooms.count + (transfer == nil ? 0 : 1) }
    var cities: [String] { scope == .makkahOnly ? ["makkah"] : ["makkah", "madinah"] }
    var revisionKey: String {
        if let cachedRevisionKey { return cachedRevisionKey }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let values = (try? encoder.encode(rooms))?.base64EncodedString() ?? ""
        let flights = (try? encoder.encode([outbound, inbound]))?.base64EncodedString() ?? ""
        let components = [flights, values, transfer?.rawValue ?? "", scope.rawValue, String(adults), cabin.rawValue]
        let route = [plannedOrigin, plannedArrival.rawValue, String(plannedDeparture.timeIntervalSince1970), String(plannedReturn.timeIntervalSince1970), String(routeConfigured)]
        let train = [String(haramainSelected), haramainFareClass.rawValue, String(haramainAdultTickets)]
        let key = (components + route + train + [guidePreference?.memberID ?? "", guidePreference?.displayName ?? ""]).joined(separator: "|")
        cachedRevisionKey = key
        return key
    }
    @discardableResult func select(_ flight: LocalJourneyFlight) -> Bool {
        if ["JED", "MED"].contains(flight.destination) {
            guard !routeConfigured || scope != .makkahOnly || flight.destination == "JED" else { return false }
            outbound = flight
            plannedOrigin = flight.origin
            plannedArrival = SaudiArrivalAirport(rawValue: flight.destination) ?? .jeddah
            if let value = day(flight.departureAt, airport: flight.origin) { plannedDeparture = value }
            if plannedReturn <= plannedDeparture { plannedReturn = Calendar.current.date(byAdding: .day, value: 7, to: plannedDeparture) ?? plannedDeparture }
        } else if ["JED", "MED"].contains(flight.origin) {
            guard !routeConfigured || scope != .makkahOnly || flight.origin == "JED" else { return false }
            inbound = flight
            if outbound == nil { plannedOrigin = flight.destination }
            if let value = day(flight.departureAt, airport: flight.origin) { plannedReturn = value }
            if plannedDeparture >= plannedReturn && outbound == nil { plannedDeparture = max(Calendar.current.startOfDay(for: Date()), Calendar.current.date(byAdding: .day, value: -7, to: plannedReturn) ?? plannedReturn) }
        } else { return false }
        return true
    }
    @discardableResult func select(_ room: LocalJourneyRoom) -> Bool {
        guard cities.contains(room.city) else { return false }
        rooms[room.city] = room
        if room.city == "madinah" { scope = .makkahAndMadinah }
        if outbound == nil && inbound == nil {
            if !routeConfigured {
                plannedDeparture = rooms.values.map(\.checkin).min() ?? room.checkin
                plannedReturn = rooms.values.map(\.checkout).max() ?? room.checkout
            }
            else { plannedDeparture = min(plannedDeparture, room.checkin); plannedReturn = max(plannedReturn, room.checkout) }
            if scope == .makkahAndMadinah && (Calendar.current.dateComponents([.day], from: plannedDeparture, to: plannedReturn).day ?? 0) < 2 {
                plannedReturn = Calendar.current.date(byAdding: .day, value: 2, to: plannedDeparture) ?? plannedReturn
            }
        }
        return true
    }
    func changeScope(_ value: JourneyScope) {
        scope = value; routeConfigured = true
        if value == .makkahOnly {
            rooms.removeValue(forKey: "madinah"); plannedArrival = .jeddah; haramainSelected = false
            if outbound?.destination == "MED" { outbound = nil }
            if inbound?.origin == "MED" { inbound = nil }
        }
    }
    private func day(_ raw: String?, airport: String) -> Date? {
        guard let parts = IumrahPremiumFlightLeg.localParts(raw, code: airport) else { return nil }
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.calendar = Calendar(identifier: .gregorian); f.dateFormat = "yyyy-MM-dd"
        return f.date(from: parts.day)
    }
    var trip: TripDraft? {
        guard let outbound, let inbound,
              outbound.origin == inbound.destination,
              let first = SaudiArrivalAirport(rawValue: outbound.destination),
              let last = SaudiArrivalAirport(rawValue: inbound.origin),
              let departure = day(outbound.departureAt, airport: outbound.origin),
              let arrival = day(outbound.arrivalAt, airport: outbound.destination),
              let returning = day(inbound.departureAt, airport: inbound.origin),
              returning > arrival, arrival >= departure,
              departure >= Calendar.current.startOfDay(for: Date()),
              scope != .makkahOnly || (first == .jeddah && last == .jeddah),
              scope != .makkahAndMadinah || (Calendar.current.dateComponents([.day], from: arrival, to: returning).day ?? 0) >= 2 else { return nil }
        var draft = TripDraft()
        draft.guidePreference = guidePreference
        draft.origin = outbound.origin; draft.originAirport = nil
        draft.departureDate = departure; draft.saudiArrivalDate = arrival; draft.returnDate = returning
        draft.arrivalAirport = first; draft.selectedReturnAirport = last
        draft.scope = scope; draft.adults = adults; draft.rooms = 1; draft.children = 0; draft.infants = 0
        draft.flightTripType = .roundTrip
        var filters = draft.effectiveFlightFilters; filters.cabinClass = cabin; draft.flightFilters = filters
        return draft
    }
    var plannedTrip: TripDraft {
        if let trip { return trip }
        var draft = TripDraft()
        draft.guidePreference = guidePreference
        draft.origin = plannedOrigin; draft.originAirport = nil
        draft.scope = scope; draft.arrivalAirport = scope == .makkahOnly ? .jeddah : plannedArrival
        draft.departureDate = outbound.flatMap { day($0.departureAt, airport: $0.origin) } ?? plannedDeparture
        draft.saudiArrivalDate = outbound.flatMap { day($0.arrivalAt, airport: $0.destination) }
        draft.returnDate = inbound.flatMap { day($0.departureAt, airport: $0.origin) } ?? plannedReturn
        draft.selectedReturnAirport = inbound.flatMap { SaudiArrivalAirport(rawValue: $0.origin) }
        draft.adults = adults; draft.rooms = 1; draft.children = 0; draft.infants = 0
        var filters = draft.effectiveFlightFilters; filters.cabinClass = cabin; draft.flightFilters = filters
        return draft
    }
    var hasPriceComponent: Bool { outbound != nil || inbound != nil || !rooms.isEmpty }
    func expectedWindow(_ city: String) -> TripStayWindow? {
        guard trip != nil || routeConfigured else { return nil }
        let trip = plannedTrip
        let windows = TripStayPlanner.windows(for: trip)
        return city == "madinah" ? windows.madinah : windows.makkah
    }
    func validRoom(_ city: String) -> Bool {
        guard let room = rooms[city], let window = expectedWindow(city) else { return false }
        let cal = Calendar.current
        return room.adults == adults && room.childrenAges.isEmpty && room.rate.currency == "USD" && room.rate.price.isFinite && room.rate.price > 0 &&
            cal.isDate(room.checkin, inSameDayAs: window.checkIn) && cal.isDate(room.checkout, inSameDayAs: window.checkOut)
    }
    var sourceCompatible: Bool {
        guard let a = outbound, let b = inbound else { return false }
        for flight in [a, b] {
            if let publishedCabin = flight.publishedCabin,
               publishedCabin.lowercased().replacingOccurrences(of: " ", with: "_") != cabin.rawValue { return false }
        }
        if let x = a.publishedID, let y = b.publishedID {
            return a.publishedIsPair == true || b.publishedIsPair == true ? x == y && a.publishedIsPair == true && b.publishedIsPair == true : x != y
        }
        if let x = a.discoveryOffer, let y = b.discoveryOffer { return !x.isRoundTrip && !y.isRoundTrip && cabin == .economy }
        if a.publishedID != nil && a.publishedIsPair != true && b.discoveryOffer?.isRoundTrip == false { return cabin == .economy }
        if b.publishedID != nil && b.publishedIsPair != true && a.discoveryOffer?.isRoundTrip == false { return cabin == .economy }
        return false
    }
    var complete: Bool {
        guard trip != nil, sourceCompatible, let transfer, transfer.passengerCapacity >= adults,
              (1...6).contains(adults) else { return false }
        return cities.allSatisfy { validRoom($0) }
    }
    func estimateIdentity(_ flight: LocalJourneyFlight) -> String? {
        if let id = flight.publishedID { return "curated:" + id }
        return identity(flight)
    }
    private func identity(_ flight: LocalJourneyFlight) -> String? {
        if let id = flight.publishedID, flight.publishedIsPair != true { return "curated:" + id }
        guard let offer = flight.discoveryOffer, !offer.isRoundTrip else { return nil }
        return ["aviasales", "ow", offer.origin.uppercased(), offer.destination.uppercased(), String(offer.departureAt.prefix(10)), "-", offer.airlineCode.uppercased(), offer.flightNumber.uppercased().filter { $0.isLetter || $0.isNumber }, "-", "-"].joined(separator: ":")
    }
    private func staged(_ flight: LocalJourneyFlight, _ kind: StagedUmrahFlightKind) -> StagedUmrahFlight {
        .init(id: flight.id, kind: kind, origin: flight.origin, destination: flight.destination, airline: flight.airline,
              flightNumber: flight.flightNumber, departureAt: flight.departureAt, returnAt: nil, returnAirline: nil,
              returnFlightNumber: nil, source: flight.publishedID == nil ? "Aviasales" : "iumrah")
    }
    /// Assemble the exact same server request as the guided flow, with the same
    /// trusted provider IDs. The separate store is only used for this review.
    func makeQuoteJourney() -> JourneyStore? {
        guard complete, let draft = trip, let a = outbound, let b = inbound, let transfer else { return nil }
        let result = JourneyStore()
        result.trip = draft
        result.stageUmrahFlight(staged(a, .outbound)); result.stageUmrahFlight(staged(b, .inbound))
        if let x = a.publishedID, let y = b.publishedID {
            result.packageFlightPath = .publishedDirect
            if a.publishedIsPair == true { result.selectedPublishedCompleteID = x }
            else { result.selectedPublishedOutboundID = x; result.selectedPublishedReturnID = y }
        } else if let x = a.discoveryOffer, let y = b.discoveryOffer {
            result.stageAviasalesOffer(x, kind: .outbound); result.stageAviasalesOffer(y, kind: .inbound)
        } else {
            guard let x = identity(a), let y = identity(b) else { return nil }
            result.mixedFlightIdentity = "mixed:" + x + "~" + y
        }
        result.usesLocalJourney = true
        result.localJourneyFlights = [a, b]
        result.localJourneyRooms = Dictionary(uniqueKeysWithValues: cities.compactMap { city in rooms[city].map { ($0.id, $0) } })
        result.chooseTransferVehicle(transfer)
        result.setHaramainFareClass(haramainFareClass)
        result.setHaramainAdultTickets(haramainAdultTickets)
        result.setHaramainTrainSelected(haramainSelected)
        result.confirmTransferSelection()
        return result
    }
}
