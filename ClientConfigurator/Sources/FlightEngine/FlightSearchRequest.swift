import Foundation

enum FlightCabinClass: String, CaseIterable, Codable, Hashable, Identifiable {
    case economy
    case premiumEconomy = "premium_economy"
    case business
    case first

    var id: String { rawValue }
}

enum FlightStopsPreference: String, CaseIterable, Codable, Hashable, Identifiable {
    case any
    case nonstop
    case upToOne
    case upToTwo

    var id: String { rawValue }
    var maxStops: Int? {
        switch self {
        case .any: return nil
        case .nonstop: return 0
        case .upToOne: return 1
        case .upToTwo: return 2
        }
    }
}

enum FlightTimeWindow: String, CaseIterable, Codable, Hashable, Identifiable {
    case any
    case night
    case morning
    case afternoon
    case evening

    var id: String { rawValue }
    var hours: ClosedRange<Int>? {
        switch self {
        case .any: return nil
        case .night: return 0...5
        case .morning: return 6...11
        case .afternoon: return 12...17
        case .evening: return 18...23
        }
    }
}

enum FlightInfantSeating: String, CaseIterable, Codable, Hashable, Identifiable {
    case lap
    case seat

    var id: String { rawValue }
}

struct FlightSearchFilters: Codable, Hashable {
    var cabinClass: FlightCabinClass = .economy
    var stops: FlightStopsPreference = .any
    var minCarryOnBags: Int = 0
    var minCheckedBags: Int = 0
    var maxPriceUSD: Int? = nil
    var departureWindow: FlightTimeWindow = .any
    var arrivalWindow: FlightTimeWindow = .any
    var airlinesInclude: [String] = []
    var airlinesExclude: [String] = []
    var allowSelfTransfer: Bool = false
    var infantSeating: FlightInfantSeating = .lap

    static let `default` = FlightSearchFilters()

    var normalizedAirlinesInclude: [String] { normalized(airlinesInclude) }
    var normalizedAirlinesExclude: [String] { normalized(airlinesExclude) }

    private func normalized(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() }
            .filter { $0.range(of: "^[A-Z0-9]{2}$", options: .regularExpression) != nil }
            .filter { seen.insert($0).inserted }
    }
}


struct FlightJourneySearchRequest: Hashable, Codable {
    let id: String
    let outboundOrigin: String
    let outboundDestination: String
    let inboundOrigin: String?
    let inboundDestination: String?
    let adults: Int
    let children: Int
    let infants: Int
    let cabin: String
    let filters: FlightSearchFilters

    init(
        id: String = UUID().uuidString,
        outboundOrigin: String,
        outboundDestination: String,
        inboundOrigin: String? = nil,
        inboundDestination: String? = nil,
        adults: Int,
        children: Int,
        infants: Int,
        cabin: String = "economy",
        filters: FlightSearchFilters = .default
    ) {
        self.id = id
        self.outboundOrigin = outboundOrigin.uppercased()
        self.outboundDestination = outboundDestination.uppercased()
        self.inboundOrigin = inboundOrigin?.uppercased()
        self.inboundDestination = inboundDestination?.uppercased()
        self.adults = adults
        self.children = children
        self.infants = infants
        self.cabin = cabin
        self.filters = filters
    }
}

struct FlightJourneyDatePair: Hashable, Codable {
    let outbound: Date
    let inbound: Date?
}

enum FlightFareScope: String, Codable, Hashable {
    case perPassenger
    case totalParty
    case unknown
}

/// Normalized flight result independent of the transport used to discover it.
/// `sourceID`/`sourceName` describe the upstream data source (for example Ignav),
/// while the actual airline remains represented by `airline`/`flightNumber`.
struct LiveFlightCandidate: Identifiable, Hashable, Codable {
    let id: String
    let sourceID: String
    let sourceName: String
    let direction: FlightDirection
    let airline: String
    let flightNumber: String
    let origin: String
    let destination: String
    let departureAt: Date
    let arrivalAt: Date
    let stops: Int
    let durationMinutes: Int
    let observedFare: Decimal
    let observedCurrency: String
    let fareScope: FlightFareScope
    let observedAt: Date
    let sourceURL: String?
    let rawFingerprint: String?
    let airlineCode: String?
    let segments: [FlightSegment]?
    let connectionAirports: [FlightAirportSnapshot]?
    let providerItineraryID: String?
    let cabinClass: String?
    let baggage: FlightBaggageAllowance?
    let requiresSelfTransfer: Bool?

    init(
        id: String,
        sourceID: String,
        sourceName: String,
        direction: FlightDirection,
        airline: String,
        flightNumber: String,
        origin: String,
        destination: String,
        departureAt: Date,
        arrivalAt: Date,
        stops: Int,
        durationMinutes: Int,
        observedFare: Decimal,
        observedCurrency: String,
        fareScope: FlightFareScope,
        observedAt: Date,
        sourceURL: String? = nil,
        rawFingerprint: String? = nil,
        airlineCode: String? = nil,
        segments: [FlightSegment]? = nil,
        connectionAirports: [FlightAirportSnapshot]? = nil,
        providerItineraryID: String? = nil,
        cabinClass: String? = nil,
        baggage: FlightBaggageAllowance? = nil,
        requiresSelfTransfer: Bool? = nil
    ) {
        self.id = id
        self.sourceID = sourceID.trimmingCharacters(in: .whitespacesAndNewlines)
        self.sourceName = sourceName.trimmingCharacters(in: .whitespacesAndNewlines)
        self.direction = direction
        self.airline = airline.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedFlightNumber = FlightReferenceCatalog.normalizedVerifiedFlightNumber(flightNumber)
            ?? flightNumber.trimmingCharacters(in: .whitespacesAndNewlines)
        self.flightNumber = normalizedFlightNumber
        self.origin = origin.uppercased()
        self.destination = destination.uppercased()
        self.departureAt = departureAt
        self.arrivalAt = arrivalAt
        self.stops = stops
        self.durationMinutes = durationMinutes
        self.observedFare = observedFare
        self.observedCurrency = observedCurrency.uppercased()
        self.fareScope = fareScope
        self.observedAt = observedAt
        self.sourceURL = sourceURL?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank
        self.rawFingerprint = rawFingerprint?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank
        self.airlineCode = airlineCode?.uppercased() ?? FlightReferenceCatalog.airlineCode(from: normalizedFlightNumber)
        self.segments = segments?.isEmpty == false ? segments : nil
        self.connectionAirports = connectionAirports?.isEmpty == false ? connectionAirports : nil
        self.providerItineraryID = providerItineraryID?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank
        self.cabinClass = cabinClass?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank
        self.baggage = baggage
        self.requiresSelfTransfer = requiresSelfTransfer
    }

    var deduplicationKey: String {
        let normalized = FlightReferenceCatalog.normalizedVerifiedFlightNumber(flightNumber) ?? flightNumber.uppercased()
        let epoch = Int(departureAt.timeIntervalSince1970 / 300)
        let segmentKey = (segments ?? []).map { segment in
            let number = FlightReferenceCatalog.normalizedVerifiedFlightNumber(segment.flightNumber) ?? segment.flightNumber.uppercased()
            return "\(number)-\(segment.origin.code)-\(segment.destination.code)"
        }.joined(separator: "+")
        let connectionKey = (connectionAirports ?? []).map(\.code).joined(separator: "+")
        return "\(normalized)|\(origin)|\(destination)|\(epoch)|\(segmentKey)|\(connectionKey)".lowercased()
    }

    /// Final provider-neutral safety gate before a result can be rendered.
    /// Source-specific validation belongs in the API adapter; this layer checks
    /// itinerary/fare coherence without depending on old airline-bot registries.
    var isDisplayableCandidate: Bool {
        let age = Date().timeIntervalSince(observedAt)
        guard !sourceID.isEmpty,
              !sourceName.isEmpty,
              observedFare > 0,
              fareScope != .unknown,
              observedCurrency.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil,
              age >= -5 * 60,
              // Search responses may come from the Package Engine's 12-hour
              // exact-query cache. The server enforces freshness and rejects
              // past travel dates before a cached fare reaches the client.
              age <= 12 * 60 * 60 + 5 * 60,
              origin.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil,
              destination.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil,
              origin != destination,
              departureAt < arrivalAt,
              stops >= 0,
              durationMinutes > 0,
              let segments,
              !segments.isEmpty,
              segments.count == stops + 1 else { return false }

        if let sourceURL {
            guard let url = URL(string: sourceURL), ["https", "http"].contains(url.scheme?.lowercased() ?? "") else { return false }
        }

        guard segments.first?.origin.code == origin,
              segments.last?.destination.code == destination else { return false }

        for (index, segment) in segments.enumerated() {
            guard segment.origin.code != segment.destination.code,
                  segment.departureAt < segment.arrivalAt else { return false }
            if index > 0 {
                guard segments[index - 1].destination.code == segment.origin.code,
                      segments[index - 1].arrivalAt <= segment.departureAt else { return false }
            }
        }

        if stops == 0 { return connectionAirports == nil || connectionAirports?.isEmpty == true }
        guard let connectionAirports, connectionAirports.count == stops else { return false }
        return connectionAirports.map(\.code) == segments.dropLast().map(\.destination.code)
    }
}


struct LiveFlightJourneyCandidate: Identifiable, Hashable, Codable {
    let id: String
    let sourceID: String
    let sourceName: String
    let totalFare: Decimal
    let currency: String
    let fareScope: FlightFareScope
    let observedAt: Date
    let providerItineraryID: String
    let outbound: LiveFlightCandidate
    let inbound: LiveFlightCandidate?
    let baggage: FlightBaggageAllowance?
    let requiresSelfTransfer: Bool?

    var isDisplayableCandidate: Bool {
        guard totalFare > 0,
              fareScope != .unknown,
              outbound.isDisplayableCandidate,
              outbound.direction == .outbound,
              outbound.observedCurrency.caseInsensitiveCompare(currency) == .orderedSame else { return false }
        guard let inbound else { return true }
        return inbound.isDisplayableCandidate &&
            inbound.direction == .inbound &&
            inbound.observedCurrency.caseInsensitiveCompare(currency) == .orderedSame
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
