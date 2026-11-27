import Foundation

struct IumrahManualEstimateRequest: Encodable {
    struct Flight: Encodable {
        let identity: String
        let origin: String
        let destination: String
        let departureDate: String
        let cabin: String
    }
    let adults: Int
    let includeMadinah: Bool
    let start: String
    let end: String
    let transferVehicle: String?
    let haramain: Train
    struct Train: Encodable { let enabled: Bool; let fareClass: String; let ticketCount: Int }
    let rooms: [BookingNuiteeRoomSelection]
    let flights: [Flight]
}
struct IumrahManualEstimate: Decodable {
    let totalPackagePrice: Decimal
    let pricePerPerson: Decimal
    let currency: String
    let bookingAllowed: Bool
    let pairedFareIncluded: Bool
    let provisionalTier: Bool
}
struct IumrahManualEstimateEnvelope: Decodable {
    let ok: Bool
    let estimate: IumrahManualEstimate
}

extension IumrahManualJourneyStore {
    func estimateRequest() -> IumrahManualEstimateRequest? {
        guard hasPriceComponent else { return nil }
        let formatter = DateFormatter(); formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"
        let selected = [outbound, inbound].compactMap { $0 }
        let flights: [IumrahManualEstimateRequest.Flight] = selected.compactMap { flight in
            guard let identity = estimateIdentity(flight), let parts = IumrahPremiumFlightLeg.localParts(flight.departureAt, code: flight.origin) else { return nil }
            return .init(identity: identity, origin: flight.origin, destination: flight.destination, departureDate: parts.day, cabin: cabin.rawValue)
        }
        guard flights.count == selected.count else { return nil }
        let plan = plannedTrip
        return .init(adults: adults, includeMadinah: scope == .makkahAndMadinah,
                     start: formatter.string(from: plan.departureDate), end: formatter.string(from: plan.returnDate),
                     transferVehicle: transfer?.rawValue, haramain: .init(enabled: haramainSelected && transfer != nil && scope == .makkahAndMadinah, fareClass: haramainFareClass.rawValue, ticketCount: min(haramainAdultTickets, adults)), rooms: rooms.values.sorted { $0.id < $1.id }.map(\.bookingSelection), flights: flights)
    }
}
