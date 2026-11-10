import Foundation

// Aggregate analytics only. All Business endpoints reuse the existing staff cookie
// and X-Iumrah-Business-Session header from APIClient.perform.
struct IntelligenceOverviewResponse: Decodable {
    let ok: Bool
    let overview: IntelligenceOverview
}

struct IntelligenceOverview: Decodable {
    let days: Int
    let periodStart: String
    let periodEnd: String
    let events: Int
    let visitors: Int
    let sessions: Int
    let funnel: [IntelligenceFunnelStep]
    let screens: [IntelligenceScreen]
    let daily: [IntelligenceDaily]
}

struct IntelligenceFunnelStep: Decodable, Identifiable {
    let event: String
    let title: String
    let visitors: Int
    var id: String { event }
}

struct IntelligenceScreen: Decodable, Identifiable {
    let screen: String
    let views: Int
    let visitors: Int
    let averageSeconds: Int?
    let timedExits: Int
    var id: String { screen }
}

struct IntelligenceDaily: Decodable, Identifiable {
    let day: String
    let visitors: Int
    let events: Int
    var id: String { day }
}

struct IntelligenceSessionsResponse: Decodable {
    let ok: Bool
    let sessions: [IntelligenceSession]
}

struct IntelligenceSession: Decodable, Identifiable {
    let sessionId: String
    let platform: String
    let startedAt: String
    let lastEventAt: String
    let eventCount: Int
    var id: String { sessionId }
}

struct IntelligenceJourneyResponse: Decodable {
    let ok: Bool
    let sessionId: String
    let events: [IntelligenceJourneyEvent]
}

struct IntelligenceJourneyEvent: Decodable, Identifiable {
    let name: String
    let screen: String
    let elementId: String
    let at: String
    var id: String { "\(name)|\(screen)|\(elementId)|\(at)" }
}

struct IntelligenceReportsResponse: Decodable {
    let ok: Bool
    let reports: [IntelligenceReport]
}

struct IntelligenceReport: Decodable, Identifiable {
    let id: String
    let status: String
    let model: String
    let periodStart: String
    let periodEnd: String
    let eventCount: Int
    let report: IntelligenceAdvice?
    let error: String?
    let createdAt: String
    let completedAt: String?
}

struct IntelligenceAdvice: Decodable {
    let summary: String
    let recommendations: [IntelligenceRecommendation]
}

struct IntelligenceRecommendation: Decodable, Identifiable {
    let area: String
    let priority: String
    let finding: String
    let recommendation: String
    let metric: String
    var id: String { "\(area)|\(finding)" }
}

extension APIClient {
    func intelligenceOverview(days: Int = 7) async throws -> IntelligenceOverview {
        var components = URLComponents(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/intelligence"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "days", value: String(days))]
        guard let url = components.url else { throw APIError.invalidURL }
        let (data, response) = try await perform(from: url)
        try validate(response, data: data)
        return try decoder.decode(IntelligenceOverviewResponse.self, from: data).overview
    }

    func intelligenceSessions(days: Int = 7) async throws -> [IntelligenceSession] {
        var components = URLComponents(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/intelligence/sessions"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "days", value: String(days))]
        guard let url = components.url else { throw APIError.invalidURL }
        let (data, response) = try await perform(from: url)
        try validate(response, data: data)
        return try decoder.decode(IntelligenceSessionsResponse.self, from: data).sessions
    }

    func intelligenceJourney(sessionID: String) async throws -> IntelligenceJourneyResponse {
        let url = AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/intelligence/sessions/\(sessionID)")
        let (data, response) = try await perform(from: url)
        try validate(response, data: data)
        return try decoder.decode(IntelligenceJourneyResponse.self, from: data)
    }

    func intelligenceReports() async throws -> [IntelligenceReport] {
        let url = AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/intelligence/reports")
        let (data, response) = try await perform(from: url)
        try validate(response, data: data)
        return try decoder.decode(IntelligenceReportsResponse.self, from: data).reports
    }

    func generateIntelligenceReport() async throws {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/intelligence/reports/generate"))
        request.httpMethod = "POST"
        request.timeoutInterval = 85
        let (data, response) = try await perform(request)
        try validate(response, data: data)
    }
}
