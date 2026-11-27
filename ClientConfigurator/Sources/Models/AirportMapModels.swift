import Foundation
import CoreLocation

struct AirportMapPoint: Codable, Identifiable, Hashable {
    enum Source: String, Codable {
        case bundled
        case appleMaps
        case cache
    }

    let id: String
    let name: String
    let city: String
    let country: String
    let latitude: Double
    let longitude: Double
    let airport: Airport?
    let source: Source

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    var displayCode: String? {
        guard let value = airport?.iata.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(),
              value.count == 3 else { return nil }
        return value
    }

    var displayTitle: String {
        let trimmedCity = city.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmedCity.isEmpty ? name : trimmedCity
    }

    static func bundled(_ airport: Airport) -> AirportMapPoint {
        AirportMapPoint(
            id: "iata:\(airport.iata.uppercased())",
            name: airport.name,
            city: airport.city,
            country: airport.country,
            latitude: airport.lat,
            longitude: airport.lon,
            airport: airport,
            source: .bundled
        )
    }

    static func appleMaps(
        name: String,
        city: String,
        country: String,
        latitude: Double,
        longitude: Double
    ) -> AirportMapPoint {
        let normalizedName = name
            .lowercased()
            .replacingOccurrences(of: " ", with: "-")
            .replacingOccurrences(of: "/", with: "-")
        let latKey = Int((latitude * 10_000).rounded())
        let lonKey = Int((longitude * 10_000).rounded())
        return AirportMapPoint(
            id: "map:\(latKey):\(lonKey):\(normalizedName)",
            name: name,
            city: city,
            country: country,
            latitude: latitude,
            longitude: longitude,
            airport: nil,
            source: .appleMaps
        )
    }

    func resolving(to airport: Airport) -> AirportMapPoint {
        AirportMapPoint(
            id: "iata:\(airport.iata.uppercased())",
            name: airport.name,
            city: airport.city,
            country: airport.country,
            latitude: airport.lat,
            longitude: airport.lon,
            airport: airport,
            source: source
        )
    }
}
