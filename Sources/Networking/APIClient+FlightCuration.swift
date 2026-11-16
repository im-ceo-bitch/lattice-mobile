import Foundation

extension APIClient {
    func searchFlightsForCuration(_ payload: BusinessFlightCurationSearchRequest) async throws -> BusinessFlightCurationSearchResponse {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/package/flights/curation-search"))
        request.httpMethod = "POST"
        request.timeoutInterval = 35
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(payload)
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(BusinessFlightCurationSearchResponse.self, from: data)
    }

    func curatedFlights() async throws -> [BusinessCuratedFlightOffer] {
        let url = AppConfig.apiBaseURL.appending(path: "/api/admin/package/flights/curated")
        let (data, response) = try await perform(from: url)
        if let http = response as? HTTPURLResponse, http.statusCode == 409,
           let problem = try? JSONDecoder().decode(CuratedCatalogProblem.self, from: data),
           problem.error == "CURATED_CATALOG_MIGRATION_REQUIRED" {
            throw problem
        }
        try validate(response, data: data)
        return try decoder.decode(BusinessCuratedFlightsResponse.self, from: data).offers
    }

    func exportPublishedFlights() async throws -> Data {
        let url = AppConfig.apiBaseURL.appending(path: "/api/admin/package/flights/curated/export")
        var request = URLRequest(url: url)
        request.timeoutInterval = 25
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return data
    }

    func publishCuratedFlight(_ itinerary: BusinessFlightCurationItinerary, travelerCount: Int, priority: Int = 100) async throws -> BusinessCuratedFlightOffer? {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/package/flights/curated"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(BusinessCuratedFlightSaveRequest(
            itinerary: itinerary,
            travelerCount: travelerCount,
            published: true,
            priority: priority
        ))
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        struct Envelope: Decodable { let ok: Bool; let offer: BusinessCuratedFlightOffer? }
        return try decoder.decode(Envelope.self, from: data).offer
    }

    func deleteCuratedFlight(id: String) async throws {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/package/flights/curated/\(encoded)"))
        request.httpMethod = "DELETE"
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        _ = try? decoder.decode(BusinessCuratedFlightDeleteResponse.self, from: data)
    }
}

private struct CuratedCatalogProblem: Decodable, LocalizedError {
    let error: String
    let legacyCount: Int?
    var errorDescription: String? {
        "Найдены опубликованные рейсы в старой базе iumrah-core (\(legacyCount ?? 0)). Требуется восстановление каталога в iumrah-hotels."
    }
}
