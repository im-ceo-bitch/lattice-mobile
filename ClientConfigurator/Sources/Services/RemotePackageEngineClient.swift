import Foundation

/// Thin client for the authoritative configurator inside iumrah-backend.
/// Never calculate selling prices or expose internal supplier cost here.
struct RemotePackageEngineClient {
    private let api = APIClient.shared

    func manualEstimate(_ body: IumrahManualEstimateRequest) async throws -> IumrahManualEstimate {
        let response: IumrahManualEstimateEnvelope = try await APIClient.hotelPrices.post("/api/package/estimate", body: body, timeoutInterval: 120)
        guard response.ok, response.estimate.bookingAllowed == false, response.estimate.currency == "USD",
              response.estimate.totalPackagePrice > 0, response.estimate.pricePerPerson > 0 else { throw APIError.invalidResponse }
        return response.estimate
    }

    func health() async throws -> PackageEngineHealthResponse {
        try await api.get(AppConfig.packageHealthPath, timeoutInterval: 8)
    }

    func roomCategories(hotelID: String) async throws -> [IumrahRoomCategoryOption] {
        let response: HotelRoomCategoriesResponse = try await api.get(
            "/api/package/hotel/\(hotelID)/room-categories"
        )
        return response.categories.sorted { $0.position < $1.position }
    }

    func hotelPricingSources(hotelID: String) async throws -> [HotelPricingSourceIdentity] {
        let response: HotelPricingSourcesResponse = try await api.get(
            "/api/package/hotel/\(hotelID)/pricing-sources", timeoutInterval: 10
        )
        return response.ok ? response.sources : []
    }

    func primaryHotel(tier: PackageTier, stars: Int, city: String) async throws -> PrimaryHotelResolutionResponse {
        try await api.get(
            "/api/package/primary-hotel",
            query: [
                URLQueryItem(name: "tier", value: tier.rawValue),
                URLQueryItem(name: "stars", value: String(stars)),
                URLQueryItem(name: "city", value: city)
            ]
        )
    }


    func packageQuote(
        trip: TripDraft,
        pricingOffer: FlightOffer,
        outboundOffer: FlightOffer,
        inboundOffer: FlightOffer?,
        makkahHotelID: String,
        makkahRoomID: String?,
        madinahHotelID: String?,
        madinahRoomID: String?,
        includeHaramainTrain: Bool,
        transferVehicle: TransferVehicleKind?,
        haramainFareClass: HaramainFareClass,
        haramainTicketCount: Int,
        makkahNightsOverride: Int? = nil,
        madinahNightsOverride: Int? = nil,
        nuiteeRooms: [BookingNuiteeRoomSelection]? = nil,
        packageApprovalHeaders: [String:String] = [:]
    ) async throws -> PackageQuote {
        let rawProviderItineraryID = pricingOffer.providerItineraryID?.trimmingCharacters(in: .whitespacesAndNewlines)
        let providerItineraryID: String
        if let rawProviderItineraryID, rawProviderItineraryID.hasPrefix("curated:") {
            providerItineraryID = rawProviderItineraryID
        } else if pricingOffer.sourceLabel == "iumrah Flights Scanner",
                  let outboundID = outboundOffer.sourceCandidateID?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !outboundID.isEmpty,
                  let inboundID = inboundOffer?.sourceCandidateID?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !inboundID.isEmpty {
            // Storefront rows are published Business offer ids. Combine the exact two
            // selected rows into the same server-only curated fare identity used by
            // the normal generator; never trust the fare amount carried by the UI.
            providerItineraryID = outboundID == inboundID
                ? "curated:\(outboundID)"
                : "curated:\(outboundID)+\(inboundID)"
        } else if let rawProviderItineraryID, !rawProviderItineraryID.isEmpty {
            providerItineraryID = rawProviderItineraryID
        } else {
            throw LocalPricingError.invalidFlightFare
        }

        let plannedStay = TripStayPlanner.breakdown(for: trip, calendar: Calendar(identifier: .gregorian))
        let stay: TripStayBreakdown
        if let makkahNightsOverride,
           let madinahNightsOverride,
           makkahNightsOverride > 0,
           madinahNightsOverride >= 0,
           (trip.scope == .makkahAndMadinah) == (madinahNightsOverride > 0) {
            // An immutable Hotel First snapshot owns its exact city split. Preserve
            // it while the original travel window is unchanged; ordinary generator
            // trips continue using TripStayPlanner exactly as before.
            stay = TripStayBreakdown(
                totalNights: makkahNightsOverride + madinahNightsOverride,
                totalDays: makkahNightsOverride + madinahNightsOverride + 1,
                makkahNights: makkahNightsOverride,
                madinahNights: madinahNightsOverride
            )
        } else {
            stay = plannedStay
        }
        var legs: [ServerPackageQuoteRequest.Flight.Leg] = [
            .init(origin: outboundOffer.origin, destination: outboundOffer.destination, departureDate: Self.flightDay(outboundOffer))
        ]
        if trip.isRoundTripFlight {
            if let inboundOffer {
                legs.append(.init(origin: inboundOffer.origin, destination: inboundOffer.destination, departureDate: Self.flightDay(inboundOffer)))
            } else if let paired = pricingOffer.pairedLeg {
                legs.append(.init(origin: paired.origin, destination: paired.destination, departureDate: Self.flightDay(paired.departureAt, airportCode: paired.origin, segments: paired.segments)))
            } else {
                throw LocalPricingError.invalidFlightFare
            }
        }

        let infantSeating = trip.effectiveFlightFilters.infantSeating
        let infantsOnLap = infantSeating == .lap ? min(trip.infants, trip.adults) : 0
        let infantsInSeat = infantSeating == .lap ? max(0, trip.infants - trip.adults) : trip.infants
        let request = ServerPackageQuoteRequest(
            nuiteeRooms: nuiteeRooms,
            tier: trip.packageTier.rawValue,
            tripType: trip.resolvedFlightTripType.rawValue,
            includeMadinah: trip.scope == .makkahAndMadinah,
            stayPolicy: trip.hotelFirstStayPolicy == true ? "hotelFirst" : "balanced",
            travelers: .init(adults: trip.adults, children: trip.children, infants: trip.infants, rooms: trip.rooms),
            meals: .init(
                makkahLunch: trip.effectiveMealSelection.makkahLunch,
                makkahDinner: trip.effectiveMealSelection.makkahDinner,
                madinahDinner: trip.effectiveMealSelection.madinahDinner
            ),
            transferVehicle: transferVehicle?.rawValue,
            haramain: .init(enabled: includeHaramainTrain, fareClass: haramainFareClass.rawValue, ticketCount: max(0, haramainTicketCount)),
            flight: .init(
                providerItineraryId: providerItineraryID,
                cabinClass: pricingOffer.cabinClass ?? trip.effectiveFlightFilters.cabinClass.rawValue,
                infantsInSeat: infantsInSeat,
                infantsOnLap: infantsOnLap,
                legs: legs
            ),
            hotels: .init(
                makkah: .init(hotelId: makkahHotelID, roomId: makkahRoomID, nights: stay.makkahNights),
                madinah: trip.scope == .makkahAndMadinah ? madinahHotelID.map { .init(hotelId: $0, roomId: madinahRoomID, nights: stay.madinahNights) } : nil
            )
        )
        let response: ServerPackageQuoteEnvelope = try await APIClient.hotelPrices.post(
            "/api/package/quote",
            body: request,
            headers: packageApprovalHeaders,
            timeoutInterval: 180
        )
        guard response.ok else { throw APIError.invalidResponse }
        let quote = response.quote.publicQuote
        guard quote.totalPackagePrice > 0, quote.pricePerPerson > 0,
              quote.quoteId?.hasPrefix("server-") == true,
              quote.quoteProof?.isEmpty == false, quote.currency == "USD" else {
            throw APIError.server(502, "PACKAGE_QUOTE_INVALID")
        }
        // An older deployed worker can still return a total, but not the new retail
        // breakdown. Keep the signed total visible; the review will offer a refresh.
        if let price = quote.tripSummary, !price.reconciles(with: quote.totalPackagePrice) {
            throw APIError.server(502, "PACKAGE_PRICE_BREAKDOWN_INVALID")
        }
        return quote
    }

    func commitPricingReport(bookingID: String, bookingToken: String, quoteProof: String) async throws {
        let response: QuoteCommitResponse = try await api.post(
            "/api/package/quote/commit/\(bookingID)",
            body: QuoteCommitBody(quoteProof: quoteProof),
            headers: ["x-booking-token": bookingToken],
            timeoutInterval: 12
        )
        guard response.ok else { throw APIError.invalidResponse }
    }

    private static func flightDay(_ offer: FlightOffer) -> String {
        flightDay(offer.departureAt, airportCode: offer.origin, segments: offer.segments)
    }

    private static func flightDay(_ date: Date, airportCode: String, segments: [FlightSegment]?) -> String {
        let timeZoneIdentifier = segments?.first?.origin.timeZoneIdentifier
            ?? FlightReferenceCatalog.airport(airportCode)?.timeZoneIdentifier
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZoneIdentifier.flatMap(TimeZone.init(identifier:)) ?? TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

private struct ServerPackageQuoteEnvelope: Decodable {
    let ok: Bool
    let quote: ServerPackageQuote
}

private struct ServerPackageQuote: Decodable {
    let totalPackagePrice: Decimal
    let pricePerPerson: Decimal
    let currency: String
    let isEstimated: Bool
    let quoteId: String
    let quoteProof: String
    let stayPlan: PackageStayPlan?
    let bookingAllowed: Bool?
    let resolvedTier: String?
    let tripSummary: TripSummaryPublicPrice?
    let roomPolicy: TripSummaryRoomPolicy?
    let itineraryPreview: [PackageItineraryPreviewItem]?

    private enum CodingKeys: String, CodingKey { case totalPackagePrice, pricePerPerson, currency, isEstimated, quoteId, quoteProof, stayPlan, bookingAllowed, resolvedTier, tripSummary, roomPolicy, itineraryPreview }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        totalPackagePrice = try c.decode(Decimal.self, forKey: .totalPackagePrice)
        pricePerPerson = try c.decode(Decimal.self, forKey: .pricePerPerson)
        currency = try c.decode(String.self, forKey: .currency)
        isEstimated = try c.decode(Bool.self, forKey: .isEstimated)
        quoteId = try c.decode(String.self, forKey: .quoteId)
        quoteProof = try c.decode(String.self, forKey: .quoteProof)
        stayPlan = try c.decodeIfPresent(PackageStayPlan.self, forKey: .stayPlan)
        bookingAllowed = try c.decodeIfPresent(Bool.self, forKey: .bookingAllowed)
        resolvedTier = try c.decodeIfPresent(String.self, forKey: .resolvedTier)
        tripSummary = try c.decodeIfPresent(TripSummaryPublicPrice.self, forKey: .tripSummary)
        roomPolicy = try c.decodeIfPresent(TripSummaryRoomPolicy.self, forKey: .roomPolicy)
        // A malformed optional calendar must not discard a verified financial quote.
        itineraryPreview = try? c.decodeIfPresent([PackageItineraryPreviewItem].self, forKey: .itineraryPreview)
    }

    var publicQuote: PackageQuote {
        var result = PackageQuote(
            totalPackagePrice: totalPackagePrice,
            pricePerPerson: pricePerPerson,
            currency: currency,
            isEstimated: isEstimated,
            quoteId: quoteId,
            quoteProof: quoteProof,
            stayPlan: stayPlan
        )
        result.bookingAllowed = bookingAllowed
        result.resolvedTier = resolvedTier
        result.tripSummary = tripSummary
        result.roomPolicy = roomPolicy
        result.itineraryPreview = itineraryPreview
        return result
    }
}

private struct ServerPackageQuoteRequest: Encodable {
    let nuiteeRooms: [BookingNuiteeRoomSelection]?
    struct Travelers: Encodable { let adults: Int; let children: Int; let infants: Int; let rooms: Int }
    struct Meals: Encodable { let makkahLunch: Bool; let makkahDinner: Bool; let madinahDinner: Bool }
    struct Haramain: Encodable { let enabled: Bool; let fareClass: String; let ticketCount: Int }
    struct Flight: Encodable {
        struct Leg: Encodable { let origin: String; let destination: String; let departureDate: String }
        let providerItineraryId: String
        let cabinClass: String
        let infantsInSeat: Int
        let infantsOnLap: Int
        let legs: [Leg]
    }
    struct Hotel: Encodable { let hotelId: String; let roomId: String?; let nights: Int }
    struct Hotels: Encodable { let makkah: Hotel; let madinah: Hotel? }

    let tier: String
    let tripType: String
    let includeMadinah: Bool
    let stayPolicy: String
    let travelers: Travelers
    let meals: Meals
    let transferVehicle: String?
    let haramain: Haramain
    let flight: Flight
    let hotels: Hotels
}

private struct QuoteCommitBody: Encodable { let quoteProof: String }
private struct QuoteCommitResponse: Decodable { let ok: Bool; let bookingID: String?; let quoteId: String?; let pricingVersion: String? }
