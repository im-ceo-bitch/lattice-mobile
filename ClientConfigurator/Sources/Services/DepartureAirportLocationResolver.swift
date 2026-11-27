import Foundation
import CoreLocation
import Combine

@MainActor
final class DepartureAirportLocationResolver: NSObject, ObservableObject, @preconcurrency CLLocationManagerDelegate {
    @Published private(set) var isLocating = false
    @Published private(set) var errorMessage: String?

    private let manager = CLLocationManager()
    private let airportService = AirportSearchService()
    private var completion: ((Airport) -> Void)?
    private var hasRequestedLocation = false

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    func locateNearestAirport(onResolved: @escaping (Airport) -> Void) {
        completion = onResolved
        errorMessage = nil

        guard CLLocationManager.locationServicesEnabled() else {
            errorMessage = "Location services are disabled."
            isLocating = false
            return
        }

        switch manager.authorizationStatus {
        case .notDetermined:
            isLocating = true
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            requestLocationIfNeeded()
        case .denied, .restricted:
            errorMessage = "Location access is unavailable."
            isLocating = false
        @unknown default:
            errorMessage = "Location access is unavailable."
            isLocating = false
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            requestLocationIfNeeded()
        case .denied, .restricted:
            isLocating = false
            errorMessage = "Location access is unavailable."
        case .notDetermined:
            break
        @unknown default:
            break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        hasRequestedLocation = false
        guard let location = locations.last else {
            isLocating = false
            return
        }

        Task {
            let airport = await resolveNearestAirport(to: location)
            isLocating = false
            guard let airport else {
                errorMessage = "Could not determine a nearby departure airport."
                return
            }
            completion?(airport)
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        hasRequestedLocation = false
        isLocating = false
        errorMessage = error.localizedDescription
    }

    private func requestLocationIfNeeded() {
        guard !hasRequestedLocation else { return }
        hasRequestedLocation = true
        isLocating = true
        manager.requestLocation()
    }

    private func resolveNearestAirport(to location: CLLocation) async -> Airport? {
        var queries: [String] = []

        if let placemark = try? await CLGeocoder().reverseGeocodeLocation(
            location,
            preferredLocale: Locale(identifier: "en_US")
        ).first {
            if let locality = placemark.locality, !locality.isEmpty { queries.append(locality) }
            if let subAdministrativeArea = placemark.subAdministrativeArea, !subAdministrativeArea.isEmpty {
                queries.append(subAdministrativeArea)
            }
            if let administrativeArea = placemark.administrativeArea, !administrativeArea.isEmpty {
                queries.append(administrativeArea)
            }
            if let country = placemark.country, !country.isEmpty { queries.append(country) }
        }

        var seen = Set<String>()
        let uniqueQueries = queries.filter { value in
            let key = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard !key.isEmpty, seen.insert(key).inserted else { return false }
            return true
        }

        var candidates: [Airport] = []
        for query in uniqueQueries {
            guard !Task.isCancelled else { return nil }
            if let values = try? await airportService.search(query, limit: 12) {
                candidates.append(contentsOf: values)
            }
        }

        var airportByCode: [String: Airport] = [:]
        for airport in candidates { airportByCode[airport.iata.uppercased()] = airport }

        return airportByCode.values
            .map { airport in
                let airportLocation = CLLocation(latitude: airport.lat, longitude: airport.lon)
                return (airport, location.distance(from: airportLocation))
            }
            .filter { $0.1 <= 250_000 }
            .min { $0.1 < $1.1 }?
            .0
    }
}
