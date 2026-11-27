import Foundation

@MainActor
protocol PackageQuoteServicing {
    func quote(trip: TripDraft, hotel: HotelSummary, outbound: FlightOffer, inbound: FlightOffer) async throws -> PackageQuote
}

enum PackageQuoteServiceError: LocalizedError {
    case serverPricingContextRequired

    var errorDescription: String? {
        "Final package pricing requires the secure iumrah PackageEngine with verified flight and hotel identifiers."
    }
}

@MainActor
struct LocalOnlyPackageQuoteService: PackageQuoteServicing {
    func quote(trip: TripDraft, hotel: HotelSummary, outbound: FlightOffer, inbound: FlightOffer) async throws -> PackageQuote {
        throw PackageQuoteServiceError.serverPricingContextRequired
    }
}
