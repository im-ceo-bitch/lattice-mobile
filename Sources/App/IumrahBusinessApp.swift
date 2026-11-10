import SwiftUI

@main
struct IumrahBusinessApp: App {
    @UIApplicationDelegateAdaptor(BusinessAppDelegate.self) private var appDelegate
    @StateObject private var auth = AuthStore()
    @StateObject private var navigation = BusinessNavigationStore()
    @StateObject private var appLock = BusinessAppLockStore()

    var body: some Scene {
        WindowGroup {
            BusinessAdaptiveLayoutHost {
                RootView()
                    .background {
                        BusinessPlatformWindowConfiguration()
                    }
            }
            .environmentObject(auth)
            .environmentObject(navigation)
            .environmentObject(appLock)
            .task { await BusinessNotifications.prepare() }
        }
        .commands {
            BusinessNavigationCommands(navigation: navigation)
        }
    }
}
