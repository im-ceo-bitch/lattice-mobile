import Foundation

private func cleanCuratedID(_ value: String?) -> String? {
    guard let value else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

struct CuratedPublishedFlightSelection: Hashable {
    let completeID: String?
    let outboundID: String?
    let returnID: String?

    init(completeID: String? = nil, outboundID: String? = nil, returnID: String? = nil) {
        self.completeID = cleanCuratedID(completeID)
        self.outboundID = cleanCuratedID(outboundID)
        self.returnID = cleanCuratedID(returnID)
    }

    var isComplete: Bool {
        completeID != nil || (outboundID != nil && returnID != nil)
    }
}

private struct CuratedPublishedFlightResolveRequest: Encodable {
    let completeID: String?
    let outboundID: String?
    let returnID: String?
    let travelerCount: Int
    let origin: String
    let outboundDestination: String
    let returnOrigin: String
    let returnDestination: String
}

private struct CuratedPublishedFlightResolveResponse: Decodable {
    struct ResolvedLeg: Decodable {
        let id: String
        let airline: String
        let flightNumber: String
        let airlineCode: String?
        let origin: String
        let destination: String
        let departureAt: String
        let arrivalAt: String
        let durationMinutes: Int
        let cabinClass: String?
    }

    let ok: Bool
    let resolvedAt: String
    let currency: String
    let totalFare: Decimal
    let fareScope: String
    let providerItineraryID: String
    let sourceName: String
    let outbound: ResolvedLeg
    let inbound: ResolvedLeg
}

@MainActor
final class CuratedFlightRecommendationService {
    static let shared = CuratedFlightRecommendationService()
    private let api = APIClient.shared
    private struct CatalogueCache { let rows: [CuratedFlightRecommendation]; let fetched: Date }
    private var catalogueCache: [String: CatalogueCache] = [:]
    private var catalogueRequests: [String: Task<[CuratedFlightRecommendation], Error>] = [:]

    private init() {}

    /// Loads every staff-published direct Umrah option connected to the departure
    /// airport. The service stays origin-wide so route changes do not require a
    /// different data contract; TripBuilder applies the pilgrim's exact JED/MED
    /// route criteria before any card is shown or selected.
    func load(trip: TripDraft, from: Date = Date(), days: Int = 365, force: Bool = false) async throws -> [CuratedFlightRecommendation] {
        let key = "\(trip.originCode.uppercased()):\(Self.requestDay(from)):\(max(1, min(days, 365)))"
        if let running = catalogueRequests[key] { return try await running.value }
        if !force, let cached = catalogueCache[key], Date().timeIntervalSince(cached.fetched) < 300 { return cached.rows }
        let task = Task { @MainActor in try await self.loadUncached(trip: trip, from: from, days: days) }
        catalogueRequests[key] = task
        defer { catalogueRequests[key] = nil }
        let result = try await task.value
        catalogueCache = catalogueCache.filter { Date().timeIntervalSince($0.value.fetched) < 300 }
        catalogueCache[key] = .init(rows: result, fetched: Date())
        return result
    }

    private func loadUncached(trip: TripDraft, from: Date, days: Int) async throws -> [CuratedFlightRecommendation] {
        let calendar = Calendar(identifier: .gregorian)
        let start = calendar.startOfDay(for: from)
        let end = calendar.date(byAdding: .day, value: max(1, min(days, 365)), to: start) ?? start

        let fromKey = Self.requestDay(start)
        let toKey = Self.requestDay(end)

        // Read both public D1 projections and merge them. Do not return early from
        // /recommendations: during staged backend deployments one projection can be
        // older or partially filtered while the other already contains the staff-
        // published row. A single non-empty stale response must never hide the rest
        // of the Business catalogue from the client.
        var merged: [String: CuratedFlightRecommendation] = [:]
        var firstError: Error?

        do {
            let response: CuratedFlightRecommendationsResponse = try await api.get(
                "/api/package/flights/recommendations",
                query: [
                    URLQueryItem(name: "umrah_origin", value: trip.originCode.uppercased()),
                    URLQueryItem(name: "from", value: fromKey),
                    URLQueryItem(name: "to", value: toKey)
                ],
                timeoutInterval: 10
            )
            if response.ok {
                for item in response.recommendations where item.nonstop {
                    merged[item.id] = item
                }
            }
        } catch {
            firstError = error
        }

        do {
            let fallback = try await storefrontFallback(
                origin: trip.originCode.uppercased(),
                fromKey: fromKey,
                toKey: toKey
            )
            for item in fallback where item.nonstop {
                // The recommendations projection has richer canonical metadata, so
                // keep it when both endpoints describe the same publication.
                if var existing = merged[item.id] {
                    existing.fareUsdPerTraveler = existing.fareUsdPerTraveler ?? item.fareUsdPerTraveler
                    merged[item.id] = existing
                } else { merged[item.id] = item }
            }
        } catch {
            if firstError == nil { firstError = error }
        }

        if !merged.isEmpty {
            return merged.values.sorted { lhs, rhs in
                if lhs.outboundDate != rhs.outboundDate { return lhs.outboundDate < rhs.outboundDate }
                return lhs.id < rhs.id
            }
        }
        if let firstError { throw firstError }
        return []
    }

    private func storefrontFallback(origin: String, fromKey: String, toKey: String) async throws -> [CuratedFlightRecommendation] {
        let board = try await HotelStorefrontService().flightBoard(origin: origin)
        guard board.ok else { return [] }

        return board.options.compactMap { option in
            let outboundDate = String(option.outbound.departureAt.prefix(10))
            guard outboundDate >= fromKey, outboundDate <= toKey else { return nil }

            let inboundDate = option.inbound.map { String($0.departureAt.prefix(10)) }
            let outbound = Self.curatedLeg(option.outbound)
            let inbound = option.inbound.map(Self.curatedLeg)
            let isOneWay = inbound == nil

            let role: String
            if isOneWay {
                if option.outbound.origin.uppercased() == origin {
                    role = "outbound"
                } else if option.outbound.destination.uppercased() == origin {
                    role = "return"
                } else {
                    return nil
                }
            } else {
                guard option.outbound.origin.uppercased() == origin,
                      option.inbound?.destination.uppercased() == origin else { return nil }
                role = "complete"
            }

            let codes = [option.outbound.airlineCode, option.inbound?.airlineCode]
                .compactMap { value -> String? in
                    guard let value else { return nil }
                    let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
                    return clean.isEmpty ? nil : clean
                }
            let names = [option.outbound.airline, option.inbound?.airline]
                .compactMap { value -> String? in
                    guard let value else { return nil }
                    let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
                    return clean.isEmpty ? nil : clean
                }
            let numbers = [option.outbound.flightNumber, option.inbound?.flightNumber]
                .compactMap { value -> String? in
                    guard let value else { return nil }
                    let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
                    return clean.isEmpty ? nil : clean
                }

            return CuratedFlightRecommendation(
                id: option.id,
                outboundDate: outboundDate,
                inboundDate: inboundDate,
                cabinClass: option.outbound.cabinClass,
                airlineCodes: Array(Set(codes)),
                airlineNames: Array(Set(names)),
                flightNumbers: numbers,
                observedAt: option.observedAt,
                outbound: outbound,
                inbound: inbound,
                nonstop: option.outbound.stops == 0 && (option.inbound?.stops ?? 0) == 0,
                recommendationLabel: "iumrah recommends",
                offerType: isOneWay ? "one_way" : "paired_one_way",
                journeyRole: role,
                fareUsdPerTraveler: option.currency.uppercased() == "USD" && option.perTravelerFare.isFinite && option.perTravelerFare > 0 ? option.perTravelerFare : nil
            )
        }
    }

    private static func curatedLeg(_ leg: StorefrontFlightLeg) -> CuratedFlightRecommendation.Leg {
        CuratedFlightRecommendation.Leg(
            airline: leg.airline,
            flightNumber: leg.flightNumber,
            airlineCode: leg.airlineCode,
            origin: leg.origin,
            destination: leg.destination,
            departureAt: leg.departureAt,
            arrivalAt: leg.arrivalAt,
            durationMinutes: leg.durationMinutes,
            stops: leg.stops,
            cabinClass: leg.cabinClass
        )
    }

    /// Resolves the already-selected published direct flight into the same verified
    /// FlightOffer contract used by the normal Generator. This endpoint reads D1 only;
    /// it deliberately does not call Ignav again.
    func resolvePublishedSelection(
        trip: TripDraft,
        selection: CuratedPublishedFlightSelection
    ) async throws -> (outbound: FlightOffer, inbound: FlightOffer) {
        guard selection.isComplete else { throw APIError.invalidResponse }

        let response: CuratedPublishedFlightResolveResponse = try await api.post(
            "/api/package/flights/recommendations/resolve",
            body: CuratedPublishedFlightResolveRequest(
                completeID: selection.completeID,
                outboundID: selection.outboundID,
                returnID: selection.returnID,
                travelerCount: trip.travelerCount,
                origin: trip.originCode,
                outboundDestination: trip.outboundDestinationCode,
                returnOrigin: trip.returnOriginCode,
                returnDestination: trip.originCode
            ),
            timeoutInterval: 12
        )
        guard response.ok,
              let observedAt = Self.instant(response.resolvedAt),
              response.totalFare > 0 else { throw APIError.invalidResponse }

        let fareScope: FlightFareScope = response.fareScope == "perPassenger" ? .perPassenger : .totalParty
        let outboundCandidate = try candidate(
            response.outbound,
            direction: .outbound,
            response: response,
            observedAt: observedAt,
            fareScope: fareScope
        )
        let inboundCandidate = try candidate(
            response.inbound,
            direction: .inbound,
            response: response,
            observedAt: observedAt,
            fareScope: fareScope
        )

        let outbound = FlightOffer(
            id: "published:outbound:\(response.providerItineraryID)",
            direction: .outbound,
            airline: outboundCandidate.airline,
            flightNumber: outboundCandidate.flightNumber,
            origin: outboundCandidate.origin,
            destination: outboundCandidate.destination,
            departureAt: outboundCandidate.departureAt,
            arrivalAt: outboundCandidate.arrivalAt,
            stops: outboundCandidate.stops,
            durationMinutes: outboundCandidate.durationMinutes,
            totalPackagePrice: response.totalFare,
            currency: response.currency,
            sourceLabel: response.sourceName,
            packageTotalPrice: response.totalFare,
            sourceCandidateID: outboundCandidate.id,
            airlineCode: outboundCandidate.airlineCode,
            segments: outboundCandidate.segments,
            connectionAirports: outboundCandidate.connectionAirports,
            fareAmount: response.totalFare,
            fareScope: fareScope,
            fareObservedAt: observedAt,
            providerItineraryID: response.providerItineraryID,
            cabinClass: outboundCandidate.cabinClass,
            requiresSelfTransfer: false,
            pairedLeg: FlightPairedLeg(candidate: inboundCandidate)
        )

        let inbound = FlightOffer(
            id: "published:inbound:\(response.providerItineraryID)",
            direction: .inbound,
            airline: inboundCandidate.airline,
            flightNumber: inboundCandidate.flightNumber,
            origin: inboundCandidate.origin,
            destination: inboundCandidate.destination,
            departureAt: inboundCandidate.departureAt,
            arrivalAt: inboundCandidate.arrivalAt,
            stops: inboundCandidate.stops,
            durationMinutes: inboundCandidate.durationMinutes,
            totalPackagePrice: response.totalFare,
            currency: response.currency,
            sourceLabel: response.sourceName,
            packageTotalPrice: response.totalFare,
            sourceCandidateID: inboundCandidate.id,
            airlineCode: inboundCandidate.airlineCode,
            segments: inboundCandidate.segments,
            connectionAirports: inboundCandidate.connectionAirports,
            fareAmount: response.totalFare,
            fareScope: fareScope,
            fareObservedAt: observedAt,
            providerItineraryID: response.providerItineraryID,
            cabinClass: inboundCandidate.cabinClass,
            requiresSelfTransfer: false,
            pairedLeg: FlightPairedLeg(candidate: outboundCandidate)
        )

        guard outbound.isVerifiedForBooking, inbound.isVerifiedForBooking else {
            throw APIError.invalidResponse
        }
        return (outbound, inbound)
    }

    private func candidate(
        _ leg: CuratedPublishedFlightResolveResponse.ResolvedLeg,
        direction: FlightDirection,
        response: CuratedPublishedFlightResolveResponse,
        observedAt: Date,
        fareScope: FlightFareScope
    ) throws -> LiveFlightCandidate {
        guard let departure = Self.instant(leg.departureAt),
              let arrival = Self.instant(leg.arrivalAt),
              departure < arrival else { throw APIError.invalidResponse }

        // Published recommendations are direct by contract. A single normalized
        // segment is sufficient for the same booking-safety gate as Ignav results.
        let segment = FlightSegment(
            id: "published-segment:\(leg.id)",
            airline: leg.airline,
            airlineCode: leg.airlineCode,
            flightNumber: leg.flightNumber,
            origin: FlightAirportSnapshot(code: leg.origin),
            destination: FlightAirportSnapshot(code: leg.destination),
            departureAt: departure,
            arrivalAt: arrival,
            durationMinutes: leg.durationMinutes,
            cabin: leg.cabinClass
        )

        let candidate = LiveFlightCandidate(
            id: "published:\(direction.rawValue):\(leg.id)",
            sourceID: "iumrah-published",
            sourceName: response.sourceName,
            direction: direction,
            airline: leg.airline,
            flightNumber: leg.flightNumber,
            origin: leg.origin,
            destination: leg.destination,
            departureAt: departure,
            arrivalAt: arrival,
            stops: 0,
            durationMinutes: leg.durationMinutes,
            observedFare: response.totalFare,
            observedCurrency: response.currency,
            fareScope: fareScope,
            observedAt: observedAt,
            rawFingerprint: response.providerItineraryID,
            airlineCode: leg.airlineCode,
            segments: [segment],
            connectionAirports: nil,
            providerItineraryID: response.providerItineraryID,
            cabinClass: leg.cabinClass,
            requiresSelfTransfer: false
        )
        guard candidate.isDisplayableCandidate else { throw APIError.invalidResponse }
        return candidate
    }

    private static func requestDay(_ date: Date) -> String {
        let components = Calendar.current.dateComponents([.year, .month, .day], from: date)
        guard let year = components.year, let month = components.month, let day = components.day else {
            return Self.day.string(from: date)
        }
        return String(format: "%04d-%02d-%02d", year, month, day)
    }

    static let day: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func date(_ string: String?) -> Date? {
        guard let string else { return nil }
        return day.date(from: string)
    }

    private static func instant(_ string: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let value = fractional.date(from: string) { return value }
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: string)
    }
}
