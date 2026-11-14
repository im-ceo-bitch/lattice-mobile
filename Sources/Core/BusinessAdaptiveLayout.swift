import SwiftUI

/// Central layout contract for iPhone, iPad and Mac Catalyst.
///
/// Decisions are based on the *actual available pane size*, not a device-name check.
/// This lets iPad Split View / Stage Manager and resizable Catalyst windows move
/// between compact and workstation compositions without relaunching the app.
enum BusinessLayoutClass: String, Sendable {
    case compact
    case regular
    case wide
    case desktop
}

struct BusinessAdaptiveLayout: Equatable, Sendable {
    let layoutClass: BusinessLayoutClass
    let availableSize: CGSize
    let horizontalSizeClass: UserInterfaceSizeClass?

    var isCompact: Bool { layoutClass == .compact }
    var isDesktop: Bool { layoutClass == .desktop }

    /// Root product navigation can use a persistent sidebar before individual
    /// workspaces become wide enough for their own list/detail split.
    var usesWorkspaceNavigation: Bool {
        switch layoutClass {
        case .compact: return false
        case .regular, .wide, .desktop: return true
        }
    }

    /// Use a second list/detail level only when the *detail pane itself* has room.
    /// Keeping this threshold high prevents cramped three-column layouts on iPad.
    var supportsTwoPaneWorkspace: Bool {
        availableSize.width >= 980
    }

    var supportsDenseDashboard: Bool {
        availableSize.width >= 900
    }

    var pageHorizontalPadding: CGFloat {
        switch layoutClass {
        case .compact: return 18
        case .regular: return 22
        case .wide: return 26
        case .desktop: return 28
        }
    }

    var rootContentMaxWidth: CGFloat {
        switch layoutClass {
        case .compact: return .infinity
        case .regular: return 820
        case .wide: return 1180
        case .desktop: return 1280
        }
    }

    var detailContentMaxWidth: CGFloat {
        switch layoutClass {
        case .compact: return .infinity
        case .regular: return 780
        case .wide: return 980
        case .desktop: return 1040
        }
    }

    var formContentMaxWidth: CGFloat {
        switch layoutClass {
        case .compact: return .infinity
        case .regular: return 720
        case .wide, .desktop: return 920
        }
    }

    var listPaneWidth: CGFloat {
        min(420, max(340, availableSize.width * 0.34))
    }

    var cardGridColumns: [GridItem] {
        let minimum: CGFloat = layoutClass == .desktop ? 300 : 280
        return [GridItem(.adaptive(minimum: minimum, maximum: 420), spacing: 14, alignment: .top)]
    }

    static func resolve(size: CGSize, horizontalSizeClass: UserInterfaceSizeClass?) -> BusinessAdaptiveLayout {
        let width = max(0, size.width)
        let resolved: BusinessLayoutClass
        #if targetEnvironment(macCatalyst)
        // The Mac window is wide, but its nested inspector may be narrow.
        resolved = width < 720 ? .compact : (width < 1024 ? .regular : .desktop)
        #else

        // Compact size class always wins. This protects the existing iPhone UI and
        // makes narrow iPad multitasking behave like the proven phone composition.
        if horizontalSizeClass == .compact || width < 720 {
            resolved = .compact
        } else if width < 1024 {
            resolved = .regular
        } else {
            resolved = .wide
        }

        #endif
        return BusinessAdaptiveLayout(
            layoutClass: resolved,
            availableSize: size,
            horizontalSizeClass: horizontalSizeClass
        )
    }
}

private struct BusinessAdaptiveLayoutKey: EnvironmentKey {
    static let defaultValue = BusinessAdaptiveLayout(
        layoutClass: .compact,
        availableSize: .zero,
        horizontalSizeClass: .compact
    )
}

extension EnvironmentValues {
    var businessAdaptiveLayout: BusinessAdaptiveLayout {
        get { self[BusinessAdaptiveLayoutKey.self] }
        set { self[BusinessAdaptiveLayoutKey.self] = newValue }
    }
}

/// Measures the whole app window. Use `BusinessAdaptivePaneHost` again inside the
/// desktop detail column so child screens make decisions from their real pane width.
struct BusinessAdaptiveLayoutHost<Content: View>: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        GeometryReader { proxy in
            content
                .environment(
                    \.businessAdaptiveLayout,
                    BusinessAdaptiveLayout.resolve(
                        size: proxy.size,
                        horizontalSizeClass: horizontalSizeClass
                    )
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// Re-measures a specific workspace pane. This matters on iPad/Mac because the
/// persistent product sidebar consumes part of the window width.
struct BusinessAdaptivePaneHost<Content: View>: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        GeometryReader { proxy in
            content
                .environment(
                    \.businessAdaptiveLayout,
                    BusinessAdaptiveLayout.resolve(
                        size: proxy.size,
                        horizontalSizeClass: horizontalSizeClass
                    )
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

private struct BusinessReadableWidthModifier: ViewModifier {
    @Environment(\.businessAdaptiveLayout) private var layout
    let kind: Kind

    enum Kind { case root, detail, form }

    @ViewBuilder
    func body(content: Content) -> some View {
        if layout.isCompact {
            content
        } else {
            let maxWidth: CGFloat = switch kind {
            case .root: layout.rootContentMaxWidth
            case .detail: layout.detailContentMaxWidth
            case .form: layout.formContentMaxWidth
            }

            content
                .frame(maxWidth: maxWidth, alignment: .topLeading)
                .frame(maxWidth: .infinity, alignment: .top)
        }
    }
}

extension View {
    /// No-op on compact iPhone. Constrains wide feed/form screens to readable widths.
    func businessAdaptiveReadableWidth() -> some View {
        modifier(BusinessReadableWidthModifier(kind: .root))
    }

    func businessAdaptiveDetailWidth() -> some View {
        modifier(BusinessReadableWidthModifier(kind: .detail))
    }

    func businessAdaptiveFormWidth() -> some View {
        modifier(BusinessReadableWidthModifier(kind: .form))
    }
}
