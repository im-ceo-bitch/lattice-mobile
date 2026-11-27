import SwiftUI

/// Ambient iumrah identity texture for the five primary navigation headers.
///
/// The world atlas is deliberately low-contrast and its left side fades out,
/// preserving 100% white text, notifications, and wordmark legibility.
/// It stays strictly decorative: no hit-testing, accessibility or layout impact.
struct IumrahWorldDotsHeaderBackground: View {
    /// Set at the point of use if a special header needs even less texture.
    var mapOpacity: Double = 0.425
    var waveSpeed: Double = 0.56
    var waveIntensity: Double = 0.78
    var isAnimating = true

    var body: some View {
        GeometryReader { geometry in
            let width = max(geometry.size.width, 1)
            let height = max(geometry.size.height, 1)
            let mapWidth = min(max(width * 0.94, 300), 920)

            ZStack {
                Color.iumrahHeaderBackground

                // Fixed 2:1 geometry retains geographic proportions. Only the
                // header viewport clips the atlas, not the country outlines.
                IumrahWorldDotsMap(
                    isAnimating: isAnimating,
                    waveSpeed: waveSpeed,
                    waveIntensity: waveIntensity,
                    opacity: mapOpacity
                )
                .frame(width: mapWidth, height: mapWidth / 2)
                .position(x: width * 0.57, y: height * 0.50)
                .mask {
                    LinearGradient(
                        stops: [
                            .init(color: .clear, location: 0),
                            .init(color: .white.opacity(0.32), location: 0.25),
                            .init(color: .white, location: 0.61),
                            .init(color: .white, location: 1)
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                }
            }
            .frame(width: width, height: height)
            .clipped()
        }
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }
}

#if DEBUG
#Preview("iumrah · Signature header texture") {
    VStack(spacing: 14) {
        ZStack(alignment: .leading) {
            IumrahWorldDotsHeaderBackground()
            VStack(alignment: .leading, spacing: 18) {
                Text("iumrah PROJECT")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                Text("Отеллар")
                    .font(.system(size: 35, weight: .bold, design: .rounded))
            }
            .foregroundStyle(.white)
            .padding(22)
        }
        .frame(height: 172)

        ZStack(alignment: .leading) {
            IumrahWorldDotsHeaderBackground()
            Text("iumrah PROJECT")
                .font(.system(size: 26, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .padding(22)
        }
        .frame(height: 106)
    }
    .background(Color.iumrahPageBackground)
}
#endif
