import Foundation

protocol AirportSearchServicing {
    func search(_ query: String, limit: Int) async throws -> [Airport]
}

struct AirportSearchService: AirportSearchServicing {
    private let api = APIClient.shared

    func search(_ query: String, limit: Int = 10) async throws -> [Airport] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        let response: AirportSearchResponse = try await api.get(
            "/api/airports",
            query: [
                URLQueryItem(name: "q", value: trimmed),
                URLQueryItem(name: "limit", value: String(max(1, min(12, limit))))
            ]
        )
        return response.airports
    }
}
