import SwiftUI

struct FamilyQuoteOrbit: View {
    let still: Bool
    private let symbols = ["airplane", "bed.double.fill", "car.fill", "person.fill"]
    var body: some View {
        IumrahDecorativeTimeline(maxFPS: 24, paused: still) { date in
            let phase = still ? 0 : date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 5) * .pi * 2 / 5
            ZStack {
                Circle().stroke(.secondary.opacity(0.22)).frame(width: 96, height: 96)
                Image(systemName: "suitcase.fill").font(.title)
                ForEach(symbols.indices, id: \.self) { i in
                    let angle = phase + Double(i) * .pi / 2
                    Image(systemName: symbols[i]).offset(x: 48 * cos(angle), y: 48 * sin(angle))
                }
            }.frame(width: 136, height: 136)
        }.accessibilityHidden(true)
    }
}
