import SwiftUI
import UIKit

/// Normal upward scrolling, no rubber-band pull or refresh indicator.
/// The masthead stays at the top boundary when dragged down.
private struct IumrahSearchPullKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    var iumrahSearchPullActive: Bool {
        get { self[IumrahSearchPullKey.self] }
        set { self[IumrahSearchPullKey.self] = newValue }
    }
}

struct IumrahRootScrollingPage<Header: View, Page: View>: View {
    @EnvironmentObject private var settings: AppSettingsStore
    private let masthead: Header
    private let page: Page
    private let onRefresh: () async -> Void
    private let searchCardOverlap: CGFloat
    private let extendsUnderStatusBar: Bool
    private let headerHelp: Bool
    private let helpContext: String?
    private let fixedRefreshHeader: Bool
    private let scrollingRefresh: Bool

    init(
        onRefresh: @escaping () async -> Void,
        searchCardOverlap: CGFloat = 0,
        extendsUnderStatusBar: Bool = true,
        headerHelp: Bool = false,
        helpContext: String? = nil,
        fixedRefreshHeader: Bool = false,
        scrollingRefresh: Bool = false,
        @ViewBuilder header: () -> Header,
        @ViewBuilder content: () -> Page
    ) {
        self.extendsUnderStatusBar = extendsUnderStatusBar
        self.headerHelp = headerHelp || helpContext != nil
        self.helpContext = helpContext
        self.fixedRefreshHeader = fixedRefreshHeader
        self.scrollingRefresh = scrollingRefresh
        self.onRefresh = onRefresh
        self.searchCardOverlap = searchCardOverlap
        self.masthead = header()
        self.page = content()
    }

    var body: some View {
        GeometryReader { viewport in
        if fixedRefreshHeader {
            VStack(spacing: 0) {
                masthead
                    .padding(.top, extendsUnderStatusBar ? viewport.safeAreaInsets.top : 0)
                    .background(Color.iumrahHeaderBackground)
                    .transaction { $0.animation = nil }
                ScrollView(showsIndicators: false) {
                    page
                        .frame(maxWidth: .infinity, alignment: .top)
                        .environment(\.iumrahSearchPullActive, false)
                        .background(IumrahNativePullRefresh(action: onRefresh))
                }
                .frame(maxHeight: .infinity)
            }
            .ignoresSafeArea(.container, edges: extendsUnderStatusBar ? .top : [])
            .background(Color.iumrahPageBackground.ignoresSafeArea())
        } else {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                masthead
                    .padding(.top, extendsUnderStatusBar ? viewport.safeAreaInsets.top : 0)
                    .background(alignment: .top) {
                        // Paint only the moving top inset, leaving Home's curved
                        // lower edge transparent rather than filling its corners.
                        Color.iumrahHeaderBackground
                            .frame(height: extendsUnderStatusBar ? viewport.safeAreaInsets.top : 0)
                    }
                    // The header is a normal scroll child: it disappears on
                    // upward swipes. Only positive top overscroll is cancelled.
                    .offset(y: 0)
                    .transaction { $0.animation = nil }
                    // The following search card must paint ABOVE the lower
                    // edge of the hero; a positive zIndex on the masthead
                    // hid the card title on Home and Hotels.

                page
                    .environment(\.iumrahSearchPullActive, false)
            }
            .frame(maxWidth: .infinity, alignment: .top)
            .background { if scrollingRefresh { IumrahNativePullRefresh(action: onRefresh) } else { IumrahNoVerticalBounce() } }
        }
        .ignoresSafeArea(.container, edges: extendsUnderStatusBar ? .top : [])
        .background(Color.iumrahPageBackground.ignoresSafeArea())
        }
        }
        .coordinateSpace(name: "iumrah.root.nonstickyScroll")
        .modifier(IumrahHelpOverlayHost(enabled: headerHelp, explicitContext: helpContext.map { IumrahHelpContext(key: $0) }, autoOnContextChange: true))
    }
}

struct IumrahCollapseSearchOnPull: ViewModifier {
    @Environment(\.iumrahSearchPullActive) private var pulling
    let collapse: () -> Void
    func body(content: Content) -> some View {
        content.onChange(of: pulling) { _, active in if active { collapse() } }
    }
}

/// Attach the native iOS refresh control to the content scroll view, never the masthead.
@MainActor
private struct IumrahNativePullRefresh: UIViewRepresentable {
    let action: () async -> Void

    @MainActor final class Coordinator: NSObject {
        let control = UIRefreshControl()
        weak var scroll: UIScrollView?
        var action: () async -> Void
        var task: Task<Void, Never>?
        init(action: @escaping () async -> Void) {
            self.action = action
            super.init()
            control.addTarget(self, action: #selector(refresh), for: .valueChanged)
            control.tintColor = .secondaryLabel
        }
        func attach(to view: UIView) {
            var parent = view.superview
            while let candidate = parent {
                if let target = candidate as? UIScrollView {
                    if scroll !== target {
                        if scroll?.refreshControl === control { scroll?.refreshControl = nil }
                        scroll = target
                    }
                    target.bounces = true
                    target.alwaysBounceVertical = true
                    if target.refreshControl !== control { target.refreshControl = control }
                    return
                }
                parent = candidate.superview
            }
        }
        @objc func refresh() {
            guard task == nil else { return }
            task = Task { @MainActor [weak self] in
                guard let self else { return }
                defer { self.control.endRefreshing(); self.task = nil }
                await self.action()
            }
        }
        func detach() {
            task?.cancel()
            task = nil
            control.endRefreshing()
            if scroll?.refreshControl === control { scroll?.refreshControl = nil }
            scroll = nil
        }
    }
    final class Marker: UIView {
        weak var coordinator: Coordinator?
        override func didMoveToSuperview() {
            super.didMoveToSuperview()
            coordinator?.attach(to: self)
        }
        override func didMoveToWindow() {
            super.didMoveToWindow()
            if window != nil { coordinator?.attach(to: self) }
        }
    }
    func makeCoordinator() -> Coordinator { Coordinator(action: action) }
    func makeUIView(context: Context) -> Marker {
        let view = Marker(frame: .zero)
        view.isUserInteractionEnabled = false
        view.coordinator = context.coordinator
        return view
    }
    func updateUIView(_ uiView: Marker, context: Context) {
        context.coordinator.action = action
        context.coordinator.attach(to: uiView)
    }
    static func dismantleUIView(_ uiView: Marker, coordinator: Coordinator) { coordinator.detach() }
}
