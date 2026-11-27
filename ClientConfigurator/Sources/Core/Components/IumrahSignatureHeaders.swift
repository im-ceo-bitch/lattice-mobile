import SwiftUI

/// Shared geometry used by the five root tabs and the four booking stages.
/// The black hero participates in scroll layout; it is never a sticky overlay.
enum IumrahSignatureHeaderGeometry {
    static let logoWidth: CGFloat = 187.2
    static let logoHeight: CGFloat = 57.6
    static let topInset: CGFloat = 14
    static let lowerInset: CGFloat = 100
    static let bottomRadius: CGFloat = 30
    static let summaryOverlap: CGFloat = 46
    static let contentHeight: CGFloat = logoHeight + topInset + lowerInset
}

/// One brand row shared by all five iPhone root tabs.
/// Identical 44-pt native chrome slots keep the wordmark geometrically
/// centered, including on smaller phones and when the drawer is unavailable.
/// This is also the layout used on Home: menu / wordmark / notifications.
struct IumrahPrimaryHeaderBrandRow: View {
    @EnvironmentObject private var chrome: AppChromeStore
    @EnvironmentObject private var settings: AppSettingsStore
    @Environment(\.iumrahNavigationChromeStyle) private var navigationChromeStyle
    @Environment(\.iumrahHelpInHeader) private var helpInHeader
    @ObservedObject private var notifications = ClientNotificationCenter.shared

    var body: some View {
        HStack(spacing: 0) {
            HStack {
                if navigationChromeStyle == .drawer {
                    IumrahGlassIconButton(systemName: "line.3.horizontal", size: 44, foreground: .white,
                        accessibilityLabel: IumrahAccessibilityCopy.text(settings.language,
                            ru: "Меню", en: "Menu", uz: "Menyu", cy: "Меню", tr: "Menu", id: "Menu")) { chrome.openSidebar() }
                }
                Spacer(minLength: 0)
            }.frame(width: helpInHeader ? 88 : 48)
            Spacer(minLength: 4)
            Image("HeaderWordmarkLight")
                .resizable().renderingMode(.template).scaledToFit()
                .foregroundStyle(.white)
                .frame(maxWidth: IumrahSignatureHeaderGeometry.logoWidth, maxHeight: IumrahSignatureHeaderGeometry.logoHeight)
                .accessibilityLabel("iumrah").accessibilityAddTraits(.isHeader)
            Spacer(minLength: 4)
            if helpInHeader {
                IumrahNativeHeaderActionGroup {
                    notificationAction
                    IumrahPageHelpButton(inSystemToolbar: true)
                }.frame(width: 88)
            } else {
                notificationAction.modifier(IumrahNativeChromeButton()).frame(width: 48, height: 48)
            }
        }
        .frame(height: IumrahSignatureHeaderGeometry.logoHeight)
        .foregroundStyle(.white)
        .environment(\.colorScheme, .dark)
    }
    private var notificationAction: some View {
        Button { IumrahHaptics.selection(); chrome.openNotifications() } label: {
            Image(systemName: notifications.unreadCount > 0 ? "bell.badge" : "bell")
                .font(.system(size: 17, weight: .medium))
        }
        .accessibilityLabel(IumrahAccessibilityCopy.text(settings.language,
            ru: "Уведомления", en: "Notifications", uz: "Bildirishnomalar", cy: "Билдиришномалар", tr: "Bildirimler", id: "Notifikasi"))
    }

}

/// Shared Booking-style independent pills. Horizontal scrolling avoids truncated
/// labels on iPhone mini; selected pills remain visible after a board switch.
struct IumrahHeaderPills: View {
    let labels: [String]
    let symbols: [String]
    var selection: Int? = nil
    var enabled: [Bool] = []
    let onSelect: (Int) -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(labels.indices, id: \.self) { index in
                        let selected = selection == index
                        let allowed = !enabled.indices.contains(index) || enabled[index]
                        Button {
                            IumrahHaptics.selection()
                            onSelect(index)
                        } label: {
                            HStack(spacing: 7) {
                                if symbols.indices.contains(index) {
                                    Image(systemName: symbols[index]).font(.system(size: 15, weight: .medium))
                                }
                                Text(labels[index]).font(.system(size: 13, weight: .semibold)).fixedSize()
                            }
                            .padding(.horizontal, 15)
                            .frame(height: 44)
                            .foregroundStyle(selected ? Color.black : Color.white.opacity(allowed ? 1 : 0.5))
                            .background(selected ? Color.white : Color.white.opacity(0.07), in: Capsule())
                            .overlay(Capsule().strokeBorder(Color.white.opacity(selected ? 1 : 0.65), lineWidth: 1))
                            .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                        .disabled(!allowed)
                        .accessibilityAddTraits(selected ? .isSelected : [])
                        .id(index)
                    }
                }
                .padding(.horizontal, IumrahDesign.pagePadding)
                .padding(.vertical, 1)
            }
            .onAppear { if let selection { proxy.scrollTo(selection, anchor: .center) } }
            .onChange(of: selection) { _, value in
                if let value { withAnimation(.easeInOut(duration: 0.22)) { proxy.scrollTo(value, anchor: .center) } }
            }
        }
        .frame(height: 46)
    }
}

struct IumrahHeaderTripleTabs: View {
    let labels: [String]
    let selection: Int
    let onSelect: (Int) -> Void
    var body: some View {
        IumrahHeaderPills(labels: labels, symbols: ["suitcase", "doc.text", "calendar"], selection: selection, onSelect: onSelect)
    }
}

struct IumrahHeaderCapsuleActions: View {
    let labels: [String]
    let symbols: [String]
    let enabled: [Bool]
    let onSelect: (Int) -> Void
    var body: some View {
        IumrahHeaderPills(labels: labels, symbols: symbols, enabled: enabled, onSelect: onSelect)
    }
}

/// Home, Hotels, Flights, Transfer and Package use exactly the same masthead.
struct IumrahDiscoveryMasthead: View {
    @EnvironmentObject private var chrome: AppChromeStore
    @EnvironmentObject private var settings: AppSettingsStore
    @EnvironmentObject private var manual: IumrahManualJourneyStore
    let selection: Int
    private func tr(_ ru: String, _ en: String, _ uz: String, _ cy: String) -> String {
        IumrahFlightCopy.text(settings.language, ru, en, uz, cy)
    }
    var body: some View {
        IumrahPrimaryTabHeader(footer: AnyView(IumrahHeaderPills(
            labels: [tr("Собрать умру", "Build Umrah", "Umra tuzish", "Умра тузиш"),
                     tr("Отели", "Hotels", "Mehmonxonalar", "Меҳмонхоналар"),
                     tr("Авиабилеты", "Flights", "Aviachiptalar", "Авиачипталар"),
                     tr("Трансфер", "Transfer", "Transfer", "Трансфер"),
                     tr("Гиды и команда", "Guides & team", "Gidlar va jamoa", "Гидлар ва жамоа"),
                     tr("Мой пакет", "My package", "Mening paketim", "Менинг пакетим") + (manual.componentCount > 0 ? " · \(manual.componentCount)" : "")],
            symbols: ["sparkles", "bed.double", "airplane", "car.side", "person.crop.circle.badge.checkmark", "suitcase"], selection: selection,
            onSelect: { index in
                switch index {
                case 0: chrome.openUmrahPlan()
                case 1: chrome.openHotels(board: .hotels)
                case 2: chrome.openHotels(board: .flights)
                case 3: chrome.openHotels(board: .transfer)
                case 4: chrome.openHotels(board: .guide)
                case 5: chrome.openHotels(board: .summary)
                default: break
                }
            })), discovery: true)
    }
}

/// One curved black masthead for all root surfaces, with room for the pills.
struct IumrahPrimaryTabHeader: View {
    var title: String? = nil
    var subtitle: String? = nil
    var footer: AnyView? = nil
    var discovery = false
    var flexibleFooter = false
    var animateMap = true

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            IumrahPrimaryHeaderBrandRow().padding(.horizontal, IumrahDesign.pagePadding)
            if let title {
                Text(title)
                    .font(IumrahType.bold(28, relativeTo: .largeTitle))
                    .lineLimit(1).minimumScaleFactor(0.78)
                    .foregroundStyle(.white).padding(.top, 7).padding(.horizontal, IumrahDesign.pagePadding)
                    .accessibilityAddTraits(.isHeader)
            }
            if let subtitle {
                Text(subtitle).font(IumrahType.regular(14, relativeTo: .subheadline))
                    .lineLimit(1).minimumScaleFactor(0.8)
                    .foregroundStyle(.white.opacity(0.76)).padding(.top, 3).padding(.horizontal, IumrahDesign.pagePadding)
            }
            if let footer {
                if discovery {
                    // Center the 46pt carousel in the visible gap above the 40pt overlap.
                    footer.padding(.top, max(0, (IumrahSignatureHeaderGeometry.contentHeight + 52 - IumrahSignatureHeaderGeometry.topInset - IumrahSignatureHeaderGeometry.logoHeight - 40 - 46) / 2))
                } else { footer.padding(.top, 12) }
            }
            if !flexibleFooter { Spacer(minLength: 0) }
        }
        .foregroundStyle(.white)
        .padding(.top, IumrahSignatureHeaderGeometry.topInset)
        .padding(.bottom, flexibleFooter ? 18 : 0)
        .frame(maxWidth: .infinity)
        .frame(height: flexibleFooter ? nil : (discovery ? IumrahSignatureHeaderGeometry.contentHeight + 52 : IumrahSignatureHeaderGeometry.contentHeight + (footer == nil ? 0 : 34)), alignment: .top)
        .background {
            IumrahWorldDotsHeaderBackground(mapOpacity: 0.33, isAnimating: animateMap && !discovery)
                .clipShape(UnevenRoundedRectangle(bottomLeadingRadius: discovery ? IumrahSignatureHeaderGeometry.bottomRadius : 0, bottomTrailingRadius: discovery ? IumrahSignatureHeaderGeometry.bottomRadius : 0))
        }
        .accessibilityElement(children: .contain)
    }
}

/// The scrolling header owns its top inset. Never leave a black status-bar plate.
struct IumrahPrimaryTabScrollChrome: ViewModifier {
    func body(content: Content) -> some View {
        content.background(Color.iumrahPageBackground.ignoresSafeArea())
    }
}
