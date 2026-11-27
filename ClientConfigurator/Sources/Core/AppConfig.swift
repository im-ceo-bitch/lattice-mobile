import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

enum AppConfig {
    static let appName = "iUmra"
    // One first-party API origin. /api/package is a compatibility path, NOT a
    // separate Worker. The unified backend must implement these contracts.
    static let apiBaseURL = URL(string: "https://iumrah-backend.helloiumrah.workers.dev")!
    static let publicWebBaseURL = URL(string: "https://iumrah.app")!
    // All first-party API requests use the unified Worker.
    private static let legacyAPIHosts: Set<String> = [
        "iumrah.app", "www.iumrah.app", "iumrah.uz", "www.iumrah.uz",
        "iumrahproject.com", "www.iumrahproject.com", "iumrah.us", "www.iumrah.us",
        "iumrah-package-api.helloiumrah.workers.dev", "iumrah-flight-hub.helloiumrah.workers.dev"
    ]

    static let flightInventoryConfigured = true
    static let hotelPriceProviderTimeoutSeconds: Double = 17
    static let hotelPriceSearchHardTimeoutSeconds: Double = 46
    static let packageHealthPath = "/api/package/health"
    static let packageBookingPath = "/api/bookings"
    static let usesServerPrimaryHotelResolver = true
    static let usesLocalPrimaryHotelFallback = true

    /// Resolve first-party API requests on the single Worker. Preserve the
    /// percent-encoded path and query, including signed attachment parameters.
    /// Never attach client credentials to an arbitrary host supplied by a response.
    static func apiURL(_ rawValue: String, query: [URLQueryItem] = []) -> URL? {
        guard !rawValue.isEmpty, !rawValue.hasPrefix("//"), !rawValue.contains("\\"),
              var parts = URLComponents(string: rawValue), parts.user == nil, parts.password == nil,
              parts.fragment == nil else { return nil }
        if let host = parts.host?.lowercased() {
            guard parts.scheme?.lowercased() == "https", parts.port == nil || parts.port == 443,
                  host == apiBaseURL.host || legacyAPIHosts.contains(host) else { return nil }
        } else if parts.scheme != nil || parts.port != nil {
            return nil
        }
        var path = parts.percentEncodedPath
        if !path.hasPrefix("/") { path = "/" + path }
        // No dot-segment escape from the API namespace.
        let decoded = path.removingPercentEncoding ?? path
        guard decoded.hasPrefix("/api/"), !decoded.contains("\\"),
              !decoded.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }) else { return nil }
        parts.scheme = "https"
        parts.host = apiBaseURL.host
        parts.port = nil
        parts.percentEncodedPath = path
        if !query.isEmpty { parts.queryItems = (parts.queryItems ?? []) + query }
        return parts.url
    }

    static func isUnifiedAPIOrigin(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" && url.host?.lowercased() == apiBaseURL.host &&
        (url.port == nil || url.port == 443) && url.user == nil && url.password == nil
    }

    static func isAllowedAPIOrigin(_ url: URL) -> Bool {
        return isUnifiedAPIOrigin(url)
    }

    /// Public external image/map links remain public. First-party API media and
    /// relative API resources follow the same Worker as the rest of the app.
    static func absoluteURL(_ rawValue: String?) -> URL? {
        guard let rawValue, !rawValue.isEmpty else { return nil }
        if let api = apiURL(rawValue) { return api }
        if let direct = URL(string: rawValue), direct.scheme != nil { return direct }
        return URL(string: rawValue, relativeTo: apiBaseURL)?.absoluteURL
    }
}

/// Prevent a redirect from silently switching authenticated traffic back to a
/// legacy Worker or to a third-party host.
final class IumrahAPIOriginDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        guard let url = request.url, let original = response.url,
              AppConfig.isAllowedAPIOrigin(url), url.host?.lowercased() == original.host?.lowercased() else {
            completionHandler(nil)
            return
        }
        completionHandler(request)
    }
}
