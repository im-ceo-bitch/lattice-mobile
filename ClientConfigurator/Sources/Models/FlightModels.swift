import Foundation

enum FlightDirection: String, Codable, Hashable {
    case outbound
    case inbound
}

struct FlightAirportSnapshot: Hashable, Codable {
    let code: String
    let city: String?
    let name: String?
    let terminal: String?
    let timeZoneIdentifier: String?

    init(code: String, city: String? = nil, name: String? = nil, terminal: String? = nil, timeZoneIdentifier: String? = nil) {
        let upper = code.uppercased()
        let reference = FlightReferenceCatalog.airport(upper)
        self.code = upper
        self.city = city?.nilIfBlank ?? reference?.city
        self.name = name?.nilIfBlank ?? reference?.name
        self.terminal = terminal?.nilIfBlank
        self.timeZoneIdentifier = timeZoneIdentifier?.nilIfBlank ?? reference?.timeZoneIdentifier
    }

    var displayCity: String { city?.nilIfBlank ?? code }
    var displayAirport: String { name?.nilIfBlank ?? code }
}

struct FlightSegment: Identifiable, Hashable, Codable {
    let id: String
    let airline: String
    let airlineCode: String?
    let flightNumber: String
    let origin: FlightAirportSnapshot
    let destination: FlightAirportSnapshot
    let departureAt: Date
    let arrivalAt: Date
    let durationMinutes: Int
    let aircraft: String?
    let operatingCarrier: String?
    let cabin: String?

    init(
        id: String = UUID().uuidString,
        airline: String,
        airlineCode: String? = nil,
        flightNumber: String,
        origin: FlightAirportSnapshot,
        destination: FlightAirportSnapshot,
        departureAt: Date,
        arrivalAt: Date,
        durationMinutes: Int,
        aircraft: String? = nil,
        operatingCarrier: String? = nil,
        cabin: String? = nil
    ) {
        self.id = id
        self.airline = airline
        let normalizedFlightNumber = FlightReferenceCatalog.normalizedVerifiedFlightNumber(flightNumber)
            ?? flightNumber.trimmingCharacters(in: .whitespacesAndNewlines)
        self.airlineCode = airlineCode?.uppercased() ?? FlightReferenceCatalog.airlineCode(from: normalizedFlightNumber)
        self.flightNumber = normalizedFlightNumber
        self.origin = origin
        self.destination = destination
        self.departureAt = departureAt
        self.arrivalAt = arrivalAt
        self.durationMinutes = durationMinutes
        self.aircraft = aircraft?.nilIfBlank
        self.operatingCarrier = operatingCarrier?.nilIfBlank
        self.cabin = cabin?.nilIfBlank
    }
}

struct FlightBaggageAllowance: Hashable, Codable {
    let carryOn: Int?
    let checked: Int?
}

/// Compact snapshot of the other leg belonging to the same complete Ignav fare.
/// It lets the outbound list render every API itinerary without presenting several
/// visually identical outbound cards whose different return flights are hidden.
struct FlightPairedLeg: Hashable, Codable {
    let airline: String
    let flightNumber: String
    let origin: String
    let destination: String
    let departureAt: Date
    let arrivalAt: Date
    let stops: Int
    let durationMinutes: Int
    let segments: [FlightSegment]?

    init(candidate: LiveFlightCandidate) {
        airline = candidate.airline
        flightNumber = candidate.flightNumber
        origin = candidate.origin
        destination = candidate.destination
        departureAt = candidate.departureAt
        arrivalAt = candidate.arrivalAt
        stops = candidate.stops
        durationMinutes = candidate.durationMinutes
        segments = candidate.segments
    }

    var primaryAirlineCode: String? {
        FlightReferenceCatalog.airlineCode(from: flightNumber) ??
        segments?.compactMap { segment in
            segment.airlineCode ?? FlightReferenceCatalog.airlineCode(from: segment.flightNumber)
        }.first
    }
}

struct FlightLayover: Identifiable, Hashable {
    let id: String
    let airport: FlightAirportSnapshot
    let durationMinutes: Int
    let airportChange: Bool
    let overnight: Bool

    init(previous: FlightSegment, next: FlightSegment) {
        id = "\(previous.id)-\(next.id)"
        airport = previous.destination
        // Do not manufacture layover duration from timezone arithmetic. The
        // provider source remains authoritative; until it exposes an explicit
        // layover duration, present only the verified transfer airport/country.
        durationMinutes = 0
        airportChange = previous.destination.code != next.origin.code
        let calendar = Calendar(identifier: .gregorian)
        overnight = !calendar.isDate(previous.arrivalAt, inSameDayAs: next.departureAt)
    }
}

struct FlightOffer: Identifiable, Hashable, Codable {
    let id: String
    let direction: FlightDirection
    let airline: String
    let flightNumber: String
    let origin: String
    let destination: String
    let departureAt: Date
    let arrivalAt: Date
    let stops: Int
    let durationMinutes: Int

    /// Historical property name retained for source compatibility. In Generator V2
    /// this is the displayed airline fare for this flight option. The final Umrah
    /// package selling price is calculated separately by the server PackageEngine.
    let totalPackagePrice: Decimal
    let currency: String
    let sourceLabel: String

    /// Legacy remote-pricing metadata retained for decoding older stored sessions.
    /// Generator V2 does not use these fields to calculate the final package price.
    let packageTotalPrice: Decimal?
    let quoteId: String?
    let sourceCandidateID: String?
    let airlineCode: String?
    let segments: [FlightSegment]?
    let connectionAirports: [FlightAirportSnapshot]?

    /// Actual ticket fare observed by the active flight data provider. Generator
    /// keeps fare components separate from the package selling price.
    let fareAmount: Decimal?
    let fareScope: FlightFareScope?
    let fareObservedAt: Date?
    let fareSourceURL: String?
    let providerItineraryID: String?
    let cabinClass: String?
    let baggage: FlightBaggageAllowance?
    let requiresSelfTransfer: Bool?
    let pairedLeg: FlightPairedLeg?

    init(
        id: String,
        direction: FlightDirection,
        airline: String,
        flightNumber: String,
        origin: String,
        destination: String,
        departureAt: Date,
        arrivalAt: Date,
        stops: Int,
        durationMinutes: Int,
        totalPackagePrice: Decimal,
        currency: String,
        sourceLabel: String,
        packageTotalPrice: Decimal? = nil,
        quoteId: String? = nil,
        sourceCandidateID: String? = nil,
        airlineCode: String? = nil,
        segments: [FlightSegment]? = nil,
        connectionAirports: [FlightAirportSnapshot]? = nil,
        fareAmount: Decimal? = nil,
        fareScope: FlightFareScope? = nil,
        fareObservedAt: Date? = nil,
        fareSourceURL: String? = nil,
        providerItineraryID: String? = nil,
        cabinClass: String? = nil,
        baggage: FlightBaggageAllowance? = nil,
        requiresSelfTransfer: Bool? = nil,
        pairedLeg: FlightPairedLeg? = nil
    ) {
        self.id = id
        self.direction = direction
        self.airline = airline
        self.flightNumber = flightNumber
        self.origin = origin.uppercased()
        self.destination = destination.uppercased()
        self.departureAt = departureAt
        self.arrivalAt = arrivalAt
        self.stops = stops
        self.durationMinutes = durationMinutes
        self.totalPackagePrice = totalPackagePrice
        self.currency = currency
        self.sourceLabel = sourceLabel
        self.packageTotalPrice = packageTotalPrice
        self.quoteId = quoteId
        self.sourceCandidateID = sourceCandidateID
        self.airlineCode = airlineCode?.uppercased() ?? FlightReferenceCatalog.airlineCode(from: flightNumber)
        self.segments = segments?.isEmpty == false ? segments : nil
        self.connectionAirports = connectionAirports?.isEmpty == false ? connectionAirports : nil
        self.fareAmount = fareAmount
        self.fareScope = fareScope
        self.fareObservedAt = fareObservedAt
        self.fareSourceURL = fareSourceURL?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? fareSourceURL : nil
        self.providerItineraryID = providerItineraryID?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? providerItineraryID : nil
        self.cabinClass = cabinClass?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? cabinClass : nil
        self.baggage = baggage
        self.requiresSelfTransfer = requiresSelfTransfer
        self.pairedLeg = pairedLeg
    }

    /// Stable itinerary identity shared with LiveFlightCandidate. Upstream APIs
    /// can assign different IDs to the same physical itinerary, so deduplication
    /// uses flight/route/time/segments rather than provider IDs.
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

    /// Identity of one complete upstream fare result. Several Ignav itineraries can
    /// share the same physical outbound/return leg while differing in the paired
    /// leg, baggage or complete-journey fare. UI result merging must preserve those
    /// offers instead of collapsing them by the physical-leg deduplication key.
    var resultIdentityKey: String {
        // Preserve every distinct provider fare row. Some providers reuse an
        // itinerary identifier across fare/baggage variants, so provider ID alone
        // is not a sufficient UI identity key.
        let provider = providerItineraryID?.nilIfBlank ?? id
        let fare = fareAmount.map { NSDecimalNumber(decimal: $0).stringValue } ?? NSDecimalNumber(decimal: totalPackagePrice).stringValue
        let departure = Int(departureAt.timeIntervalSince1970)
        let arrival = Int(arrivalAt.timeIntervalSince1970)
        let baggageKey = "\(baggage?.carryOn ?? -1):\(baggage?.checked ?? -1)"
        let transferKey = requiresSelfTransfer.map { $0 ? "self" : "protected" } ?? "unknown"
        return [direction.rawValue, provider, fare, currency.uppercased(), String(departure), String(arrival), baggageKey, transferKey]
            .joined(separator: "|")
            .lowercased()
    }

    var displaySegments: [FlightSegment] {
        if let segments, !segments.isEmpty { return segments }
        let code = airlineCode ?? FlightReferenceCatalog.airlineCode(from: flightNumber)
        return [
            FlightSegment(
                id: "aggregate-\(id)",
                airline: airline,
                airlineCode: code,
                flightNumber: flightNumber,
                origin: FlightAirportSnapshot(code: origin),
                destination: FlightAirportSnapshot(code: destination),
                departureAt: departureAt,
                arrivalAt: arrivalAt,
                durationMinutes: durationMinutes
            )
        ]
    }

    var layovers: [FlightLayover] {
        let values = displaySegments
        guard values.count > 1 else { return [] }
        return zip(values, values.dropFirst()).map { FlightLayover(previous: $0.0, next: $0.1) }
    }

    var primaryAirlineCode: String? {
        if let airlineCode, airlineCode.range(of: "^[A-Z0-9]{2}$", options: .regularExpression) != nil {
            return airlineCode
        }
        if let code = FlightReferenceCatalog.airlineCode(from: flightNumber) { return code }
        for segment in displaySegments {
            if let code = FlightReferenceCatalog.airlineCode(from: segment.flightNumber) { return code }
        }
        return nil
    }

    var flightNumbersSummary: String {
        var seen = Set<String>()
        return displaySegments
            .compactMap { FlightReferenceCatalog.normalizedVerifiedFlightNumber($0.flightNumber) }
            .filter { seen.insert($0).inserted }
            .joined(separator: " · ")
    }

    var airlinesSummary: String {
        var seen = Set<String>()
        let values = displaySegments.compactMap { segment -> String? in
            let code = segment.airlineCode ?? FlightReferenceCatalog.airlineCode(from: segment.flightNumber)
            let value = FlightReferenceCatalog.airlineName(code: code, fallback: segment.airline)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return value.isEmpty ? nil : value
        }
        let summary = values.filter { seen.insert($0).inserted }.joined(separator: " + ")
        if !summary.isEmpty { return summary }
        return airline.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Final client-side safety gate. Provider-specific response validation is
    /// performed by the flight API adapter; this model verifies the normalized
    /// itinerary/fare contract without any airline-bot registry dependency.
    var isVerifiedForBooking: Bool {
        let source = sourceLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        if providerItineraryID?.hasPrefix("aviasales:") == true {
            let age = fareObservedAt.map { Date().timeIntervalSince($0) }
            return source == "Aviasales Data" &&
                airline.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false &&
                (fareAmount ?? 0) > 0 &&
                fareScope != nil && fareScope != .unknown &&
                age.map { $0 >= -5 * 60 && $0 <= 30 * 60 } == true &&
                currency.uppercased().range(of: "^[A-Z]{3}$", options: .regularExpression) != nil &&
                origin.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil &&
                destination.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil &&
                origin != destination && departureAt < arrivalAt && durationMinutes > 0 && stops >= 0
        }

        let lowerSource = source.lowercased()
        let age = fareObservedAt.map { Date().timeIntervalSince($0) }
        guard !source.isEmpty,
              !lowerSource.contains("google flights"),
              !lowerSource.contains("skyscanner"),
              !lowerSource.contains("ref-google"),
              !lowerSource.contains("ref-skyscanner"),
              !airline.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let fareAmount, fareAmount > 0,
              let fareScope, fareScope != .unknown,
              let age, age >= -5 * 60, age <= 30 * 60,
              currency.uppercased().range(of: "^[A-Z]{3}$", options: .regularExpression) != nil,
              origin.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil,
              destination.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil,
              origin != destination,
              departureAt < arrivalAt,
              durationMinutes > 0,
              stops >= 0,
              let segments, !segments.isEmpty, segments.count == stops + 1 else { return false }

        if let fareSourceURL {
            guard let url = URL(string: fareSourceURL), ["https", "http"].contains(url.scheme?.lowercased() ?? "") else { return false }
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

struct PackageStayPlan: Hashable, Codable {
    let timezone: String
    let source: String
    let firstCity: String
    let lastCity: String
    let totalNights: Int
    let totalDays: Int
    let makkahNights: Int
    let madinahNights: Int
    let makkahCheckIn: String
    let makkahCheckOut: String
    let madinahCheckIn: String?
    let madinahCheckOut: String?
    let hotelReadyAt: String?
    let leaveHotelAt: String?
    let earlyArrivalNight: Bool
}

struct PackageQuote: Hashable, Codable {
    let totalPackagePrice: Decimal
    let pricePerPerson: Decimal
    let currency: String
    let isEstimated: Bool
    let quoteId: String?
    /// Opaque server-encrypted proof containing the confidential generator report.
    /// It is intentionally unreadable by iOS/Android/Web and is submitted only
    /// after a real booking exists so PackageEngine can persist the Business audit.
    let quoteProof: String?
    let stayPlan: PackageStayPlan?
    var bookingAllowed: Bool? = nil
    var resolvedTier: String? = nil
    var tripSummary: TripSummaryPublicPrice? = nil
    var roomPolicy: TripSummaryRoomPolicy? = nil
    var itineraryPreview: [PackageItineraryPreviewItem]? = nil
    init(
        totalPackagePrice: Decimal,
        pricePerPerson: Decimal,
        currency: String,
        isEstimated: Bool,
        quoteId: String?,
        quoteProof: String? = nil,
        stayPlan: PackageStayPlan? = nil
    ) {
        self.totalPackagePrice = totalPackagePrice
        self.pricePerPerson = pricePerPerson
        self.currency = currency
        self.isEstimated = isEstimated
        self.quoteId = quoteId
        self.quoteProof = quoteProof
        self.stayPlan = stayPlan
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

struct TripSummaryPublicPrice: Codable, Hashable {
    struct Component: Codable, Hashable, Identifiable {
        var id: String { code }
        let code: String
        let label: String
        let amountUsd: Decimal
        let cancellationPolicy: String?
    }
    let version: String
    let currency: String
    let components: [Component]
    let servicesSubtotalUsd: Decimal
    let supportRate: Decimal
    let supportAmountUsd: Decimal
    let paymentRate: Decimal
    let paymentAmountUsd: Decimal
    let roundingUsd: Decimal
    let totalUsd: Decimal
    let perPilgrimUsd: Decimal

    func reconciles(with total: Decimal) -> Bool {
        func cents(_ value: Decimal) -> Decimal {
            var scaled = value * 100, rounded = Decimal.zero
            NSDecimalRound(&rounded, &scaled, 0, .plain)
            return rounded
        }
        guard version == "trip-summary-v2", currency == "USD", supportRate == Decimal(string: "0.09"), paymentRate == Decimal(string: "0.02"),
              !components.isEmpty, Set(components.map(\.code)).count == components.count,
              components.allSatisfy({ $0.amountUsd >= 0 }) else { return false }
        return cents(totalUsd) == cents(total) &&
            components.reduce(Decimal.zero) { $0 + cents($1.amountUsd) } == cents(servicesSubtotalUsd) &&
            cents(servicesSubtotalUsd) + cents(supportAmountUsd) + cents(paymentAmountUsd) + cents(roundingUsd) == cents(totalUsd) &&
            cents(servicesSubtotalUsd * supportRate) == cents(supportAmountUsd) && cents(totalUsd * paymentRate) == cents(paymentAmountUsd)
    }
}


struct TripSummaryRoomPolicy: Codable, Hashable {
    let minimumRooms: Int
    let requiresAdultException: Bool
}

// Quote preview carries no booking identity or private supplier costs.
struct PackageItineraryPreviewItem: Codable, Hashable {
    let id: String
    let dateLocal: String
    let title: String
    let subtitle: String
    let icon: String
    let location: String
    let timeLocal: String?
    let endTimeLocal: String?
    let kind: String?
}

// Presentation-only grouping. Financial values are still the server's exact line amounts.
enum TripReviewPriceGrouping {
    struct Group: Identifiable {
        let key: String
        let representative: TripSummaryPublicPrice.Component
        var amount: Decimal
        var id: String { key }
    }
    static func groups(_ components: [TripSummaryPublicPrice.Component]) -> [Group] {
        var result: [Group] = []
        for component in components {
            let groupKey = key(component.code)
            if let index = result.firstIndex(where: { $0.key == groupKey }) { result[index].amount += component.amountUsd }
            else { result.append(Group(key: groupKey, representative: component, amount: component.amountUsd)) }
        }
        return result
    }
    static func key(_ code: String) -> String {
        if code.hasPrefix("flight_") { return "flights" }
        if code == "meals" || code.hasPrefix("meal_") { return "meals" }
        if code.hasPrefix("ziyarat_") { return "ziyarats" }
        if code == "transfers" || code == "vip_transfer_upgrade" { return "transfer" }
        return code
    }
}
