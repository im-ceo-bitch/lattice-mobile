import SwiftUI

/// Lightweight, continuously moving payment-method strip used anywhere the user
/// needs reassurance about supported/manual payment rails. The logos are rendered
/// as template artwork so they remain legible in both light and dark appearance.
struct IumrahPaymentMethodsMarquee: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var compact = false

    private let logos = [
        "PaymentVisa",
        "PaymentPayme",
        "PaymentHumo",
        "PaymentUzcard",
        "PaymentClick"
    ]

    var body: some View {
        GeometryReader { _ in
            IumrahDecorativeTimeline(maxFPS: 24) { date in
                let itemWidth: CGFloat = compact ? 84 : 98
                let spacing: CGFloat = compact ? 14 : 18
                let groupWidth = CGFloat(logos.count) * (itemWidth + spacing)
                let speed: Double = compact ? 21 : 25
                let traveled = reduceMotion ? 0 : date.timeIntervalSinceReferenceDate * speed
                let offset = CGFloat(traveled.truncatingRemainder(dividingBy: Double(groupWidth)))

                HStack(spacing: spacing) {
                    ForEach(0..<4, id: \.self) { group in
                        ForEach(logos, id: \.self) { logo in
                            logoView(logo, width: itemWidth)
                                .id("\(group)-\(logo)")
                        }
                    }
                }
                .offset(x: -offset)
            }
        }
        .frame(height: compact ? 44 : 54)
        .clipped()
        .accessibilityHidden(true)
    }

    private func logoView(_ name: String, width: CGFloat) -> some View {
        Image(name)
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .foregroundStyle(Color.primary.opacity(0.78))
            .frame(width: width, height: compact ? 26 : 32)
            .padding(.horizontal, 7)
            .frame(width: width, height: compact ? 40 : 48)
    }
}
