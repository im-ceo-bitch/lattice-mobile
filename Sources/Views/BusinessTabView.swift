import SwiftUI

@MainActor
final class BusinessNavigationStore: ObservableObject {
    @Published var selection: BusinessWorkspaceSection = .kelvin
    @Published var bookingFilterRequest: String?
    @Published var unreadChatCount = 0
    @Published var openFlightCatalog = false
    @Published var openRequests = false
    @Published var configuratorRequest = 0
    func showConfigurator() { configuratorRequest += 1; selection = .overview }
    func showRequests() { openRequests = true; selection = .bookings }
    func openBookings(filter: String = "all") { bookingFilterRequest = filter; selection = .bookings }


    func navigate(to section: BusinessWorkspaceSection) {
        selection = section
    }
}

enum BusinessWorkspaceSection: String, Identifiable, CaseIterable, Hashable {
    case overview
    case kelvin
    case account
    case bookings
    case chats
    case flights
    case intelligence
    case profile
    case security
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
        case .kelvin: return "Kelvin"
        case .account: return "Аккаунт"
        case .bookings: return "Поездки"
        case .chats: return "Чаты"
        case .flights: return "Каталоги"
        case .intelligence: return "Аналитика"
        case .profile: return "Мой профиль"
        case .security: return "Безопасность"
        case .sessions: return "Устройства и сеансы"
        case .employees: return "Сотрудники"
        case .archive: return "Архив клиентов"
        case .payments: return "Платежи"
        case .ziyarats: return "Зияраты"
        case .notifications: return "Создать уведомление"
        case .esimCenter: return "eSIM Center"
        }
    }

    var systemImage: String {
        switch self {
        case .overview: return "square.grid.2x2.fill"
        case .kelvin: return "waveform"
        case .account: return "person.crop.circle"
        case .bookings: return "suitcase.rolling.fill"
        case .chats: return "message.fill"
        case .flights: return "square.stack"
        case .intelligence: return "chart.xyaxis.line"
        case .profile: return "person.crop.circle"
        case .security: return "lock.shield.fill"
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
        .kelvin, .bookings, .overview, .chats, .account
    ]

    static let administration: [BusinessWorkspaceSection] = [
        .flights, .intelligence, .profile, .security, .sessions, .employees, .archive, .payments, .ziyarats, .notifications
    ]
}

/// Adaptive application shell.
/// - Compact width: preserves the established iPhone bottom-tab + drawer UI.
/// - iPad regular/wide: persistent product sidebar.
/// - Mac Catalyst: desktop sidebar at every supported window size.
struct BusinessTabView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var navigation: BusinessNavigationStore
    @Environment(\.businessAdaptiveLayout) private var layout

    var body: some View {
        Group {
            if layout.usesWorkspaceNavigation {
                BusinessWorkspaceView()
            } else {
                BusinessCompactTabView()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .iumrahBusinessFlightPriceOpen)) { _ in
            navigation.openFlightCatalog = true; navigation.navigate(to: .account)
        }
        .onReceive(NotificationCenter.default.publisher(for: .iumrahBusinessOfferOpen)) { _ in navigation.navigate(to: .bookings) }
        .onReceive(NotificationCenter.default.publisher(for: .iumrahBusinessBookingOpen)) { _ in
            navigation.navigate(to: .bookings)
        }
        .task(id: auth.user?.login) { await updateUnreadChats() }
        .onReceive(NotificationCenter.default.publisher(for: .iumrahBusinessChatChanged)) { _ in Task { await updateUnreadChats() } }
        .onReceive(NotificationCenter.default.publisher(for: .iumrahBusinessChatRead)) { _ in Task { await updateUnreadChats() } }
        .onReceive(NotificationCenter.default.publisher(for: .iumrahBusinessChatOpen)) { _ in
            navigation.navigate(to: .chats)
        }
        .onChange(of: auth.user?.role, initial: true) { _, role in
            if role?.lowercased() != "superadmin" && navigation.selection == .kelvin { navigation.selection = .overview }
        }
        .onAppear {
            if BusinessNotificationRoute.pendingBooking != nil || BusinessNotificationRoute.pendingOffer != nil { navigation.navigate(to: .bookings) }
            else if BusinessNotificationRoute.pendingChat != nil { navigation.navigate(to: .chats) }
            else if UserDefaults.standard.string(forKey: "iumrah.price.pendingFlightKey") != nil {
                navigation.openFlightCatalog = true; navigation.navigate(to: .account)
            }
        }
    }
    private func updateUnreadChats() async {
        let login = auth.user?.login
        guard login != nil, let threads = try? await APIClient.shared.businessChatThreads(), !Task.isCancelled, login == auth.user?.login else { return }
        navigation.unreadChatCount = threads.filter(\.unreadForStaff).count
    }
}

private struct BusinessCompactTabView: View {
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var sidebar = BusinessSidebarStore()
    @EnvironmentObject private var navigation: BusinessNavigationStore

    var body: some View {
        Group {
            TabView(selection: $navigation.selection) {
                NavigationStack { KelvinView(isSelected: navigation.selection == .kelvin) }
                    .tag(BusinessWorkspaceSection.kelvin)
                    .tabItem { Label("Kelvin", systemImage: "waveform") }
                NavigationStack { BookingsView() }
                    .tag(BusinessWorkspaceSection.bookings)
                    .tabItem { Label("Поездки", systemImage: "suitcase.rolling.fill") }
                NavigationStack { BusinessNativeConfiguratorView(owner: auth.user?.login ?? "") }
                    .tag(BusinessWorkspaceSection.overview)
                    .tabItem { Label("Обзор", systemImage: "square.grid.2x2.fill") }
                NavigationStack { ChatsView() }
                    .tag(BusinessWorkspaceSection.chats)
                    .tabItem { Label("Чаты", systemImage: "message.fill") }
                    .badge(navigation.unreadChatCount)
                NavigationStack { BusinessAccountHome() }
                    .tag(BusinessWorkspaceSection.account)
                    .tabItem { Label("Аккаунт", systemImage: "person.crop.circle") }
            }
            .environmentObject(sidebar)
            .environment(\.businessUsesPersistentSidebar, true)
            .tint(BusinessDesign.ink)
            .onAppear {
                // A compact iPad window can inherit a desktop-only selection.
                if !BusinessWorkspaceSection.primary.contains(navigation.selection) {
                    navigation.selection = .account
                }
            }
            .onChange(of: navigation.selection) { _, value in
                // Admin destinations live in the compact drawer rather than tabs.
                if !BusinessWorkspaceSection.primary.contains(value) {
                    navigation.selection = .account
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
                    ForEach(BusinessWorkspaceSection.administration.filter { $0 != .intelligence || auth.user?.role.lowercased() == "superadmin" }) { section in
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
            .navigationTitle("Kelvin").navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
            .navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 300)
        } detail: {
            BusinessAdaptivePaneHost {
                ZStack {
                    if auth.user?.role.lowercased() == "superadmin" {
                        NavigationStack { KelvinView(isSelected: navigation.selection == .kelvin) }
                            .opacity(navigation.selection == .kelvin ? 1 : 0)
                            .allowsHitTesting(navigation.selection == .kelvin)
                            .accessibilityHidden(navigation.selection != .kelvin)
                    }
                    if navigation.selection != .kelvin || auth.user?.role.lowercased() != "superadmin" {
                        NavigationStack { workspaceDestination(navigation.selection) }
                            .id(navigation.selection)
                    }
                }
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
        case .overview: BusinessNativeConfiguratorView(owner: auth.user?.login ?? "")
        case .kelvin: KelvinView()
        case .account: BusinessAccountHome()
        case .bookings: BookingsView()
        case .chats: ChatsView()
        case .flights: BusinessCatalogsView()
        case .intelligence: IntelligenceView()
        case .profile: ProfileView()
        case .security: BusinessSecuritySettingsView()
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
            Button("Kelvin") { navigation.navigate(to: .kelvin) }
                .keyboardShortcut("1", modifiers: .command)
            Button("Бронирования") { navigation.navigate(to: .bookings) }
                .keyboardShortcut("2", modifiers: .command)
            Button("Обзор") { navigation.navigate(to: .overview) }.keyboardShortcut("3", modifiers: .command)
            Button("Чаты") { navigation.navigate(to: .chats) }.keyboardShortcut("4", modifiers: .command)
            Button("Аккаунт") { navigation.navigate(to: .account) }.keyboardShortcut("5", modifiers: .command)

            Divider()

            Button("Архив клиентов") { navigation.navigate(to: .archive) }
                .keyboardShortcut("f", modifiers: .command)
            Button("Новое уведомление") { navigation.navigate(to: .notifications) }
                .keyboardShortcut("n", modifiers: [.command, .shift])
        }
    }
}
