import SwiftUI
import UIKit

enum BusinessDesign {
    private static func adaptive(light: UIColor, dark: UIColor) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
    }

    // Central semantic palette. Light values intentionally preserve the
    // existing iumrah Business appearance; dark values are tuned for long
    // operational use at night with clear surface separation and contrast.
    static let header = Color.black
    static let headerInk = Color.white
    static let background = adaptive(
        light: .white,
        dark: .black
    )
    static let ink = adaptive(
        light: UIColor(red: 0.055, green: 0.055, blue: 0.060, alpha: 1),
        dark: UIColor(red: 0.965, green: 0.965, blue: 0.975, alpha: 1)
    )
    static let muted = adaptive(
        light: UIColor(red: 0.480, green: 0.480, blue: 0.500, alpha: 1),
        dark: UIColor(red: 0.610, green: 0.610, blue: 0.640, alpha: 1)
    )
    static let accent = adaptive(
        light: .black,
        dark: UIColor(red: 0.965, green: 0.965, blue: 0.975, alpha: 1)
    )
    static let onAccent = adaptive(
        light: .white,
        dark: .black
    )
    static let primaryControl = adaptive(
        light: .black,
        dark: UIColor(red: 0.205, green: 0.205, blue: 0.220, alpha: 1)
    )
    static let onPrimaryControl = Color.white
    static let softOrange = adaptive(
        light: UIColor(red: 0.960, green: 0.960, blue: 0.962, alpha: 1),
        dark: UIColor(red: 0.105, green: 0.105, blue: 0.115, alpha: 1)
    )
    static let line = adaptive(
        light: UIColor(red: 0.930, green: 0.930, blue: 0.935, alpha: 1),
        dark: UIColor(red: 0.200, green: 0.200, blue: 0.215, alpha: 1)
    )
    static let card = adaptive(
        light: .white,
        dark: UIColor(red: 0.110, green: 0.110, blue: 0.120, alpha: 1)
    )
    static let secondarySurface = adaptive(
        light: UIColor(red: 0.965, green: 0.965, blue: 0.968, alpha: 1),
        dark: UIColor(red: 0.165, green: 0.165, blue: 0.178, alpha: 1)
    )
    static let tertiarySurface = adaptive(
        light: UIColor(red: 0.978, green: 0.978, blue: 0.980, alpha: 1),
        dark: UIColor(red: 0.135, green: 0.135, blue: 0.148, alpha: 1)
    )
}

struct BusinessCardModifier: ViewModifier {
    var radius: CGFloat = 28
    func body(content: Content) -> some View {
        content
            .background(BusinessDesign.card)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(BusinessDesign.line, lineWidth: 1))
            .shadow(color: .black.opacity(0.025), radius: 14, y: 6)
    }
}

struct BusinessBrandLogo: View {
    private var width: CGFloat?
    private var height: CGFloat?
    private var foreground: Color?

    init(width: CGFloat = 154, foreground: Color? = nil) {
        self.foreground = foreground
        self.width = width
        self.height = nil
    }

    init(height: CGFloat, foreground: Color? = nil) {
        self.foreground = foreground
        self.width = nil
        self.height = height
    }

    var body: some View {
        Image("Logo")
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .foregroundStyle(foreground ?? BusinessDesign.ink)
            .frame(width: width, height: height)
            .accessibilityLabel("iumrah Business")
    }
}

extension View {
    func businessCard(radius: CGFloat = 28) -> some View { modifier(BusinessCardModifier(radius: radius)) }
}


private struct BusinessGlassModifier<S: Shape>: ViewModifier {
    let shape: S
    let interactive: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            // iOS 26: native Liquid Glass only. Interactive controls use the
            // system's interaction response instead of a custom pressed blur.
            if interactive {
                content.glassEffect(.regular.interactive(), in: shape)
            } else {
                content.glassEffect(.regular, in: shape)
            }
        } else {
            // Compatibility fallback for older iOS: ordinary opaque control surface.
            content
                .background(BusinessDesign.card, in: shape)
                .overlay(shape.stroke(BusinessDesign.line, lineWidth: 0.8))
        }
    }
}

extension View {
    func businessGlass<S: Shape>(in shape: S, interactive: Bool = false) -> some View {
        modifier(BusinessGlassModifier(shape: shape, interactive: interactive))
    }
}

struct BusinessGlassGroup<Content: View>: View {
    let spacing: CGFloat?
    private let content: Content

    init(spacing: CGFloat? = nil, @ViewBuilder content: () -> Content) {
        self.spacing = spacing
        self.content = content()
    }

    @ViewBuilder
    var body: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) {
                content
            }
        } else {
            content
        }
    }
}


/// Shared navigation treatment: native bars, opaque semantic surface and
/// system-managed status indicators. Do not extend interactive content into safe areas.
extension View {
    func businessNavigationSurface() -> some View {
        self
            .toolbarBackground(BusinessDesign.header, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .tint(BusinessDesign.ink)
    }
}

struct BusinessPageHeading: View {
    let title: String
    let subtitle: String?
    @ScaledMetric(relativeTo: .largeTitle) private var titleSize: CGFloat = 34

    init(title: String, subtitle: String? = nil) {
        self.title = title
        self.subtitle = subtitle
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.system(size: titleSize, weight: .bold, design: .rounded))
                .foregroundStyle(BusinessDesign.ink)
                .accessibilityAddTraits(.isHeader)
                .fixedSize(horizontal: false, vertical: true)
            if let subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(BusinessDesign.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
