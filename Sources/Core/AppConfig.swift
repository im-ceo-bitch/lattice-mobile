import Foundation

// One point of configuration for the Business client. The shipped JSON contains
// public HTTPS endpoints only; never add Cloudflare / provider access tokens here.
private struct BusinessEndpointSettings: Decodable {
    let platform_api_url: String?
    let backend_api_url: String?
    let flight_hub_url: String?
}

enum AppConfig {
    private static let settings: BusinessEndpointSettings? = {
        guard let file = Bundle.main.url(forResource: "EndpointConfig", withExtension: "json"),
              let data = try? Data(contentsOf: file) else { return nil }
        return try? JSONDecoder().decode(BusinessEndpointSettings.self, from: data)
    }()

    private static func httpsURL(_ raw: String?) -> URL? {
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty,
              let url = URL(string: raw),
              url.scheme?.lowercased() == "https",
              url.host != nil,
              url.user == nil,
              url.password == nil,
              url.query == nil,
              url.fragment == nil else { return nil }
        return url
    }

    static let unifiedBackendURL: URL = URL(string: "https://iumrah-backend.helloiumrah.workers.dev")!
    static let apiBaseURL: URL = unifiedBackendURL
    static let flightHubBaseURL: URL = unifiedBackendURL
    static func isUnifiedModulePath(_ path: String) -> Bool {
        path.hasPrefix("/api/") || path == "/v1" || path.hasPrefix("/v1/")
    }
    static func routedAPIURL(_ url: URL) -> URL? {
        guard url.scheme?.lowercased() == "https", url.user == nil, url.password == nil,
              url.port == nil || url.port == 443, url.fragment == nil,
              var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let path = url.path
        guard !path.contains("\\"), !path.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }) else { return nil }
        let host = url.host?.lowercased()
        guard host == unifiedBackendURL.host || host == "iumrah.app" || host == "iumrah.uz" || host == "iumrah-package-api.helloiumrah.workers.dev" || host == "iumrah-flight-hub.helloiumrah.workers.dev" else { return nil }
        if isUnifiedModulePath(path) {
            parts.host = unifiedBackendURL.host
            parts.port = nil
        } else if path.hasPrefix("/api/") {
            parts.host = apiBaseURL.host
            parts.port = nil
        }
        return parts.url
    }
    static let appName = "iumrah Business"
    static let buildChannel = "TestFlight"

    static func absoluteURL(_ value: String?) -> URL? {
        guard let value, !value.isEmpty else { return nil }
        if let direct = URL(string: value), direct.scheme != nil { return routedAPIURL(direct) ?? direct }
        guard let relative = URL(string: value, relativeTo: apiBaseURL)?.absoluteURL else { return nil }
        return routedAPIURL(relative) ?? relative
    }
}
