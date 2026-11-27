import Foundation

struct AirportSearchResponse: Decodable {
    let airports: [Airport]
}

struct Airport: Codable, Identifiable, Hashable {
    let iata: String
    let icao: String?
    let name: String
    let city: String
    let country: String
    let countryCode: String
    let region: String
    let lat: Double
    let lon: Double
    let type: String
    let score: Double
    let aliases: [String]

    var id: String { iata }

    var compactTitle: String {
        "\(iata) · \(city)"
    }

    var subtitle: String {
        "\(name) · \(country)"
    }
}
