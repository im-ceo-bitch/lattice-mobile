import Foundation

/// Normalized geometry (360 × 360 design coordinates), independent of SwiftUI.
/// Keeping this pure makes rotation, expansion and spacing testable without Xcode.
enum IumrahOrbitV5Geometry {
    static let radii = [140.0, 125.0, 111.0, 97.0]
    static let dotRadii = [7.3, 6.3, 5.5, 4.8]
    static let pointsPerRing = 24
    static let activeRow = 1 // second from outside, third from center
    static let expandedRadius = 27.5
    static let middleRadius = 119.75
    static let tau = 2 * Double.pi

    struct Point {
        let x: Double
        let y: Double
        let angle: Double
    }
    struct Reveal {
        let slot: Int
        let dot: Int
        let expansion: Double
        let symbolOpacity: Double
        let center: Point
        let radius: Double
    }

    static func ease(_ x: Double) -> Double {
        let t = min(1, max(0, x))
        return t * t * t * (t * (t * 6 - 15) + 10)
    }

    static func rotation(_ time: Double, duration: Double) -> Double {
        let period = max(1, duration)
        return time.truncatingRemainder(dividingBy: period) * tau / period
    }

    static func point(row: Int, dot: Int, rotation: Double, radius: Double? = nil) -> Point {
        let offset = row.isMultiple(of: 2) ? -Double.pi / 24 : 0
        let angle = -Double.pi / 2 + offset + Double(dot) * tau / 24 + rotation
        let r = radius ?? radii[row]
        return Point(x: 180 + r * cos(angle), y: 180 + r * sin(angle), angle: angle)
    }

    static func reveal(time: Double, rotation: Double, duration: Double, still: Bool = false) -> Reveal {
        let cycles = max(0, time) / max(0.5, duration)
        let slot = Int(cycles.rounded(.down))
        let f = cycles - Double(slot)
        let dot = (slot % 8) * 3
        let p = still ? 1 : ease(f / 0.28) * ease((1 - f) / 0.28)
        let r = radii[activeRow] + (middleRadius - radii[activeRow]) * p
        return Reveal(slot: slot, dot: dot, expansion: p,
                      symbolOpacity: ease((p - 0.3) / 0.6),
                      center: point(row: activeRow, dot: dot, rotation: rotation, radius: r),
                      radius: dotRadii[activeRow] + (expandedRadius - dotRadii[activeRow]) * p)
    }

    // Pin the closest middle-row dot to the upper right without changing ring geometry.
    static func pinnedReveal(rotation: Double, expansion: Double) -> Reveal {
        let target = -Double.pi / 4
        let dot = (0..<pointsPerRing).min { a, b in
            abs(sin((point(row: activeRow, dot: a, rotation: rotation).angle - target) / 2)) <
            abs(sin((point(row: activeRow, dot: b, rotation: rotation).angle - target) / 2))
        } ?? 3
        let p = min(1, max(0, expansion))
        let r = radii[activeRow] + (middleRadius-radii[activeRow])*p
        return Reveal(slot: 0, dot: dot, expansion: p, symbolOpacity: ease((p-0.3)/0.6),
                      center: point(row: activeRow, dot: dot, rotation: rotation, radius: r),
                      radius: dotRadii[activeRow] + (expandedRadius-dotRadii[activeRow])*p)
    }

    /// The surrounding dots shrink and fade; the selected dot is replaced, not duplicated.
    static func visibility(row: Int, dot: Int, point: Point, reveal: Reveal?) -> Double {
        guard let reveal else { return 1 }
        if row == activeRow && dot == reveal.dot { return 0 }
        let distance = hypot(point.x - reveal.center.x, point.y - reveal.center.y)
        let space = ease((distance - reveal.radius - dotRadii[row] - 1) / 13)
        return 1 - reveal.expansion * (1 - space)
    }

    /// Real selected services converge from the middle of the annulus.
    static func assemblyPoint(index: Int, count: Int, rotation: Double, progress: Double) -> Point {
        let angle = -Double.pi / 2 + Double(index) * tau / Double(max(1, count)) + rotation
        let r = middleRadius * (1 - min(1, max(0, progress)))
        return Point(x: 180 + r * cos(angle), y: 180 + r * sin(angle), angle: angle)
    }

    static func huePosition(_ angle: Double) -> Double {
        let f = (angle + Double.pi / 2) / tau
        return f - floor(f)
    }
}
