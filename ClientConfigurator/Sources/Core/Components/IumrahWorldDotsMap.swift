import SwiftUI

/// iumrah's reusable monochrome world-map motion identity.
///
/// A geographic Robinson-projection map containing **5,026** individually drawn
/// white dots. Its transparent dot atlas is immutable; a native Metal colour
/// shader lights and dims the dots in travelling, gently bent waves.
///
/// No looping videos, network calls, timers, or external libraries. The dots
/// remain geometrically fixed throughout the animation.
///
/// Typical placements:
///
///     IumrahWorldDotsMap()
///         .frame(maxWidth: .infinity)
///
///     IumrahWorldDotsMap(
///         isAnimating: true,
///         waveSpeed: 0.65,
///         waveIntensity: 0.85,
///         background: .black
///     )
///     .frame(height: 180)
///
/// The content is 2:1 and letterboxes as necessary; it never stretches,
/// crops, or distorts geography. `background: .clear` lets callers reuse the
/// animation over any existing dark header/card.
struct IumrahWorldDotsMap: View {
    var isAnimating: Bool = true
    /// Wave travel rate. 1 is the designed reference speed; 0 freezes travel.
    var waveSpeed: Double = 0.78
    /// 0 = a steady white-dot map, 1 = normal travelling light and dark waves.
    var waveIntensity: Double = 1.0
    /// Overall transparency without changing the underlying dot coordinates.
    var opacity: Double = 1.0
    var background: Color = .clear

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var startDate = Date()
    @State private var isVisible = false

    private let mapRatio: CGFloat = 2.0

    private var shouldAnimate: Bool {
        isAnimating && waveSpeed > 0 && isVisible && scenePhase == .active && !reduceMotion
    }

    var body: some View {
        IumrahDecorativeTimeline(paused: !shouldAnimate) { date in
            GeometryReader { geometry in
                let width = max(0.0, min(geometry.size.width, geometry.size.height * mapRatio))
                let height = width / mapRatio
                let phase = shouldAnimate
                    ? Float(max(0, date.timeIntervalSince(startDate)).truncatingRemainder(dividingBy: 3600))
                    : Float(0)

                Image("IumrahWorldDots")
                    .resizable()
                    .interpolation(.high)
                    .antialiased(true)
                    .frame(width: width, height: height)
                    .colorEffect(
                        ShaderLibrary.iumrahWorldDotWave(
                            .float(phase),
                            .float(Float(width)),
                            .float(Float(height)),
                            .float(Float(max(0, min(waveSpeed, 3)))),
                            .float(Float(reduceMotion ? 0 : max(0, min(waveIntensity, 1)))),
                            .float(Float(max(0, min(opacity, 1))))
                        )
                    )
                    .frame(width: geometry.size.width, height: geometry.size.height)
            }
        }
        .aspectRatio(mapRatio, contentMode: .fit)
        .background(background)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear { isVisible = true }
        .onDisappear { isVisible = false }
    }
}

#if DEBUG
/// Isolated previews: this component does not inject itself into any page.
private struct IumrahWorldDotsMapPreview: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                IumrahWorldDotsMap(background: Color(red: 0.018, green: 0.018, blue: 0.022))
                    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))

                IumrahWorldDotsMap(waveSpeed: 0.42, waveIntensity: 0.72)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 16)
                    .background(.black, in: RoundedRectangle(cornerRadius: 20))

                IumrahWorldDotsMap(isAnimating: false, waveIntensity: 0)
                    .background(Color.black)
            }
            .padding(20)
        }
        .background(Color(red: 0.955, green: 0.955, blue: 0.965))
    }
}

#Preview("iumrah · World of Dots") {
    IumrahWorldDotsMapPreview()
}
#endif
