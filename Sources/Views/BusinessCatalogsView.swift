import SwiftUI

struct BusinessCatalogsView: View {
    @State private var flightOpen = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                BusinessPageHeading(title: "Каталоги", subtitle: "Источники и компоненты умры")
                NavigationLink { FlightCurationView(tabMode: true, catalogMode: true) } label: { row("Авиабилеты", "Umrah Direct Flights · мониторинг", "airplane") }
                NavigationLink { BusinessNuiteeHotelsView() } label: { row("Отели", "Мекка и Медина", "building.2") }
                NavigationLink { ZiyaratsView() } label: { row("Зияраты", "Управление экскурсиями", "map") }
            }.businessAdaptiveReadableWidth().padding(16)
        }
        .background(BusinessDesign.background)
        .navigationBarTitleDisplayMode(.inline)
        .businessNavigationSurface()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { BusinessSidebarButton() }
            ToolbarItem(placement: .principal) { BusinessBrandLogo(width: 150, foreground: .white).frame(height: 36) }
        }
        .navigationDestination(isPresented: $flightOpen) { FlightCurationView(tabMode: true, catalogMode: true) }
        .onReceive(NotificationCenter.default.publisher(for: .iumrahBusinessFlightPriceOpen)) { _ in flightOpen = true }
        .onAppear { if UserDefaults.standard.string(forKey: "iumrah.price.pendingFlightKey") != nil { flightOpen = true } }
    }
    private func row(_ title: String, _ subtitle: String, _ symbol: String) -> some View {
        HStack(spacing: 16) {
            Image(systemName: symbol).font(.title2).frame(width: 44)
            VStack(alignment: .leading, spacing: 4) { Text(title).font(.headline); Text(subtitle).font(.caption).foregroundStyle(.secondary) }
            Spacer(); Image(systemName: "chevron.right").font(.footnote)
        }.foregroundStyle(BusinessDesign.ink).padding(18).businessCard(radius: 22)
    }
}
