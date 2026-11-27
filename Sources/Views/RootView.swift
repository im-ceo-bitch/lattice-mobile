import SwiftUI

struct RootView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var navigation: BusinessNavigationStore
    @EnvironmentObject private var appLock: BusinessAppLockStore
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.businessAdaptiveLayout) private var layout

    @State private var launchRevealing = true
    @State private var launchCollapsed = false
    @State private var launchStarted = Date()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            switch auth.state {
            case .checking: Color(uiColor: .systemBackground)
            case .signedOut: LoginView()
            case .signedIn:
                BusinessTabView()
                    .allowsHitTesting(!appLock.isLocked && scenePhase == .active)
                if appLock.isLocked {
                    BusinessAppUnlockView()
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { BusinessDesign.background.ignoresSafeArea() }
        .tint(BusinessDesign.ink)
        .overlay {
            if launchRevealing || auth.state == .checking {
                KelvinLaunchMark(collapsed: launchCollapsed).transition(.opacity).zIndex(1)
            }
        }
        .task(id: auth.state) {
            guard launchRevealing, auth.state != .checking else { return }
            let remaining = max(0, 0.82 - Date().timeIntervalSince(launchStarted))
            if !reduceMotion { try? await Task.sleep(for: .seconds(remaining)) }
            guard !Task.isCancelled else { return }
            if !reduceMotion && auth.state == .signedIn && !appLock.isLocked && !layout.usesWorkspaceNavigation && navigation.selection == .kelvin && auth.user?.role.lowercased() == "superadmin" {
                withAnimation(.easeInOut(duration: 0.42)) { launchCollapsed = true }
                try? await Task.sleep(for: .milliseconds(420))
            }
            guard !Task.isCancelled else { return }
            withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.22)) { launchRevealing = false }
        }
        .onReceive(NotificationCenter.default.publisher(for: .iumrahBusinessSessionInvalidated)) { notification in
            auth.handleSessionInvalidated(token: notification.object as? String)
        }
        .onChange(of: auth.state) { _, state in
            if state == .signedIn, let login = auth.user?.login {
                appLock.bindAccount(login)
                Task { await auth.expireWeeklySessionIfNeeded() }
            } else if state == .signedOut {
                appLock.didSignOut()
                navigation.unreadChatCount = 0
                navigation.bookingFilterRequest = nil
                navigation.configuratorRequest = 0
                navigation.selection = .kelvin
                BusinessNotificationRoute.pendingOffer = nil
                BusinessNotificationRoute.pendingBooking = nil
                BusinessNotificationRoute.pendingChat = nil
            }
        }
        .onChange(of: auth.passwordLoginSerial) { _, _ in
            if let login = auth.user?.login { appLock.didPasswordLogin(account: login) }
        }
        .onChange(of: scenePhase) { _, next in
            switch next {
            case .active:
                appLock.sceneDidBecomeActive(authenticated: auth.state == .signedIn)
                Task {
                    await auth.expireWeeklySessionIfNeeded()
                    if auth.state == .signedIn { await BusinessNotifications.registerCurrentDeviceIfPossible() }
                }
            case .background:
                // Face ID temporarily moves a scene into .inactive. Only a real
                // background transition counts towards automatic PIN locking.
                appLock.sceneDidMoveToBackground()
            case .inactive:
                break
            @unknown default: break
            }
        }
    }
}

