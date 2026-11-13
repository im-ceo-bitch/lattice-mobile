import Foundation

// Compatibility shim for repository revisions where the Overview screen already
// expects Ignav usage statistics but APIClient.swift does not yet expose the
// corresponding endpoint. Kept in a separate extension so pricing updates do
// not replace the rest of APIClient and accidentally regress newer API methods.
extension APIClient {
    func ignavUsage() async throws -> IgnavUsageSnapshot {
        let url = AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/ignav-usage")
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)

        if let token = BusinessSessionVault.sessionToken {
            request.setValue(token, forHTTPHeaderField: "X-Iumrah-Business-Session")
        }

        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if http.statusCode == 401 {
            throw APIError.unauthorized
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError.server(message ?? "HTTP_\(http.statusCode)")
        }

        return try JSONDecoder().decode(IgnavUsageResponse.self, from: data).usage
    }
}
