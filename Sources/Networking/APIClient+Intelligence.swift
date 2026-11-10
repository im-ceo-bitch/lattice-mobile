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
    let platforms: [IntelligencePlatform]?
    let dailyPlatform: [IntelligenceDailyPlatform]?
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

struct IntelligencePlatform: Decodable, Identifiable {
    let platform: String
    let visitors: Int
    let sessions: Int
    let events: Int
    let bookings: Int
    var id: String { platform }
    var displayName: String {
        switch platform { case "ios": "iOS"; case "android": "Android"; case "web": "Web"; default: platform }
    }
}

struct IntelligenceDailyPlatform: Decodable, Identifiable {
    let day: String
    let platform: String
    let visitors: Int
    var id: String { "\(day)|\(platform)" }
    var platformName: String {
        switch platform { case "ios": "iOS"; case "android": "Android"; case "web": "Web"; default: platform }
    }
}

struct IntelligenceChatMessage: Decodable, Identifiable {
    let id: String
    let role: String
    let content: String
    let createdAt: String
}

struct IntelligenceChatHistory: Decodable {
    let ok: Bool
    let threadId: String?
    let messages: [IntelligenceChatMessage]
}

struct IntelligenceChatAnswer: Decodable {
    let ok: Bool
    let threadId: String
    let answer: String
    let model: String
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
    // The unified Worker runs on workers.dev while the staff login cookie is
    // issued by iumrah.app. Forward only first-party authentication cookies
    // and the registered Business device-session token to our own Worker.
    // APIClient.perform only attaches the token to iumrah.app by design.
    private func intelligencePerform(_ original: URLRequest) async throws -> (Data, URLResponse) {
        var request = original
        if let token = BusinessSessionVault.sessionToken {
            request.setValue(token, forHTTPHeaderField: "X-Iumrah-Business-Session")
        }
        // The site's authentication cookie name is not controlled by the
        // Business app. Forward first-party login cookies but omit obvious
        // advertising/analytics cookies on the request to our own Worker.
        let loginCookies = (HTTPCookieStorage.shared.cookies(for: AppConfig.apiBaseURL) ?? [])
            .filter { cookie in
                let name = cookie.name.lowercased()
                return !(name.hasPrefix("_ga") || name.hasPrefix("_gid") ||
                         name.hasPrefix("_fbp") || name.hasPrefix("cf_"))
            }
        if !loginCookies.isEmpty {
            let header = HTTPCookie.requestHeaderFields(with: loginCookies)["Cookie"]
            request.setValue(header, forHTTPHeaderField: "Cookie")
        }
        return try await perform(request)
    }

    func intelligenceOverview(days: Int = 7) async throws -> IntelligenceOverview {
        var components = URLComponents(url: AppConfig.unifiedBackendURL.appending(path: "/api/admin/hotels/intelligence"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "days", value: String(days))]
        guard let url = components.url else { throw APIError.invalidURL }
        let (data, response) = try await intelligencePerform(URLRequest(url: url))
        try validate(response, data: data)
        return try decoder.decode(IntelligenceOverviewResponse.self, from: data).overview
    }

    func intelligenceSessions(days: Int = 7) async throws -> [IntelligenceSession] {
        var components = URLComponents(url: AppConfig.unifiedBackendURL.appending(path: "/api/admin/hotels/intelligence/sessions"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "days", value: String(days))]
        guard let url = components.url else { throw APIError.invalidURL }
        let (data, response) = try await intelligencePerform(URLRequest(url: url))
        try validate(response, data: data)
        return try decoder.decode(IntelligenceSessionsResponse.self, from: data).sessions
    }

    func intelligenceJourney(sessionID: String) async throws -> IntelligenceJourneyResponse {
        let url = AppConfig.unifiedBackendURL.appending(path: "/api/admin/hotels/intelligence/sessions/\(sessionID)")
        let (data, response) = try await intelligencePerform(URLRequest(url: url))
        try validate(response, data: data)
        return try decoder.decode(IntelligenceJourneyResponse.self, from: data)
    }

    func intelligenceReports() async throws -> [IntelligenceReport] {
        let url = AppConfig.unifiedBackendURL.appending(path: "/api/admin/hotels/intelligence/reports")
        let (data, response) = try await intelligencePerform(URLRequest(url: url))
        try validate(response, data: data)
        return try decoder.decode(IntelligenceReportsResponse.self, from: data).reports
    }

    func intelligenceChatHistory(threadID: String) async throws -> IntelligenceChatHistory {
        var components = URLComponents(url: AppConfig.unifiedBackendURL.appending(path: "/api/admin/hotels/intelligence/chat"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "threadId", value: threadID)]
        guard let url = components.url else { throw APIError.invalidURL }
        let (data, response) = try await intelligencePerform(URLRequest(url: url))
        try validate(response, data: data)
        return try decoder.decode(IntelligenceChatHistory.self, from: data)
    }

    func intelligenceChat(message: String, threadID: String?, days: Int) async throws -> IntelligenceChatAnswer {
        var request = URLRequest(url: AppConfig.unifiedBackendURL.appending(path: "/api/admin/hotels/intelligence/chat"))
        request.httpMethod = "POST"
        request.timeoutInterval = 85
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["message": message, "days": days]
        if let threadID { body["threadId"] = threadID }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await intelligencePerform(request)
        try validate(response, data: data)
        return try decoder.decode(IntelligenceChatAnswer.self, from: data)
    }

    func generateIntelligenceReport() async throws {
        var request = URLRequest(url: AppConfig.unifiedBackendURL.appending(path: "/api/admin/hotels/intelligence/reports/generate"))
        request.httpMethod = "POST"
        request.timeoutInterval = 85
        let (data, response) = try await intelligencePerform(request)
        try validate(response, data: data)
    }
}
