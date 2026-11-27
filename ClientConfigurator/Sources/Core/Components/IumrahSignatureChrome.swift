import SwiftUI

/// A reusable Booking-like interaction in iumrah's own graphite language.
/// Content owns the real search fields and action; the shell never fabricates results.
struct IumrahGraphiteSearchSurface<Content: View>: View {
    @Binding var isExpanded: Bool
    let summary: String
    let subtitle: String
    let content: Content
    @Environment(\.iumrahSearchPullActive) private var pulling
    @Environment(\.journeyRefreshing) private var refreshing
    @EnvironmentObject private var settings: AppSettingsStore


    init(isExpanded: Binding<Bool>, summary: String, subtitle: String,
         @ViewBuilder content: () -> Content) {
        _isExpanded = isExpanded
        self.summary = summary
        self.subtitle = subtitle
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.22)) {
                    isExpanded.toggle()
                }
                IumrahHaptics.selection()
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 23, weight: .medium))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(summary).font(.system(size: 16, weight: .semibold))
                            .lineLimit(2).minimumScaleFactor(0.8)
                        Text(subtitle).font(.caption).foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                .foregroundStyle(Color.primary)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(isExpanded
                ? localized("Свернуть поиск", "Qidiruvni yopish", "Collapse search")
                : localized("Изменить параметры", "Qidiruv shartlarini o‘zgartirish", "Edit search"))

            if isExpanded {
                Rectangle().fill(Color.black.opacity(0.12)).frame(height: 1)
                content
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .transition(.opacity)
            }
        }
        .frame(minHeight: 62)
        .modifier(IumrahAnimatedSearchBorder(forceOnEfficiency: true))
        .onChange(of: pulling || refreshing) { _, active in
            if active { isExpanded = false }
        }
    }

    private func localized(_ ru: String, _ uz: String, _ en: String) -> String {
        switch settings.language {
        case .russian: return ru
        case .uzbek: return uz
        case .uzbekCyrillic: return ru
        default: return en
        }
    }
}

/// A measured, bounded viewport for long search forms. Unlike ViewThatFits,
/// this mounts the controls once and preserves their focus and sheet state.
struct IumrahCompactSearchFields<Content: View>: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var measuredHeight: CGFloat = 330
    private var limit: CGFloat { dynamicTypeSize.isAccessibilitySize ? 420 : 330 }
    private let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View {
        ScrollView(.vertical, showsIndicators: measuredHeight > limit) {
            content.frame(maxWidth: .infinity, alignment: .leading)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                    if height > 0 { measuredHeight = height }
                }
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(height: min(measuredHeight, limit))
    }
}

/// One opaque search surface and the original moving monochrome border.
struct IumrahAnimatedSearchBorder: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    var radius: CGFloat = 34
    var guidance: Bool = false
    var greenAccent: Bool = false
    var animate: Bool = true
    var forceOnEfficiency = false
    func body(content: Content) -> some View {
        content
            .background(Color.iumrahCardBackground, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay {
                if animate { IumrahDecorativeTimeline(maxFPS: 24, staticWhenConstrained: !forceOnEfficiency) { date in
                    let rotation = reduceMotion ? 0 : date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 5) * 72
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .strokeBorder(AngularGradient(colors: greenAccent ? [Color(red: 0.08, green: 0.55, blue: 0.30), Color(red: 0.40, green: 0.88, blue: 0.55), .white, Color(red: 0.14, green: 0.65, blue: 0.39), Color(red: 0.08, green: 0.55, blue: 0.30)] : guidance ? [Color(red: 0.96, green: 0.66, blue: 0.08), Color(red: 1, green: 0.83, blue: 0.33), .white, Color(red: 1, green: 0.92, blue: 0.65), Color(red: 0.96, green: 0.66, blue: 0.08)] : [.black, .black, .white, .gray, .black, .white, .black],
                            center: .center, startAngle: .degrees(rotation), endAngle: .degrees(rotation + 360)), lineWidth: 3)
                        .allowsHitTesting(false)
                } } else {
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .strokeBorder(Color.primary.opacity(0.20), lineWidth: 1)
                        .allowsHitTesting(false)
                }
            }
    }
}
