import Foundation

// MARK: - iUmrah Security KYC
//
// Kept in a focused extension so the KYC hotfix does not replace the main
// APIClient.swift and cannot roll back newer networking/eSIM work.
extension APIClient {
    func reviewBookingSecurity(
        bookingID: String,
        action: String,
        note: String
    ) async throws -> BusinessSecuritySubmission {
        let url = AppConfig.apiBaseURL.appending(
            path: "/api/admin/hotels/operations/bookings/\(bookingID)/security/review"
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 45
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let sessionToken = BusinessSessionVault.sessionToken {
            request.setValue(sessionToken, forHTTPHeaderField: "X-Iumrah-Business-Session")
        }

        request.httpBody = try JSONEncoder().encode(
            BusinessSecurityReviewPayload(action: action, note: note)
        )

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

        return try JSONDecoder()
            .decode(BusinessSecurityReviewResponse.self, from: data)
            .security
    }
}
