import SwiftUI
import UIKit

private struct BusinessUsesPersistentSidebarKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var businessUsesPersistentSidebar: Bool {
        get { self[BusinessUsesPersistentSidebarKey.self] }
        set { self[BusinessUsesPersistentSidebarKey.self] = newValue }
    }
}

@MainActor
final class BusinessSidebarStore: ObservableObject {
    @Published var isOpen = false
    @Published var route: BusinessSidebarRoute?

    func open() {
        withAnimation(.interactiveSpring(response: 0.36, dampingFraction: 0.88, blendDuration: 0.10)) {
            isOpen = true
        }
    }

    func close() {
        withAnimation(.interactiveSpring(response: 0.34, dampingFraction: 0.90, blendDuration: 0.08)) {
            isOpen = false
        }
    }

    func show(_ route: BusinessSidebarRoute) {
        // Present the destination immediately. The full-screen destination owns its
        // own hit-testing and the drawer is reset underneath for the return trip.
        self.route = route
        isOpen = false
    }
}

enum BusinessSidebarRoute: String, Identifiable {
    case profile, security, sessions, employees, archive, payments, ziyarats, flights, notifications, esimCenter, intelligence
    var id: String { rawValue }
}

struct BusinessSidebarButton: View {
    @EnvironmentObject private var sidebar: BusinessSidebarStore
    @Environment(\.businessUsesPersistentSidebar) private var usesPersistentSidebar

    @ViewBuilder
    var body: some View {
        if !usesPersistentSidebar {
            Button { sidebar.open() } label: {
                Image(systemName: "line.3.horizontal")
                    .font(.system(size: 17, weight: .semibold))
            }
            .accessibilityLabel("Меню")
        }
    }
}

/// Root button-driven drawer. The drawer is a stationary, opaque surface underneath
/// the application; the complete application surface moves only when the explicit
/// menu button opens or closes it. There is intentionally no swipe gesture.
struct BusinessSidebarHost<Content: View>: View {
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var sidebar = BusinessSidebarStore()
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    private var screenWidth: CGFloat { UIScreen.main.bounds.width }
    private var drawerWidth: CGFloat { min(326, screenWidth * 0.76) }

    private var contentOffset: CGFloat {
        sidebar.isOpen ? drawerWidth : 0
    }

    private var openProgress: CGFloat {
        guard drawerWidth > 0 else { return 0 }
        return min(1, max(0, contentOffset / drawerWidth))
    }

    var body: some View {
        ZStack(alignment: .leading) {
            // Always opaque. Never animate opacity on the drawer itself: doing so
            // makes the screen underneath visible through menu rows.
            drawerLayer
                .zIndex(0)

            appSurface
                .zIndex(1)
        }
        .background(BusinessDesign.background.ignoresSafeArea())
        .fullScreenCover(item: $sidebar.route) { route in
            NavigationStack {
                switch route {
                case .profile: ProfileView()
                case .security: BusinessSecuritySettingsView()
                case .sessions: BusinessSessionsView()
                case .employees: EmployeesView()
                case .archive: ClientArchiveView()
                case .payments: PaymentsView()
                case .ziyarats: ZiyaratsView()
                case .flights: FlightCurationView()
                case .intelligence: IntelligenceView()
                case .notifications: NotificationsComposerView()
                case .esimCenter: ESIMCenterView()
                }
            }
        }
    }

    private var drawerLayer: some View {
        ZStack(alignment: .leading) {
            // Dedicated solid backdrop extending through status/home-indicator areas.
            BusinessDesign.background
                .ignoresSafeArea()

            drawerContent
        }
        .frame(width: drawerWidth)
        .frame(maxHeight: .infinity)
        // The drawer is opened only from the explicit menu button.
        .allowsHitTesting(sidebar.isOpen)
        .accessibilityHidden(!sidebar.isOpen)
    }

    private var appSurface: some View {
        // IMPORTANT: all overlays/gestures that belong to the app surface are added
        // BEFORE offset. This guarantees their hit region travels with the page and
        // never remains invisibly on top of the revealed drawer.
        content
            .environmentObject(sidebar)
            .background(BusinessDesign.background)
            .overlay {
                if sidebar.isOpen {
                    // Transparent interaction layer only over the MOVED app surface.
                    // It prevents accidental interaction with the page and closes the
                    // drawer on tap, just like ChatGPT.
                    Rectangle()
                        .fill(Color.black.opacity(0.0001))
                        .contentShape(Rectangle())
                        .onTapGesture { sidebar.close() }
                }
            }
            // No root frame and no clipShape here. Navigation bars, status-area
            // content and the TabView keep their original full-height geometry.
            .shadow(
                color: .black.opacity(0.14 * openProgress),
                radius: 26 * openProgress,
                x: -8,
                y: 0
            )
            .offset(x: contentOffset)
    }

    // Deliberately no DragGesture here. The sidebar is button-only so it cannot
    // compete with scrolling, carousels, cards, or any other screen interaction.

    private var drawerContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                BusinessBrandLogo(width: 138)
                Text(auth.user?.displayName ?? "iumrah Business")
                    .font(.title3.bold())
                Text(auth.user?.login ?? "")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 22)
            .padding(.top, 22)
            .padding(.bottom, 24)

            if auth.user?.role.lowercased() == "superadmin" {
                sidebarButton("Аналитика", icon: "chart.xyaxis.line", route: .intelligence)
            }
            sidebarButton("Мой профиль", icon: "person.crop.circle", route: .profile)
            sidebarButton("Безопасность", icon: "lock.shield.fill", route: .security)
            sidebarButton("Устройства и сеансы", icon: "lock.shield", route: .sessions)
            sidebarButton("Сотрудники", icon: "person.2", route: .employees)
            sidebarButton("Архив клиентов", icon: "archivebox", route: .archive)
            sidebarButton("Payments", icon: "creditcard.and.123", route: .payments)
            sidebarButton("Ziyarats", icon: "map.fill", route: .ziyarats)
            if auth.user?.role.lowercased() == "superadmin" {
                sidebarButton("eSIM Center", icon: "simcard.2.fill", route: .esimCenter)
            }
            sidebarButton("Создать уведомление", icon: "bell.badge.fill", route: .notifications)

            Spacer(minLength: 12)

            Button(role: .destructive) {
                Task { await auth.logout() }
            } label: {
                Label("Выйти", systemImage: "rectangle.portrait.and.arrow.right")
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 18)
                    .frame(height: 52)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 10)
            .padding(.bottom, 18)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func sidebarButton(_ title: String, icon: String, route: BusinessSidebarRoute) -> some View {
        Button { sidebar.show(route) } label: {
            HStack(spacing: 13) {
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .semibold))
                    .frame(width: 28)
                Text(title)
                    .font(.body.weight(.semibold))
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.bold())
                    .foregroundStyle(.tertiary)
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 18)
            .frame(height: 54)
            .background(
                BusinessDesign.secondarySurface,
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
        }
        .buttonStyle(.plain)
        .contentShape(Rectangle())
        .padding(.horizontal, 10)
        .padding(.bottom, 6)
    }
}
