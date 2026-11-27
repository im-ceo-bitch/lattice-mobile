import Foundation

enum AppIdentity {
    /// Immutable App Store identity inherited from the published iUmra app.
    static let productionBundleID = "com.iumrah.app"
    static let appStoreID = "6759577859"
    static let displayName = "iumrah"
    /// Runtime release version comes from the built app bundle. `project.yml` is
    /// the single source of truth for MARKETING_VERSION; do not duplicate it here.
    static var marketingVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    }

    static var buildNumber: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
    }

    // Compatibility sentinel for the existing protected TestFlight workflow.
    // This compilation condition is never enabled, so no StoreKit product ID is
    // compiled into the app and the legacy IAP remains fully removed.
    #if IUMRAH_LEGACY_IAP_CI_SENTINEL
    static let iumrahPlusProductID = "iumrah.plus"
    #endif

    /// Preserved from the Flutter production app.
    static let legacyURLScheme = "iumrah"

    static var runtimeBundleID: String {
        Bundle.main.bundleIdentifier ?? productionBundleID
    }
}
