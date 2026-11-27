import Foundation

/// The cached-fare endpoint has no segment list. This model is reserved for
/// complete itineraries supplied by an authorized ticket search integration.
struct FlightDiscoveryVerifiedSegment: Codable, Hashable {
    let originAirport: String
    let destinationAirport: String
    let departureAt: String
    let arrivalAt: String
    let airlineCode: String
    let flightNumber: String
}

enum FlightDiscoveryItineraryValidator {
    static func verified(
        _ segments: [FlightDiscoveryVerifiedSegment]?,
        origin: String,
        destination: String,
        transfers: Int
    ) -> [FlightDiscoveryVerifiedSegment]? {
        guard let legs = segments, !legs.isEmpty, legs.count <= 8 else { return nil }
        if transfers >= 0 && legs.count != transfers + 1 { return nil }
        guard legs.first?.originAirport.uppercased() == origin.uppercased(),
              legs.last?.destinationAirport.uppercased() == destination.uppercased() else { return nil }
        var previousArrival: Date?
        var previousAirport: String?
        for leg in legs {
            guard isIATA(leg.originAirport), isIATA(leg.destinationAirport),
                  let departure = parse(leg.departureAt),
                  let arrival = parse(leg.arrivalAt),
                  arrival > departure else { return nil }
            if let previousArrival, let previousAirport {
                guard leg.originAirport.uppercased() == previousAirport,
                      departure >= previousArrival else { return nil }
            }
            previousArrival = arrival
            previousAirport = leg.destinationAirport.uppercased()
        }
        return legs
    }

    static func connectionMinutes(from first: FlightDiscoveryVerifiedSegment, to second: FlightDiscoveryVerifiedSegment) -> Int? {
        guard first.destinationAirport.uppercased() == second.originAirport.uppercased(),
              let arrival = parse(first.arrivalAt), let departure = parse(second.departureAt),
              departure >= arrival else { return nil }
        return Int(departure.timeIntervalSince(arrival) / 60)
    }

    private static func isIATA(_ string: String) -> Bool {
        string.count == 3 && string.uppercased().unicodeScalars.allSatisfy { (65...90).contains(Int($0.value)) }
    }

    private static func parse(_ string: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let result = formatter.date(from: string) { return result }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: string)
    }
}
