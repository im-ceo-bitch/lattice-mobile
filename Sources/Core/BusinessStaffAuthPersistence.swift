import Foundation
import Security

/// Saves only the existing site's staff cookies securely across app restarts.
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

    static var hasSavedLogin: Bool { read() != nil }

    static var needsPasswordLogin: Bool {
        guard let snapshot = read() else { return false }
        return Date().timeIntervalSince(snapshot.passwordLoginAt) >= maximumPasswordLoginAge
    }

    @discardableResult
    static func restoreIfAllowed() -> Bool {
        guard let snapshot = read() else { return true }
        if needsPasswordLogin {
            clear()
            return false
        }
        for entry in snapshot.cookies {
            guard (entry.expiresAt ?? .distantFuture) > Date() else { continue }
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
        return true
    }

    static func persistSuccessfulPasswordLogin() {
        save(passwordLoginAt: Date())
    }

    static func persistFirstRestoredLoginIfNeeded() {
        guard read() == nil else { return }
        save(passwordLoginAt: Date())
    }

    private static func save(passwordLoginAt: Date) {
        let cookies = (HTTPCookieStorage.shared.cookies ?? [])
            .filter { cookie in
                let host = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
                return host == "iumrah.app" || host.hasSuffix(".iumrah.app")
            }
            .map { cookie in
                CookieEntry(
                    name: cookie.name, value: cookie.value, domain: cookie.domain,
                    path: cookie.path, expiresAt: cookie.expiresDate,
                    secure: cookie.isSecure,
                    httpOnly: cookie.isHTTPOnly
                )
            }
        let value = Snapshot(passwordLoginAt: passwordLoginAt, cookies: cookies)
        guard let data = try? JSONEncoder().encode(value) else { return }
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
        _ = SecItemAdd(toAdd as CFDictionary, nil)
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
        HTTPCookieStorage.shared.cookies?.forEach { cookie in
            let host = cookie.domain.lowercased()
            if host.contains("iumrah.app") { HTTPCookieStorage.shared.deleteCookie(cookie) }
        }
    }
}
