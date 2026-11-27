import Foundation

/// Read-only presentation model. The original offer remains the booking source.
struct IumrahPremiumFlightLeg: Hashable {
    let airline: String
    let airlineCode: String
    let number: String
    let origin: String
    let destination: String
    let departure: String
    let arrival: String?
    let duration: Int
    let stops: Int
    var cabin: String? = nil
    var aircraft: String? = nil
    var departureTerminal: String? = nil
    var arrivalTerminal: String? = nil
    var operatingCarrier: String? = nil

    var verifiedNumber: String? {
        let compact = number.uppercased().filter { !$0.isWhitespace && $0 != "-" }
        if compact.range(of: #"^[0-9]{1,4}[A-Z]?$"#, options: .regularExpression) != nil { return airlineCode.count == 2 ? FlightReferenceCatalog.normalizedVerifiedFlightNumber(airlineCode + compact) : nil }
        return FlightReferenceCatalog.normalizedVerifiedFlightNumber(number)
    }
    var title: String { airline.isEmpty ? verifiedNumber ?? "\(origin) – \(destination)" : airline }
    var share: String { ["iumrah", title, verifiedNumber ?? "", "\(origin) → \(destination)", departure].filter { !$0.isEmpty }.joined(separator: " · ") }

    init(airline: String, airlineCode: String, number: String, origin: String, destination: String, departure: String, arrival: String?, duration: Int, stops: Int, cabin: String? = nil, aircraft: String? = nil, departureTerminal: String? = nil, arrivalTerminal: String? = nil, operatingCarrier: String? = nil) {
        self.airline = airline; self.airlineCode = airlineCode; self.number = number
        self.origin = origin; self.destination = destination; self.departure = departure; self.arrival = arrival
        self.duration = duration; self.stops = stops; self.cabin = cabin; self.aircraft = aircraft
        self.departureTerminal = departureTerminal; self.arrivalTerminal = arrivalTerminal; self.operatingCarrier = operatingCarrier
    }
    init(_ segment: FlightSegment, stops: Int = 0, cabin: String? = nil) {
        let formatter = ISO8601DateFormatter()
        self.init(airline: FlightReferenceCatalog.airlineName(code: segment.airlineCode, fallback: segment.airline), airlineCode: segment.airlineCode ?? "", number: segment.flightNumber, origin: segment.origin.code, destination: segment.destination.code, departure: formatter.string(from: segment.departureAt), arrival: formatter.string(from: segment.arrivalAt), duration: segment.durationMinutes, stops: stops, cabin: segment.cabin ?? cabin, aircraft: segment.aircraft, departureTerminal: segment.origin.terminal, arrivalTerminal: segment.destination.terminal, operatingCarrier: segment.operatingCarrier)
    }
    init(_ leg: StorefrontFlightLeg) {
        self.init(airline: leg.airline, airlineCode: leg.airlineCode, number: leg.flightNumber, origin: leg.origin, destination: leg.destination, departure: leg.departureAt, arrival: leg.arrivalAt, duration: leg.durationMinutes, stops: leg.stops, cabin: leg.cabinClass)
    }
    init(_ leg: FlightDiscoveryVerifiedSegment) {
        self.init(airline: FlightReferenceCatalog.airlineName(code: leg.airlineCode, fallback: leg.airlineCode), airlineCode: leg.airlineCode, number: leg.flightNumber, origin: leg.originAirport, destination: leg.destinationAirport, departure: leg.departureAt, arrival: leg.arrivalAt, duration: 0, stops: 0)
    }

    static func instant(_ raw: String?) -> Date? {
        guard let raw else { return nil }
        let normalized = raw.replacingOccurrences(of: " ", with: "T", options: [], range: raw.range(of: " "))
        let iso = ISO8601DateFormatter(); iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: normalized) { return date }
        iso.formatOptions = [.withInternetDateTime]
        if let date = iso.date(from: normalized) { return date }
        // AeroDataBox UTC may use a space between date and time, and omit seconds.
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(secondsFromGMT: 0)
        for pattern in ["yyyy-MM-dd HH:mm'Z'", "yyyy-MM-dd'T'HH:mmXXXXX", "yyyy-MM-dd HH:mmXXXXX"] {
            f.dateFormat = pattern; if let d = f.date(from: raw) { return d }
        }
        return nil
    }
    static func localParts(_ raw: String?, code: String) -> (day: String, time: String)? {
        guard let raw, raw.count >= 16 else { return nil }
        if let instant = instant(raw), let zone = FlightReferenceCatalog.timeZone(for: code) {
            let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = zone; f.dateFormat = "yyyy-MM-dd HH:mm"
            let value = f.string(from: instant)
            return (String(value.prefix(10)), String(value.suffix(5)))
        }
        // Never interpret an offset timestamp as local time when the zone is unknown.
        guard raw.count == 16 || raw.count == 19, raw.range(of: #"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$"#, options: .regularExpression) != nil else { return nil }
        return (String(raw.prefix(10)), String(raw.dropFirst(11).prefix(5)))
    }
    var effectiveDuration: Int {
        if duration > 0 { return duration }
        guard let a = Self.instant(departure), let b = Self.instant(arrival), b > a else { return 0 }
        return Int(b.timeIntervalSince(a) / 60)
    }
}

/// Great-circle preview, not a recording of the aircraft's traveled path.
struct IumrahFlightGlobeRoute {
    typealias Vector = IumrahHemisphereProjection.Vector
    let projection: IumrahHemisphereProjection
    let points: [CGPoint]
    let livePoint: CGPoint?
    let progressIndex: Int?

    init?(from: Airport, to: Airport, position: IumrahFlightOperationalDetail.Position?) {
        let a = Vector(latitude: from.lat, longitude: from.lon), b = Vector(latitude: to.lat, longitude: to.lon)
        let angle = acos(max(-1, min(1, a.dot(b))))
        guard angle > 0.00001, angle < .pi - 0.00001 else { return nil }
        func vector(_ t: Double) -> Vector {
            let l = sin((1-t)*angle)/sin(angle), r = sin(t*angle)/sin(angle)
            return Vector(x: l*a.x+r*b.x, y: l*a.y+r*b.y, z: l*a.z+r*b.z)
        }
        let mid = vector(0.5)
        let projection = IumrahHemisphereProjection(latitude: asin(mid.z)*180 / .pi, longitude: atan2(mid.y, mid.x)*180 / .pi)
        self.projection = projection
        let samples = (0...64).map { vector(Double($0)/64) }
        self.points = samples.map { projection.project($0).point }
        if let position {
            let v = Vector(latitude: position.latitude, longitude: position.longitude)
            self.livePoint = projection.point(latitude: position.latitude, longitude: position.longitude)
            self.progressIndex = samples.indices.max { samples[$0].dot(v) < samples[$1].dot(v) }
        } else { self.livePoint = nil; self.progressIndex = nil }
    }
}
