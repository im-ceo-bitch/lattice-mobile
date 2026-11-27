import SwiftUI

/// One source of truth for iPhone, iPad and Mac layout decisions.
///
/// The profile is resolved from the *current window size* instead of a device-name
/// check so iPad Split View / Stage Manager and resizable Mac Catalyst windows can
/// move between compact and wide compositions at runtime without relaunching.
enum IumrahLayoutClass: String, Sendable {
    case compact
    case regular
    case wide
    case desktop
}

struct IumrahAdaptiveLayout: Equatable, Sendable {
    let layoutClass: IumrahLayoutClass
    let windowSize: CGSize
    let horizontalSizeClass: UserInterfaceSizeClass?

    var usesSidebarNavigation: Bool {
        switch layoutClass {
        case .compact:
            return false
        case .regular, .wide, .desktop:
            return true
        }
    }

    var isDesktop: Bool { layoutClass == .desktop }

    /// Wide composition is intentionally stricter than sidebar eligibility. A Mac
    /// window keeps desktop navigation even when narrow, but only adopts two/three
    /// column content once there is enough real window width to support it.
    var isWide: Bool {
        switch layoutClass {
        case .wide: return true
        case .desktop: return windowSize.width >= 1180
        case .compact, .regular: return false
        }
    }

    /// Readable width for feed-style root screens. Full-bleed maps/photos remain
    /// opt-in and are intentionally not constrained by this metric.
    var rootContentMaxWidth: CGFloat {
        switch layoutClass {
        case .compact: return .infinity
        case .regular: return 760
        case .wide: return 1040
        case .desktop: return 1180
        }
    }

    var detailContentMaxWidth: CGFloat {
        switch layoutClass {
        case .compact: return .infinity
        case .regular: return 760
        case .wide: return 920
        case .desktop: return 980
        }
    }

    var pageHorizontalPadding: CGFloat {
        switch layoutClass {
        case .compact: return IumrahDesign.pagePadding
        case .regular: return 24
        case .wide: return 30
        case .desktop: return 34
        }
    }

    var preferredGridColumnCount: Int {
        switch layoutClass {
        case .compact: return 1
        case .regular: return 2
        case .wide, .desktop: return 3
        }
    }

    static func resolve(
        size: CGSize,
        horizontalSizeClass: UserInterfaceSizeClass?
    ) -> IumrahAdaptiveLayout {
        #if targetEnvironment(macCatalyst)
        return IumrahAdaptiveLayout(
            layoutClass: .desktop,
            windowSize: size,
            horizontalSizeClass: horizontalSizeClass
        )
        #else
        let width = max(size.width, 0)
        let resolvedClass: IumrahLayoutClass

        // A compact size class always wins. This is what preserves the exact
        // iPhone composition and also gives narrow iPad multitasking windows the
        // same proven phone navigation instead of squeezing a desktop sidebar in.
        if horizontalSizeClass == .compact || width < 700 {
            resolvedClass = .compact
        } else if width < 1000 {
            resolvedClass = .regular
        } else {
            resolvedClass = .wide
        }

        return IumrahAdaptiveLayout(
            layoutClass: resolvedClass,
            windowSize: size,
            horizontalSizeClass: horizontalSizeClass
        )
        #endif
    }
}

private struct IumrahAdaptiveLayoutKey: EnvironmentKey {
    static let defaultValue = IumrahAdaptiveLayout(
        layoutClass: .compact,
        windowSize: .zero,
        horizontalSizeClass: .compact
    )
}

enum IumrahNavigationChromeStyle: Sendable, Equatable {
    case drawer
    case sidebar
}

private struct IumrahNavigationChromeStyleKey: EnvironmentKey {
    static let defaultValue: IumrahNavigationChromeStyle = .drawer
}

extension EnvironmentValues {
    var iumrahAdaptiveLayout: IumrahAdaptiveLayout {
        get { self[IumrahAdaptiveLayoutKey.self] }
        set { self[IumrahAdaptiveLayoutKey.self] = newValue }
    }

    var iumrahNavigationChromeStyle: IumrahNavigationChromeStyle {
        get { self[IumrahNavigationChromeStyleKey.self] }
        set { self[IumrahNavigationChromeStyleKey.self] = newValue }
    }
}

struct IumrahAdaptiveLayoutHost<Content: View>: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        GeometryReader { proxy in
            let layout = IumrahAdaptiveLayout.resolve(
                size: proxy.size,
                horizontalSizeClass: horizontalSizeClass
            )

            content
                .environment(\.iumrahAdaptiveLayout, layout)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
