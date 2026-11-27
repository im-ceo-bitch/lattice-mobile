import SwiftUI
import UIKit

// Semantic graphite token used by root chrome and navigation.
extension Color {
    static let iumrahJourneyGreen = Color(red: 0.18, green: 0.51, blue: 0.36)
    static let iumrahDesertGold = Color(red: 181.0 / 255, green: 134.0 / 255, blue: 69.0 / 255)
    static let iumrahHeaderBackground = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.18, green: 0.18, blue: 0.19, alpha: 1)
            : UIColor(white: 17.0 / 255, alpha: 1)
    })
    static let iumrahSignatureBlack = Color(red: 17.0 / 255.0, green: 17.0 / 255.0, blue: 17.0 / 255.0)
}

/// Small step counter used by the eight-page family configuration branch.
struct IumrahFoundationCompactSteps: View {
    let total: Int
    let current: Int // 1-based
    var language: AppSettingsStore.Language = .english

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<max(1, total), id: \.self) { index in
                Capsule(style: .continuous)
                    .fill(index < current ? Color.primary : Color.primary.opacity(0.12))
                    .frame(maxWidth: .infinity)
                    .frame(height: 4)
            }
            Text("\(min(max(current, 1), max(1, total))) / \(max(1, total))")
                .font(.caption.weight(.semibold).monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(minWidth: 44, alignment: .trailing)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySummary)
    }

    private var accessibilitySummary: String {
        switch language {
        case .russian: return "Шаг \(current) из \(total)"
        case .uzbek: return "\(current)-bosqich, jami \(total)"
        case .uzbekCyrillic: return "\(current)-босқич, жами \(total)"
        default: return "Step \(current) of \(total)"
        }
    }
}
