import Foundation

protocol HotelCatalogServicing {
    func listHotels(city: String) async throws -> [HotelSummary]
    func hotelDetail(id: String) async throws -> HotelDetail
}

struct HotelCatalogService: HotelCatalogServicing {
    private let api = APIClient.shared

    func listHotels(city: String) async throws -> [HotelSummary] {
        let response: HotelsResponse = try await api.get(
            "/api/catalog/hotels",
            query: [URLQueryItem(name: "city", value: city)]
        )
        return response.hotels
    }

    func hotelDetail(id: String) async throws -> HotelDetail {
        let response: HotelDetailResponse = try await api.get("/api/catalog/hotels/\(id)")
        return response.hotel
    }
}
