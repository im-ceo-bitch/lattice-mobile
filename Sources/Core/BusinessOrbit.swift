import SwiftUI

/// Brand adapters only; the shared Orbit source is identical in iOS and Business.
struct BusinessOrbit: View {
    var diameter: CGFloat = 240
    var pinnedSymbol: String? = nil
    var isActive = true

    private static let symbols: [IumrahOrbitV5Service] = [
        .init(id: "booking", symbol: "checkmark.seal.fill"),
        .init(id: "clients", symbol: "person.2.fill"),
        .init(id: "analytics", symbol: "chart.bar.fill"),
        .init(id: "flight", symbol: "airplane"),
        .init(id: "hotel", symbol: "building.2.fill"),
        .init(id: "chat", symbol: "bubble.left.and.bubble.right.fill"),
        .init(id: "sync", symbol: "arrow.triangle.2.circlepath"),
        .init(id: "security", symbol: "lock.shield.fill")
    ]

    var body: some View {
        IumrahOrbitAdaptive(maxDiameter: diameter, logo: Image("Logo"), services: Self.symbols,
                           accessibilityTitle: "iumrah Business", pinnedSymbol: pinnedSymbol, isActive: isActive)
    }
}
