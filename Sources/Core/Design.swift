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
    // Geometry follows the client iumrah Design Foundation. Business retains its own palette.
    enum Space { static let xs: CGFloat = 8; static let sm: CGFloat = 12; static let md: CGFloat = 16; static let page: CGFloat = 18; static let lg: CGFloat = 22 }
    enum Radius { static let control: CGFloat = 19; static let compact: CGFloat = 22; static let card: CGFloat = 28; static let hero: CGFloat = 34 }
    enum Size { static let tap: CGFloat = 44; static let primary: CGFloat = 56 }
    enum TypeStyle {
        static let hero = Font.system(.largeTitle, design: .rounded, weight: .bold)
        static let section = Font.system(.title2, design: .rounded, weight: .bold)
        static let title = Font.system(.title3, design: .rounded, weight: .bold)
    }
    static let header = Color.black
    static let headerInk = Color.white
    // Security Blue is reserved for selection and security; not a primary CTA fill.
    private static func rgb(_ hex: UInt32) -> UIColor {
        UIColor(red: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: 1)
    }
    static let securityBlue = adaptive(light: rgb(BusinessAnimationPalette.selectionLight), dark: rgb(BusinessAnimationPalette.selectionDark))
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
    var radius: CGFloat = BusinessDesign.Radius.card
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
    func businessCard(radius: CGFloat = BusinessDesign.Radius.card) -> some View { modifier(BusinessCardModifier(radius: radius)) }
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


/// Primary action styling, independent from the color scheme of the navigation bar.
struct BusinessActionStyle: ButtonStyle {
    var primary = true
    @Environment(\.isEnabled) private var enabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 16).padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: primary ? BusinessDesign.Size.primary : BusinessDesign.Size.tap)
            .foregroundStyle(primary ? BusinessDesign.onAccent : BusinessDesign.ink)
            .background(primary ? BusinessDesign.accent : BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: BusinessDesign.Radius.control))
            .opacity(enabled ? (configuration.isPressed ? 0.76 : 1) : 0.45)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: configuration.isPressed)
    }
}

struct BusinessStageRail: View {
    let titles: [String]
    let symbols: [String]
    let current: Int
    let maximumReachable: Int
    let goBack: (Int) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        // Six 44pt controls fit a 320pt window with standard page margins.
        // Connectors occupy the background, not additional horizontal space.
        HStack(spacing: 0) {
            ForEach(titles.indices, id: \.self) { index in
                Button { goBack(index) } label: {
                    Image(systemName: index < current ? "checkmark" : symbols[index])
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(index <= current ? BusinessDesign.onAccent : BusinessDesign.muted)
                        .frame(width: 36, height: 36)
                        .background(index <= current ? BusinessDesign.accent : BusinessDesign.secondarySurface, in: Circle())
                        .overlay { if index == current { Circle().strokeBorder(BusinessDesign.securityBlue, lineWidth: 2) } }
                        .frame(minWidth: BusinessDesign.Size.tap, maxWidth: .infinity, minHeight: BusinessDesign.Size.tap)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(index == current || index > max(current, maximumReachable))
                .accessibilityLabel("Шаг \(index + 1): \(titles[index])")
                .accessibilityAddTraits(index == current ? .isSelected : [])
            }
        }
        .background {
            Capsule().fill(BusinessDesign.line).frame(height: 2)
                .padding(.horizontal, BusinessDesign.Size.tap / 2).accessibilityHidden(true)
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.24), value: current)
    }
}

struct BusinessChoiceRow: View {
    let title: String
    let subtitle: String
    let symbol: String
    let selected: Bool
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: symbol).font(.title2).frame(width: 36)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(subtitle).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            Image(systemName: selected ? "checkmark.circle.fill" : "circle").font(.title2)
                .foregroundStyle(selected ? BusinessDesign.securityBlue : BusinessDesign.muted)
        }.foregroundStyle(BusinessDesign.ink).padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(BusinessDesign.card, in: RoundedRectangle(cornerRadius: BusinessDesign.Radius.compact))
            .overlay { RoundedRectangle(cornerRadius: BusinessDesign.Radius.compact).strokeBorder(selected ? BusinessDesign.ink : BusinessDesign.line, lineWidth: selected ? 2 : 1) }
            .accessibilityElement(children: .combine).accessibilityAddTraits(selected ? .isSelected : [])
    }
}
