import SwiftUI

struct IumrahOrbitV5Service: Identifiable, Hashable {
    let id: String
    let symbol: String

    static let showcase: [Self] = [
        .init(id: "flight", symbol: "airplane"),
        .init(id: "hotel", symbol: "building.2.fill"),
        .init(id: "transfer", symbol: "car.side.fill"),
        .init(id: "booking", symbol: "checkmark.seal.fill"),
        .init(id: "luggage", symbol: "suitcase.rolling.fill"),
        .init(id: "ziyarat", symbol: "map.fill"),
        .init(id: "guide", symbol: "person.2.fill"),
        .init(id: "esim", symbol: "antenna.radiowaves.left.and.right")
    ]
}

/// Native iOS 17+ Orbit V5. No video, GIF, web view, or third-party dependencies.
/// The center logo is stationary. All 96 points rotate as one annulus.
struct IumrahOrbitV5: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var colorScheme

    var services: [IumrahOrbitV5Service] = IumrahOrbitV5Service.showcase
    var diameter: CGFloat = 320
    var rotationDuration: TimeInterval = 25
    var revealDuration: TimeInterval = 3.2
    var isActive: Bool = true
    /// nil follows system appearance; override for custom light/dark cards.
    var lightOnDark: Bool? = nil
    var logo: Image = Image("IumrahOrbitAccountLogo")
    var logoWidthFraction: CGFloat = 0.38
    var accessibilityTitle: String = "iumrah Account"
    var pinnedSymbol: String? = nil
    var mergeToCenter: Bool = false

    init(
        services: [IumrahOrbitV5Service] = IumrahOrbitV5Service.showcase,
        diameter: CGFloat = 320,
        rotationDuration: TimeInterval = 25,
        revealDuration: TimeInterval = 3.2,
        isActive: Bool = true,
        lightOnDark: Bool? = nil,
        logo: Image = Image("IumrahOrbitAccountLogo"),
        logoWidthFraction: CGFloat = 0.38,
        accessibilityTitle: String = "iumrah Account",
        pinnedSymbol: String? = nil,
        mergeToCenter: Bool = false
    ) {
        self.services = services
        self.diameter = diameter
        self.rotationDuration = rotationDuration
        self.revealDuration = revealDuration
        self.isActive = isActive
        self.lightOnDark = lightOnDark
        self.logo = logo
        self.logoWidthFraction = logoWidthFraction
        self.accessibilityTitle = accessibilityTitle
        self.pinnedSymbol = pinnedSymbol
        self.mergeToCenter = mergeToCenter
    }

    @State private var visible = false
    @State private var elapsed: TimeInterval = 0
    @State private var resumedAt: Date? = nil
    @State private var frozenTime: TimeInterval? = nil
    @State private var pinStarted = Date()
    @State private var pinSettled = false
    @State private var mergeStarted: Date? = nil
    @State private var mergeSettled = false

    private var shouldRun: Bool {
        visible && isActive && scenePhase == .active && !reduceMotion && !services.isEmpty
    }
    private var foreground: Color { (lightOnDark ?? (colorScheme == .dark)) ? .white : .black }
    private var side: CGFloat { max(1, diameter) }
    private var scale: CGFloat { side / 360 }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: !shouldRun || (pinnedSymbol != nil && pinSettled && !mergeToCenter) || (mergeToCenter && mergeSettled))) { timeline in
            let time = elapsed + (resumedAt.map { max(0, timeline.date.timeIntervalSince($0)) } ?? 0)
            let motionTime = reduceMotion ? 0 : (frozenTime ?? time)
            let assemblyTime = mergeToCenter ? (reduceMotion || mergeSettled ? 1.0 : min(1, max(0, mergeStarted.map { timeline.date.timeIntervalSince($0) / 1.8 } ?? 0))) : 0
            let merge = IumrahOrbitV5Geometry.ease((assemblyTime - 0.32) / 0.68)
            let rotation = IumrahOrbitV5Geometry.rotation(motionTime, duration: rotationDuration)
            let reveal: IumrahOrbitV5Geometry.Reveal? = mergeToCenter ? nil : pinnedSymbol != nil ? IumrahOrbitV5Geometry.pinnedReveal(
                rotation: rotation, expansion: reduceMotion || pinSettled ? 1 : IumrahOrbitV5Geometry.ease(timeline.date.timeIntervalSince(pinStarted) / 0.55)
            ) : (services.isEmpty ? nil : IumrahOrbitV5Geometry.reveal(
                time: motionTime, rotation: rotation, duration: revealDuration, still: reduceMotion
            ))

            ZStack {
                Canvas { context, _ in
                    for row in IumrahOrbitV5Geometry.radii.indices {
                        for dot in 0..<IumrahOrbitV5Geometry.pointsPerRing {
                            let p = IumrahOrbitV5Geometry.point(row: row, dot: dot, rotation: rotation)
                            let v = IumrahOrbitV5Geometry.visibility(row: row, dot: dot, point: p, reveal: reveal) * (1 - 0.65 * IumrahOrbitV5Geometry.ease(assemblyTime / 0.28))
                            if v > 0.001 {
                                let r = CGFloat(IumrahOrbitV5Geometry.dotRadii[row] * v * (1 - 0.8 * merge)) * scale
                                let x = CGFloat(180 + (p.x - 180) * (1 - merge)) * scale
                                let y = CGFloat(180 + (p.y - 180) * (1 - merge)) * scale
                                let rect = CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r)
                                context.fill(Path(ellipseIn: rect), with: .color(Self.color(at: p.angle).opacity(v * (1 - merge))))
                            }
                        }
                    }
                }
                .accessibilityHidden(true)

                if let reveal, let symbol = pinnedSymbol ?? (services.isEmpty ? nil : services[reveal.slot % services.count].symbol) {
                    let radius = CGFloat(reveal.radius * (1 - 0.85 * merge)) * scale
                    Circle()
                        .fill(Self.color(at: reveal.center.angle))
                        .frame(width: radius * 2, height: radius * 2)
                        .overlay {
                            Image(systemName: symbol)
                                .font(.system(size: 32 * scale * CGFloat(0.55 + 0.45 * reveal.expansion), weight: .semibold))
                                .symbolRenderingMode(.monochrome)
                                .foregroundStyle(.white)
                                .opacity(reveal.symbolOpacity)
                        }
                        .opacity(1 - merge)
                        .position(x: CGFloat(180 + (reveal.center.x - 180) * (1 - merge)) * scale, y: CGFloat(180 + (reveal.center.y - 180) * (1 - merge)) * scale)
                        .accessibilityHidden(true)
                }

                if mergeToCenter && !services.isEmpty && assemblyTime < 1 && !reduceMotion {
                    ForEach(Array(services.prefix(12).enumerated()), id: \.offset) { index, service in
                        let point = IumrahOrbitV5Geometry.assemblyPoint(index: index, count: min(12, services.count), rotation: rotation, progress: merge)
                        let appear = IumrahOrbitV5Geometry.ease(assemblyTime / 0.28)
                        let disappear = 1 - IumrahOrbitV5Geometry.ease((merge - 0.58) / 0.42)
                        let bubble = 2 * CGFloat(18 * appear * (1 - 0.55 * merge)) * scale
                        Circle()
                            .fill(Self.color(at: point.angle))
                            .frame(width: bubble, height: bubble)
                            .overlay {
                                Image(systemName: service.symbol)
                                    .font(.system(size: 21 * scale * CGFloat(1 - 0.55 * merge), weight: .semibold))
                                    .foregroundStyle(.white)
                                    .opacity(appear)
                            }
                            .opacity(appear * disappear)
                            .position(x: CGFloat(point.x) * scale, y: CGFloat(point.y) * scale)
                            .accessibilityHidden(true)
                    }
                }

                logo
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(foreground)
                    .frame(width: side * min(0.46, max(0.12, logoWidthFraction)))
                    .accessibilityHidden(true)
            }
            .frame(width: side, height: side)
        }
        .frame(width: side, height: side)
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(accessibilityTitle))
        .onAppear { visible = true; updateClock(); if pinnedSymbol != nil { updatePin() } }
        .onDisappear { visible = false; stopClock() }
        .onChange(of: shouldRun) { _, _ in updateClock() }
        .task(id: mergeToCenter) {
            mergeSettled = false
            mergeStarted = mergeToCenter ? Date() : nil
            if mergeToCenter {
                try? await Task.sleep(for: .milliseconds(1820))
                if !Task.isCancelled { mergeSettled = true }
            }
        }
        .task(id: pinnedSymbol) {
            updatePin()
            if pinnedSymbol != nil {
                try? await Task.sleep(for: .milliseconds(560))
                if !Task.isCancelled { pinSettled = true }
            }
        }
    }

    private func updatePin() {
        pinSettled = false
        pinStarted = Date()
        if pinnedSymbol != nil {
            if frozenTime == nil { frozenTime = elapsed + (resumedAt.map { max(0, Date().timeIntervalSince($0)) } ?? 0) }
        } else if let frozenTime {
            elapsed = frozenTime
            self.frozenTime = nil
            resumedAt = shouldRun ? Date() : nil
        }
    }

    private func updateClock() {
        if shouldRun {
            if resumedAt == nil { resumedAt = Date() }
        } else {
            stopClock()
        }
    }

    private func stopClock() {
        if let resumedAt {
            elapsed += max(0, Date().timeIntervalSince(resumedAt))
            self.resumedAt = nil
        }
    }

    // Continuous sRGB interpolation. Spatial palette is anchored to the screen,
    // so the rotating points flow through colors exactly as in the V5 prototype.
    private static let palette: [UInt32] = [
        0x9bbdb3, 0x63bdcf, 0x30bce9, 0x30afe8, 0x419de9, 0x5389e8,
        0x6674e7, 0x8456e9, 0xa43aea, 0xbb25e5, 0xd524d6, 0xe329bb,
        0xe927a1, 0xec388b, 0xf24d78, 0xfa656a, 0xfa7d71, 0xff997c,
        0xffb18a, 0xf9bc88, 0xdfba91, 0xbdbaa5
    ]

    private static func color(at angle: Double) -> Color {
        let f = IumrahOrbitV5Geometry.huePosition(angle) * Double(palette.count)
        let i = Int(f) % palette.count
        let q = f - floor(f)
        let a = palette[i]
        let b = palette[(i + 1) % palette.count]
        func channel(_ shift: UInt32) -> Double {
            let x = Double((a >> shift) & 255)
            let y = Double((b >> shift) & 255)
            return (x + (y - x) * q) / 255
        }
        return Color(red: channel(16), green: channel(8), blue: channel(0))
    }
}

/// Responsive brand ring for cards and authentication screens.
struct IumrahOrbitAdaptive: View {
    let maxDiameter: CGFloat
    let logo: Image
    var services: [IumrahOrbitV5Service] = IumrahOrbitV5Service.showcase
    var lightOnDark: Bool? = nil
    var accessibilityTitle: String = "iumrah"
    var pinnedSymbol: String? = nil
    var isActive = true
    var mergeToCenter = false

    var body: some View {
        GeometryReader { proxy in
            IumrahOrbitV5(services: services, diameter: min(maxDiameter, proxy.size.width),
                          isActive: isActive, lightOnDark: lightOnDark, logo: logo,
                          accessibilityTitle: accessibilityTitle, pinnedSymbol: pinnedSymbol,
                          mergeToCenter: mergeToCenter)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(height: maxDiameter)
    }
}

/// One-shot, visual-only assembly. Does not issue a quote or create a booking.
struct IumrahOrbitAssemblyMoment: View {
    let services: [IumrahOrbitV5Service]
    let logo: Image
    var maxDiameter: CGFloat = 220
    var accessibilityTitle: String = "iumrah"
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var merging = false

    var body: some View {
        IumrahOrbitAdaptive(maxDiameter: maxDiameter, logo: logo, services: services,
                           accessibilityTitle: accessibilityTitle, mergeToCenter: merging)
            .task(id: services) {
                merging = reduceMotion
                guard !reduceMotion, !services.isEmpty else { return }
                do { try await Task.sleep(for: .milliseconds(700)) } catch { return }
                guard !Task.isCancelled else { return }
                merging = true
            }
    }
}

#Preview("Orbit V5 — Light") {
    IumrahOrbitV5(diameter: 340, logo: Image(systemName: "circle.hexagongrid.fill"))
        .padding(12).background(Color.white).preferredColorScheme(.light)
}
