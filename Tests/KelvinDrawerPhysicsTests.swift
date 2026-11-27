import Foundation

@main struct KelvinDrawerPhysicsTests {
    static func main() {
        let w: CGFloat = 300
        let p = KelvinDrawerPhysics.self
        var checks = 0
        func check(_ value: Bool, _ label: String) {
            precondition(value, label); checks += 1
        }
        check(p.width(for: 390) > 300, "usable phone drawer")
        check(p.width(for: 1366) == 420, "tablet cap")
        check(p.horizontal(x: 100, y: 20), "right swipe")
        check(p.horizontal(x: -100, y: 20), "left swipe")
        check(!p.horizontal(x: 20, y: 100), "vertical scroll")
        check(!p.horizontal(x: 40, y: 40), "diagonal scroll")
        check(!p.horizontal(x: 0, y: 0), "no movement")
        check(abs(p.progress(start: 0, translation: 75, width: w) - 0.25) < 0.001, "one-to-one movement")
        check(p.progress(start: 0.4, translation: -30, width: w) > 0.29, "reverse movement from current position")
        check(p.progress(start: 0, translation: -100, width: w) == 0, "lower bound")
        check(p.progress(start: 1, translation: 100, width: w) == 1, "upper bound")
        check(!p.destination(progress: 0.3, velocity: 0, width: w), "short slow swipe cancels")
        check(p.destination(progress: 0.7, velocity: 0, width: w), "long slow swipe opens")
        check(p.destination(progress: 0.2, velocity: 1000, width: w), "fast right flick opens")
        check(!p.destination(progress: 0.8, velocity: -1000, width: w), "fast left flick closes")
        check(!p.destination(progress: 0.6, velocity: -450, width: w), "reversing velocity closes")
        check(p.initialVelocity(progress: 0.2, target: 1, velocity: 600, width: w) == 2.5, "normalize right velocity")
        check(p.initialVelocity(progress: 0.8, target: 0, velocity: -600, width: w) == 2.5, "normalize left velocity")
        check(p.initialVelocity(progress: 1, target: 1, velocity: 500, width: w) == 0, "zero remaining distance")
        check(p.initialVelocity(progress: 0.99, target: 1, velocity: 1000, width: w) <= 12, "bound spring velocity")
        print("Kelvin drawer physics: \(checks) checks passed")
    }
}
