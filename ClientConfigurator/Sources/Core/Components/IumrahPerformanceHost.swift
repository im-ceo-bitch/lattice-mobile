import SwiftUI
import Combine
import UIKit
import Darwin

private struct IumrahPerformanceProfileKey: EnvironmentKey {
    static let defaultValue: IumrahPerformanceProfile = .balanced
}
private struct IumrahActiveTabKey: EnvironmentKey {
    static let defaultValue = true
}
extension EnvironmentValues {
    var iumrahPerformanceProfile: IumrahPerformanceProfile {
        get { self[IumrahPerformanceProfileKey.self] }
        set { self[IumrahPerformanceProfileKey.self] = newValue }
    }
    var iumrahTabIsActive: Bool {
        get { self[IumrahActiveTabKey.self] }
        set { self[IumrahActiveTabKey.self] = newValue }
    }
}

/// Isolates decorative ticks from the parent; no ticking in background or on
/// retained inactive tabs. Does not cap native scrolling, video or audio.
struct IumrahDecorativeTimeline<Content: View>: View {
    var maxFPS: Double = 30
    var paused = false
    var staticWhenConstrained = false
    private let content: (Date) -> Content

    init(maxFPS: Double = 30, paused: Bool = false, staticWhenConstrained: Bool = false, @ViewBuilder content: @escaping (Date) -> Content) {
        self.maxFPS = maxFPS
        self.paused = paused
        self.staticWhenConstrained = staticWhenConstrained
        self.content = content
    }
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.iumrahPerformanceProfile) private var profile
    @Environment(\.iumrahTabIsActive) private var activeTab
    @State private var visible = false

    var body: some View {
        let stopped = paused || reduceMotion || !visible || !activeTab || scenePhase != .active || (staticWhenConstrained && profile.staticBackgrounds)
        TimelineView(.animation(minimumInterval: 1 / max(1, min(maxFPS, profile.decorativeFPS)), paused: stopped)) { context in
            content(stopped ? Date(timeIntervalSinceReferenceDate: 0) : context.date)
        }
        .onAppear { visible = true }
        .onDisappear { visible = false }
    }
}
