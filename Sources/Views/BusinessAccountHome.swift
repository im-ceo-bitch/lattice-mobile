import SwiftUI

struct BusinessAccountHome: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var navigation: BusinessNavigationStore
    @State private var flightOpen = false
    @State private var logout = false
    private var owner: Bool { auth.user?.role.lowercased() == "superadmin" }
    var body: some View {
        List {
            Section {
                NavigationLink { ProfileView() } label: {
                    HStack(spacing: 14) {
                        Image(systemName: "person.crop.circle.fill").font(.system(size: 42)).foregroundStyle(.secondary)
                        VStack(alignment: .leading) {
                            Text(auth.user?.displayName ?? "iumrah Business").font(.headline)
                            Text(auth.user?.login ?? "").font(.caption).foregroundStyle(.secondary)
                        }
                    }.padding(.vertical, 8)
                }
            }
            Section("Каталоги и услуги") {
                NavigationLink { FlightCurationView(tabMode: true, catalogMode: true) } label: { Label("Авиабилеты", systemImage: "airplane") }
                NavigationLink { BusinessNuiteeHotelsView() } label: { Label("Отели", systemImage: "building.2") }
                NavigationLink { ZiyaratsView() } label: { Label("Зияраты", systemImage: "map") }
                if owner { NavigationLink { ESIMCenterView() } label: { Label("eSIM Center", systemImage: "simcard.2") } }
            }
            Section("Управление") {
                if owner { NavigationLink { IntelligenceView() } label: { Label("Аналитика", systemImage: "chart.xyaxis.line") } }
                NavigationLink { PaymentsView() } label: { Label("Платежи", systemImage: "creditcard") }
                NavigationLink { EmployeesView() } label: { Label("Сотрудники", systemImage: "person.2") }
                NavigationLink { ClientArchiveView() } label: { Label("Архив клиентов", systemImage: "archivebox") }
                NavigationLink { NotificationsComposerView() } label: { Label("Создать уведомление", systemImage: "bell.badge") }
            }
            Section("Безопасность и диагностика") {
                NavigationLink { BusinessSecuritySettingsView() } label: { Label("Безопасность", systemImage: "lock.shield") }
                NavigationLink { BusinessSessionsView() } label: { Label("Устройства и сеансы", systemImage: "desktopcomputer") }
                NavigationLink { BusinessNotificationSoundView() } label: { Label("Звук уведомлений", systemImage: "speaker.wave.2") }
                NavigationLink { BusinessPushDiagnosticsView() } label: { Label("Диагностика уведомлений", systemImage: "bell") }
            }
            Section { Button("Выйти", role: .destructive) { logout = true } }
        }
        .navigationTitle("Аккаунт")
        .navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
        .navigationDestination(isPresented: $flightOpen) { FlightCurationView(tabMode: true, catalogMode: true) }
        .onAppear { openPendingFlight() }
        .onChange(of: navigation.openFlightCatalog) { _, _ in openPendingFlight() }
        .confirmationDialog("Выйти из аккаунта?", isPresented: $logout) { Button("Выйти", role: .destructive) { Task { await auth.logout() } } }
    }
    private func openPendingFlight() {
        if navigation.openFlightCatalog { navigation.openFlightCatalog = false; flightOpen = true }
    }
}
