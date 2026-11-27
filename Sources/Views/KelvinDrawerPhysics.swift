import Foundation

/// Pure geometry, independent of SwiftUI/UIKit. All distances are points.
enum KelvinDrawerPhysics {
    static func width(for viewport: CGFloat) -> CGFloat { max(1, min(420, viewport * 0.78)) }
    static func clamp(_ progress: CGFloat) -> CGFloat { min(1, max(0, progress)) }
    static func horizontal(x: CGFloat, y: CGFloat) -> Bool { abs(x) > abs(y) * 1.35 && abs(x) > 0 }
    static func progress(start: CGFloat, translation: CGFloat, width: CGFloat) -> CGFloat {
        clamp(start + translation / max(1, width))
    }
    static func destination(progress: CGFloat, velocity: CGFloat, width: CGFloat) -> Bool {
        // Predict the release position; a fast flick need not cross halfway.
        clamp(progress + min(2400, max(-2400, velocity)) * 0.16 / max(1, width)) >= 0.5
    }
    static func initialVelocity(progress: CGFloat, target: CGFloat, velocity: CGFloat, width: CGFloat) -> Double {
        let remaining = (target - progress) * width
        guard abs(remaining) > 1 else { return 0 }
        return Double(min(12, max(-12, velocity / remaining)))
    }
}
