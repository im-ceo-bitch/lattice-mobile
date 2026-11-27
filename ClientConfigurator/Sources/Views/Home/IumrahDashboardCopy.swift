import SwiftUI

/// Shared presentation components for the Home and Account roots. All amounts and
/// membership levels come from the authenticated account store; no demo values.
struct IumrahDashboardCopy {
    let language: AppSettingsStore.Language
    func t(_ ru: String, _ en: String, _ uz: String, _ cy: String) -> String {
        IumrahFlightCopy.text(language, ru, en, uz, cy)
    }
}

struct IumrahDashboardPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .opacity(configuration.isPressed ? 0.87 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: configuration.isPressed)
            .onChange(of: configuration.isPressed) { _, pressed in if pressed { IumrahHaptics.soft() } }
    }
}
