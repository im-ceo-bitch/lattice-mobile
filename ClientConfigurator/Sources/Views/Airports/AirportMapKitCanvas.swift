import SwiftUI
import MapKit
import UIKit

struct AirportMapKitCanvas: UIViewRepresentable {
    let points: [AirportMapPoint]
    let origin: Airport?
    let destination: Airport?
    let selectedPointID: String?
    let initialFocus: Airport?
    let resetGeneration: Int
    let onSelect: (AirportMapPoint) -> Void
    let onRegionSettled: (MKCoordinateRegion, CLLocationDistance) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> MKMapView {
        let mapView = MKMapView(frame: .zero)
        mapView.delegate = context.coordinator
        mapView.mapType = .hybrid
        mapView.isRotateEnabled = true
        mapView.isPitchEnabled = true
        mapView.showsCompass = false
        mapView.showsScale = false
        mapView.showsBuildings = true
        mapView.pointOfInterestFilter = .excludingAll
        mapView.register(AirportAnnotationView.self, forAnnotationViewWithReuseIdentifier: AirportAnnotationView.reuseIdentifier)
        mapView.register(AirportClusterAnnotationView.self, forAnnotationViewWithReuseIdentifier: AirportClusterAnnotationView.reuseIdentifier)

        context.coordinator.mapView = mapView
        context.coordinator.sync(parent: self, mapView: mapView)
        context.coordinator.applyInitialCamera(on: mapView)
        return mapView
    }

    func updateUIView(_ mapView: MKMapView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.sync(parent: self, mapView: mapView)

        if context.coordinator.lastResetGeneration != resetGeneration {
            context.coordinator.lastResetGeneration = resetGeneration
            context.coordinator.applyResetCamera(on: mapView)
        }
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var parent: AirportMapKitCanvas
        weak var mapView: MKMapView?
        private var annotationsByID: [String: AirportAnnotation] = [:]
        var lastResetGeneration: Int
        private var routeKey: String?
        private var didApplyInitialCamera = false

        init(parent: AirportMapKitCanvas) {
            self.parent = parent
            self.lastResetGeneration = parent.resetGeneration
        }

        func sync(parent: AirportMapKitCanvas, mapView: MKMapView) {
            let endpointPoints = Self.endpointPoints(origin: parent.origin, destination: parent.destination)
            var desiredByID: [String: AirportMapPoint] = [:]
            for point in parent.points { desiredByID[point.id] = point }
            endpointPoints.forEach { desiredByID[$0.id] = $0 }

            let staleIDs = Set(annotationsByID.keys).subtracting(desiredByID.keys)
            let staleAnnotations = staleIDs.compactMap { annotationsByID.removeValue(forKey: $0) }
            if !staleAnnotations.isEmpty {
                mapView.removeAnnotations(staleAnnotations)
            }

            var additions: [AirportAnnotation] = []
            for point in desiredByID.values {
                let role = Self.role(for: point, origin: parent.origin, destination: parent.destination)
                if let existing = annotationsByID[point.id] {
                    existing.point = point
                    existing.role = role
                    existing.coordinate = point.coordinate
                    if let view = mapView.view(for: existing) as? AirportAnnotationView {
                        view.configure(
                            point: point,
                            role: role,
                            selected: parent.selectedPointID == point.id,
                            cameraDistance: mapView.camera.centerCoordinateDistance
                        )
                    }
                } else {
                    let annotation = AirportAnnotation(point: point, role: role)
                    annotationsByID[point.id] = annotation
                    additions.append(annotation)
                }
            }
            if !additions.isEmpty {
                mapView.addAnnotations(additions)
            }

            updateRouteOverlay(on: mapView, origin: parent.origin, destination: parent.destination)
            updateVisibleAnnotationStyles(on: mapView)
        }

        func applyInitialCamera(on mapView: MKMapView) {
            guard !didApplyInitialCamera else { return }
            didApplyInitialCamera = true
            applyResetCamera(on: mapView, animated: false)
        }

        func applyResetCamera(on mapView: MKMapView, animated: Bool = true) {
            if let origin = parent.origin, let destination = parent.destination {
                fitRoute(origin: origin, destination: destination, on: mapView, animated: animated)
                return
            }

            let focus = parent.initialFocus ?? parent.origin ?? parent.destination
            let center = focus.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }
                ?? CLLocationCoordinate2D(latitude: 28.0, longitude: 52.0)

            let camera = MKMapCamera(
                lookingAtCenter: center,
                fromDistance: focus == nil ? 32_000_000 : 7_800_000,
                pitch: 0,
                heading: 0
            )
            mapView.setCamera(camera, animated: animated)
        }

        private func fitRoute(origin: Airport, destination: Airport, on mapView: MKMapView, animated: Bool) {
            let originPoint = MKMapPoint(CLLocationCoordinate2D(latitude: origin.lat, longitude: origin.lon))
            let destinationPoint = MKMapPoint(CLLocationCoordinate2D(latitude: destination.lat, longitude: destination.lon))
            var rect = MKMapRect(x: originPoint.x, y: originPoint.y, width: 1, height: 1)
            rect = rect.union(MKMapRect(x: destinationPoint.x, y: destinationPoint.y, width: 1, height: 1))

            if rect.width < 1_000 && rect.height < 1_000 {
                let region = MKCoordinateRegion(
                    center: CLLocationCoordinate2D(latitude: origin.lat, longitude: origin.lon),
                    latitudinalMeters: 200_000,
                    longitudinalMeters: 200_000
                )
                mapView.setRegion(region, animated: animated)
            } else {
                mapView.setVisibleMapRect(
                    rect,
                    edgePadding: UIEdgeInsets(top: 150, left: 64, bottom: 250, right: 64),
                    animated: animated
                )
            }
        }

        private func updateRouteOverlay(on mapView: MKMapView, origin: Airport?, destination: Airport?) {
            let newKey: String?
            if let origin, let destination {
                newKey = "\(origin.iata.uppercased())-\(destination.iata.uppercased())"
            } else {
                newKey = nil
            }
            guard routeKey != newKey else { return }
            routeKey = newKey

            mapView.removeOverlays(mapView.overlays)
            guard let origin, let destination else { return }
            var coordinates = [
                CLLocationCoordinate2D(latitude: origin.lat, longitude: origin.lon),
                CLLocationCoordinate2D(latitude: destination.lat, longitude: destination.lon)
            ]
            let line = MKGeodesicPolyline(coordinates: &coordinates, count: coordinates.count)
            mapView.addOverlay(line, level: .aboveLabels)
        }

        private func updateVisibleAnnotationStyles(on mapView: MKMapView) {
            let distance = mapView.camera.centerCoordinateDistance
            for annotation in mapView.annotations {
                if let airportAnnotation = annotation as? AirportAnnotation,
                   let view = mapView.view(for: airportAnnotation) as? AirportAnnotationView {
                    view.configure(
                        point: airportAnnotation.point,
                        role: airportAnnotation.role,
                        selected: parent.selectedPointID == airportAnnotation.point.id,
                        cameraDistance: distance
                    )
                } else if let cluster = annotation as? MKClusterAnnotation,
                          let view = mapView.view(for: cluster) as? AirportClusterAnnotationView {
                    view.configure(count: cluster.memberAnnotations.count, cameraDistance: distance)
                }
            }
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            if annotation is MKUserLocation { return nil }

            if let cluster = annotation as? MKClusterAnnotation {
                let view = (mapView.dequeueReusableAnnotationView(
                    withIdentifier: AirportClusterAnnotationView.reuseIdentifier,
                    for: cluster
                ) as? AirportClusterAnnotationView)
                    ?? AirportClusterAnnotationView(annotation: cluster, reuseIdentifier: AirportClusterAnnotationView.reuseIdentifier)
                view.configure(count: cluster.memberAnnotations.count, cameraDistance: mapView.camera.centerCoordinateDistance)
                return view
            }

            guard let airportAnnotation = annotation as? AirportAnnotation else { return nil }
            let view = (mapView.dequeueReusableAnnotationView(
                withIdentifier: AirportAnnotationView.reuseIdentifier,
                for: airportAnnotation
            ) as? AirportAnnotationView)
                ?? AirportAnnotationView(annotation: airportAnnotation, reuseIdentifier: AirportAnnotationView.reuseIdentifier)
            view.annotation = airportAnnotation
            view.clusteringIdentifier = airportAnnotation.role == .normal ? "iumrah-airports" : nil
            view.configure(
                point: airportAnnotation.point,
                role: airportAnnotation.role,
                selected: parent.selectedPointID == airportAnnotation.point.id,
                cameraDistance: mapView.camera.centerCoordinateDistance
            )
            return view
        }

        func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
            if let cluster = view.annotation as? MKClusterAnnotation {
                mapView.showAnnotations(cluster.memberAnnotations, animated: true)
                mapView.deselectAnnotation(cluster, animated: false)
                IumrahHaptics.soft()
                return
            }

            guard let annotation = view.annotation as? AirportAnnotation else {
                mapView.deselectAnnotation(view.annotation, animated: false)
                return
            }
            parent.onSelect(annotation.point)
            mapView.deselectAnnotation(annotation, animated: false)
        }

        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            updateVisibleAnnotationStyles(on: mapView)
            parent.onRegionSettled(mapView.region, mapView.camera.centerCoordinateDistance)
        }

        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            guard let polyline = overlay as? MKPolyline else {
                return MKOverlayRenderer(overlay: overlay)
            }
            let renderer = MKPolylineRenderer(polyline: polyline)
            renderer.strokeColor = UIColor.systemBlue.withAlphaComponent(0.92)
            renderer.lineWidth = 3
            renderer.lineCap = .round
            renderer.lineJoin = .round
            renderer.lineDashPattern = [6, 6]
            return renderer
        }

        private static func endpointPoints(origin: Airport?, destination: Airport?) -> [AirportMapPoint] {
            [origin, destination].compactMap { $0 }.map(AirportMapPoint.bundled)
        }

        private static func role(for point: AirportMapPoint, origin: Airport?, destination: Airport?) -> AirportEndpointRole {
            let code = point.airport?.iata.uppercased()
            if let origin, code == origin.iata.uppercased() { return .origin }
            if let destination, code == destination.iata.uppercased() { return .destination }
            return .normal
        }
    }
}

private enum AirportEndpointRole {
    case normal
    case origin
    case destination
}

private final class AirportAnnotation: NSObject, MKAnnotation {
    @objc dynamic var coordinate: CLLocationCoordinate2D
    var point: AirportMapPoint
    var role: AirportEndpointRole

    init(point: AirportMapPoint, role: AirportEndpointRole) {
        self.point = point
        self.role = role
        self.coordinate = point.coordinate
        super.init()
    }
}

private final class AirportAnnotationView: MKAnnotationView {
    static let reuseIdentifier = "iumrah-airport-annotation"

    private let symbolContainer = UIView()
    private let symbolView = UIImageView()
    private let dotView = UIView()
    private let codeLabel = UILabel()
    private var visualMode: VisualMode = .dot

    private enum VisualMode {
        case dot
        case compact
        case detailed
    }

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        isOpaque = false
        canShowCallout = false
        collisionMode = .circle

        symbolView.image = UIImage(systemName: "airplane")
        symbolView.contentMode = .scaleAspectFit
        symbolView.tintColor = .label

        symbolContainer.addSubview(symbolView)
        addSubview(symbolContainer)
        addSubview(dotView)
        addSubview(codeLabel)

        codeLabel.font = UIFont.monospacedSystemFont(ofSize: 10, weight: .bold)
        codeLabel.textAlignment = .center
        codeLabel.textColor = .white
        codeLabel.backgroundColor = UIColor.black.withAlphaComponent(0.68)
        codeLabel.layer.cornerRadius = 9
        codeLabel.clipsToBounds = true
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func configure(
        point: AirportMapPoint,
        role: AirportEndpointRole,
        selected: Bool,
        cameraDistance: CLLocationDistance
    ) {
        let endpoint = role != .normal
        let mode: VisualMode
        if endpoint || selected || cameraDistance < 1_350_000 {
            mode = .detailed
        } else if cameraDistance < 5_500_000 {
            mode = .compact
        } else {
            mode = .dot
        }
        visualMode = mode

        let accent: UIColor
        switch role {
        case .origin:
            accent = .systemBlue
        case .destination:
            accent = .systemGreen
        case .normal:
            accent = selected ? .systemBlue : .white
        }

        codeLabel.text = point.displayCode
        codeLabel.isHidden = mode != .detailed || point.displayCode == nil
        symbolContainer.isHidden = mode == .dot
        symbolView.isHidden = mode == .dot
        dotView.isHidden = mode != .dot

        switch mode {
        case .dot:
            bounds = CGRect(x: 0, y: 0, width: 18, height: 18)
            centerOffset = .zero
            dotView.frame = CGRect(x: 5, y: 5, width: 8, height: 8)
            dotView.layer.cornerRadius = 4
            dotView.backgroundColor = endpoint ? accent : UIColor.white.withAlphaComponent(0.92)
            dotView.layer.borderWidth = 1.5
            dotView.layer.borderColor = UIColor.black.withAlphaComponent(0.28).cgColor
            displayPriority = endpoint ? .required : .defaultLow

        case .compact:
            bounds = CGRect(x: 0, y: 0, width: 30, height: 30)
            centerOffset = .zero
            symbolContainer.frame = bounds.insetBy(dx: 5, dy: 5)
            symbolContainer.layer.cornerRadius = 10
            symbolContainer.backgroundColor = endpoint || selected
                ? accent
                : UIColor.systemBackground.withAlphaComponent(0.90)
            symbolView.frame = symbolContainer.bounds.insetBy(dx: 5, dy: 5)
            symbolView.tintColor = endpoint || selected ? .white : .label
            symbolContainer.layer.shadowColor = UIColor.black.cgColor
            symbolContainer.layer.shadowOpacity = 0.18
            symbolContainer.layer.shadowRadius = 4
            symbolContainer.layer.shadowOffset = CGSize(width: 0, height: 2)
            displayPriority = endpoint ? .required : .defaultHigh

        case .detailed:
            bounds = CGRect(x: 0, y: 0, width: 58, height: point.displayCode == nil ? 42 : 62)
            centerOffset = CGPoint(x: 0, y: -12)
            symbolContainer.frame = CGRect(x: 11, y: 0, width: 36, height: 36)
            symbolContainer.layer.cornerRadius = 12
            symbolContainer.backgroundColor = endpoint || selected
                ? accent
                : UIColor.systemBackground.withAlphaComponent(0.92)
            symbolView.frame = symbolContainer.bounds.insetBy(dx: 8, dy: 8)
            symbolView.tintColor = endpoint || selected ? .white : .label
            symbolContainer.layer.shadowColor = UIColor.black.cgColor
            symbolContainer.layer.shadowOpacity = 0.24
            symbolContainer.layer.shadowRadius = 6
            symbolContainer.layer.shadowOffset = CGSize(width: 0, height: 3)
            codeLabel.frame = CGRect(x: 5, y: 40, width: 48, height: 18)
            displayPriority = endpoint || selected || point.source == .bundled ? .required : .defaultHigh
        }

        accessibilityLabel = [point.displayTitle, point.displayCode].compactMap { $0 }.joined(separator: ", ")
        setNeedsLayout()
    }
}

private final class AirportClusterAnnotationView: MKAnnotationView {
    static let reuseIdentifier = "iumrah-airport-cluster"

    private let circle = UIView()
    private let countLabel = UILabel()

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        canShowCallout = false
        collisionMode = .circle
        bounds = CGRect(x: 0, y: 0, width: 38, height: 38)

        circle.frame = bounds
        circle.layer.cornerRadius = 19
        circle.layer.borderWidth = 1
        circle.layer.borderColor = UIColor.label.withAlphaComponent(0.10).cgColor
        circle.layer.shadowColor = UIColor.black.cgColor
        circle.layer.shadowOpacity = 0.18
        circle.layer.shadowRadius = 5
        circle.layer.shadowOffset = CGSize(width: 0, height: 2)
        addSubview(circle)

        countLabel.frame = bounds
        countLabel.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .bold)
        countLabel.textAlignment = .center
        addSubview(countLabel)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func configure(count: Int, cameraDistance: CLLocationDistance) {
        countLabel.text = count > 99 ? "99+" : String(count)
        if cameraDistance > 8_000_000 {
            bounds = CGRect(x: 0, y: 0, width: 28, height: 28)
            circle.frame = bounds
            circle.layer.cornerRadius = 14
            countLabel.frame = bounds
            countLabel.font = UIFont.monospacedSystemFont(ofSize: 10, weight: .bold)
        } else {
            bounds = CGRect(x: 0, y: 0, width: 38, height: 38)
            circle.frame = bounds
            circle.layer.cornerRadius = 19
            countLabel.frame = bounds
            countLabel.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .bold)
        }
        circle.backgroundColor = UIColor.systemBackground.withAlphaComponent(0.92)
        countLabel.textColor = .label
        displayPriority = .defaultHigh
    }
}
