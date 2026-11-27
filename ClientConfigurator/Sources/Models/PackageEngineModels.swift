import Foundation

/// Health payload for the small Package Engine surface that remains after the
/// flight-bot cleanup. Flight inventory and final package pricing are not
/// responsibilities of this worker.
struct PackageEngineHealthResponse: Decodable {
    let ok: Bool
    let service: String
    let hotelsDbConfigured: Bool
    let bookingsDbConfigured: Bool?
    let primaryHotelConfigCount: Int?
    let primaryHotelsReady: Bool?
    let primaryHotelConfigByCity: [String: Int]?
    let roomCategoriesReady: Bool?
    let roomCategoryCount: Int?
    let bookingRoomColumnsReady: Bool?
    let pricingContract: String?
    let quoteSealingMode: String?
}

struct PrimaryHotelResolutionResponse: Decodable, Hashable {
    let ok: Bool
    let hotelId: String
    let roomId: String?
    let tier: String?
    let stars: Int
    let city: String
    let pricingMode: String?
}
