import SwiftUI
import UIKit

/// Stops rubber-band overscroll without offset compensation or refresh gestures.
struct IumrahNoVerticalBounce: UIViewRepresentable {
    final class Marker: UIView {
        override func didMoveToWindow() {
            super.didMoveToWindow()
            configureScrollView()
        }
        override func didMoveToSuperview() {
            super.didMoveToSuperview()
            configureScrollView()
        }
        func configureScrollView() {
            var ancestor = superview
            while let view = ancestor {
                if let scroll = view as? UIScrollView {
                    scroll.bounces = false
                    scroll.alwaysBounceVertical = false
                    return
                }
                ancestor = view.superview
            }
        }
    }
    func makeUIView(context: Context) -> Marker {
        let view = Marker(frame: .zero)
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear
        return view
    }
    func updateUIView(_ uiView: Marker, context: Context) {
        uiView.configureScrollView()
    }
}

/// Reports where the bottom of the scrolling hero is relative to its ScrollView.
struct IumrahScrollingHeroBottomKey: PreferenceKey {
    static var defaultValue: CGFloat = 1000
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

/// Apple Liquid Glass segmented picker on iOS 26 and an accessible native
/// material fallback on iOS 17–18. Keeps selection and accessibility explicit.
struct IumrahGlassPillSelector<Value: Hashable>: View {
    struct Option {
        let value: Value
        let title: String
        let enabled: Bool
        init(_ value: Value, _ title: String, enabled: Bool = true) {
            self.value = value
            self.title = title
            self.enabled = enabled
        }
    }

    let options: [Option]
    let selection: Value
    let onSelect: (Value) -> Void
    var height: CGFloat = 54
    var body: some View {
        Picker("", selection: Binding(get: { selection }, set: { value in
            guard options.contains(where: { $0.value == value && $0.enabled }) else { return }
            IumrahHaptics.selection()
            onSelect(value)
        })) {
            ForEach(options.indices, id: \.self) { index in
                Text(options[index].title)
                    .tag(options[index].value)
                    .disabled(!options[index].enabled)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .frame(minHeight: min(height, 44))
    }
}

/// Uses the system button renderer, including its interaction on iOS 26.
struct IumrahNativeChromeButton: ViewModifier {
    var tint: Color? = nil

    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            if let tint {
                content.buttonStyle(.glass(.regular.tint(tint)))
                    .buttonBorderShape(.circle).controlSize(.regular)
            } else {
                content.buttonStyle(.glass)
                    .buttonBorderShape(.circle).controlSize(.regular)
            }
        } else {
            content.buttonStyle(.bordered).buttonBorderShape(.circle)
                .controlSize(.regular).tint(tint ?? .primary)
        }
    }
}

/// A single Apple Liquid Glass surface for adjacent header actions. The
/// individual controls stay semantic buttons without a second glass layer.
struct IumrahNativeHeaderActionGroup<Content: View>: View {
    private let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View {
        HStack(spacing: 0) { content }
            .buttonStyle(IumrahHeaderActionLabelStyle())
            .iumrahGlass(in: Capsule(), interactive: true, allowsStaticGlass: true, chrome: true)
            .foregroundStyle(.white)
            .environment(\.colorScheme, .dark)
    }
}
private struct IumrahHeaderActionLabelStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 19, weight: .medium))
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.60 : 1)
    }
}

struct IumrahJourneySheetStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
            .presentationCornerRadius(28)
            .presentationBackground(Color.iumrahPageBackground)
    }
}

/// Shared header: flight selection optionally adds its route and step title.
/// The search summary expands independently of the black surface.
struct IumrahJourneyHeader<Summary: View>: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var chrome: AppChromeStore
    @EnvironmentObject private var settings: AppSettingsStore
    @ObservedObject private var notifications = ClientNotificationCenter.shared
    @Environment(\.journeyRefreshing) private var refreshing
    @Environment(\.journeyHeaderPull) private var pull
    @Environment(\.iumrahPullHandler) private var pullHandler
    @Environment(\.journeyTopInset) private var topInset
    var showsNotifications: Bool = false
    let onBack: (() -> Void)?
    let pageBackground: Color
    let summary: Summary
    struct FlightHeading {
        let origin: String
        let destination: String
        let title: String
    }
    let flightHeading: FlightHeading?

    init(showsNotifications: Bool = false, pageBackground: Color = .iumrahPageBackground,
         flightHeading: FlightHeading? = nil, onBack: (() -> Void)? = nil, @ViewBuilder summary: () -> Summary) {
        self.showsNotifications = showsNotifications
        self.onBack = onBack
        self.pageBackground = pageBackground
        self.summary = summary()
        self.flightHeading = flightHeading
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                IumrahGlassIconButton(systemName: "chevron.backward", size: 48,
                    foreground: .white,
                    accessibilityLabel: IumrahAccessibilityCopy.text(settings.language, ru: "Назад", en: "Back", uz: "Orqaga", cy: "Орқага", tr: "Geri", id: "Kembali")) { if let onBack { onBack() } else { dismiss() } }
                    .environment(\.colorScheme, .dark)
                Spacer(minLength: 0)
                Image("HeaderWordmarkLight")
                    .resizable()
                    .renderingMode(.template)
                    .scaledToFit()
                    .frame(width: IumrahSignatureHeaderGeometry.logoWidth,
                           height: IumrahSignatureHeaderGeometry.logoHeight)
                    .accessibilityLabel("iumrah")
                Spacer(minLength: 0)
                if showsNotifications {
                    IumrahNativeHeaderActionGroup {
                        Button { chrome.openNotifications() } label: {
                            Image(systemName: notifications.unreadCount > 0 ? "bell.badge" : "bell")
                        }.accessibilityLabel(IumrahAccessibilityCopy.text(settings.language,
                            ru: "Уведомления", en: "Notifications", uz: "Bildirishnomalar", cy: "Билдиришномалар", tr: "Bildirimler", id: "Notifikasi"))
                        IumrahPageHelpButton(inSystemToolbar: true)
                    }
                } else { IumrahPageHelpButton() }
            }
            .foregroundStyle(.white)
            .environment(\.colorScheme, .dark)
            .frame(height: IumrahSignatureHeaderGeometry.logoHeight)
            .padding(.horizontal, 20)
            if let heading = flightHeading {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .center, spacing: 12) {
                        Text(heading.origin).font(IumrahType.bold(36, relativeTo: .largeTitle)).lineLimit(1).minimumScaleFactor(0.7)
                        Image(systemName: "airplane").font(.system(size: 22, weight: .medium))
                            .frame(maxWidth: .infinity).accessibilityHidden(true)
                        Text(heading.destination).font(IumrahType.bold(36, relativeTo: .largeTitle)).lineLimit(1).minimumScaleFactor(0.7)
                    }.accessibilityElement(children: .combine)
                    Text(heading.title).font(IumrahType.bold(23, relativeTo: .title2))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                }.foregroundStyle(.white).padding(.horizontal, 20)
            }
            }
            .padding(.top, IumrahSignatureHeaderGeometry.topInset + topInset)
            .padding(.bottom, flightHeading == nil ? IumrahSignatureHeaderGeometry.lowerInset : 62)
            .frame(maxWidth: .infinity)
            .background {
                if flightHeading != nil {
                    ZStack(alignment: .bottom) {
                        IumrahFlightPalette.hero
                        IumrahHemisphereMap(presentation: .horizon, palette: .dark, isAnimating: false, lightIntensity: 0.85, mapOpacity: 0.42)
                            .frame(height: 148)
                    }
                } else {
                    IumrahWorldDotsHeaderBackground(mapOpacity: 0.30, isAnimating: false)
                }
            }
            .offset(y: 0)
            .transaction { $0.animation = nil }

            // The fixed overlap is relative to the *collapsed* summary. When
            // expanded, only the card below the boundary grows downward.
            summary
                .foregroundStyle(Color.iumrahInk)
                .padding(.horizontal, 18)
                .offset(y: -IumrahSignatureHeaderGeometry.summaryOverlap)
                .padding(.bottom, -IumrahSignatureHeaderGeometry.summaryOverlap)


        }
        .background(pageBackground)
        .background(IumrahNoVerticalBounce())
    }
}

/// Resize URLs of the same photo must not occupy multiple collage cells.
enum IumrahHotelPhotoIdentity {
    static func unique(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.filter { value in
            guard !value.isEmpty else { return false }
            guard var url = URLComponents(string: value) else { return seen.insert(value).inserted }
            let sizing = Set(["width", "height", "w", "h", "size", "quality", "q", "fit", "format", "auto", "resize", "crop", "dpr", "imwidth", "impolicy"])
            url.queryItems = url.queryItems?.filter { !sizing.contains($0.name.lowercased()) }.sorted {
                ($0.name, $0.value ?? "") < ($1.name, $1.value ?? "")
            }
            if url.queryItems?.isEmpty == true { url.queryItems = nil }
            url.fragment = nil
            url.scheme = url.scheme?.lowercased()
            url.host = url.host?.lowercased()
            return seen.insert(url.string ?? value).inserted
        }
    }
}

private struct JourneyHeaderFrameKey: PreferenceKey {
    static var defaultValue: CGRect = .null
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) { value = nextValue() }
}
private struct JourneyHeaderPullKey: EnvironmentKey { static let defaultValue: CGFloat = 0 }
private struct JourneyTopInsetKey: EnvironmentKey { static let defaultValue: CGFloat = 0 }
private struct JourneyRefreshingKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    var journeyHeaderPull: CGFloat {
        get { self[JourneyHeaderPullKey.self] }
        set { self[JourneyHeaderPullKey.self] = newValue }
    }
    var journeyTopInset: CGFloat {
        get { self[JourneyTopInsetKey.self] }
        set { self[JourneyTopInsetKey.self] = newValue }
    }
    var journeyRefreshing: Bool {
        get { self[JourneyRefreshingKey.self] }
        set { self[JourneyRefreshingKey.self] = newValue }
    }
}

/// Tracks the scrolling header. Refresh progress belongs below the summary,
/// not in the logo/status-bar area. No timer or simulated network delay.
// Compatibility name: layout only. Pull-to-refresh intentionally removed.
struct IumrahJourneyRefresh: ViewModifier {
    let action: () async -> Void
    func body(content: Content) -> some View {
        GeometryReader { viewport in
            content
                .environment(\.journeyTopInset, viewport.safeAreaInsets.top)
                .environment(\.journeyRefreshing, false)
                .environment(\.journeyHeaderPull, 0)
                .environment(\.iumrahSearchPullActive, false)
                .ignoresSafeArea(.container, edges: .top)
                .background(Color.iumrahPageBackground.ignoresSafeArea())
        }
        .modifier(IumrahHelpOverlayHost(enabled: true))
    }
}
