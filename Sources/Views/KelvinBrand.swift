import SwiftUI

struct KelvinWordmark: View {
    var width: CGFloat = 108
    var body: some View {
        Image("KelvinWordmark").resizable().scaledToFit().frame(width: width)
            .accessibilityLabel("Kelvin")
    }
}

struct KelvinLaunchMark: View {
    var collapsed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var revealed = false
    private let widths: [CGFloat] = [142,156,57,165,61,159,55]
    var body: some View {
        GeometryReader { proxy in
            let width = collapsed ? 88 : min(250, proxy.size.width * 0.62)
            HStack(spacing: 0) {
                ForEach(widths.indices, id: \.self) { i in
                    Image("KelvinLetter\(i)").resizable().scaledToFit()
                        .frame(width: width * widths[i] / 795)
                        .offset(y: revealed || reduceMotion ? 0 : 15)
                        .blur(radius: revealed || reduceMotion ? 0 : 8)
                        .opacity(revealed || reduceMotion ? 1 : 0)
                        .animation(reduceMotion ? nil : .easeOut(duration: 0.42).delay(Double(i == 6 ? 7 : i) * 0.055), value: revealed)
                }
            }
            .position(x: proxy.size.width / 2, y: collapsed ? 23 : proxy.size.height / 2)
        }
        .background(Color(uiColor: .systemBackground).ignoresSafeArea())
        .accessibilityLabel("Kelvin")
        .task { revealed = true }
    }
}
