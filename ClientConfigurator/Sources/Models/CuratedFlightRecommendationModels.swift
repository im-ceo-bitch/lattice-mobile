import Foundation

struct CuratedFlightRecommendation: Decodable, Identifiable, Hashable {
    struct Leg: Decodable, Hashable {
        let airline: String
        let flightNumber: String
        let airlineCode: String
        let origin: String
        let destination: String
        let departureAt: String
        let arrivalAt: String
        let durationMinutes: Int
        let stops: Int
        let cabinClass: String

        enum CodingKeys: String, CodingKey {
            case airline, origin, destination, stops
            case flightNumber = "flight_number"
            case airlineCode = "airline_code"
            case departureAt = "departure_at"
            case arrivalAt = "arrival_at"
            case durationMinutes = "duration_minutes"
            case cabinClass = "cabin_class"
        }
    }

    let id: String
    let outboundDate: String
    let inboundDate: String?
    let cabinClass: String
    let airlineCodes: [String]
    let airlineNames: [String]
    let flightNumbers: [String]
    let observedAt: String
    let outbound: Leg
    let inbound: Leg?
    let nonstop: Bool
    let recommendationLabel: String
    let offerType: String?
    let journeyRole: String?
    var fareUsdPerTraveler: Double? = nil

    var effectiveOfferType: String {
        if let offerType, !offerType.isEmpty { return offerType }
        return inbound == nil ? "one_way" : "paired_one_way"
    }

    var effectiveJourneyRole: String {
        if let journeyRole, !journeyRole.isEmpty { return journeyRole }
        return effectiveOfferType == "one_way" ? "outbound" : "complete"
    }

    var primaryAirlineCode: String? {
        let value = outbound.airlineCode.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? airlineCodes.first : value
    }

    var primaryAirlineName: String {
        let value = outbound.airline.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? (airlineNames.first ?? primaryAirlineCode ?? "Airline") : value
    }
}

struct CuratedFlightRecommendationsResponse: Decodable {
    let ok: Bool
    let recommendations: [CuratedFlightRecommendation]
    let generatedAt: String
}
