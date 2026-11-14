import Foundation
import Security

/// Saves only the trusted API origin’s staff cookie securely across app restarts.
/// This does not extend cookie expiry and cannot override server-side expiry.
enum BusinessStaffAuthPersistence {
    private static let service = "com.iumrah.root.staff-auth"
    private static let account = "staff-cookie-snapshot-v1"
    static let maximumPasswordLoginAge: TimeInterval = 7 * 24 * 60 * 60

    private struct CookieEntry: Codable {
        let name: String
        let value: String
        let domain: String
        let path: String
        let expiresAt: Date?
        let secure: Bool
        let httpOnly: Bool
    }
    private struct Snapshot: Codable {
        let passwordLoginAt: Date
        let cookies: [CookieEntry]
    }

    private static let staffCookieName = "iumrah_staff_session"

    private static func normalizedHost(_ value: String) -> String {
        value.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
    }

    private static func isCurrentStaffCookie(_ cookie: HTTPCookie) -> Bool {
        cookie.name == staffCookieName && cookie.isSecure &&
        normalizedHost(cookie.domain) == AppConfig.apiBaseURL.host?.lowercased() &&
        (cookie.expiresDate ?? .distantFuture) > Date()
    }

    static var hasSavedLogin: Bool { read() != nil }

    static func clearStaffCookies() {
        let hosts = Set([AppConfig.apiBaseURL.host?.lowercased() ?? "", "iumrah.app", "iumrah.uz"])
        for cookie in HTTPCookieStorage.shared.cookies ?? [] where
            cookie.name == staffCookieName && hosts.contains(normalizedHost(cookie.domain)) {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
    }

    static var needsPasswordLogin: Bool {
        guard let snapshot = read() else { return false }
        return Date().timeIntervalSince(snapshot.passwordLoginAt) >= maximumPasswordLoginAge
    }

    @discardableResult
    static func restoreIfAllowed() -> Bool {
        guard let snapshot = read() else {
            return (HTTPCookieStorage.shared.cookies(for: AppConfig.apiBaseURL) ?? []).contains(where: isCurrentStaffCookie)
        }
        if needsPasswordLogin {
            clear()
            return false
        }
        for entry in snapshot.cookies {
            guard entry.name == staffCookieName, entry.secure,
                  normalizedHost(entry.domain) == AppConfig.apiBaseURL.host?.lowercased(),
                  (entry.expiresAt ?? .distantFuture) > Date() else { continue }
            var properties: [HTTPCookiePropertyKey: Any] = [
                .name: entry.name,
                .value: entry.value,
                .domain: entry.domain,
                .path: entry.path
            ]
            if let expiresAt = entry.expiresAt { properties[.expires] = expiresAt }
            if entry.secure { properties[.secure] = "TRUE" }
            if entry.httpOnly { properties[HTTPCookiePropertyKey("HttpOnly")] = "TRUE" }
            if let cookie = HTTPCookie(properties: properties) {
                HTTPCookieStorage.shared.setCookie(cookie)
            }
        }
        let valid = (HTTPCookieStorage.shared.cookies(for: AppConfig.apiBaseURL) ?? []).contains(where: isCurrentStaffCookie)
        if !valid { clear() }
        return valid
    }

    static func persistSuccessfulPasswordLogin() throws {
        try save(passwordLoginAt: Date())
    }

    static func persistRestoredLogin() throws {
        try save(passwordLoginAt: read()?.passwordLoginAt ?? Date())
    }

    private static func save(passwordLoginAt: Date) throws {
        let cookies = (HTTPCookieStorage.shared.cookies(for: AppConfig.apiBaseURL) ?? [])
            .filter(isCurrentStaffCookie)
            .map { cookie in
                CookieEntry(
                    name: cookie.name, value: cookie.value, domain: cookie.domain,
                    path: cookie.path, expiresAt: cookie.expiresDate,
                    secure: cookie.isSecure,
                    httpOnly: cookie.isHTTPOnly
                )
            }
        let value = Snapshot(passwordLoginAt: passwordLoginAt, cookies: cookies)
        guard !cookies.isEmpty else { throw APIError.server("STAFF_COOKIE_MISSING") }
        let data = try JSONEncoder().encode(value)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let replacement = [kSecValueData as String: data] as CFDictionary
        if SecItemUpdate(query as CFDictionary, replacement) == errSecSuccess { return }
        var toAdd = query
        toAdd[kSecValueData as String] = data
        toAdd[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        guard SecItemAdd(toAdd as CFDictionary, nil) == errSecSuccess else {
            throw APIError.server("STAFF_SESSION_STORAGE_FAILED")
        }
    }

    private static func read() -> Snapshot? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }

    static func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
        clearStaffCookies()
    }
}
