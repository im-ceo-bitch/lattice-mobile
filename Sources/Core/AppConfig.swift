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

    // Keep the existing platform API until the new Core Worker and all account/
    // bookings operations pass smoke tests on the new database.
    static let apiBaseURL: URL = httpsURL(settings?.platform_api_url) ?? URL(string: "https://iumrah.app")!
    // The single deployed Worker owns flights, telemetry and supported admin
    // services. Auth and bookings stay on the existing platform until their
    // routes and data are fully migrated; switching them prematurely logs users out.
    static let unifiedBackendURL: URL = httpsURL(settings?.backend_api_url)
        ?? httpsURL(settings?.flight_hub_url)
        ?? URL(string: "https://iumrah-backend.helloiumrah.workers.dev")!
    static let flightHubBaseURL: URL = unifiedBackendURL
    static let appName = "iumrah Business"
    static let buildChannel = "TestFlight"

    static func absoluteURL(_ value: String?) -> URL? {
        guard let value, !value.isEmpty else { return nil }
        if let direct = URL(string: value), direct.scheme != nil { return direct }
        return URL(string: value, relativeTo: apiBaseURL)?.absoluteURL
    }
}
