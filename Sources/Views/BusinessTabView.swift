import SwiftUI

@MainActor
final class BusinessNavigationStore: ObservableObject {
    @Published var selection: BusinessWorkspaceSection = .overview

    func navigate(to section: BusinessWorkspaceSection) {
        selection = section
    }
}

enum BusinessWorkspaceSection: String, Identifiable, CaseIterable, Hashable {
    case overview
    case bookings
    case chats
    case flights
    case profile
    case sessions
    case employees
    case archive
    case payments
    case ziyarats
    case notifications
    case esimCenter

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: return "Обзор"
        case .bookings: return "Бронирования"
        case .chats: return "Чаты"
        case .flights: return "Авиабилеты"
        case .profile: return "Мой профиль"
        case .sessions: return "Устройства и сеансы"
        case .employees: return "Сотрудники"
        case .archive: return "Архив клиентов"
        case .payments: return "Payments"
        case .ziyarats: return "Ziyarats"
        case .notifications: return "Создать уведомление"
        case .esimCenter: return "eSIM Center"
        }
    }

    var systemImage: String {
        switch self {
        case .overview: return "square.grid.2x2.fill"
        case .bookings: return "suitcase.rolling.fill"
        case .chats: return "message.fill"
        case .flights: return "airplane"
        case .profile: return "person.crop.circle"
        case .sessions: return "lock.shield"
        case .employees: return "person.2"
        case .archive: return "archivebox"
        case .payments: return "creditcard.and.123"
        case .ziyarats: return "map.fill"
        case .notifications: return "bell.badge.fill"
        case .esimCenter: return "simcard.2.fill"
        }
    }

    static let primary: [BusinessWorkspaceSection] = [
        .overview, .bookings, .chats, .flights
    ]

    static let administration: [BusinessWorkspaceSection] = [
        .profile, .sessions, .employees, .archive, .payments, .ziyarats, .notifications
    ]
}

/// Adaptive application shell.
/// - Compact width: preserves the established iPhone bottom-tab + drawer UI.
/// - iPad regular/wide: persistent product sidebar.
/// - Mac Catalyst: desktop sidebar at every supported window size.
struct BusinessTabView: View {
    @Environment(\.businessAdaptiveLayout) private var layout

    var body: some View {
        if layout.usesWorkspaceNavigation {
            BusinessWorkspaceView()
        } else {
            BusinessCompactTabView()
        }
    }
}

private struct BusinessCompactTabView: View {
    @EnvironmentObject private var navigation: BusinessNavigationStore

    var body: some View {
        BusinessSidebarHost {
            TabView(selection: $navigation.selection) {
                NavigationStack { OverviewView() }
                    .tag(BusinessWorkspaceSection.overview)
                    .tabItem { Label("Обзор", systemImage: "square.grid.2x2.fill") }
                NavigationStack { BookingsView() }
                    .tag(BusinessWorkspaceSection.bookings)
                    .tabItem { Label("Брони", systemImage: "suitcase.rolling.fill") }
                NavigationStack { ChatsView() }
                    .tag(BusinessWorkspaceSection.chats)
                    .tabItem { Label("Чаты", systemImage: "message.fill") }
                NavigationStack { FlightCurationView(tabMode: true) }
                    .tag(BusinessWorkspaceSection.flights)
                    .tabItem { Label("Авиабилеты", systemImage: "airplane") }
            }
            .tint(BusinessDesign.ink)
            .onChange(of: navigation.selection) { _, value in
                // Admin destinations live in the compact drawer rather than tabs.
                if !BusinessWorkspaceSection.primary.contains(value) {
                    navigation.selection = .overview
                }
            }
        }
    }
}

private struct BusinessWorkspaceView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var navigation: BusinessNavigationStore
    @StateObject private var compatibilitySidebarStore = BusinessSidebarStore()
    @State private var columnVisibility: NavigationSplitViewVisibility = .all

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            List {
                Section {
                    ForEach(BusinessWorkspaceSection.primary) { section in
                        workspaceRow(section)
                    }
                }

                Section("Управление") {
                    ForEach(BusinessWorkspaceSection.administration) { section in
                        workspaceRow(section)
                    }
                    if auth.user?.role.lowercased() == "superadmin" {
                        workspaceRow(.esimCenter)
                    }
                }

                Section {
                    Button(role: .destructive) {
                        Task { await auth.logout() }
                    } label: {
                        Label("Выйти", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }
            }
            .listStyle(.sidebar)
            .navigationTitle("iumrah Business")
            .navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 300)
        } detail: {
            BusinessAdaptivePaneHost {
                NavigationStack {
                    workspaceDestination(navigation.selection)
                }
                .id(navigation.selection)
            }
        }
        .navigationSplitViewStyle(.balanced)
        .environmentObject(compatibilitySidebarStore)
        .environment(\.businessUsesPersistentSidebar, true)
        .tint(BusinessDesign.ink)
        .background(BusinessDesign.background.ignoresSafeArea())
    }

    @ViewBuilder
    private func workspaceRow(_ section: BusinessWorkspaceSection) -> some View {
        Button {
            navigation.navigate(to: section)
        } label: {
            Label(section.title, systemImage: section.systemImage)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .fontWeight(navigation.selection == section ? .semibold : .regular)
        .foregroundStyle(navigation.selection == section ? BusinessDesign.ink : .primary)
        .listRowBackground(
            navigation.selection == section
                ? BusinessDesign.secondarySurface
                : Color.clear
        )
        .accessibilityAddTraits(navigation.selection == section ? .isSelected : [])
    }

    @ViewBuilder
    private func workspaceDestination(_ section: BusinessWorkspaceSection) -> some View {
        switch section {
        case .overview: OverviewView()
        case .bookings: BookingsView()
        case .chats: ChatsView()
        case .flights: FlightCurationView(tabMode: true)
        case .profile: ProfileView()
        case .sessions: BusinessSessionsView()
        case .employees: EmployeesView()
        case .archive: ClientArchiveView()
        case .payments: PaymentsView()
        case .ziyarats: ZiyaratsView()
        case .notifications: NotificationsComposerView()
        case .esimCenter: ESIMCenterView()
        }
    }
}

struct BusinessNavigationCommands: Commands {
    @ObservedObject var navigation: BusinessNavigationStore

    var body: some Commands {
        CommandMenu("Navigate") {
            Button("Overview") { navigation.navigate(to: .overview) }
                .keyboardShortcut("1", modifiers: .command)
            Button("Bookings") { navigation.navigate(to: .bookings) }
                .keyboardShortcut("2", modifiers: .command)
            Button("Chats") { navigation.navigate(to: .chats) }
                .keyboardShortcut("3", modifiers: .command)
            Button("Flights") { navigation.navigate(to: .flights) }
                .keyboardShortcut("4", modifiers: .command)

            Divider()

            Button("Search clients") { navigation.navigate(to: .archive) }
                .keyboardShortcut("f", modifiers: .command)
            Button("New notification") { navigation.navigate(to: .notifications) }
                .keyboardShortcut("n", modifiers: [.command, .shift])
        }
    }
}
