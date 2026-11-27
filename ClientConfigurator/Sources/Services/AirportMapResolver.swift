import Foundation
import CoreLocation

struct AirportMapResolver {
    private let service = AirportSearchService()

    func resolve(_ point: AirportMapPoint) async -> Airport? {
        if let airport = point.airport { return airport }

        let location = CLLocation(latitude: point.latitude, longitude: point.longitude)
        var queries: [String] = [point.name, point.city]

        if point.city.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           let placemark = try? await CLGeocoder().reverseGeocodeLocation(
            location,
            preferredLocale: Locale(identifier: "en_US")
           ).first {
            if let locality = placemark.locality { queries.append(locality) }
            if let administrativeArea = placemark.administrativeArea { queries.append(administrativeArea) }
        }

        var seen = Set<String>()
        for rawQuery in queries {
            let query = rawQuery.trimmingCharacters(in: .whitespacesAndNewlines)
            let key = query.lowercased()
            guard !query.isEmpty, seen.insert(key).inserted else { continue }
            guard !Task.isCancelled else { return nil }

            guard let matches = try? await service.search(query, limit: 12), !matches.isEmpty else {
                continue
            }

            let nearest = matches
                .map { airport -> (Airport, CLLocationDistance) in
                    let airportLocation = CLLocation(latitude: airport.lat, longitude: airport.lon)
                    return (airport, location.distance(from: airportLocation))
                }
                .min { $0.1 < $1.1 }

            if let nearest, nearest.1 <= 65_000 {
                return nearest.0
            }
        }

        return nil
    }
}
