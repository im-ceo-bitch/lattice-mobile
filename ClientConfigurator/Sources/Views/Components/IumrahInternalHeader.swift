import SwiftUI
import UIKit

enum TripProgressStage: Int, CaseIterable {
    case trip = 1
    case hotel = 2
    case flight = 3
    case transfer = 4
    case ready = 5

    var localizationKey: String {
        switch self {
        case .trip: return "step_trip"
        case .hotel: return "step_hotel"
        case .flight: return "step_flight"
        case .transfer: return "step_transfer"
        case .ready: return "step_ready"
        }
    }

    fileprivate var carouselSymbol: String {
        switch self {
        case .trip: return "calendar"
        case .hotel: return "building.2.fill"
        case .flight: return "airplane.departure"
        case .transfer: return "car.side.fill"
        case .ready: return "checkmark.seal.fill"
        }
    }

    fileprivate var carouselRole: IumrahIconRole {
        switch self {
        case .trip: return .calendar
        case .hotel: return .hotel
        case .flight: return .travel
        case .transfer: return .transfer
        case .ready: return .success
        }
    }
}

/// Keeps UINavigationController's native edge-swipe pop gesture available even
/// though generator screens hide the stock navigation bar in favor of the
/// in-content generator header above.
struct GeneratorInteractivePopRestorer: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> Controller {
        Controller()
    }

    func updateUIViewController(_ uiViewController: Controller, context: Context) {}

    final class Controller: UIViewController {
        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            navigationController?.interactivePopGestureRecognizer?.isEnabled = true
        }
    }
}

private struct IumrahInternalNavigationModifier: ViewModifier {
    @EnvironmentObject private var chrome: AppChromeStore

    let progressStage: TripProgressStage?
    let showsGeneratorAmbient: Bool
    let currentPriceText: String?

    @State private var registered = false

    @ViewBuilder
    func body(content: Content) -> some View {
        if showsGeneratorAmbient, progressStage != nil {
            content
                .modifier(IumrahHelpOverlayHost(enabled: true))
                // The generator header is part of each destination's own scroll
                // content. This branch only removes the stock navigation bar and
                // preserves Apple's interactive edge-swipe back gesture.
                .toolbar(.hidden, for: .navigationBar)
                .navigationBarBackButtonHidden(true)
                .background {
                    GeneratorInteractivePopRestorer()
                        .frame(width: 0, height: 0)
                }
                .tint(Color.primary)
                .modifier(InternalChromeRegistrationModifier(
                    chrome: chrome,
                    registered: $registered
                ))
        } else {
            content
                .toolbar(.visible, for: .navigationBar)
                .navigationBarBackButtonHidden(false)
                .navigationBarTitleDisplayMode(.inline)
                .tint(Color.primary)
                .modifier(InternalChromeRegistrationModifier(
                    chrome: chrome,
                    registered: $registered
                ))
        }
    }
}

/// Isolated lifecycle registration avoids duplicating onAppear/onDisappear
/// bookkeeping across the two navigation presentation branches above.
private struct InternalChromeRegistrationModifier: ViewModifier {
    let chrome: AppChromeStore
    @Binding var registered: Bool

    func body(content: Content) -> some View {
        content
            .onAppear {
                guard !registered else { return }
                registered = true
                chrome.beginInternalNavigation()
            }
            .onDisappear {
                guard registered else { return }
                registered = false
                chrome.endInternalNavigation()
            }
    }
}

extension View {
    func iumrahInternalNavigation(
        progress: TripProgressStage? = nil,
        showsGeneratorAmbient: Bool = false,
        currentPriceText: String? = nil
    ) -> some View {
        modifier(
            IumrahInternalNavigationModifier(
                progressStage: progress,
                showsGeneratorAmbient: showsGeneratorAmbient,
                currentPriceText: currentPriceText
            )
        )
    }
}
