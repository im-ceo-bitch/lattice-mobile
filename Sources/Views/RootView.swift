import SwiftUI

struct RootView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var appLock: BusinessAppLockStore
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            BusinessDesign.background.ignoresSafeArea()
            switch auth.state {
            case .checking: LaunchView()
            case .signedOut: LoginView()
            case .signedIn:
                BusinessTabView()
                    .allowsHitTesting(!appLock.isLocked && scenePhase == .active)
                if appLock.isLocked {
                    BusinessAppUnlockView()
                }
            }
        }
        .overlay {
            // Prevent displaying Business data in app-switcher snapshots.
            if auth.state == .signedIn && scenePhase != .active {
                BusinessAppPrivacyShield()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .iumrahBusinessSessionInvalidated)) { _ in
            auth.handleSessionInvalidated()
        }
        .onChange(of: auth.state) { _, state in
            if state == .signedIn, let login = auth.user?.login {
                appLock.bindAccount(login)
                Task { await auth.expireWeeklySessionIfNeeded() }
            } else if state == .signedOut {
                appLock.didSignOut()
            }
        }
        .onChange(of: auth.passwordLoginSerial) { _, _ in
            if let login = auth.user?.login { appLock.didPasswordLogin(account: login) }
        }
        .onChange(of: scenePhase) { _, next in
            switch next {
            case .active:
                appLock.sceneDidBecomeActive(authenticated: auth.state == .signedIn)
                Task { await auth.expireWeeklySessionIfNeeded() }
            case .inactive, .background:
                appLock.sceneDidMoveToBackground()
            @unknown default: break
            }
        }
    }
}

private struct LaunchView: View {
    @State private var pulse = false
    var body: some View {
        VStack(spacing: 18) {
            BusinessBrandLogo(height: 62)
                .frame(maxWidth: 300)
            Capsule()
                .fill(BusinessDesign.ink.opacity(0.85))
                .frame(width: pulse ? 72 : 28, height: 3)
                .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: pulse)
        }
        .onAppear { pulse = true }
    }
}
