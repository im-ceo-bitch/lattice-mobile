import Foundation

struct IumrahFlightOperationalDetail: Decodable {
    struct Position: Decodable {
        let latitude: Double
        let longitude: Double
        let reportedAt: String?
        let altitudeFeet: Double?
        let speedKmh: Double?
    }
    let status: String?
    let updatedAt: String?
    let departureTerminal: String?
    let departureGate: String?
    let arrivalTerminal: String?
    let arrivalGate: String?
    let baggageBelt: String?
    let departureScheduled: String?
    let arrivalScheduled: String?
    let departureRevised: String?
    let arrivalRevised: String?
    let departureActual: String?
    let arrivalActual: String?
    let arrivalEstimatedUTC: String?
    let aircraft: String?
    let registration: String?
    let position: Position?
}

/// The transport reports why enrichment is unavailable without exposing credentials.
struct IumrahFlightDetailResult {
    let detail: IumrahFlightOperationalDetail?
    let reason: String?
}

actor IumrahFlightDetailService {
    static let shared = IumrahFlightDetailService()
    private struct Envelope: Decodable { let detail: IumrahFlightOperationalDetail?; let reason: String? }
    private var inFlight: [String: Task<IumrahFlightDetailResult, Never>] = [:]
    private var cache: [String: (value: IumrahFlightDetailResult, expires: Date)] = [:]

    func detail(number: String, day: String, time: String, origin: String, destination: String, force: Bool = false) async -> IumrahFlightDetailResult {
        guard let number = FlightReferenceCatalog.normalizedVerifiedFlightNumber(number), day.count == 10 else { return .init(detail: nil, reason: "invalid_request") }
        let key = [number, day, time, origin, destination].joined(separator: "|")
        if let request = inFlight[key] { return await request.value }
        if !force, let entry = cache[key], entry.expires > Date() { return entry.value }
        let request = Task<IumrahFlightDetailResult, Never> {
            let query = [URLQueryItem(name: "number", value: number), .init(name: "date", value: day), .init(name: "time", value: time), .init(name: "origin", value: origin), .init(name: "destination", value: destination)]
            do {
                let envelope: Envelope = try await APIClient.shared.get("/api/package/flights/detail", query: query, timeoutInterval: 15)
                return .init(detail: envelope.detail, reason: envelope.reason ?? (envelope.detail == nil ? "no_match" : nil))
            } catch let error as APIError {
                switch error {
                case .status(let code), .server(let code, _): return .init(detail: nil, reason: "http_\(code)")
                case .decoding: return .init(detail: nil, reason: "invalid_response")
                default: return .init(detail: nil, reason: "request_failed")
                }
            } catch { return .init(detail: nil, reason: "network_error") }
        }
        inFlight[key] = request
        let result = await request.value
        inFlight[key] = nil
        cache = cache.filter { $0.value.expires > Date() }
        if result.detail != nil { cache[key] = (result, Date().addingTimeInterval(300)) }
        return result
    }
}
