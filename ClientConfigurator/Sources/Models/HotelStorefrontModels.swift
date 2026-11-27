import Foundation

enum HotelsShowcaseBoard: String, CaseIterable, Identifiable {
    case hotels
    case flights
    case sundayClub
    case services // Backward-compatible legacy request, not a visible step.
    case visa
    case transfer
    case guide
    case summary

    var id: String { rawValue }
}

struct StorefrontFlightLeg: Codable, Hashable {
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
        case airline
        case flightNumber = "flight_number"
        case airlineCode = "airline_code"
        case origin, destination
        case departureAt = "departure_at"
        case arrivalAt = "arrival_at"
        case durationMinutes = "duration_minutes"
        case stops
        case cabinClass = "cabin_class"
    }
}

struct StorefrontFlightBaggage: Codable, Hashable {
    let carryOn: Int?
    let checked: Int?
}

struct StorefrontFlightOption: Codable, Identifiable, Hashable {
    let id: String
    let kind: String
    let priority: Int
    let currency: String
    let travelerCount: Int
    let totalFare: Double
    let perTravelerFare: Double
    let observedAt: String
    let outbound: StorefrontFlightLeg
    let inbound: StorefrontFlightLeg?
    let baggage: StorefrontFlightBaggage?
}

struct StorefrontFlightBaseline: Codable, Hashable {
    let mode: String
    let travelers: Int
    let currency: String
    let perTravelerFareUsd: Double
    let totalFareUsd: Double
    let outboundOfferID: String
    let inboundOfferID: String
    let outbound: StorefrontFlightLeg
    let inbound: StorefrontFlightLeg
    let observedAt: String
}

struct StorefrontFlightBoardResponse: Codable, Hashable {
    let ok: Bool
    let origin: String
    let generatedAt: String
    let baseline: StorefrontFlightBaseline?
    let options: [StorefrontFlightOption]
    var catalogComplete: Bool? = nil
}

/// A locally composed Umrah package attached to one or more catalog flight rows.
/// Uzbekistan → Saudi Arabia is the package anchor. A matching Saudi Arabia →
/// Uzbekistan leg becomes the return component and receives the exact same package
/// price in the storefront. Component supplier prices are never exposed.
enum StorefrontUmrahPackageKind: String, Hashable {
    case makkahComfortShort
    case makkahMadinahStandard
    /// Hotel-first configurator starts from one concrete Makkah hotel. Madinah can
    /// be added later without duplicating the package screen.
    case hotelFirstMakkah
}

struct StorefrontPackageHotel: Hashable, Identifiable {
    let id: String
    let name: String
    let city: String
    let stars: Int?
    let coverImageURL: String?
    let nights: Int
}


struct StorefrontPackageSnapshotConfiguration: Codable, Hashable {
    let adults: Int
    let children: Int
    let infants: Int
    let rooms: Int
    let makkahLunch: Bool
    let makkahDinner: Bool
    let madinahDinner: Bool
    let transferVehicle: String?
    let haramainEnabled: Bool
    let haramainFareClass: String
    let haramainTicketCount: Int
    let makkahRoomId: String?
    let madinahRoomId: String?

    var mealSelection: PackageMealSelection {
        PackageMealSelection(
            makkahLunch: makkahLunch,
            makkahDinner: makkahDinner,
            madinahDinner: madinahDinner
        )
    }
}

struct StorefrontFlightPackagePreview: Hashable, Identifiable {
    var id: String { packageID }

    let packageID: String
    let snapshotConfiguration: StorefrontPackageSnapshotConfiguration?
    let pricePerPerson: Decimal
    let totalPackagePrice: Decimal
    /// Complete published flight-pair fare for one traveler. Kept internal so the
    /// package detail can recalculate the same package when traveler/room/transfer
    /// selections change without exposing component pricing in the UI.
    let flightFarePerPersonUSD: Decimal
    let fareObservedAt: String
    let outboundOptionID: String
    let returnOptionID: String
    let outbound: StorefrontFlightLeg
    let inbound: StorefrontFlightLeg
    let durationDays: Int
    let totalNights: Int
    let makkahNights: Int
    let madinahNights: Int
    let hotelFirstVariant: String?
    let hotelFirstVariantIndex: Int?
    let hotelFirstVariantMinDays: Int?
    let hotelFirstVariantMaxDays: Int?
    let hotelFirstAnchorCity: String?
    let hotelFirstAnchorHotelID: String?
    let kind: StorefrontUmrahPackageKind
    let tier: PackageTier
    let hotels: [StorefrontPackageHotel]
    let packageQuote: PackageQuote

    var primaryHotel: StorefrontPackageHotel? {
        if let hotelFirstAnchorHotelID, let anchor = hotels.first(where: { $0.id == hotelFirstAnchorHotelID }) {
            return anchor
        }
        return hotels.first(where: { $0.city.lowercased().contains("makk") || $0.city.lowercased().contains("mecc") }) ?? hotels.first
    }

    var usesTashkentReturnFallback: Bool {
        outbound.origin.uppercased() != "TAS" && inbound.destination.uppercased() == "TAS"
    }
}
