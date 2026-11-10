import Foundation
import Security
import CryptoKit
import LocalAuthentication
import SwiftUI

// The local app lock never replaces server authorization. It only protects an
// already authenticated Business workspace when the device is shared or idle.
enum BusinessAppLockInterval: Int, CaseIterable, Identifiable {
    case immediately = 0
    case oneHour = 3600
    case sixHours = 21600
    case twelveHours = 43200
    case oneDay = 86400

    var id: Int { rawValue }
    var title: String {
        switch self {
        case .immediately: return "Сразу после выхода"
        case .oneHour: return "Через 1 час"
        case .sixHours: return "Через 6 часов"
        case .twelveHours: return "Через 12 часов"
        case .oneDay: return "Через 24 часа"
        }
    }
}

private enum BusinessLockKeychain {
    static let service = "com.iumrah.root.local-app-lock"
    private static let pinAccount = "pin-record-v1"

    static func read() -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: pinAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
        return result as? Data
    }

    static func write(_ data: Data) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: pinAccount
        ]
        if SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary) == errSecSuccess { return }
        var payload = query
        payload[kSecValueData as String] = data
        payload[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(payload as CFDictionary, nil)
        guard status == errSecSuccess else { throw BusinessAppLockError.storage }
    }

    static func remove() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: pinAccount
        ]
        SecItemDelete(query as CFDictionary)
    }
}

private struct BusinessPINRecord: Codable {
    let account: String
    let salt: Data
    let digest: Data
}

enum BusinessAppLockError: LocalizedError {
    case invalidPIN
    case incorrectPIN
    case mismatch
    case storage
    case unavailableBiometrics
    case lockedOut

    var errorDescription: String? {
        switch self {
        case .invalidPIN: return "PIN должен состоять ровно из шести цифр."
        case .incorrectPIN: return "Неверный PIN-код."
        case .mismatch: return "PIN-коды не совпадают."
        case .storage: return "Не удалось сохранить PIN в защищённом хранилище."
        case .unavailableBiometrics: return "Face ID или Touch ID недоступен на этом устройстве."
        case .lockedOut: return "Слишком много попыток. Повторите позже."
        }
    }
}

@MainActor
final class BusinessAppLockStore: ObservableObject {
    private enum Keys {
        static let interval = "iumrah.business.app-lock.interval-v1"
        static let biometrics = "iumrah.business.app-lock.biometrics-v1"
        static let lastBackground = "iumrah.business.app-lock.background-v1"
        static let failedAttempts = "iumrah.business.app-lock.failures-v1"
        static let blockedUntil = "iumrah.business.app-lock.blocked-until-v1"
    }

    @Published private(set) var hasPIN: Bool
    @Published private(set) var isLocked: Bool
    @Published private(set) var biometricsEnabled: Bool
    @Published private(set) var interval: BusinessAppLockInterval
    @Published private(set) var errorMessage: String?
    @Published private(set) var blockedUntil: Date?

    private var sceneInactiveAt: Date?
    private var biometricPromptInProgress = false
    private let preferences = UserDefaults.standard

    init() {
        let configured = (try? JSONDecoder().decode(BusinessPINRecord.self, from: BusinessLockKeychain.read() ?? Data())) != nil
        hasPIN = configured
        isLocked = configured // Cold launches always require local unlock.
        biometricsEnabled = configured && UserDefaults.standard.bool(forKey: Keys.biometrics)
        interval = BusinessAppLockInterval(rawValue: UserDefaults.standard.integer(forKey: Keys.interval)) ?? .immediately
        blockedUntil = UserDefaults.standard.object(forKey: Keys.blockedUntil) as? Date
    }

    private var record: BusinessPINRecord? {
        guard let data = BusinessLockKeychain.read() else { return nil }
        return try? JSONDecoder().decode(BusinessPINRecord.self, from: data)
    }

    func bindAccount(_ login: String) {
        guard let stored = record else { return }
        if stored.account != login.lowercased() {
            clearPIN()
        }
    }

    func setInterval(_ value: BusinessAppLockInterval) {
        interval = value
        preferences.set(value.rawValue, forKey: Keys.interval)
    }

    func setPIN(_ newPIN: String, confirmation: String, account: String, oldPIN: String? = nil) throws {
        guard newPIN.count == 6 && newPIN.allSatisfy(\.isNumber) else { throw BusinessAppLockError.invalidPIN }
        guard newPIN == confirmation else { throw BusinessAppLockError.mismatch }
        if hasPIN {
            guard let oldPIN, verifyPIN(oldPIN, unlock: false) else { throw BusinessAppLockError.incorrectPIN }
        }
        var saltBytes = [UInt8](repeating: 0, count: 32)
        let randomResult = saltBytes.withUnsafeMutableBufferPointer { pointer in
            SecRandomCopyBytes(kSecRandomDefault, pointer.count, pointer.baseAddress!)
        }
        guard randomResult == errSecSuccess else { throw BusinessAppLockError.storage }
        let salt = Data(saltBytes)
        let digest = Self.digest(pin: newPIN, salt: salt)
        let record = BusinessPINRecord(account: account.lowercased(), salt: salt, digest: digest)
        try BusinessLockKeychain.write(JSONEncoder().encode(record))
        preferences.set(0, forKey: Keys.failedAttempts)
        preferences.removeObject(forKey: Keys.blockedUntil)
        blockedUntil = nil
        hasPIN = true
        isLocked = false
        errorMessage = nil
    }

    func removePIN(currentPIN: String) -> Bool {
        guard verifyPIN(currentPIN, unlock: false) else { return false }
        clearPIN()
        return true
    }

    func clearPIN() {
        BusinessLockKeychain.remove()
        preferences.removeObject(forKey: Keys.biometrics)
        preferences.removeObject(forKey: Keys.lastBackground)
        preferences.removeObject(forKey: Keys.blockedUntil)
        preferences.removeObject(forKey: Keys.failedAttempts)
        biometricsEnabled = false
        hasPIN = false
        isLocked = false
        blockedUntil = nil
        errorMessage = nil
        sceneInactiveAt = nil
    }

    private static func digest(pin: String, salt: Data) -> Data {
        var combined = salt
        combined.append(contentsOf: pin.utf8)
        return Data(SHA256.hash(data: combined))
    }

    private static func constantTimeEquals(_ a: Data, _ b: Data) -> Bool {
        guard a.count == b.count else { return false }
        return zip(a, b).reduce(UInt8(0)) { partial, bytes in partial | (bytes.0 ^ bytes.1) } == 0
    }

    @discardableResult
    func verifyPIN(_ entered: String, unlock: Bool = true) -> Bool {
        guard let record else { errorMessage = "PIN-код не настроен."; return false }
        if let blockedUntil, blockedUntil > Date() {
            errorMessage = "Слишком много попыток. Повторите позже."
            return false
        }
        let valid = entered.count == 6 && Self.constantTimeEquals(
            record.digest, Self.digest(pin: entered, salt: record.salt)
        )
        if valid {
            preferences.set(0, forKey: Keys.failedAttempts)
            preferences.removeObject(forKey: Keys.blockedUntil)
            blockedUntil = nil
            errorMessage = nil
            if unlock { isLocked = false }
            return true
        }
        let failed = preferences.integer(forKey: Keys.failedAttempts) + 1
        preferences.set(failed, forKey: Keys.failedAttempts)
        if failed % 5 == 0 {
            let penalty = min(3600, 60 * (1 << min(5, failed / 5 - 1)))
            blockedUntil = Date().addingTimeInterval(TimeInterval(penalty))
            preferences.set(blockedUntil, forKey: Keys.blockedUntil)
            errorMessage = "Слишком много попыток. Повторите позже."
        } else {
            errorMessage = "Неверный PIN-код."
        }
        return false
    }

    var biometryName: String {
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else { return "Face ID / Touch ID" }
        return context.biometryType == .faceID ? "Face ID" : "Touch ID"
    }

    var canUseBiometrics: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
    }

    func setBiometricsEnabled(_ enabled: Bool) async -> Bool {
        if !enabled {
            biometricsEnabled = false
            preferences.set(false, forKey: Keys.biometrics)
            return true
        }
        guard hasPIN, canUseBiometrics else {
            errorMessage = BusinessAppLockError.unavailableBiometrics.localizedDescription
            return false
        }
        guard await evaluateBiometrics(reason: "Подтвердите включение биометрической разблокировки iumrah Business") else {
            errorMessage = "Не удалось включить биометрию. PIN-код продолжает работать."
            return false
        }
        biometricsEnabled = true
        preferences.set(true, forKey: Keys.biometrics)
        errorMessage = nil
        return true
    }

    func unlockWithBiometrics() async -> Bool {
        guard hasPIN, isLocked, biometricsEnabled, canUseBiometrics else { return false }
        if let blockedUntil, blockedUntil > Date() { return false }
        let result = await evaluateBiometrics(reason: "Разблокировать iumrah Business")
        if result { isLocked = false; errorMessage = nil }
        return result
    }

    private func evaluateBiometrics(reason: String) async -> Bool {
        let context = LAContext()
        context.localizedFallbackTitle = "Ввести PIN"
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else { return false }
        biometricPromptInProgress = true
        let result = await withCheckedContinuation { continuation in
            context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { success, _ in
                continuation.resume(returning: success)
            }
        }
        biometricPromptInProgress = false
        return result
    }

    func didPasswordLogin(account: String) {
        bindAccount(account)
        isLocked = false
        sceneInactiveAt = nil
        preferences.removeObject(forKey: Keys.lastBackground)
        errorMessage = nil
    }

    func didSignOut() {
        isLocked = hasPIN
        sceneInactiveAt = nil
    }

    func sceneDidMoveToBackground() {
        guard hasPIN && !biometricPromptInProgress else { return }
        sceneInactiveAt = Date()
        preferences.set(sceneInactiveAt, forKey: Keys.lastBackground)
        if interval == .immediately { isLocked = true }
    }

    func sceneDidBecomeActive(authenticated: Bool) {
        guard authenticated && hasPIN && !biometricPromptInProgress else { return }
        let inactive = sceneInactiveAt ?? (preferences.object(forKey: Keys.lastBackground) as? Date)
        if let inactive, Date().timeIntervalSince(inactive) >= TimeInterval(interval.rawValue) {
            isLocked = true
        }
        sceneInactiveAt = nil
    }
}
