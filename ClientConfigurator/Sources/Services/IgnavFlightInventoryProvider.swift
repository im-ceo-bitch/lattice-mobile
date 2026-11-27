import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

enum IgnavFlightProviderError: LocalizedError, Equatable {
    case invalidRequest
    case serverUnavailable
    case searchFailed

    var errorDescription: String? {
        switch self {
        case .invalidRequest: return "Параметры поиска авиабилетов заполнены некорректно."
        case .serverUnavailable: return "Сервис поиска авиабилетов временно недоступен. Повторите попытку."
        case .searchFailed: return "Не удалось получить актуальные авиабилеты. Повторите поиск."
        }
    }
}

@MainActor
final class IgnavFlightInventoryProvider: FlightInventoryProviding {
    let sourceName = "Ignav"
    private let session: URLSession
    private let maxConcurrentDatePairs = 3

    init(session: URLSession? = nil) {
        self.session = session ?? URLSession(configuration: .ephemeral, delegate: IumrahAPIOriginDelegate(), delegateQueue: nil)
    }

    func searchJourney(
        request: FlightJourneySearchRequest,
        datePairs: [FlightJourneyDatePair],
        onUpdate: @escaping @MainActor ([LiveFlightJourneyCandidate]) -> Void
    ) async throws -> [LiveFlightJourneyCandidate] {
        guard !datePairs.isEmpty else { return [] }
        let session = self.session
        var nextIndex = 0
        var merged: [LiveFlightJourneyCandidate] = []
        var firstError: Error?

        await withTaskGroup(of: JourneySearchResult.self) { group in
            func enqueue(_ pair: FlightJourneyDatePair) {
                group.addTask {
                    do {
                        let values = try await Self.fetchPair(session: session, request: request, pair: pair)
                        return JourneySearchResult(candidates: values, error: nil)
                    } catch {
                        return JourneySearchResult(candidates: [], error: error)
                    }
                }
            }

            while nextIndex < min(maxConcurrentDatePairs, datePairs.count) {
                enqueue(datePairs[nextIndex])
                nextIndex += 1
            }

            for await result in group {
                if firstError == nil, let error = result.error { firstError = error }
                if !result.candidates.isEmpty {
                    merged = Self.merge(merged, result.candidates)
                    onUpdate(merged)
                }
                if nextIndex < datePairs.count {
                    enqueue(datePairs[nextIndex])
                    nextIndex += 1
                }
            }
        }

        if merged.isEmpty, let firstError { throw firstError }
        return merged
    }

    private nonisolated static func fetchPair(
        session: URLSession,
        request: FlightJourneySearchRequest,
        pair: FlightJourneyDatePair
    ) async throws -> [LiveFlightJourneyCandidate] {
        guard let url = AppConfig.apiURL("/api/package/flights/search") else { throw IgnavFlightProviderError.invalidRequest }
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.timeoutInterval = 32
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        urlRequest.httpBody = try JSONEncoder().encode(ProxySearchBody(request: request, pair: pair))

        let (data, response) = try await session.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse else { throw IgnavFlightProviderError.serverUnavailable }
        if http.statusCode == 503,
           let error = try? JSONDecoder().decode(ProxyErrorResponse.self, from: data),
           error.error == "FLIGHT_PROVIDER_NOT_CONFIGURED" {
            throw FlightInventoryProviderError.notConfigured
        }
        guard (200..<300).contains(http.statusCode) else {
            if (500..<600).contains(http.statusCode) { throw IgnavFlightProviderError.serverUnavailable }
            throw IgnavFlightProviderError.searchFailed
        }

        let decoded = try JSONDecoder().decode(ProxySearchResponse.self, from: data)
        guard decoded.ok, decoded.source == "ignav" else { throw IgnavFlightProviderError.searchFailed }
        let observedAt = try parseISO8601(decoded.observedAt)
        return decoded.itineraries.compactMap {
            journey(from: $0, request: request, expectedPair: pair, observedAt: observedAt)
        }
    }

    private nonisolated static func journey(
        from itinerary: ProxyItinerary,
        request: FlightJourneySearchRequest,
        expectedPair: FlightJourneyDatePair,
        observedAt: Date
    ) -> LiveFlightJourneyCandidate? {
        let expectsReturn = request.inboundOrigin != nil && request.inboundDestination != nil && expectedPair.inbound != nil
        guard itinerary.price.amount > 0,
              itinerary.price.currency.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil,
              itinerary.price.status.caseInsensitiveCompare("verified") == .orderedSame,
              itinerary.legs.count == (expectsReturn ? 2 : 1),
              itinerary.fareScope == "total_party" else { return nil }

        guard let outbound = legCandidate(
            itinerary.legs[0],
            itinerary: itinerary,
            direction: .outbound,
            expectedOrigin: request.outboundOrigin,
            expectedDestination: request.outboundDestination,
            expectedDate: expectedPair.outbound,
            observedAt: observedAt
        ) else { return nil }

        let inbound: LiveFlightCandidate?
        if expectsReturn,
           let inboundOrigin = request.inboundOrigin,
           let inboundDestination = request.inboundDestination,
           let inboundDate = expectedPair.inbound {
            guard let value = legCandidate(
                itinerary.legs[1],
                itinerary: itinerary,
                direction: .inbound,
                expectedOrigin: inboundOrigin,
                expectedDestination: inboundDestination,
                expectedDate: inboundDate,
                observedAt: observedAt
            ) else { return nil }
            inbound = value
        } else {
            inbound = nil
        }

        let value = LiveFlightJourneyCandidate(
            id: "ignav:\(itinerary.ignavId)",
            sourceID: "ignav",
            sourceName: "Ignav",
            totalFare: itinerary.price.amount,
            currency: itinerary.price.currency.uppercased(),
            fareScope: .totalParty,
            observedAt: observedAt,
            providerItineraryID: itinerary.ignavId,
            outbound: outbound,
            inbound: inbound,
            baggage: itinerary.bags.map { FlightBaggageAllowance(carryOn: $0.carryOn, checked: $0.checked) },
            requiresSelfTransfer: itinerary.requiresSelfTransfer
        )
        return value.isDisplayableCandidate ? value : nil
    }

    private nonisolated static func legCandidate(
        _ leg: ProxyLeg,
        itinerary: ProxyItinerary,
        direction: FlightDirection,
        expectedOrigin: String,
        expectedDestination: String,
        expectedDate: Date,
        observedAt: Date
    ) -> LiveFlightCandidate? {
        let segments: [FlightSegment] = leg.segments.compactMap { value in
            guard let departure = try? parseISO8601(value.departureTimeUTC),
                  let arrival = try? parseISO8601(value.arrivalTimeUTC), departure < arrival,
                  value.durationMinutes > 0 else { return nil }
            let exactNumber = [value.marketingCarrierCode, value.flightNumber]
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: " ")
            return FlightSegment(
                id: "ignav:\(itinerary.ignavId):\(direction.rawValue):\(value.departureAirport):\(value.arrivalAirport):\(value.departureTimeUTC)",
                airline: value.operatingCarrierName ?? leg.airline,
                airlineCode: value.marketingCarrierCode.range(of: "^[A-Z0-9]{2}$", options: .regularExpression) != nil ? value.marketingCarrierCode : nil,
                flightNumber: exactNumber,
                origin: FlightAirportSnapshot(code: value.departureAirport, timeZoneIdentifier: value.departureTimezone),
                destination: FlightAirportSnapshot(code: value.arrivalAirport, timeZoneIdentifier: value.arrivalTimezone),
                departureAt: departure,
                arrivalAt: arrival,
                durationMinutes: value.durationMinutes,
                aircraft: value.aircraft,
                operatingCarrier: value.operatingCarrierName,
                cabin: itinerary.cabinClass
            )
        }
        guard segments.count == leg.segments.count,
              let first = segments.first, let last = segments.last,
              first.origin.code == expectedOrigin,
              last.destination.code == expectedDestination,
              leg.stops == segments.count - 1,
              leg.durationMinutes > 0,
              calendarDay(expectedDate) == calendarDay(first.departureAt, timeZoneIdentifier: first.origin.timeZoneIdentifier) else { return nil }

        for index in 1..<segments.count {
            guard segments[index - 1].destination.code == segments[index].origin.code,
                  segments[index - 1].arrivalAt <= segments[index].departureAt else { return nil }
        }

        let connections = segments.count > 1 ? segments.dropLast().map { $0.destination } : []
        let candidate = LiveFlightCandidate(
            id: "ignav:\(itinerary.ignavId):\(direction.rawValue)",
            sourceID: "ignav",
            sourceName: "Ignav",
            direction: direction,
            airline: leg.airline,
            flightNumber: leg.flightNumber,
            origin: leg.origin,
            destination: leg.destination,
            departureAt: first.departureAt,
            arrivalAt: last.arrivalAt,
            stops: leg.stops,
            durationMinutes: leg.durationMinutes,
            // Ignav price belongs to the complete itinerary returned for the
            // submitted passenger mix. In round-trip mode both leg candidates carry
            // the same trip-level fare; JourneyStore charges it exactly once.
            observedFare: itinerary.price.amount,
            observedCurrency: itinerary.price.currency,
            fareScope: .totalParty,
            observedAt: observedAt,
            sourceURL: nil,
            rawFingerprint: itinerary.ignavId,
            airlineCode: leg.airlineCode,
            segments: segments,
            connectionAirports: connections.isEmpty ? nil : connections,
            providerItineraryID: itinerary.ignavId,
            cabinClass: itinerary.cabinClass,
            baggage: itinerary.bags.map { FlightBaggageAllowance(carryOn: $0.carryOn, checked: $0.checked) },
            requiresSelfTransfer: itinerary.requiresSelfTransfer
        )
        return candidate.isDisplayableCandidate ? candidate : nil
    }

    private nonisolated static func merge(_ lhs: [LiveFlightJourneyCandidate], _ rhs: [LiveFlightJourneyCandidate]) -> [LiveFlightJourneyCandidate] {
        var result = lhs
        var keys = Set(result.map { resultKey($0) })
        for value in rhs where keys.insert(resultKey(value)).inserted { result.append(value) }
        return result
    }

    /// Ignav may reuse one itinerary ID across fare/baggage variants. Collapse only
    /// byte-equivalent normalized rows so the app can surface every distinct price
    /// returned by the provider.
    private nonisolated static func resultKey(_ journey: LiveFlightJourneyCandidate) -> String {
        let fare = NSDecimalNumber(decimal: journey.totalFare).stringValue
        let departure = Int(journey.outbound.departureAt.timeIntervalSince1970)
        let arrival = Int(journey.outbound.arrivalAt.timeIntervalSince1970)
        let baggage = "\(journey.baggage?.carryOn ?? -1):\(journey.baggage?.checked ?? -1)"
        let transfer = journey.requiresSelfTransfer.map { $0 ? "self" : "protected" } ?? "unknown"
        return [journey.providerItineraryID, fare, journey.currency.uppercased(), String(departure), String(arrival), baggage, transfer]
            .joined(separator: "|")
            .lowercased()
    }

    private nonisolated static func parseISO8601(_ value: String) throws -> Date {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        if let date = standard.date(from: value) { return date }
        throw IgnavFlightProviderError.searchFailed
    }

    private nonisolated static func calendarDay(_ date: Date, timeZoneIdentifier: String? = nil) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        if let timeZoneIdentifier, let timeZone = TimeZone(identifier: timeZoneIdentifier) {
            formatter.timeZone = timeZone
        } else {
            formatter.timeZone = .current
        }
        return formatter.string(from: date)
    }
}

private struct JourneySearchResult: Sendable {
    let candidates: [LiveFlightJourneyCandidate]
    let error: Error?
}

private struct ProxySearchBody: Encodable, Sendable {
    let legs: [ProxySearchLeg]
    let adults: Int
    let children: Int
    let infantsInSeat: Int
    let infantsOnLap: Int
    let cabinClass: String
    let minCarryOnBags: Int?
    let minCheckedBags: Int?
    let maxPrice: Int?
    let airlinesInclude: [String]?
    let airlinesExclude: [String]?
    let allowSelfTransfer: Bool

    init(request: FlightJourneySearchRequest, pair: FlightJourneyDatePair) {
        let filters = request.filters
        var requestedLegs = [
            ProxySearchLeg(origin: request.outboundOrigin, destination: request.outboundDestination, departureDate: Self.day(pair.outbound), maxStops: nil, departureTimeRange: nil)
        ]
        if let inboundOrigin = request.inboundOrigin,
           let inboundDestination = request.inboundDestination,
           let inboundDate = pair.inbound {
            requestedLegs.append(ProxySearchLeg(origin: inboundOrigin, destination: inboundDestination, departureDate: Self.day(inboundDate), maxStops: nil, departureTimeRange: nil))
        }
        legs = requestedLegs
        adults = request.adults
        children = request.children
        if filters.infantSeating == .lap {
            infantsOnLap = min(request.infants, request.adults)
            infantsInSeat = max(0, request.infants - request.adults)
        } else {
            infantsOnLap = 0
            infantsInSeat = request.infants
        }
        cabinClass = filters.cabinClass.rawValue
        // Fetch the complete provider inventory. Stops, baggage, airline and price
        // controls belong to the results screen; sending them upstream made valid
        // Ignav itineraries disappear before the pilgrim could compare them.
        minCarryOnBags = nil
        minCheckedBags = nil
        maxPrice = nil
        airlinesInclude = nil
        airlinesExclude = nil
        allowSelfTransfer = true
    }

    enum CodingKeys: String, CodingKey {
        case legs, adults, children
        case infantsInSeat = "infants_in_seat"
        case infantsOnLap = "infants_on_lap"
        case cabinClass = "cabin_class"
        case minCarryOnBags = "min_carry_on_bags"
        case minCheckedBags = "min_checked_bags"
        case maxPrice = "max_price"
        case airlinesInclude = "airlines_include"
        case airlinesExclude = "airlines_exclude"
        case allowSelfTransfer = "allow_self_transfer"
    }

    private static func day(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

private struct ProxySearchLeg: Encodable, Sendable {
    let origin: String
    let destination: String
    let departureDate: String
    let maxStops: Int?
    let departureTimeRange: ProxyTimeRange?
    enum CodingKeys: String, CodingKey {
        case origin, destination
        case departureDate = "departure_date"
        case maxStops = "max_stops"
        case departureTimeRange = "departure_time_range"
    }
}

private struct ProxyTimeRange: Encodable, Sendable {
    let earliestHour: Int?
    let latestHour: Int?
    let arrivalEarliestHour: Int?
    let arrivalLatestHour: Int?

    init?(departure: FlightTimeWindow, arrival: FlightTimeWindow) {
        earliestHour = departure.hours?.lowerBound
        latestHour = departure.hours?.upperBound
        arrivalEarliestHour = arrival.hours?.lowerBound
        arrivalLatestHour = arrival.hours?.upperBound
        if earliestHour == nil, latestHour == nil, arrivalEarliestHour == nil, arrivalLatestHour == nil { return nil }
    }

    enum CodingKeys: String, CodingKey {
        case earliestHour = "earliest_hour"
        case latestHour = "latest_hour"
        case arrivalEarliestHour = "arrival_earliest_hour"
        case arrivalLatestHour = "arrival_latest_hour"
    }
}

private struct ProxyErrorResponse: Decodable { let error: String }
private struct ProxySearchResponse: Decodable {
    let ok: Bool
    let source: String
    let observedAt: String
    let itineraries: [ProxyItinerary]
    enum CodingKeys: String, CodingKey { case ok, source, itineraries; case observedAt = "observed_at" }
}
private struct ProxyPrice: Decodable { let amount: Decimal; let currency: String; let status: String }
private struct ProxyBags: Decodable {
    let carryOn: Int?
    let checked: Int?
    enum CodingKeys: String, CodingKey { case carryOn = "carry_on"; case checked }
}
private struct ProxySegment: Decodable {
    let marketingCarrierCode: String
    let flightNumber: String
    let operatingCarrierName: String?
    let departureAirport: String
    let departureTimeLocal: String
    let departureTimezone: String?
    let departureTimeUTC: String
    let arrivalAirport: String
    let arrivalTimeLocal: String
    let arrivalTimezone: String?
    let arrivalTimeUTC: String
    let durationMinutes: Int
    let aircraft: String?
    enum CodingKeys: String, CodingKey {
        case marketingCarrierCode = "marketing_carrier_code"
        case flightNumber = "flight_number"
        case operatingCarrierName = "operating_carrier_name"
        case departureAirport = "departure_airport"
        case departureTimeLocal = "departure_time_local"
        case departureTimezone = "departure_timezone"
        case departureTimeUTC = "departure_time_utc"
        case arrivalAirport = "arrival_airport"
        case arrivalTimeLocal = "arrival_time_local"
        case arrivalTimezone = "arrival_timezone"
        case arrivalTimeUTC = "arrival_time_utc"
        case durationMinutes = "duration_minutes"
        case aircraft
    }
}
private struct ProxyLeg: Decodable {
    let airline: String
    let flightNumber: String
    let airlineCode: String
    let origin: String
    let destination: String
    let departureAt: String
    let arrivalAt: String
    let durationMinutes: Int
    let stops: Int
    let cabinClass: String?
    let segments: [ProxySegment]
    enum CodingKeys: String, CodingKey {
        case airline, origin, destination, stops, segments
        case flightNumber = "flight_number"
        case airlineCode = "airline_code"
        case departureAt = "departure_at"
        case arrivalAt = "arrival_at"
        case durationMinutes = "duration_minutes"
        case cabinClass = "cabin_class"
    }
}
private struct ProxyItinerary: Decodable {
    let price: ProxyPrice
    let legs: [ProxyLeg]
    let cabinClass: String?
    let bags: ProxyBags?
    let requiresSelfTransfer: Bool?
    let fareScope: String
    let ignavId: String
    enum CodingKeys: String, CodingKey {
        case price, legs, bags
        case cabinClass = "cabin_class"
        case requiresSelfTransfer = "requires_self_transfer"
        case fareScope = "fare_scope"
        case ignavId = "ignav_id"
    }
}
