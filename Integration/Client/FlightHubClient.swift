import Foundation

// Consumer iOS integration module — not installed in the Business target.
// Wire this into the consumer's existing flight search once its current
// repository is provided. This API is read-only; checkout must reprice.
public struct IumrahHubFlightResponse: Decodable {
    public struct Flight: Decodable, Identifiable {
        public struct Offer: Decodable {
            public let provider: String
            public let fare_brand: String
            public let amount_minor: Int64
            public let currency: String
            public let checked_at: String
            public let fresh: Bool
            public let price_scope: String
            public let baggage_checked_kg: Double?
            public let baggage_cabin_kg: Double?
            public let seats_left: Int?
        }
        public let flight_key: String
        public let airline_code: String
        public let flight_number: String
        public let origin: String
        public let destination: String
        public let departure_date: String
        public let departure_at: String?
        public let arrival_at: String?
        public let offers: [Offer]
        public var id: String { flight_key }
        public var currentOffers: [Offer] { offers.filter { $0.fresh } }
    }
    public let ok: Bool
    public let flights: [Flight]
    public let generated_at: String
}

public enum FlightHubClientError: Error {
    case invalidBaseURL
    case invalidRoute
    case http(Int)
    case serverFailure
}

public struct IumrahFlightHubClient {
    public let baseURL: URL
    public init(baseURL: URL) throws {
        guard baseURL.scheme?.lowercased() == "https", baseURL.host != nil else {
            throw FlightHubClientError.invalidBaseURL
        }
        self.baseURL = baseURL
    }

    public func flights(origin: String, destination: String, date: String? = nil) async throws -> [IumrahHubFlightResponse.Flight] {
        let a=origin.uppercased(), b=destination.uppercased()
        guard a.count == 3, b.count == 3, a.allSatisfy({ $0.isASCII && $0.isLetter }),
              b.allSatisfy({ $0.isASCII && $0.isLetter }) else { throw FlightHubClientError.invalidRoute }
        var components=URLComponents(url: baseURL.appending(path: "v1/public/flights"), resolvingAgainstBaseURL: false)!
        var items=[URLQueryItem(name: "origin", value: a),URLQueryItem(name: "destination", value: b)]
        if let date, !date.isEmpty { items.append(URLQueryItem(name: "date", value: date)) }
        components.queryItems=items
        var request=URLRequest(url: components.url!)
        request.timeoutInterval=15
        let (data,response)=try await URLSession.shared.data(for:request)
        guard let http=response as? HTTPURLResponse else {throw FlightHubClientError.serverFailure}
        guard (200..<300).contains(http.statusCode) else {throw FlightHubClientError.http(http.statusCode)}
        let result=try JSONDecoder().decode(IumrahHubFlightResponse.self,from:data)
        guard result.ok else {throw FlightHubClientError.serverFailure}
        return result.flights
    }
}
