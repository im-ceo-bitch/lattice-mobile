import SwiftUI

struct HotelImportSessionView: View {
    let sourceURL: String
    @StateObject private var coordinator = HotelImportCoordinator()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                ImportWebView(webView: coordinator.webView)
                    .opacity(coordinator.showSource ? 1 : 0.001)
                    .allowsHitTesting(coordinator.showSource)

                if !coordinator.showSource {
                    BusinessDesign.background.ignoresSafeArea()
                    VStack(spacing: 22) {
                        Spacer()

                        ZStack {
                            Circle()
                                .fill(BusinessDesign.secondarySurface)
                                .frame(width: 72, height: 72)
                            Image(systemName: "link.badge.plus")
                                .font(.system(size: 29, weight: .semibold))
                                .foregroundStyle(BusinessDesign.ink)
                        }

                        VStack(spacing: 8) {
                            Text(coordinator.currentProvider?.rawValue ?? "Hotel Importer")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            Text(coordinator.status)
                                .font(.system(size: 27, weight: .bold, design: .rounded))
                                .tracking(-0.8)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 28)
                        }

                        ProgressView(value: coordinator.progress)
                            .tint(BusinessDesign.ink)
                            .padding(.horizontal, 48)

                        if let message = coordinator.failureMessage {
                            Text(message)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 30)

                            Button("Закрыть") { dismiss() }
                                .buttonStyle(.borderedProminent)
                                .tint(BusinessDesign.primaryControl)
                        }

                        Spacer()
                    }
                    .safeAreaPadding(.horizontal, 16)
                }
            }
            .background(BusinessDesign.background)
            .navigationTitle(coordinator.showSource ? (coordinator.currentProvider?.rawValue ?? "Источник") : "Импорт по ссылке")
            .navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }.foregroundStyle(BusinessDesign.headerInk)
                }
                if coordinator.showSource {
                    ToolbarItemGroup(placement: .topBarTrailing) {
                        Button { coordinator.reloadSource() } label: { Image(systemName: "arrow.clockwise") }
                        Button("Продолжить") { coordinator.continueAfterVerification() }
                    }
                }
            }
            .navigationDestination(isPresented: Binding(
                get: { coordinator.draft != nil },
                set: { value in if !value { coordinator.draft = nil } }
            )) {
                HotelReviewView(coordinator: coordinator)
            }
            .onAppear {
                if coordinator.sourceURL == nil && coordinator.failureMessage == nil {
                    coordinator.start(sourceURL: sourceURL)
                }
            }
        }
    }
}
