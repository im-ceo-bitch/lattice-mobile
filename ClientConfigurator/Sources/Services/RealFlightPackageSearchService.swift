import Foundation

enum FlightEngineAvailabilityError: LocalizedError, Equatable {
    case flightProviderNotConfigured
    case realOutboundRequired
    case noVerifiedFlights

    var errorDescription: String? {
        switch self {
        case .flightProviderNotConfigured: return "Flight API is not connected yet."
        case .realOutboundRequired: return "Return search requires a verified outbound flight."
        case .noVerifiedFlights: return "No verified flights were returned by the flight provider."
        }
    }
}

/// Expedia-packages style flight coordinator.
///
/// Round-trip UX is still sequential (choose outbound, then choose return), but fare
/// discovery is NOT two separately purchased one-way tickets. Ignav receives both
/// ordered legs in one request and returns one trip-level fare for each complete
/// itinerary. This is critical for international pricing where two one-way tickets
/// can be materially more expensive than the airline's return/open-jaw fare.
///
/// Outbound screen: one row per physical outbound leg using the cheapest compatible
/// complete itinerary. Return screen: only return legs compatible with that outbound,
/// each carrying the exact complete-itinerary fare for the selected pair.
@MainActor
final class RealFlightPackageSearchService: FlightSearchServicing, GeneratorComponentProviding {
    private let flightProvider: FlightInventoryProviding
    private let hotelCatalogService: HotelCatalogServicing

    private var activeSignature: String?
    private var cachedJourneys: [LiveFlightJourneyCandidate] = []
    private var cachedHotels: HotelPriceSearchSnapshot?

    init() {
        self.flightProvider = IgnavFlightInventoryProvider()
        self.hotelCatalogService = HotelCatalogService()
    }

    init(flightProvider: FlightInventoryProviding, hotelCatalogService: HotelCatalogServicing) {
        self.flightProvider = flightProvider
        self.hotelCatalogService = hotelCatalogService
    }

    init(flightProvider: FlightInventoryProviding) {
        self.flightProvider = flightProvider
        self.hotelCatalogService = HotelCatalogService()
    }

    var currentHotelPriceSnapshot: HotelPriceSearchSnapshot? { cachedHotels }

    func searchOutbound(trip: TripDraft, makkahHotel: HotelSummary, madinahHotel: HotelSummary?) async throws -> [FlightOffer] {
        try await searchOutboundProgressive(
            trip: trip,
            makkahHotel: makkahHotel,
            madinahHotel: madinahHotel,
            onUpdate: { _ in }
        )
    }

    func searchReturn(trip: TripDraft, makkahHotel: HotelSummary, madinahHotel: HotelSummary?, outbound: FlightOffer) async throws -> [FlightOffer] {
        try await searchReturnProgressive(
            trip: trip,
            makkahHotel: makkahHotel,
            madinahHotel: madinahHotel,
            outbound: outbound,
            onUpdate: { _ in }
        )
    }

    func searchOutboundProgressive(
        trip: TripDraft,
        makkahHotel: HotelSummary,
        madinahHotel: HotelSummary?,
        onUpdate: @escaping FlightSearchProgressHandler
    ) async throws -> [FlightOffer] {
        _ = makkahHotel
        _ = madinahHotel
        prepareForSearch(trip)
        onUpdate(.init(discoveredCandidates: [], pricedOffers: [], isSearching: true, status: .starting))
        onUpdate(.init(discoveredCandidates: [], pricedOffers: [], isSearching: true, status: .checkingAirlines))

        let request = makeJourneyRequest(trip)
        let dates = journeyDatePairs(trip)

        do {
            var live = cachedJourneys
            let final = try await flightProvider.searchJourney(request: request, datePairs: dates) { values in
                live = self.mergeJourneys(live, values)
                self.cachedJourneys = live
                let offers = self.ranked(
                    self.outboundOffers(from: live, roundTrip: trip.isRoundTripFlight),
                    anchor: trip.departureDate
                )
                onUpdate(.init(
                    discoveredCandidates: live.map(\.outbound),
                    pricedOffers: offers,
                    isSearching: true,
                    status: offers.isEmpty ? .checkingAirlines : .comparingFares
                ))
            }
            live = mergeJourneys(live, final)
            cachedJourneys = live
            let offers = ranked(outboundOffers(from: live, roundTrip: trip.isRoundTripFlight), anchor: trip.departureDate)
            onUpdate(.init(
                discoveredCandidates: live.map(\.outbound),
                pricedOffers: offers,
                isSearching: false,
                status: .continuing
            ))
            if offers.isEmpty { throw FlightEngineAvailabilityError.noVerifiedFlights }
            return offers
        } catch FlightInventoryProviderError.notConfigured {
            onUpdate(.init(discoveredCandidates: [], pricedOffers: [], isSearching: false, status: nil))
            throw FlightEngineAvailabilityError.flightProviderNotConfigured
        }
    }

    func searchReturnProgressive(
        trip: TripDraft,
        makkahHotel: HotelSummary,
        madinahHotel: HotelSummary?,
        outbound: FlightOffer,
        onUpdate: @escaping FlightSearchProgressHandler
    ) async throws -> [FlightOffer] {
        _ = makkahHotel
        _ = madinahHotel
        guard trip.isRoundTripFlight, outbound.isVerifiedForBooking else {
            throw FlightEngineAvailabilityError.realOutboundRequired
        }
        onUpdate(.init(discoveredCandidates: [], pricedOffers: [], isSearching: true, status: .starting))

        // Keep the exact complete-itinerary inventory fetched on the outbound
        // screen. Selecting a flexible-date outbound may update TripDraft's anchor
        // date; clearing the cache here would lose the provider fare that the user
        // actually selected and force an unnecessary second API search.
        var values = returnOffers(from: cachedJourneys, matching: outbound)
        if values.isEmpty {
            prepareForSearch(trip)
            onUpdate(.init(discoveredCandidates: [], pricedOffers: [], isSearching: true, status: .checkingAirlines))
            let request = makeJourneyRequest(trip)
            let dates = journeyDatePairs(trip)
            do {
                let final = try await flightProvider.searchJourney(request: request, datePairs: dates) { journeys in
                    self.cachedJourneys = self.mergeJourneys(self.cachedJourneys, journeys)
                    let offers = self.ranked(
                        self.returnOffers(from: self.cachedJourneys, matching: outbound),
                        anchor: trip.returnDate
                    )
                    let candidates = offers.compactMap { offer in
                        self.liveCandidate(from: offer)
                    }
                    onUpdate(.init(
                        discoveredCandidates: candidates,
                        pricedOffers: offers,
                        isSearching: true,
                        status: offers.isEmpty ? .checkingAirlines : .comparingFares
                    ))
                }
                cachedJourneys = mergeJourneys(cachedJourneys, final)
                values = returnOffers(from: cachedJourneys, matching: outbound)
            } catch FlightInventoryProviderError.notConfigured {
                onUpdate(.init(discoveredCandidates: [], pricedOffers: [], isSearching: false, status: nil))
                throw FlightEngineAvailabilityError.flightProviderNotConfigured
            }
        }

        let offers = ranked(values, anchor: trip.returnDate)
        onUpdate(.init(
            discoveredCandidates: offers.compactMap { liveCandidate(from: $0) },
            pricedOffers: offers,
            isSearching: false,
            status: .continuing
        ))
        if offers.isEmpty { throw FlightEngineAvailabilityError.noVerifiedFlights }
        return offers
    }

    /// Converts the server-maintained 48-hour hotel catalog cache into the legacy
    /// snapshot container used by JourneyStore. The only accepted production unit is
    /// USD per room/night. No Booking/Expedia scraping runs on the pilgrim device.
    func ensureHotelPrices(
        trip: TripDraft,
        makkahHotel: HotelSummary,
        madinahHotel: HotelSummary?,
        makkahRoomId: String?,
        makkahRoomName: String?,
        makkahRoomCapacity: Int?,
        madinahRoomId: String?,
        madinahRoomName: String?,
        madinahRoomCapacity: Int?,
        forceRefresh: Bool
    ) async -> HotelPriceSearchSnapshot {
        _ = makkahRoomCapacity
        _ = madinahRoomCapacity
        if !forceRefresh, let cachedHotels, isCompleteHotelSnapshot(cachedHotels, trip: trip) {
            return cachedHotels
        }
        if forceRefresh { cachedHotels = nil }

        let windows = TripStayPlanner.windows(for: trip, calendar: Calendar(identifier: .gregorian))
        let makkahPrice = await catalogPrice(for: makkahHotel, forceRefresh: forceRefresh)
        let madinahPrice = await catalogPrice(
            for: trip.scope == .makkahAndMadinah ? madinahHotel : nil,
            forceRefresh: forceRefresh
        )

        let makkahObservation = makeCatalogObservation(
            hotel: makkahHotel,
            city: "Makkah",
            window: windows.makkah,
            roomID: makkahRoomId,
            roomName: makkahRoomName,
            price: makkahPrice
        )

        let madinahObservation: HotelPriceObservation?
        if trip.scope == .makkahAndMadinah, let madinahHotel, let window = windows.madinah {
            madinahObservation = makeCatalogObservation(
                hotel: madinahHotel,
                city: "Madinah",
                window: window,
                roomID: madinahRoomId,
                roomName: madinahRoomName,
                price: madinahPrice
            )
        } else {
            madinahObservation = nil
        }

        let snapshot = HotelPriceSearchSnapshot(
            makkah: makkahObservation.map { [$0] } ?? [],
            madinah: madinahObservation.map { [$0] } ?? []
        )
        if isCompleteHotelSnapshot(snapshot, trip: trip) { cachedHotels = snapshot }
        return snapshot
    }

    private func catalogPrice(for hotel: HotelSummary?, forceRefresh: Bool) async -> HotelCatalogPrice? {
        guard let hotel else { return nil }
        return await catalogPrice(for: hotel, forceRefresh: forceRefresh)
    }

    private func catalogPrice(for hotel: HotelSummary, forceRefresh: Bool) async -> HotelCatalogPrice? {
        if !forceRefresh, let price = hotel.price, price.isUsableForPackage { return price }
        do {
            let detail = try await hotelCatalogService.hotelDetail(id: hotel.id)
            guard let price = detail.price, price.isUsableForPackage else { return nil }
            return price
        } catch {
            return nil
        }
    }

    private func makeCatalogObservation(
        hotel: HotelSummary,
        city: String,
        window: TripStayWindow,
        roomID: String?,
        roomName: String?,
        price: HotelCatalogPrice?
    ) -> HotelPriceObservation? {
        guard let price, price.isUsableForPackage,
              let amount = price.nightlyUSD, amount.isFinite, amount > 0,
              let fetchedAt = price.fetchedAt else { return nil }
        let expiresAt = price.expiresAt

        let provider: HotelPriceProviderID
        let sourceURL: String
        switch price.provider?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "booking", "booking.com":
            provider = .booking
            sourceURL = "https://www.booking.com"
        case "expedia", "expedia.com":
            provider = .expedia
            sourceURL = "https://www.expedia.com"
        default:
            return nil
        }

        return HotelPriceObservation(
            id: "catalog-\(hotel.id)-\(fetchedAt)",
            hotelId: hotel.id,
            hotelName: hotel.name,
            city: city,
            amount: Decimal(amount),
            currency: "USD",
            unit: .perRoomNight,
            providerId: provider,
            providerName: "\(price.providerDisplayName) · iumrah 48h cache",
            observedAt: fetchedAt,
            expiresAt: expiresAt,
            checkInDate: Self.catalogDay.string(from: window.checkIn),
            checkOutDate: Self.catalogDay.string(from: window.checkOut),
            sourceURL: sourceURL,
            roomId: roomID,
            roomName: roomName
        )
    }

    private static let catalogDay: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private func isCompleteHotelSnapshot(_ snapshot: HotelPriceSearchSnapshot, trip: TripDraft) -> Bool {
        !snapshot.makkah.isEmpty && (trip.scope != .makkahAndMadinah || !snapshot.madinah.isEmpty)
    }

    func invalidateHotelPrices() { cachedHotels = nil }

    func invalidateFlightInventory() {
        activeSignature = nil
        cachedJourneys = []
    }

    func invalidateSession() {
        activeSignature = nil
        cachedJourneys = []
        cachedHotels = nil
    }

    private func prepareForSearch(_ trip: TripDraft) {
        let signature = makeSignature(trip)
        guard activeSignature != signature else { return }
        activeSignature = signature
        cachedJourneys = []
        cachedHotels = nil
    }

    // MARK: - Expedia-style itinerary projection

    private func outboundOffers(from journeys: [LiveFlightJourneyCandidate], roundTrip: Bool) -> [FlightOffer] {
        if !roundTrip {
            return journeys.compactMap { journey in
                guard journey.inbound == nil else { return nil }
                return offer(from: journey, leg: journey.outbound, direction: .outbound, paired: nil)
            }
        }

        var bestByLeg: [String: LiveFlightJourneyCandidate] = [:]
        for journey in journeys where journey.isDisplayableCandidate && journey.inbound != nil {
            let key = journey.outbound.deduplicationKey
            if let current = bestByLeg[key] {
                if isCheaper(journey, than: current) { bestByLeg[key] = journey }
            } else {
                bestByLeg[key] = journey
            }
        }
        return bestByLeg.values.compactMap { journey in
            guard let inbound = journey.inbound else { return nil }
            return offer(
                from: journey,
                leg: journey.outbound,
                direction: .outbound,
                paired: FlightPairedLeg(candidate: inbound)
            )
        }
    }

    private func returnOffers(from journeys: [LiveFlightJourneyCandidate], matching outbound: FlightOffer) -> [FlightOffer] {
        let outboundKey = outbound.deduplicationKey
        var bestByLeg: [String: LiveFlightJourneyCandidate] = [:]
        for journey in journeys where journey.isDisplayableCandidate && journey.outbound.deduplicationKey == outboundKey {
            guard let inbound = journey.inbound else { continue }
            let key = inbound.deduplicationKey
            if let current = bestByLeg[key] {
                if isCheaper(journey, than: current) { bestByLeg[key] = journey }
            } else {
                bestByLeg[key] = journey
            }
        }
        return bestByLeg.values.compactMap { journey in
            guard let inbound = journey.inbound else { return nil }
            return offer(
                from: journey,
                leg: inbound,
                direction: .inbound,
                paired: FlightPairedLeg(candidate: journey.outbound)
            )
        }
    }

    private func isCheaper(_ lhs: LiveFlightJourneyCandidate, than rhs: LiveFlightJourneyCandidate) -> Bool {
        if lhs.currency.caseInsensitiveCompare(rhs.currency) == .orderedSame {
            return lhs.totalFare < rhs.totalFare
        }
        return lhs.observedAt > rhs.observedAt
    }

    private func offer(
        from journey: LiveFlightJourneyCandidate,
        leg: LiveFlightCandidate,
        direction: FlightDirection,
        paired: FlightPairedLeg?
    ) -> FlightOffer? {
        guard journey.isDisplayableCandidate else { return nil }
        let value = FlightOffer(
            id: "fare:\(direction.rawValue):\(journey.providerItineraryID):\(leg.deduplicationKey)",
            direction: direction,
            airline: leg.airline,
            flightNumber: leg.flightNumber,
            origin: leg.origin,
            destination: leg.destination,
            departureAt: leg.departureAt,
            arrivalAt: leg.arrivalAt,
            stops: leg.stops,
            durationMinutes: leg.durationMinutes,
            totalPackagePrice: journey.totalFare,
            currency: journey.currency,
            sourceLabel: journey.sourceName,
            packageTotalPrice: journey.totalFare,
            quoteId: nil,
            sourceCandidateID: leg.id,
            airlineCode: leg.airlineCode,
            segments: leg.segments,
            connectionAirports: leg.connectionAirports,
            fareAmount: journey.totalFare,
            fareScope: journey.fareScope,
            fareObservedAt: journey.observedAt,
            fareSourceURL: leg.sourceURL,
            providerItineraryID: journey.providerItineraryID,
            cabinClass: leg.cabinClass,
            baggage: journey.baggage ?? leg.baggage,
            requiresSelfTransfer: journey.requiresSelfTransfer ?? leg.requiresSelfTransfer,
            pairedLeg: paired
        )
        return value.isVerifiedForBooking ? value : nil
    }

    /// Only used for progressive status rendering on the return screen.
    private func liveCandidate(from offer: FlightOffer) -> LiveFlightCandidate? {
        LiveFlightCandidate(
            id: offer.sourceCandidateID ?? offer.id,
            sourceID: "ignav",
            sourceName: offer.sourceLabel,
            direction: offer.direction,
            airline: offer.airline,
            flightNumber: offer.flightNumber,
            origin: offer.origin,
            destination: offer.destination,
            departureAt: offer.departureAt,
            arrivalAt: offer.arrivalAt,
            stops: offer.stops,
            durationMinutes: offer.durationMinutes,
            observedFare: offer.fareAmount ?? offer.totalPackagePrice,
            observedCurrency: offer.currency,
            fareScope: offer.fareScope ?? .unknown,
            observedAt: offer.fareObservedAt ?? Date(),
            sourceURL: offer.fareSourceURL,
            rawFingerprint: offer.providerItineraryID,
            airlineCode: offer.airlineCode,
            segments: offer.segments,
            connectionAirports: offer.connectionAirports,
            providerItineraryID: offer.providerItineraryID,
            cabinClass: offer.cabinClass,
            baggage: offer.baggage,
            requiresSelfTransfer: offer.requiresSelfTransfer
        )
    }

    private func mergeJourneys(_ lhs: [LiveFlightJourneyCandidate], _ rhs: [LiveFlightJourneyCandidate]) -> [LiveFlightJourneyCandidate] {
        var values = lhs.filter(\.isDisplayableCandidate)
        var keys = Set(values.map { journeyResultKey($0) })
        for journey in rhs where journey.isDisplayableCandidate && keys.insert(journeyResultKey(journey)).inserted {
            values.append(journey)
        }
        return values
    }

    private func journeyResultKey(_ journey: LiveFlightJourneyCandidate) -> String {
        let fare = NSDecimalNumber(decimal: journey.totalFare).stringValue
        let outbound = journey.outbound.deduplicationKey
        let inbound = journey.inbound?.deduplicationKey ?? "-"
        let baggage = "\(journey.baggage?.carryOn ?? -1):\(journey.baggage?.checked ?? -1)"
        let transfer = journey.requiresSelfTransfer.map { $0 ? "self" : "protected" } ?? "unknown"
        return [journey.providerItineraryID, fare, journey.currency.uppercased(), outbound, inbound, baggage, transfer]
            .joined(separator: "|")
            .lowercased()
    }

    private func ranked(_ offers: [FlightOffer], anchor: Date) -> [FlightOffer] {
        offers.sorted { lhs, rhs in
            let lo = abs(dayOffset(lhs.departureAt, from: anchor))
            let ro = abs(dayOffset(rhs.departureAt, from: anchor))
            if lo != ro { return lo < ro }
            if lhs.currency == rhs.currency, lhs.totalPackagePrice != rhs.totalPackagePrice {
                return lhs.totalPackagePrice < rhs.totalPackagePrice
            }
            if lhs.stops != rhs.stops { return lhs.stops < rhs.stops }
            if lhs.durationMinutes != rhs.durationMinutes { return lhs.durationMinutes < rhs.durationMinutes }
            return lhs.departureAt < rhs.departureAt
        }
    }

    // MARK: - Ignav request construction

    private func makeJourneyRequest(_ trip: TripDraft) -> FlightJourneySearchRequest {
        FlightJourneySearchRequest(
            outboundOrigin: trip.originCode,
            outboundDestination: trip.outboundDestinationCode,
            inboundOrigin: trip.isRoundTripFlight ? trip.returnOriginCode : nil,
            inboundDestination: trip.isRoundTripFlight ? trip.originCode : nil,
            adults: trip.adults,
            children: trip.children,
            infants: trip.infants,
            cabin: trip.effectiveFlightFilters.cabinClass.rawValue,
            filters: trip.effectiveFlightFilters
        )
    }

    private func journeyDatePairs(_ trip: TripDraft) -> [FlightJourneyDatePair] {
        let outboundDates = FlightDatePlanner.dates(
            anchor: trip.departureDate,
            flexibility: trip.flexibility,
            calendar: Calendar.current
        )
        guard trip.isRoundTripFlight else {
            return outboundDates.map { FlightJourneyDatePair(outbound: $0, inbound: nil) }
        }

        // Preserve trip duration when flexible discovery is enabled instead of
        // generating a 7×7 cross product (49 billable Ignav searches).
        let calendar = Calendar.current
        let anchorOutbound = calendar.startOfDay(for: trip.departureDate)
        let anchorReturn = calendar.startOfDay(for: trip.returnDate)
        return outboundDates.compactMap { outbound in
            let offset = calendar.dateComponents([.day], from: anchorOutbound, to: calendar.startOfDay(for: outbound)).day ?? 0
            guard let inbound = calendar.date(byAdding: .day, value: offset, to: anchorReturn), inbound > outbound else { return nil }
            return FlightJourneyDatePair(outbound: outbound, inbound: inbound)
        }
    }

    private func dayOffset(_ date: Date, from anchor: Date) -> Int {
        let calendar = Calendar(identifier: .gregorian)
        return calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: anchor),
            to: calendar.startOfDay(for: date)
        ).day ?? 0
    }

    private func makeSignature(_ trip: TripDraft) -> String {
        let formatter = ISO8601DateFormatter()
        let filters = trip.effectiveFlightFilters
        return [
            trip.originCode, trip.outboundDestinationCode, trip.isRoundTripFlight ? trip.returnOriginCode : "-",
            trip.resolvedFlightTripType.rawValue,
            formatter.string(from: trip.departureDate), formatter.string(from: trip.returnDate),
            trip.flexibility.rawValue, String(trip.adults), String(trip.children), String(trip.infants),
            filters.cabinClass.rawValue, filters.stops.rawValue,
            String(filters.minCarryOnBags), String(filters.minCheckedBags),
            filters.maxPriceUSD.map(String.init) ?? "-",
            filters.departureWindow.rawValue, filters.arrivalWindow.rawValue,
            filters.normalizedAirlinesInclude.joined(separator: ","), filters.normalizedAirlinesExclude.joined(separator: ","),
            filters.allowSelfTransfer ? "self-transfer" : "protected", filters.infantSeating.rawValue
        ].joined(separator: "|")
    }
}

@MainActor
final class AutomaticFlightSearchService: FlightSearchServicing, GeneratorComponentProviding {
    private let coordinator: RealFlightPackageSearchService

    init() { coordinator = RealFlightPackageSearchService() }
    init(flightProvider: FlightInventoryProviding) { coordinator = RealFlightPackageSearchService(flightProvider: flightProvider) }

    var currentHotelPriceSnapshot: HotelPriceSearchSnapshot? { coordinator.currentHotelPriceSnapshot }

    func ensureHotelPrices(
        trip: TripDraft,
        makkahHotel: HotelSummary,
        madinahHotel: HotelSummary?,
        makkahRoomId: String?,
        makkahRoomName: String?,
        makkahRoomCapacity: Int?,
        madinahRoomId: String?,
        madinahRoomName: String?,
        madinahRoomCapacity: Int?,
        forceRefresh: Bool
    ) async -> HotelPriceSearchSnapshot {
        await coordinator.ensureHotelPrices(
            trip: trip, makkahHotel: makkahHotel, madinahHotel: madinahHotel,
            makkahRoomId: makkahRoomId, makkahRoomName: makkahRoomName, makkahRoomCapacity: makkahRoomCapacity,
            madinahRoomId: madinahRoomId, madinahRoomName: madinahRoomName, madinahRoomCapacity: madinahRoomCapacity,
            forceRefresh: forceRefresh
        )
    }

    func invalidateHotelPrices() { coordinator.invalidateHotelPrices() }
    func invalidateFlightInventory() { coordinator.invalidateFlightInventory() }
    func invalidateSession() { coordinator.invalidateSession() }

    func searchOutbound(trip: TripDraft, makkahHotel: HotelSummary, madinahHotel: HotelSummary?) async throws -> [FlightOffer] {
        try await coordinator.searchOutbound(trip: trip, makkahHotel: makkahHotel, madinahHotel: madinahHotel)
    }

    func searchReturn(trip: TripDraft, makkahHotel: HotelSummary, madinahHotel: HotelSummary?, outbound: FlightOffer) async throws -> [FlightOffer] {
        try await coordinator.searchReturn(trip: trip, makkahHotel: makkahHotel, madinahHotel: madinahHotel, outbound: outbound)
    }

    func searchOutboundProgressive(
        trip: TripDraft,
        makkahHotel: HotelSummary,
        madinahHotel: HotelSummary?,
        onUpdate: @escaping FlightSearchProgressHandler
    ) async throws -> [FlightOffer] {
        try await coordinator.searchOutboundProgressive(
            trip: trip,
            makkahHotel: makkahHotel,
            madinahHotel: madinahHotel,
            onUpdate: onUpdate
        )
    }

    func searchReturnProgressive(
        trip: TripDraft,
        makkahHotel: HotelSummary,
        madinahHotel: HotelSummary?,
        outbound: FlightOffer,
        onUpdate: @escaping FlightSearchProgressHandler
    ) async throws -> [FlightOffer] {
        try await coordinator.searchReturnProgressive(
            trip: trip,
            makkahHotel: makkahHotel,
            madinahHotel: madinahHotel,
            outbound: outbound,
            onUpdate: onUpdate
        )
    }
}
