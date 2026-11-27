// KelvinVoiceOrb.swift
// Native SwiftUI port of the original Kelvin Voice canvas prototype.
// iOS 15+ / iPadOS 15+. No WebView, GIF, video, or external dependencies.
// Default configuration reproduces the reference geometry and timing.

import Foundation

public enum KelvinVoiceState: String, CaseIterable, Sendable {
    case idle, listening, thinking, speaking
}

// Kept independent of SwiftUI so the reference mathematics can be tested.
enum KelvinOrbGeometry {
    static let lineCount = 34
    static let segmentCount = 180
    static let lineWidth = 0.65

    static func radius(width: Double, height: Double) -> Double {
        min(width, height) * 0.30
    }

    static func amplitude(state: KelvinVoiceState, audioLevel: Double? = nil) -> Double {
        let base: Double
        switch state {
        case .speaking: base = 0.24
        case .listening: base = 0.13
        case .thinking: base = 0.07
        case .idle: base = 0.025
        }
        // nil = exact reference behavior. Audio response is opt-in.
        guard let audioLevel, audioLevel.isFinite,
              state == .listening || state == .speaking else { return base }
        return base * (0.5 + min(1.0, max(0.0, audioLevel)))
    }

    static func rotation(line: Int, time: Double, state: KelvinVoiceState) -> Double {
        Double(line) * Double.pi / 34.0 + time * (state == .thinking ? 0.5 : 0.13)
    }

    static func opacity(line: Int) -> Double {
        0.10 + Double(line) * 0.012
    }

    static func point(line: Int, segment: Int, time: Double,
                      radius: Double, centerX: Double, centerY: Double,
                      amplitude: Double, rotation: Double) -> (x: Double, y: Double) {
        let j = Double(line)
        let p = Double(segment) / 180.0 * Double.pi * 2.0
        let mod = 1.0 + amplitude * (
            0.6 * sin(p * 5.0 + time * 3.0 + j * 0.17)
            + 0.4 * sin(p * 9.0 - time * 2.0)
        )
        let xx = cos(p) * radius * mod
        let yy = sin(p) * radius * (0.14 + j / 55.0) * mod
        let x = centerX + xx * cos(rotation) - yy * sin(rotation)
        let y = centerY + xx * sin(rotation) + yy * cos(rotation)
        return (x, y)
    }
}

#if canImport(SwiftUI)
import SwiftUI

/// The exact procedural orb from the Kelvin Voice prototype.
///
///     KelvinVoiceOrb(state: .listening)
///
/// To make it react to a real audio meter, pass a normalized 0...1 level:
///
///     KelvinVoiceOrb(state: voiceState, audioLevel: microphoneLevel)
///
/// Pass `referenceTime` (seconds) for a frozen, reproducible reference frame.
/// The default nil audioLevel preserves the original prototype's amplitude.
public struct KelvinVoiceOrb: View {
    public let state: KelvinVoiceState
    public let audioLevel: Double?
    public let referenceTime: Double?
    public let height: CGFloat
    public let maximumWidth: CGFloat

    @State private var epoch = Date()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme

    public init(state: KelvinVoiceState = .listening,
                audioLevel: Double? = nil,
                referenceTime: Double? = nil,
                height: CGFloat = 300,
                maximumWidth: CGFloat = 420) {
        self.state = state
        self.audioLevel = audioLevel
        self.referenceTime = referenceTime
        self.height = height
        self.maximumWidth = maximumWidth
    }

    private static let background = Color(.sRGB, red: 8.0 / 255.0,
                                          green: 8.0 / 255.0, blue: 8.0 / 255.0)

    public var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0,
                                paused: referenceTime != nil || reduceMotion)) { timeline in
            let time = referenceTime ?? (reduceMotion ? 0 : max(0, timeline.date.timeIntervalSince(epoch)))
            Canvas(opaque: false, colorMode: .nonLinear, rendersAsynchronously: true) { context, size in
                Self.draw(in: context, size: size, time: time,
                          state: state, audioLevel: audioLevel, dark: scheme == .dark)
            }
        }
        .frame(maxWidth: maximumWidth)
        .frame(height: height)
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)
    }

    private static func draw(in context: GraphicsContext, size: CGSize,
                             time: Double, state: KelvinVoiceState, audioLevel: Double?, dark: Bool) {
        let bounds = Path(CGRect(origin: .zero, size: size))
        let w = Double(size.width)
        let h = Double(size.height)
        guard w > 0, h > 0, time.isFinite else { return }
        let x = w / 2.0
        let y = h / 2.0
        let r = KelvinOrbGeometry.radius(width: w, height: h)
        let center = CGPoint(x: CGFloat(x), y: CGFloat(y))
        let a = KelvinOrbGeometry.amplitude(state: state, audioLevel: audioLevel)

        // Reference: radial gradient from rgba(220,230,240,.10)
        // to rgba(255,255,255,0), radius R * 1.7.
        let glow = Gradient(stops: [
            .init(color: Color(.sRGB, red: 220.0 / 255.0,
                               green: 230.0 / 255.0, blue: 240.0 / 255.0,
                               opacity: dark ? 0.10 : 0), location: 0),
            .init(color: Color(.sRGB, red: 1, green: 1, blue: 1,
                               opacity: 0), location: 1)
        ])
        context.fill(bounds, with: .radialGradient(glow, center: center,
                                                   startRadius: 0,
                                                   endRadius: CGFloat(r * 1.7)))

        // Reference: 34 paths, 181 points per path (180 segments),
        // painted in increasing line order with source-over compositing.
        for j in 0..<KelvinOrbGeometry.lineCount {
            let rot = KelvinOrbGeometry.rotation(line: j, time: time, state: state)
            var path = Path()
            for i in 0...KelvinOrbGeometry.segmentCount {
                let point = KelvinOrbGeometry.point(line: j, segment: i, time: time,
                    radius: r, centerX: x, centerY: y, amplitude: a, rotation: rot)
                let cgPoint = CGPoint(x: CGFloat(point.x), y: CGFloat(point.y))
                if i == 0 { path.move(to: cgPoint) }
                else { path.addLine(to: cgPoint) }
            }
            // The JS prototype never calls closePath(); preserve that detail.
            let ink = Color(.sRGB, red: dark ? 230.0 / 255.0 : 0.06,
                            green: dark ? 236.0 / 255.0 : 0.06, blue: dark ? 245.0 / 255.0 : 0.06,
                            opacity: KelvinOrbGeometry.opacity(line: j))
            context.stroke(path, with: .color(ink),
                           style: StrokeStyle(lineWidth: CGFloat(KelvinOrbGeometry.lineWidth),
                                              lineCap: .butt, lineJoin: .miter, miterLimit: 10))
        }
    }
}

#if DEBUG
struct KelvinVoiceOrb_Previews: PreviewProvider {
    static var previews: some View {
        KelvinVoiceOrbPreviewHost()
            .preferredColorScheme(.dark)
    }
}

private struct KelvinVoiceOrbPreviewHost: View {
    @State private var state: KelvinVoiceState = .listening
    var body: some View {
        VStack(spacing: 20) {
            KelvinVoiceOrb(state: state)
            Picker("State", selection: $state) {
                ForEach(KelvinVoiceState.allCases, id: \.self) { state in
                    Text(state.rawValue.capitalized).tag(state)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
        }
        .padding(.vertical)
        .background(Color(red: 8.0 / 255.0, green: 8.0 / 255.0, blue: 8.0 / 255.0))
    }
}
#endif
#endif
