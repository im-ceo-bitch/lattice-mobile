import SwiftUI
import MapKit
import CoreLocation

struct AirportGlobePickerView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var settings: AppSettingsStore
    @Binding var selection: Airport?
    @Binding var fallbackCode: String
    private let onSelectionCommitted: () -> Void

    @StateObject private var discovery = AirportMapDiscoveryStore()
    @State private var selectedPoint: AirportMapPoint?
    @State private var resolvedAirport: Airport?
    @State private var isResolving = false
    @State private var resolveFailed = false
    @State private var visibleRegion = Self.worldRegion
    @State private var cameraDistance: CLLocationDistance = 32_000_000
    @State private var resetGeneration = 0
    @State private var resolutionTask: Task<Void, Never>?

    private let resolver = AirportMapResolver()

    init(
        selection: Binding<Airport?>,
        fallbackCode: Binding<String>,
        onSelectionCommitted: @escaping () -> Void = {}
    ) {
        _selection = selection
        _fallbackCode = fallbackCode
        self.onSelectionCommitted = onSelectionCommitted
    }

    var body: some View {
        ZStack {
            AirportMapKitCanvas(
                points: mapPoints,
                origin: selection,
                destination: nil,
                selectedPointID: selectedPoint?.id,
                initialFocus: selection,
                resetGeneration: resetGeneration,
                onSelect: select,
                onRegionSettled: regionDidSettle
            )
            .ignoresSafeArea()

            VStack(spacing: 12) {
                topBar
                Spacer(minLength: 12)
                bottomPanel
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 8)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .onDisappear {
            resolutionTask?.cancel()
        }
    }

    private var mapPoints: [AirportMapPoint] {
        let bundled = AirportMapBootstrapCatalog.points
        let dynamic = discovery.points.filter { candidate in
            !bundled.contains { bundledPoint in
                CLLocation(latitude: candidate.latitude, longitude: candidate.longitude)
                    .distance(from: CLLocation(latitude: bundledPoint.latitude, longitude: bundledPoint.longitude)) < 2_500
            }
        }
        return bundled + dynamic
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            Button {
                resetToGlobe()
            } label: {
                Image(systemName: "globe.europe.africa.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L10n.text("airport_map_reset", settings.language))

            Text(L10n.text("airport_map_title", settings.language))
                .font(.system(size: 17, weight: .semibold, design: .rounded))
                .lineLimit(1)
                .frame(maxWidth: .infinity)

            Button {
                dismiss()
            } label: {
                Text(L10n.text("close", settings.language))
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .padding(.horizontal, 13)
                    .frame(height: 44)
            }
            .buttonStyle(.plain)
        }
        .padding(6)
        .foregroundStyle(.primary)
        .iumrahGlass(in: RoundedRectangle(cornerRadius: 25, style: .continuous), interactive: true, chrome: true)
    }

    @ViewBuilder
    private var bottomPanel: some View {
        if let selectedPoint {
            selectedAirportPanel(selectedPoint)
        } else {
            instructionPanel
        }
    }

    private var instructionPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                IumrahIconBadge(
                    systemName: "airplane.departure",
                    role: .travel,
                    size: 42,
                    symbolSize: 18,
                    cornerRadius: 13
                )

                VStack(alignment: .leading, spacing: 3) {
                    Text(L10n.text("airport_map_hint_title", settings.language))
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                    Text(mapHintText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)

                if discovery.isDiscovering {
                    ProgressView()
                        .controlSize(.small)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .iumrahGlass(in: RoundedRectangle(cornerRadius: 27, style: .continuous))
    }

    private func selectedAirportPanel(_ point: AirportMapPoint) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 13) {
                ZStack {
                    if let resolvedAirport {
                        Text(resolvedAirport.iata)
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                            .monospaced()
                    } else if let code = point.displayCode {
                        Text(code)
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                            .monospaced()
                    } else {
                        Image(systemName: "airplane")
                            .font(.system(size: 20, weight: .semibold))
                            .rotationEffect(.degrees(-35))
                    }
                }
                .frame(width: 50, height: 50)
                .iumrahGlass(in: RoundedRectangle(cornerRadius: 15, style: .continuous))

                VStack(alignment: .leading, spacing: 4) {
                    Text(resolvedAirport?.city ?? point.displayTitle)
                        .font(.system(size: 20, weight: .bold, design: .rounded))
                        .lineLimit(2)

                    Text(resolvedAirport?.subtitle ?? point.name)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                Spacer(minLength: 0)

                Button {
                    resolutionTask?.cancel()
                    selectedPoint = nil
                    resolvedAirport = nil
                    resolveFailed = false
                    isResolving = false
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .bold))
                        .frame(width: 32, height: 32)
                        .contentShape(Circle())
                        .iumrahGlass(in: Circle(), interactive: true, chrome: true)
                }
                .buttonStyle(.plain)
            }

            if isResolving {
                HStack(spacing: 9) {
                    ProgressView().controlSize(.small)
                    Text(L10n.text("airport_map_resolving", settings.language))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else if resolveFailed {
                HStack(alignment: .top, spacing: 9) {
                    Image(systemName: "exclamationmark.circle")
                        .foregroundStyle(.secondary)
                    Text(L10n.text("airport_map_resolve_failed", settings.language))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if let resolvedAirport {
                Button {
                    choose(resolvedAirport)
                } label: {
                    Text(L10n.format("airport_map_choose", settings.language, resolvedAirport.iata))
                }
                .buttonStyle(IumrahPrimaryButtonStyle())
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .iumrahGlass(in: RoundedRectangle(cornerRadius: 29, style: .continuous))
    }

    private var mapHintText: String {
        if cameraDistance > 5_500_000 {
            return L10n.text("airport_map_zoom_hint", settings.language)
        }
        return L10n.text("airport_map_tap_hint", settings.language)
    }

    private func resetToGlobe() {
        resolutionTask?.cancel()
        selectedPoint = nil
        resolvedAirport = nil
        resolveFailed = false
        isResolving = false
        discovery.resetRequestThrottle()
        resetGeneration += 1
        IumrahHaptics.soft()
    }

    private func select(_ point: AirportMapPoint) {
        resolutionTask?.cancel()
        selectedPoint = point
        resolvedAirport = point.airport
        resolveFailed = false
        isResolving = point.airport == nil
        IumrahHaptics.selection()

        guard point.airport == nil else { return }
        resolutionTask = Task {
            let airport = await resolver.resolve(point)
            guard !Task.isCancelled, selectedPoint?.id == point.id else { return }
            resolvedAirport = airport
            resolveFailed = airport == nil
            isResolving = false
            if let airport {
                discovery.rememberResolved(point, airport: airport)
            } else {
                IumrahHaptics.error()
            }
        }
    }

    private func regionDidSettle(_ region: MKCoordinateRegion, _ distance: CLLocationDistance) {
        visibleRegion = region
        cameraDistance = distance
        discovery.update(region: region, cameraDistance: distance)
    }

    private func choose(_ airport: Airport) {
        selection = airport
        fallbackCode = airport.iata
        IumrahHaptics.success()
        onSelectionCommitted()
        dismiss()
    }

    private static let worldRegion = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 28.0, longitude: 52.0),
        span: MKCoordinateSpan(latitudeDelta: 140.0, longitudeDelta: 220.0)
    )
}
