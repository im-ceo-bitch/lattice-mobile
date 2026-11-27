import Foundation

enum IumrahReferralLink {
    static let codeKey = "iumrah.referral.pendingCode"
    static let consentKey = "iumrah.referral.consent"
    static func normalized(_ raw: String) -> String? {
        let code = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return code.range(of: "^(IUMR-[A-F0-9]{24}|[A-F0-9]{16})$", options: .regularExpression) != nil ? code : nil
    }
    static func capture(_ url: URL) -> Bool {
        let parts = url.pathComponents.filter { $0 != "/" }
        let isWeb = url.scheme == "https" && ["iumrah.app", "iumrah.uz", "go.iumrah.app", "go.iumrah.uz", "iumrah-backend.helloiumrah.workers.dev"].contains(url.host ?? "") && parts.count == 2 && ["ref", "r"].contains(parts.first ?? "")
        let isApp = url.scheme == "iumrahapp" && url.host == "referral" && parts.count == 1
        guard (isWeb || isApp), let raw = parts.last, let code = normalized(raw) else { return false }
        let defaults = UserDefaults.standard
        if defaults.string(forKey: codeKey) != code {
            defaults.set(code, forKey: codeKey)
            defaults.set(false, forKey: consentKey)
        }
        return true
    }
    static func clear() {
        UserDefaults.standard.removeObject(forKey: codeKey)
        UserDefaults.standard.removeObject(forKey: consentKey)
    }
    static var headers: [String: String] {
        let defaults = UserDefaults.standard
        guard defaults.bool(forKey: consentKey), let raw = defaults.string(forKey: codeKey), let code = normalized(raw) else { return [:] }
        return ["x-iumrah-referral-code": code]
    }
}
