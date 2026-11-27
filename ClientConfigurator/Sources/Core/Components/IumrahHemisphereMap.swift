import SwiftUI

/// Native, offline, monochrome geographic hemisphere. No MapKit tiles, video,
/// image assets, or networking. Only the lighting animates; coastlines stay fixed.
/// Use as a decorative background behind flight information.
struct IumrahHemisphereMap: View {
    enum Presentation {
        case globe
        /// Top part of the sphere, intended for the bottom of a flight hero.
        case horizon
    }

    enum Palette {
        case automatic, dark, light
    }

    var projection: IumrahHemisphereProjection = .arabia
    var presentation: Presentation = .globe
    var palette: Palette = .automatic
    var isAnimating = true
    /// Full illumination cycle in seconds. Clamped to 6...60.
    var cycleDuration: Double = 12
    /// Contrast of the light sweep, not the geographical layer opacity.
    var lightIntensity: Double = 0.8
    var mapOpacity: Double = 1

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var isVisible = false
    @State private var startDate = Date()

    private var dark: Bool {
        switch palette {
        case .automatic: return colorScheme == .dark
        case .dark: return true
        case .light: return false
        }
    }

    private var animates: Bool {
        isAnimating && isVisible && scenePhase == .active && !reduceMotion && lightIntensity > 0
    }

    var body: some View {
        GeometryReader { proxy in
            let fraction: CGFloat = presentation == .horizon ? 0.48 : 1
            let diameter = min(proxy.size.width, proxy.size.height / fraction)
            let land = IumrahHemispherePathCache.path(for: projection)
            IumrahDecorativeTimeline(paused: !animates) { date in
                let period = cycleDuration.isFinite ? max(6, min(60, cycleDuration)) : 12
                let elapsed = animates ? max(0, date.timeIntervalSince(startDate)) : 0
                let phase = elapsed.truncatingRemainder(dividingBy: period) / period * 2 * .pi
                let intensity = lightIntensity.isFinite ? max(0, min(1, lightIntensity)) : 0
                let opacity = mapOpacity.isFinite ? max(0, min(1, mapOpacity)) : 1
                IumrahHemisphereSurface(land: land, dark: dark,
                                        phase: phase, intensity: reduceMotion ? 0 : intensity)
                    .frame(width: diameter, height: diameter)
                    .opacity(opacity)
                    .frame(width: proxy.size.width, height: proxy.size.height,
                           alignment: presentation == .horizon ? .top : .center)
            }
        }
        .clipped()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear { startDate = Date(); isVisible = true }
        .onDisappear { isVisible = false }
    }
}

private struct IumrahHemisphereSurface: View {
    let land: Path
    let dark: Bool
    let phase: Double
    let intensity: Double

    private func gray(_ value: Double) -> Color {
        Color(white: max(0, min(1, value)))
    }

    var body: some View {
        GeometryReader { proxy in
            let diameter = min(proxy.size.width, proxy.size.height)
            let lightX = 0.50 + 0.26 * sin(phase)
            let lightY = 0.29 + 0.08 * cos(phase)
            let breath = (1 + cos(phase - .pi / 3)) * 0.5
            let center = UnitPoint(x: lightX, y: lightY)
            let oceanBright = dark ? 0.071 + 0.012 * intensity * breath : 0.99
            let landBright = dark ? 0.68 + 0.23 * intensity * breath : 0.48 - 0.16 * intensity * breath
            let oceanDim = dark ? 0.065 : 0.98
            let landDim = dark ? 0.22 : 0.70
            let oceanLight = RadialGradient(colors: [gray(oceanBright), gray(oceanDim)],
                                            center: center, startRadius: 0, endRadius: diameter * 0.84)
            let landLight = RadialGradient(colors: [gray(landBright), gray((landBright + landDim) / 2), gray(landDim)],
                                           center: center, startRadius: 0, endRadius: diameter * 0.78)
            ZStack {
                Circle().fill(oceanLight)
                IumrahHemisphereDotShape()
                    .fill(landLight)
                    .mask(IumrahHemisphereLandShape(unitPath: land).fill(.white))
                Circle()
                    .fill(RadialGradient(stops: [
                        .init(color: .clear, location: 0.55),
                        .init(color: .black.opacity(dark ? 0.24 : 0.035), location: 1)
                    ], center: .center, startRadius: 0, endRadius: diameter / 2))
                Circle().strokeBorder(gray(dark ? 0.65 : 0.3).opacity(0.06), lineWidth: 0.5)
            }
            .clipShape(Circle())
            // Render as a single native composited layer to avoid triangle seams.
            .drawingGroup()
        }
    }
}

/// A single cached vector path; no individual SwiftUI views for the dots.
private struct IumrahHemisphereDotShape: Shape {
    private static let unit: Path = {
        var path = Path()
        let count = 112
        let step = 1.0 / Double(count)
        for row in 0..<count {
            for col in 0..<count {
                let x = (Double(col) + 0.5 + (row.isMultiple(of: 2) ? 0 : 0.5)) * step
                let y = (Double(row) + 0.5) * step
                let radiusSquared = (x - 0.5) * (x - 0.5) + (y - 0.5) * (y - 0.5)
                guard radiusSquared < 0.248 else { continue }
                let radius = step * (0.15 + 0.15 * sqrt(max(0, 1 - radiusSquared * 4)))
                path.addEllipse(in: CGRect(x: x-radius, y: y-radius, width: radius*2, height: radius*2))
            }
        }
        return path
    }()
    func path(in rect: CGRect) -> Path {
        Self.unit.applying(CGAffineTransform(a: rect.width, b: 0, c: 0, d: rect.height, tx: rect.minX, ty: rect.minY))
    }
}

private struct IumrahHemisphereLandShape: Shape {
    let unitPath: Path
    func path(in rect: CGRect) -> Path {
        unitPath.applying(CGAffineTransform(a: rect.width, b: 0, c: 0, d: rect.height,
                                            tx: rect.minX, ty: rect.minY))
    }
}

private enum IumrahHemispherePathCache {
    private final class Entry: NSObject {
        let path: Path
        init(_ path: Path) { self.path = path }
    }
    private static let cache: NSCache<NSString, Entry> = {
        let cache = NSCache<NSString, Entry>()
        cache.countLimit = 12
        return cache
    }()

    static func path(for projection: IumrahHemisphereProjection) -> Path {
        let key = "\(projection.latitude):\(projection.longitude)" as NSString
        if let entry = cache.object(forKey: key) { return entry.path }
        var path = Path()
        for triangle in IumrahHemisphereLandData.triangles {
            let points = projection.visiblePolygon(triangle)
            guard let first = points.first else { continue }
            path.move(to: first)
            for point in points.dropFirst() { path.addLine(to: point) }
            path.closeSubpath()
        }
        cache.setObject(Entry(path), forKey: key)
        return path
    }
}

#if DEBUG
#Preview("iumrah · Hemisphere / dark") {
    VStack(spacing: 12) {
        IumrahHemisphereMap(palette: .dark)
            .frame(width: 300, height: 300)
        IumrahHemisphereMap(presentation: .horizon, palette: .dark)
            .frame(height: 145)
    }
    .padding(20)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color(white: 0.035))
    .preferredColorScheme(.dark)
}

#Preview("iumrah · Hemisphere / light") {
    IumrahHemisphereMap(projection: .init(latitude: 30, longitude: 40), palette: .light)
        .frame(width: 320, height: 320)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(white: 0.97))
        .preferredColorScheme(.light)
}
#endif
