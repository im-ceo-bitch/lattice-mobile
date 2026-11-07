import Foundation

// One point of configuration for the Business client. The shipped JSON contains
// public HTTPS endpoints only; never add Cloudflare / provider access tokens here.
private struct BusinessEndpointSettings: Decodable {
    let platform_api_url: String?
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
    // Flight Hub can move independently to the new account's workers.dev host.
    static let flightHubBaseURL: URL = httpsURL(settings?.flight_hub_url) ??
        apiBaseURL.appending(path: "api/flight-hub")
    static let appName = "iumrah Business"
    static let buildChannel = "TestFlight"

    static func absoluteURL(_ value: String?) -> URL? {
        guard let value, !value.isEmpty else { return nil }
        if let direct = URL(string: value), direct.scheme != nil { return direct }
        return URL(string: value, relativeTo: apiBaseURL)?.absoluteURL
    }
}
