import Foundation
import MapKit

@MainActor
final class AirportMapDiscoveryStore: ObservableObject {
    @Published private(set) var points: [AirportMapPoint] = []
    @Published private(set) var isDiscovering = false

    private static let cacheKey = "iumrah.airport-map.poi-cache.v1"
    private static let maxCachedPoints = 1_500
    private static let maxVisiblePoints = 650
    private static let discoveryLatitudeSpan = 14.0
    private static let discoveryLongitudeSpan = 18.0

    private var cachedByID: [String: AirportMapPoint] = [:]
    private var search: MKLocalSearch?
    private var pendingTask: Task<Void, Never>?
    private var lastRequestKey: String?

    init() {
        restoreCache()
    }


    func update(region: MKCoordinateRegion, cameraDistance: CLLocationDistance) {
        publishCached(in: region)

        pendingTask?.cancel()
        guard shouldDiscover(region: region, cameraDistance: cameraDistance) else {
            isDiscovering = false
            return
        }

        let requestKey = quantizedKey(for: region)
        guard requestKey != lastRequestKey else { return }
        lastRequestKey = requestKey

        pendingTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(380))
            guard !Task.isCancelled, let self else { return }
            await self.discover(region: region)
        }
    }

    func rememberResolved(_ point: AirportMapPoint, airport: Airport) {
        let resolved = point.resolving(to: airport)
        cachedByID.removeValue(forKey: point.id)
        cachedByID[resolved.id] = resolved
        persistCache()
    }

    func resetRequestThrottle() {
        lastRequestKey = nil
    }

    private func shouldDiscover(region: MKCoordinateRegion, cameraDistance: CLLocationDistance) -> Bool {
        guard cameraDistance < 4_800_000 else { return false }
        return region.span.latitudeDelta <= Self.discoveryLatitudeSpan &&
            region.span.longitudeDelta <= Self.discoveryLongitudeSpan
    }

    private func discover(region: MKCoordinateRegion) async {
        search?.cancel()
        isDiscovering = true
        defer { isDiscovering = false }

        let request = MKLocalPointsOfInterestRequest(coordinateRegion: sanitized(region))
        request.pointOfInterestFilter = MKPointOfInterestFilter(including: [.airport])

        let search = MKLocalSearch(request: request)
        self.search = search

        do {
            let response = try await start(search)
            guard !Task.isCancelled else { return }

            let discovered = response.mapItems.compactMap(Self.point(from:))
            merge(discovered)
            publishCached(in: region)
            persistCache()
        } catch {
            // Map POI discovery is an enhancement layer. The bundled airport network
            // remains available if Apple Maps is temporarily offline or rate limited.
        }
    }

    private func start(_ search: MKLocalSearch) async throws -> MKLocalSearch.Response {
        try await withCheckedThrowingContinuation { continuation in
            search.start { response, error in
                if let response {
                    continuation.resume(returning: response)
                } else if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(throwing: URLError(.badServerResponse))
                }
            }
        }
    }

    private func merge(_ incoming: [AirportMapPoint]) {
        for point in incoming {
            if let existing = nearbyResolvedPoint(to: point), existing.airport != nil {
                continue
            }
            cachedByID[point.id] = point
        }

        if cachedByID.count > Self.maxCachedPoints {
            let resolved = cachedByID.values.filter { $0.airport != nil }
            let unresolved = cachedByID.values.filter { $0.airport == nil }
            let keepUnresolved = unresolved.suffix(max(0, Self.maxCachedPoints - resolved.count))
            cachedByID = Dictionary(uniqueKeysWithValues: (resolved + Array(keepUnresolved)).map { ($0.id, $0) })
        }
    }

    private func nearbyResolvedPoint(to candidate: AirportMapPoint) -> AirportMapPoint? {
        let location = CLLocation(latitude: candidate.latitude, longitude: candidate.longitude)
        return cachedByID.values.first { point in
            guard point.airport != nil else { return false }
            let other = CLLocation(latitude: point.latitude, longitude: point.longitude)
            return location.distance(from: other) < 2_500
        }
    }

    private func publishCached(in region: MKCoordinateRegion) {
        let center = CLLocation(latitude: region.center.latitude, longitude: region.center.longitude)
        let visible = cachedByID.values
            .filter { Self.contains($0.coordinate, in: expanded(region, factor: 1.22)) }
            .sorted { lhs, rhs in
                let left = CLLocation(latitude: lhs.latitude, longitude: lhs.longitude).distance(from: center)
                let right = CLLocation(latitude: rhs.latitude, longitude: rhs.longitude).distance(from: center)
                return left < right
            }

        points = Array(visible.prefix(Self.maxVisiblePoints))
    }

    private func restoreCache() {
        guard let data = UserDefaults.standard.data(forKey: Self.cacheKey),
              let decoded = try? JSONDecoder().decode([AirportMapPoint].self, from: data) else {
            return
        }
        cachedByID = Dictionary(uniqueKeysWithValues: decoded.map { ($0.id, $0) })
    }

    private func persistCache() {
        let values = Array(cachedByID.values.prefix(Self.maxCachedPoints))
        guard let data = try? JSONEncoder().encode(values) else { return }
        UserDefaults.standard.set(data, forKey: Self.cacheKey)
    }

    private func quantizedKey(for region: MKCoordinateRegion) -> String {
        let lat = Int((region.center.latitude * 4).rounded())
        let lon = Int((region.center.longitude * 4).rounded())
        let latSpan = Int((region.span.latitudeDelta * 2).rounded())
        let lonSpan = Int((region.span.longitudeDelta * 2).rounded())
        return "\(lat):\(lon):\(latSpan):\(lonSpan)"
    }

    private func sanitized(_ region: MKCoordinateRegion) -> MKCoordinateRegion {
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(
                latitude: min(85, max(-85, region.center.latitude)),
                longitude: region.center.longitude
            ),
            span: MKCoordinateSpan(
                latitudeDelta: min(Self.discoveryLatitudeSpan, max(0.03, region.span.latitudeDelta)),
                longitudeDelta: min(Self.discoveryLongitudeSpan, max(0.03, region.span.longitudeDelta))
            )
        )
    }

    private func expanded(_ region: MKCoordinateRegion, factor: Double) -> MKCoordinateRegion {
        MKCoordinateRegion(
            center: region.center,
            span: MKCoordinateSpan(
                latitudeDelta: min(180, region.span.latitudeDelta * factor),
                longitudeDelta: min(360, region.span.longitudeDelta * factor)
            )
        )
    }

    private static func contains(_ coordinate: CLLocationCoordinate2D, in region: MKCoordinateRegion) -> Bool {
        let halfLat = region.span.latitudeDelta / 2
        let minLat = region.center.latitude - halfLat
        let maxLat = region.center.latitude + halfLat
        guard coordinate.latitude >= minLat, coordinate.latitude <= maxLat else { return false }

        if region.span.longitudeDelta >= 359 { return true }
        let halfLon = region.span.longitudeDelta / 2
        var delta = coordinate.longitude - region.center.longitude
        if delta > 180 { delta -= 360 }
        if delta < -180 { delta += 360 }
        return abs(delta) <= halfLon
    }

    private static func point(from mapItem: MKMapItem) -> AirportMapPoint? {
        let coordinate = mapItem.placemark.coordinate
        guard CLLocationCoordinate2DIsValid(coordinate),
              abs(coordinate.latitude) <= 90,
              abs(coordinate.longitude) <= 180 else { return nil }

        let rawName = mapItem.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let city = mapItem.placemark.locality?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let country = mapItem.placemark.country?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let name = rawName.isEmpty ? (city.isEmpty ? "Airport" : city) : rawName

        return .appleMaps(
            name: name,
            city: city,
            country: country,
            latitude: coordinate.latitude,
            longitude: coordinate.longitude
        )
    }
}
