import Foundation
import Combine

struct PackageTierComparisonOption: Identifiable, Hashable {
    let tier: PackageTier
    let quote: PackageQuote?
    let makkahHotel: HotelSummary?
    let madinahHotel: HotelSummary?
    let unavailableReason: String?

    var id: String { tier.rawValue }
    var isAvailable: Bool { quote != nil && makkahHotel != nil }
}

private struct PackageTierComparisonFlightContext {
    let pricingOffer: FlightOffer
    let outboundOffer: FlightOffer
    let inboundOffer: FlightOffer?
}

struct GeneratorGroupSavingsQuoteSet: Hashable {
    let solo: PackageQuote
    let pair: PackageQuote
    let current: PackageQuote
}

@MainActor
final class JourneyStore: ObservableObject {
    var cachedLocalBookingInputKey: String?
    @Published var trip = TripDraft() { didSet { cachedLocalBookingInputKey = nil } }
    @Published var tripSummaryChildAges: [Int] = []
    var tripSummaryApprovalHeaders: [String:String] = [:]
    @Published private(set) var tripSummaryRevision: UInt64 = 0
    @Published var usesLocalJourney = false
    @Published var localJourneyFlights: [LocalJourneyFlight] = [] { didSet { cachedLocalBookingInputKey = nil } }
    @Published var localJourneyRooms: [String: LocalJourneyRoom] = [:] { didSet { cachedLocalBookingInputKey = nil } }
    /// User-facing ±0…4-day discovery window. Does not change the booked dates.
    @Published var flightSearchFlexDays: Int = 0

    /// Controls the three package-generation paths without changing the persisted
    /// TripDraft contract. Weekend keeps its existing DateFlexibility behavior;
    /// published/direct and flexible-date paths are session architecture state.
    @Published var packageFlightPath: PackageFlightPath = .publishedDirect
    @Published var selectedPublishedCompleteID: String?
    @Published var selectedPublishedOutboundID: String?
    @Published var selectedPublishedReturnID: String?
    /// Flights staged from the Flights tab before the user opens the package builder.
    /// Published iumrah recommendations also keep their canonical D1 IDs above so
    /// the generator can resolve the exact selected itinerary server-side.
    @Published var stagedUmrahFlights: [StagedUmrahFlight] = []
    /// Original Data API records for Flight First. The compact staged model powers
    /// the cart UI; these records preserve the server-recheck identity needed by
    /// the Package Engine after the user reaches Primary Hotels.
    @Published var stagedAviasalesOffers: [StagedUmrahFlightKind: FlightDiscoveryOffer] = [:]
    @Published private(set) var flightFirstHotelStagePrepared = false

    // Transfer is a first-class generator stage shared by both flight paths.
    // The base transfer price is package-wide; vehicle class controls the service
    // experience, while Haramain is the only optional priced hybrid-route add-on.
    @Published var selectedTransferVehicle: TransferVehicleKind? { didSet { cachedLocalBookingInputKey = nil } }
    @Published var haramainTrainSelected = false { didSet { cachedLocalBookingInputKey = nil } }
    @Published var haramainFareClass: HaramainFareClass = .economy { didSet { cachedLocalBookingInputKey = nil } }
    @Published var haramainAdultTickets = 0 { didSet { cachedLocalBookingInputKey = nil } }
    @Published var haramainChildTickets = 0 { didSet { cachedLocalBookingInputKey = nil } }
    @Published var transferSelectionConfirmed = false

    @Published var hotels: [HotelSummary] = []
    @Published var selectedHotel: HotelSummary?
    @Published var selectedRoom: HotelRoom?
    @Published var selectedRoomCategory: IumrahRoomCategoryOption?

    @Published var madinahHotels: [HotelSummary] = []
    @Published var selectedMadinahHotel: HotelSummary?
    @Published var selectedMadinahRoom: HotelRoom?
    @Published var selectedMadinahRoomCategory: IumrahRoomCategoryOption?

    @Published var selectedOutbound: FlightOffer?
    @Published var selectedInbound: FlightOffer?
    @Published var quote: PackageQuote?
    @Published private(set) var hotelPriceSnapshot: HotelPriceSearchSnapshot?
    @Published private(set) var isSearchingHotelPrices = false
    @Published private(set) var pricingMakkahRoomID: String?
    @Published private(set) var pricingMadinahRoomID: String?
    @Published private(set) var prefetchedInboundOffers: [FlightOffer] = []

    @Published var isLoadingHotels = false
    @Published var isLoadingMadinahHotels = false
    @Published var isSearchingFlights = false
    @Published var errorMessage: String?

    let hotelService: HotelCatalogServicing
    let flightService: FlightSearchServicing
    let quoteService: PackageQuoteServicing
    private let packageEngine = RemotePackageEngineClient()
    // Hotel/meal changes can overlap server requests. Only the most recent
    // configuration may publish its total into the generator.
    private var packageQuoteRevision: UInt64 = 0
    private var quoteTask: Task<Void, Never>?
    private var quoteTaskKey: String?
    private var completedQuoteKey: String?
    private var completedQuoteAt: Date?
    private var quoteRequestGeneration = UUID()
    private var hotelPricePrefetchTask: Task<Void, Never>?
    private var hotelPricePrefetchGeneration = UUID()
    private var inboundFlightPrefetchTask: Task<Void, Never>?

    init() {
        self.hotelService = HotelCatalogService()
        self.flightService = AutomaticFlightSearchService()
        self.quoteService = LocalOnlyPackageQuoteService()
    }

    init(
        hotelService: HotelCatalogServicing,
        flightService: FlightSearchServicing,
        quoteService: PackageQuoteServicing
    ) {
        self.hotelService = hotelService
        self.flightService = flightService
        self.quoteService = quoteService
    }

    func loadMakkahHotels() async {
        guard !isLoadingHotels else { return }
        isLoadingHotels = true
        errorMessage = nil
        defer { isLoadingHotels = false }

        do {
            let all = try await hotelService.listHotels(city: "Makkah")
            // Keep the complete published catalogue in memory. A summary-level
            // 48h price may be stale even though hotel detail can already expose
            // the refreshed price. Filtering here was the reason the selector
            // could incorrectly become completely empty.
            guard !Task.isCancelled else { return }
            hotels = all
            if selectedHotel == nil {
                // `primary_hotels.star_category` is the generator/editorial category.
                // Do not pre-filter by the property's factual star rating before
                // resolving the Business Primary Hotel: a curated Luxury slot may
                // legitimately point to a hotel whose catalog `stars` metadata is
                // missing or differs from the editorial category.
                let primary = await resolvedPrimaryHotel(from: all, city: "Makkah")
                guard !Task.isCancelled, selectedHotel == nil else { return }
                selectedHotel = primary ?? primaryHotelCandidate(from: all)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func loadMadinahHotels() async {
        guard trip.scope == .makkahAndMadinah else {
            madinahHotels = []
            selectedMadinahHotel = nil
            selectedMadinahRoom = nil
            selectedMadinahRoomCategory = nil
            return
        }

        guard !isLoadingMadinahHotels else { return }
        isLoadingMadinahHotels = true
        errorMessage = nil
        defer { isLoadingMadinahHotels = false }
        do {
            // The catalogue endpoint now normalizes historical city aliases in SQL.
            let all = try await hotelService.listHotels(city: "Madinah")
            guard !Task.isCancelled, trip.scope == .makkahAndMadinah else { return }
            madinahHotels = all.sorted {
                if $0.stars != $1.stars { return ($0.stars ?? 0) > ($1.stars ?? 0) }
                return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
            }
            if selectedMadinahHotel == nil, !all.isEmpty {
                let primary = await resolvedPrimaryHotel(from: all, city: "Madinah")
                guard !Task.isCancelled, trip.scope == .makkahAndMadinah, selectedMadinahHotel == nil else { return }
                selectedMadinahHotel = primary ?? primaryHotelCandidate(from: all)
            }
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
        }
    }

    private func resolvedPrimaryHotel(from all: [HotelSummary], city: String) async -> HotelSummary? {
        guard AppConfig.usesServerPrimaryHotelResolver else { return nil }
        do {
            let resolved = try await packageEngine.primaryHotel(
                tier: trip.packageTier,
                stars: trip.hotelStars,
                city: city
            )
            return all.first(where: { $0.id == resolved.hotelId })
        } catch {
            return nil
        }
    }

    private func resolvedPrimaryHotel(from all: [HotelSummary], cityAliases: [String]) async -> HotelSummary? {
        var seen = Set<String>()
        for city in cityAliases where seen.insert(city.lowercased()).inserted {
            if let hotel = await resolvedPrimaryHotel(from: all, city: city) {
                return hotel
            }
        }
        return nil
    }

    func primaryHotelCandidate(from all: [HotelSummary]) -> HotelSummary? {
        let exactStars = all.filter { $0.stars == trip.packageTier.primaryHotelStars }
        // Prefer a summary that is already price-ready, but never hide the hotel
        // catalogue merely because its list-row cache is stale. Final package
        // pricing still validates a fresh detail price before arithmetic runs.
        return exactStars.first(where: \.hasFreshCatalogPrice) ?? exactStars.first
    }

    /// Package category is the only hotel-level control shown to the pilgrim.
    /// Keep `hotelStars` synchronized internally so all existing booking/pricing
    /// contracts continue to work unchanged.
    func selectPackageTier(_ tier: PackageTier) {
        let expectedStars = tier.primaryHotelStars
        guard trip.packageTier != tier || trip.hotelStars != expectedStars else { return }

        trip.packageTier = tier
        trip.hotelStars = expectedStars
        trip.mealSelection = nil

        // A category change invalidates only hotel choices and the quote. Flight
        // selection, direct-flight IDs, dates, passengers and Weekend state stay intact.
        selectedHotel = nil
        selectedRoom = nil
        selectedRoomCategory = nil
        hotels = []

        selectedMadinahHotel = nil
        selectedMadinahRoom = nil
        selectedMadinahRoomCategory = nil
        madinahHotels = []

        quote = nil
        hotelPriceSnapshot = nil
        cancelHotelPricePrefetch()
        pricingMakkahRoomID = nil
        pricingMadinahRoomID = nil
        (flightService as? AutomaticFlightSearchService)?.invalidateHotelPrices()
        resetTransferSelection()
    }

    func resetAfterTripChange(keepingPublishedFlightSelection: Bool = false) {
        usesLocalJourney = false
        localJourneyFlights = []
        localJourneyRooms = [:]
        if !keepingPublishedFlightSelection { clearPublishedFlightSelection() }

        // A newly configured journey starts from the package default meal plan.
        // Comfort/Luxury paid meals are therefore enabled again until the pilgrim
        // explicitly removes them on the hotel step.
        trip.mealSelection = nil

        selectedHotel = nil
        selectedRoom = nil
        selectedRoomCategory = nil
        hotels = []

        selectedMadinahHotel = nil
        selectedMadinahRoom = nil
        selectedMadinahRoomCategory = nil
        madinahHotels = []

        selectedOutbound = nil
        selectedInbound = nil
        prefetchedInboundOffers = []
        inboundFlightPrefetchTask?.cancel()
        inboundFlightPrefetchTask = nil
        trip.saudiArrivalDate = nil
        quote = nil
        hotelPriceSnapshot = nil
        cancelHotelPricePrefetch()
        pricingMakkahRoomID = nil
        pricingMadinahRoomID = nil
        resetTransferSelection()
        (flightService as? AutomaticFlightSearchService)?.invalidateSession()
    }

    var hasCompletePublishedFlightSelection: Bool {
        selectedPublishedCompleteID != nil ||
        (selectedPublishedOutboundID != nil && selectedPublishedReturnID != nil)
    }

    var publishedFlightSelection: CuratedPublishedFlightSelection {
        CuratedPublishedFlightSelection(
            completeID: selectedPublishedCompleteID,
            outboundID: selectedPublishedOutboundID,
            returnID: selectedPublishedReturnID
        )
    }

    func clearPublishedFlightSelection() {
        selectedPublishedCompleteID = nil
        selectedPublishedOutboundID = nil
        selectedPublishedReturnID = nil
    }

    func stageUmrahFlight(_ selection: StagedUmrahFlight) {
        flightFirstHotelStagePrepared = false
        switch selection.kind {
        case .roundTrip:
            stagedUmrahFlights = [selection]
        case .outbound:
            stagedUmrahFlights.removeAll { $0.kind == .roundTrip || $0.kind == .outbound }
            stagedUmrahFlights.append(selection)
        case .inbound:
            stagedUmrahFlights.removeAll { $0.kind == .roundTrip || $0.kind == .inbound }
            stagedUmrahFlights.append(selection)
        }
    }

    @Published var mixedFlightIdentity: String? = nil { didSet { cachedLocalBookingInputKey = nil } }

    func clearStagedUmrahFlights() {
        mixedFlightIdentity = nil
        stagedUmrahFlights = []
        stagedAviasalesOffers = [:]
        trip.selectedReturnAirport = nil
        flightFirstHotelStagePrepared = false
    }

    /// Starts the dedicated Flight First hotel stage without throwing the user back
    /// into the generic flight configurator. This reset is performed once per staged
    /// flight selection so a previous package draft cannot leak a stale hotel/room or
    /// transfer into the new AV Sales flow, while navigating back/forward preserves
    /// choices already made in the current Flight First session.
    func prepareFlightFirstHotelStage() {
        guard !flightFirstHotelStagePrepared else { return }
        flightFirstHotelStagePrepared = true

        selectedHotel = nil
        selectedRoom = nil
        selectedRoomCategory = nil
        hotels = []
        selectedMadinahHotel = nil
        selectedMadinahRoom = nil
        selectedMadinahRoomCategory = nil
        madinahHotels = []
        selectedOutbound = nil
        selectedInbound = nil
        quote = nil
        hotelPriceSnapshot = nil
        cancelHotelPricePrefetch()
        pricingMakkahRoomID = nil
        pricingMadinahRoomID = nil
        resetTransferSelection()
    }

    func stageAviasalesOffer(_ offer: FlightDiscoveryOffer, kind: StagedUmrahFlightKind) {
        switch kind {
        case .roundTrip:
            stagedAviasalesOffers = [.roundTrip: offer]
        case .outbound:
            stagedAviasalesOffers.removeValue(forKey: .roundTrip)
            stagedAviasalesOffers[.outbound] = offer
        case .inbound:
            stagedAviasalesOffers.removeValue(forKey: .roundTrip)
            stagedAviasalesOffers[.inbound] = offer
        }
        packageFlightPath = .aviasalesSelected
        clearPublishedFlightSelection()
    }

    var hasCompleteStagedFlightSelection: Bool {
        stagedUmrahFlights.contains(where: { $0.kind == .roundTrip }) ||
        (stagedUmrahFlights.contains(where: { $0.kind == .outbound }) &&
         stagedUmrahFlights.contains(where: { $0.kind == .inbound }))
    }

    /// Reprices the same hidden Primary Hotel + published-flight package for a solo
    /// pilgrim, a pair and the user's current party. TripBuilder uses this only for
    /// the live group-savings explanation; it does not mutate the selected journey
    /// or expose supplier/component prices. The arithmetic is therefore identical
    /// to the Hotel-first configurator and remains server-authoritative.
    func tripBuilderGroupSavingsQuotes() async -> GeneratorGroupSavingsQuoteSet? {
        guard packageFlightPath == .publishedDirect, hasCompletePublishedFlightSelection else { return nil }

        let baseTrip = trip
        let selection = publishedFlightSelection

        do {
            let makkah = try await groupSavingsPrimaryHotel(
                tier: baseTrip.packageTier,
                stars: baseTrip.hotelStars,
                cityAliases: ["Makkah"]
            )

            let madinah: PrimaryHotelResolutionResponse?
            if baseTrip.scope == .makkahAndMadinah {
                madinah = try await groupSavingsPrimaryHotel(
                    tier: baseTrip.packageTier,
                    stars: baseTrip.hotelStars,
                    cityAliases: ["Madinah", "Medina", "Madina", "Al Madinah"]
                )
            } else {
                madinah = nil
            }

            var soloTrip = baseTrip
            soloTrip.adults = 1
            soloTrip.children = 0
            soloTrip.infants = 0
            soloTrip.rooms = 1

            var pairTrip = baseTrip
            pairTrip.adults = 2
            pairTrip.children = 0
            pairTrip.infants = 0
            pairTrip.rooms = 1

            var currentTrip = baseTrip
            currentTrip.adults = max(1, currentTrip.adults)
            currentTrip.children = max(0, currentTrip.children)
            currentTrip.infants = max(0, currentTrip.infants)
            currentTrip.rooms = max(1, currentTrip.rooms)

            async let solo = groupSavingsQuote(
                trip: soloTrip,
                selection: selection,
                makkah: makkah,
                madinah: madinah
            )
            async let pair = groupSavingsQuote(
                trip: pairTrip,
                selection: selection,
                makkah: makkah,
                madinah: madinah
            )
            async let current = groupSavingsQuote(
                trip: currentTrip,
                selection: selection,
                makkah: makkah,
                madinah: madinah
            )

            let values = try await (solo, pair, current)
            return GeneratorGroupSavingsQuoteSet(solo: values.0, pair: values.1, current: values.2)
        } catch {
            // Savings guidance is supplemental. The main generator must remain usable
            // if this background comparison cannot be refreshed.
            return nil
        }
    }

    private func groupSavingsPrimaryHotel(
        tier: PackageTier,
        stars: Int,
        cityAliases: [String]
    ) async throws -> PrimaryHotelResolutionResponse {
        var lastError: Error?
        for city in cityAliases {
            do {
                let value = try await packageEngine.primaryHotel(tier: tier, stars: stars, city: city)
                if value.ok { return value }
            } catch {
                lastError = error
            }
        }
        throw lastError ?? APIError.invalidResponse
    }

    private func groupSavingsQuote(
        trip: TripDraft,
        selection: CuratedPublishedFlightSelection,
        makkah: PrimaryHotelResolutionResponse,
        madinah: PrimaryHotelResolutionResponse?
    ) async throws -> PackageQuote {
        let resolved = try await CuratedFlightRecommendationService.shared.resolvePublishedSelection(
            trip: trip,
            selection: selection
        )

        return try await packageEngine.packageQuote(
            trip: trip,
            pricingOffer: resolved.inbound,
            outboundOffer: resolved.outbound,
            inboundOffer: resolved.inbound,
            makkahHotelID: makkah.hotelId,
            makkahRoomID: makkah.roomId,
            madinahHotelID: madinah?.hotelId,
            madinahRoomID: madinah?.roomId,
            includeHaramainTrain: false,
            transferVehicle: nil,
            haramainFareClass: .economy,
            haramainTicketCount: 0
        )
    }

    /// Resolves a flight selected in the public Aviasales Data storefront into the
    /// normal generator contract. The iOS snapshot is used only for presentation;
    /// PackageEngine re-queries Travelpayouts by route/date/flight identity before
    /// accepting the fare into a quote.
    @discardableResult
    func prepareAviasalesSelectedQuote() async -> Bool {
        guard packageFlightPath == .aviasalesSelected, hasCompleteStagedFlightSelection else {
            errorMessage = "Aviasales Flight First selection is incomplete."
            quote = nil
            return false
        }

        guard let pair = makeAviasalesFlightPair() else {
            errorMessage = "Selected Aviasales flight could not be prepared."
            quote = nil
            return false
        }

        chooseOutboundFlight(pair.outbound)
        if let inbound = pair.inbound { chooseInboundFlight(inbound) }
        scheduleHotelPricePrefetch()
        await buildQuote()
        return hasFinalGeneratorQuote
    }

    func makeAviasalesFlightPair() -> (outbound: FlightOffer, inbound: FlightOffer?)? {
        if let roundTrip = stagedAviasalesOffers[.roundTrip] {
            guard let outboundDeparture = aviasalesDate(roundTrip.departureAt) else { return nil }
            let outboundDuration = max(45, roundTrip.durationMinutes)
            let providerID = aviasalesProviderIdentity(roundTrip: roundTrip)
            let outbound = makeAviasalesFlightOffer(
                id: "av-out-\(roundTrip.id)",
                direction: .outbound,
                origin: roundTrip.origin,
                destination: roundTrip.destination,
                airlineCode: roundTrip.airlineCode,
                flightNumber: roundTrip.flightNumber,
                departure: outboundDeparture,
                durationMinutes: outboundDuration,
                stops: roundTrip.transfers,
                price: roundTrip.price,
                currency: "USD",
                bookingURL: roundTrip.bookingUrl,
                providerID: providerID
            )

            guard trip.isRoundTripFlight else { return (outbound, nil) }
            guard let returnRaw = roundTrip.returnAt, let inboundDeparture = aviasalesDate(returnRaw) else { return nil }
            // Data API's cached round-trip row can omit the operating carrier
            // of the return flight. Server-side quote validation will recheck the
            // *complete* RT fare; the iOS display must mark the missing identity
            // unconfirmed rather than block the whole hotel selection flow.
            let returnCode = roundTrip.returnAirlineCode?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let returnNumber = roundTrip.returnFlightNumber?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let inbound = makeAviasalesFlightOffer(
                id: "av-in-\(roundTrip.id)",
                direction: .inbound,
                origin: roundTrip.destination,
                destination: roundTrip.origin,
                airlineCode: returnCode,
                flightNumber: returnNumber,
                departure: inboundDeparture,
                durationMinutes: max(45, roundTrip.returnDurationMinutes ?? roundTrip.durationMinutes),
                stops: max(0, roundTrip.returnTransfers ?? 0),
                price: roundTrip.price,
                currency: "USD",
                bookingURL: roundTrip.bookingUrl,
                providerID: providerID
            )
            return (outbound, inbound)
        }

        guard let outboundSource = stagedAviasalesOffers[.outbound],
              let outboundDeparture = aviasalesDate(outboundSource.departureAt) else { return nil }
        let inboundSource = stagedAviasalesOffers[.inbound]
        let providerID = aviasalesProviderIdentity(outbound: outboundSource, inbound: inboundSource)
        let outbound = makeAviasalesFlightOffer(
            id: "av-out-\(outboundSource.id)",
            direction: .outbound,
            origin: outboundSource.origin,
            destination: outboundSource.destination,
            airlineCode: outboundSource.airlineCode,
            flightNumber: outboundSource.flightNumber,
            departure: outboundDeparture,
            durationMinutes: max(45, outboundSource.durationMinutes),
            stops: outboundSource.transfers,
            price: outboundSource.price,
            currency: "USD",
            bookingURL: outboundSource.bookingUrl,
            providerID: providerID
        )

        guard trip.isRoundTripFlight else { return (outbound, nil) }
        guard let inboundSource, let inboundDeparture = aviasalesDate(inboundSource.departureAt) else { return nil }
        let inbound = makeAviasalesFlightOffer(
            id: "av-in-\(inboundSource.id)",
            direction: .inbound,
            origin: inboundSource.origin,
            destination: inboundSource.destination,
            airlineCode: inboundSource.airlineCode,
            flightNumber: inboundSource.flightNumber,
            departure: inboundDeparture,
            durationMinutes: max(45, inboundSource.durationMinutes),
            stops: inboundSource.transfers,
            price: inboundSource.price,
            currency: "USD",
            bookingURL: inboundSource.bookingUrl,
            providerID: providerID
        )
        return (outbound, inbound)
    }

    private func makeAviasalesFlightOffer(
        id: String,
        direction: FlightDirection,
        origin: String,
        destination: String,
        airlineCode: String,
        flightNumber: String,
        departure: Date,
        durationMinutes: Int,
        stops: Int,
        price: Double,
        currency: String,
        bookingURL: String?,
        providerID: String,
        sourceLabel: String = "Aviasales Data"
    ) -> FlightOffer {
        let normalizedCode = airlineCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let normalizedNumber = flightNumber.trimmingCharacters(in: .whitespacesAndNewlines)
        return FlightOffer(
            id: id,
            direction: direction,
            airline: normalizedCode.isEmpty ? "Return carrier not confirmed" :
                FlightReferenceCatalog.airlineName(code: normalizedCode, fallback: normalizedCode),
            flightNumber: [normalizedCode, normalizedNumber].filter { !$0.isEmpty }.joined(separator: " "),
            origin: origin,
            destination: destination,
            departureAt: departure,
            arrivalAt: departure.addingTimeInterval(TimeInterval(max(45, durationMinutes) * 60)),
            stops: max(0, stops),
            durationMinutes: max(45, durationMinutes),
            totalPackagePrice: Decimal(max(0, price)),
            currency: currency.uppercased(),
            sourceLabel: sourceLabel,
            airlineCode: normalizedCode.isEmpty ? nil : normalizedCode,
            fareAmount: Decimal(max(0, price)),
            fareScope: .perPassenger,
            fareObservedAt: Date(),
            fareSourceURL: bookingURL,
            providerItineraryID: providerID,
            cabinClass: trip.effectiveFlightFilters.cabinClass.rawValue
        )
    }

    private func aviasalesProviderIdentity(roundTrip offer: FlightDiscoveryOffer) -> String {
        [
            "aviasales", "rt", token(offer.origin), token(offer.destination),
            String(offer.departureAt.prefix(10)), String((offer.returnAt ?? "-").prefix(10)),
            token(offer.airlineCode), token(offer.flightNumber),
            token(offer.returnAirlineCode ?? "-"), token(offer.returnFlightNumber ?? "-")
        ].joined(separator: ":")
    }

    private func aviasalesProviderIdentity(outbound: FlightDiscoveryOffer, inbound: FlightDiscoveryOffer?) -> String {
        var parts = [
            "aviasales", inbound == nil ? "ow" : "pair", token(outbound.origin), token(outbound.destination),
            String(outbound.departureAt.prefix(10)), inbound.map { String($0.departureAt.prefix(10)) } ?? "-",
            token(outbound.airlineCode), token(outbound.flightNumber),
            token(inbound?.airlineCode ?? "-"), token(inbound?.flightNumber ?? "-")
        ]
        // Keep the original 10-field contract when the return reverses the outbound.
        // Open-jaw journeys must retain their real return airports (12-field contract).
        if let inbound, token(inbound.origin) != token(outbound.destination) || token(inbound.destination) != token(outbound.origin) {
            parts += [token(inbound.origin), token(inbound.destination)]
        }
        return parts.joined(separator: ":")
    }

    private func token(_ value: String) -> String {
        let clean = value.uppercased().filter { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
        return clean.isEmpty ? "-" : clean
    }

    private func aviasalesDate(_ raw: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let value = withFraction.date(from: raw) { return value }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]
        if let value = iso.date(from: raw) { return value }
        let day = DateFormatter()
        day.calendar = Calendar(identifier: .gregorian)
        day.locale = Locale(identifier: "en_US_POSIX")
        day.timeZone = TimeZone(secondsFromGMT: 0)
        day.dateFormat = "yyyy-MM-dd"
        return day.date(from: String(raw.prefix(10)))
    }

    /// Converts the selected D1-published direct itinerary into verified FlightOffer
    /// values and runs the existing local package-pricing engine. No Ignav search is
    /// performed here; the only flight request is the D1 recommendation resolver.
    @discardableResult
    func preparePublishedDirectQuote() async -> Bool {
        guard packageFlightPath == .publishedDirect, hasCompletePublishedFlightSelection else {
            errorMessage = "Published direct flight selection is incomplete."
            quote = nil
            return false
        }

        do {
            let resolved = try await CuratedFlightRecommendationService.shared.resolvePublishedSelection(
                trip: trip,
                selection: publishedFlightSelection
            )
            chooseOutboundFlight(resolved.outbound)
            chooseInboundFlight(resolved.inbound)
            scheduleHotelPricePrefetch()
            await buildQuote()
            return hasFinalGeneratorQuote
        } catch {
            errorMessage = error.localizedDescription
            quote = nil
            return false
        }
    }

    func updateFlightFilters(_ filters: FlightSearchFilters) {
        guard trip.effectiveFlightFilters != filters else { return }
        trip.flightFilters = filters == .default ? nil : filters
        selectedOutbound = nil
        selectedInbound = nil
        prefetchedInboundOffers = []
        inboundFlightPrefetchTask?.cancel()
        inboundFlightPrefetchTask = nil
        trip.saudiArrivalDate = nil
        quote = nil
        transferSelectionConfirmed = false
        (flightService as? AutomaticFlightSearchService)?.invalidateFlightInventory()
    }

    func chooseHotel(_ hotel: HotelSummary) {
        packageQuoteRevision &+= 1
        if selectedHotel?.id != hotel.id {
            selectedRoom = nil
            selectedRoomCategory = nil
        }
        selectedHotel = hotel
        invalidateHotelPriceAndQuote()
        scheduleHotelPricePrefetch()
    }

    func chooseRoom(_ room: HotelRoom?) {
        selectedRoom = room
        if room != nil { selectedRoomCategory = nil }
        invalidateHotelPriceAndQuote()
        scheduleHotelPricePrefetch()
    }

    func chooseRoomCategory(_ category: IumrahRoomCategoryOption?) {
        selectedRoomCategory = category
        if category != nil { selectedRoom = nil }
        invalidateHotelPriceAndQuote()
        scheduleHotelPricePrefetch()
    }

    /// Weekly flight discovery may return a flight on another day in the seven-day
    /// window. Once the pilgrim selects one, that flight's local departure day
    /// becomes the authoritative trip date.
    /// Hotel verification is then repeated against those actual dates before
    /// local package pricing runs.
    func chooseOutboundFlight(_ offer: FlightOffer) {
        selectedOutbound = offer
        selectedInbound = nil
        quote = nil
        transferSelectionConfirmed = false
        pricingMakkahRoomID = nil
        pricingMadinahRoomID = nil

        let selectedDepartureDay = travelCalendarDay(for: offer.departureAt, airportCode: offer.origin)
        let selectedArrivalDay = travelCalendarDay(for: offer.arrivalAt, airportCode: offer.destination)
        let previousHotelStart = trip.hotelStayStartDate
        let departureChanged = !Calendar.current.isDate(selectedDepartureDay, inSameDayAs: trip.departureDate)
        let hotelStartChanged = !Calendar.current.isDate(previousHotelStart, inSameDayAs: selectedArrivalDay)

        if departureChanged { trip.departureDate = selectedDepartureDay }
        trip.saudiArrivalDate = selectedArrivalDay

        // Preserve an already completed background hotel lookup whenever the actual
        // stay dates did not change. The old flow discarded a valid snapshot on every
        // flight tap and forced the user to wait for the same catalog price lookup again.
        if departureChanged || hotelStartChanged {
            hotelPriceSnapshot = nil
            cancelHotelPricePrefetch()
            (flightService as? AutomaticFlightSearchService)?.invalidateHotelPrices()
            scheduleHotelPricePrefetch()
        } else if hotelPriceSnapshot == nil && !isSearchingHotelPrices {
            scheduleHotelPricePrefetch()
        }
    }

    func chooseInboundFlight(_ offer: FlightOffer) {
        selectedInbound = offer
        quote = nil
        transferSelectionConfirmed = false
        pricingMakkahRoomID = nil
        pricingMadinahRoomID = nil

        let selectedDay = travelCalendarDay(for: offer.departureAt, airportCode: offer.origin)
        let returnChanged = selectedDay > trip.departureDate && !Calendar.current.isDate(selectedDay, inSameDayAs: trip.returnDate)
        if returnChanged {
            trip.returnDate = selectedDay
            hotelPriceSnapshot = nil
            cancelHotelPricePrefetch()
            (flightService as? AutomaticFlightSearchService)?.invalidateHotelPrices()
            scheduleHotelPricePrefetch()
        } else if hotelPriceSnapshot == nil && !isSearchingHotelPrices {
            scheduleHotelPricePrefetch()
        }
    }

    func chooseMadinahHotel(_ hotel: HotelSummary) {
        packageQuoteRevision &+= 1
        if selectedMadinahHotel?.id != hotel.id {
            selectedMadinahRoom = nil
            selectedMadinahRoomCategory = nil
        }
        selectedMadinahHotel = hotel
        invalidateHotelPriceAndQuote()
        scheduleHotelPricePrefetch()
    }

    func chooseMadinahRoom(_ room: HotelRoom?) {
        selectedMadinahRoom = room
        if room != nil { selectedMadinahRoomCategory = nil }
        invalidateHotelPriceAndQuote()
        scheduleHotelPricePrefetch()
    }

    func chooseMadinahRoomCategory(_ category: IumrahRoomCategoryOption?) {
        selectedMadinahRoomCategory = category
        if category != nil { selectedMadinahRoom = nil }
        invalidateHotelPriceAndQuote()
        scheduleHotelPricePrefetch()
    }

    var hasSelectableHotelMeals: Bool {
        trip.packageTier == .comfort || trip.packageTier == .luxury
    }

    func isMealEnabled(_ meal: HotelMealKind, city: HotelMealCity) -> Bool {
        trip.effectiveMealSelection.isEnabled(meal, in: city)
    }

    func setMealEnabled(_ enabled: Bool, meal: HotelMealKind, city: HotelMealCity) {
        guard hasSelectableHotelMeals else { return }

        var selection = trip.effectiveMealSelection
        guard selection.isEnabled(meal, in: city) != enabled else { return }
        selection.setEnabled(enabled, meal: meal, city: city)

        var updatedTrip = trip
        updatedTrip.mealSelection = selection
        trip = updatedTrip
        packageQuoteRevision &+= 1

        // Meal changes do not invalidate the already verified hotel rate, but
        // they must invalidate every package total built from the old selection.
        quote = nil
        transferSelectionConfirmed = false
    }


    func recommendedTransferVehicle() -> TransferVehicleKind {
        // Kia Carnival is the default matched transfer for every package tier.
        // Malibu remains a no-cost alternative and Yukon is an explicit VIP upgrade.
        .carnival
    }

    func chooseTransferVehicle(_ vehicle: TransferVehicleKind) {
        guard selectedTransferVehicle != vehicle else { return }
        packageQuoteRevision &+= 1
        selectedTransferVehicle = vehicle
        transferSelectionConfirmed = false
        // Rebuild the final generator snapshot so iumrah Business receives the
        // exact selected vehicle class even though base transfer pricing is fixed.
        quote = nil
    }

    func setHaramainTrainSelected(_ selected: Bool) {
        let allowed = trip.scope == .makkahAndMadinah
        let resolved = allowed && selected
        if resolved { ensureHaramainTicketDefaults() }
        guard haramainTrainSelected != resolved else { return }
        packageQuoteRevision &+= 1
        haramainTrainSelected = resolved
        transferSelectionConfirmed = false
        quote = nil
    }

    func ensureHaramainTicketDefaults() {
        if haramainAdultTickets == 0 && haramainChildTickets == 0 {
            haramainAdultTickets = max(1, trip.adults)
            haramainChildTickets = max(0, trip.children)
        }
        haramainAdultTickets = min(max(1, haramainAdultTickets), max(1, trip.adults))
        haramainChildTickets = min(max(0, haramainChildTickets), max(0, trip.children))
    }

    func setHaramainFareClass(_ fareClass: HaramainFareClass) {
        guard haramainFareClass != fareClass else { return }
        haramainFareClass = fareClass
        if haramainTrainSelected {
            packageQuoteRevision &+= 1
            transferSelectionConfirmed = false
            quote = nil
        }
    }

    func setHaramainAdultTickets(_ value: Int) {
        let resolved = min(max(1, value), max(1, trip.adults))
        guard haramainAdultTickets != resolved else { return }
        haramainAdultTickets = resolved
        if haramainTrainSelected {
            packageQuoteRevision &+= 1
            transferSelectionConfirmed = false
            quote = nil
        }
    }

    func setHaramainChildTickets(_ value: Int) {
        let resolved = min(max(0, value), max(0, trip.children))
        guard haramainChildTickets != resolved else { return }
        haramainChildTickets = resolved
        if haramainTrainSelected {
            packageQuoteRevision &+= 1
            transferSelectionConfirmed = false
            quote = nil
        }
    }

    func confirmTransferSelection() {
        if selectedTransferVehicle == nil { selectedTransferVehicle = recommendedTransferVehicle() }
        transferSelectionConfirmed = true
    }

    func resetTransferSelection() {
        selectedTransferVehicle = nil
        haramainTrainSelected = false
        haramainFareClass = .economy
        haramainAdultTickets = 0
        haramainChildTickets = 0
        transferSelectionConfirmed = false
    }

    var haramainTicketCount: Int {
        max(0, haramainAdultTickets) + max(0, haramainChildTickets)
    }

    var haramainTrainAddOnUsd: Decimal {
        guard trip.scope == .makkahAndMadinah else { return 0 }
        let count = haramainTicketCount > 0 ? haramainTicketCount : max(1, trip.adults + trip.children)
        return haramainFareClass.publicSeatPriceUsd * Decimal(count)
    }

    var selectedTransferUpgradeUsd: Decimal {
        (selectedTransferVehicle ?? recommendedTransferVehicle()).publicUpgradeUsd(for: trip.scope)
    }


    private func invalidateHotelPriceAndQuote() {
        quote = nil
        transferSelectionConfirmed = false
        hotelPriceSnapshot = nil
        cancelHotelPricePrefetch()
        pricingMakkahRoomID = nil
        pricingMadinahRoomID = nil
        (flightService as? AutomaticFlightSearchService)?.invalidateHotelPrices()
    }

    /// Warms the server-maintained hotel catalog price as soon as the selected
    /// hotel/room and travel dates are known. This is a cheap D1-backed cache lookup;
    /// Beta never opens Booking/Expedia or runs hotel price bots on the pilgrim device.
    func scheduleHotelPricePrefetch(forceRefresh: Bool = false) {
        guard !usesLocalJourney else { return } // Nuitee owns hotel pricing in the unified flow.
        if !forceRefresh, hotelPricePrefetchTask != nil { return }
        if !forceRefresh, let snapshot = hotelPriceSnapshot, isCompleteHotelSnapshot(snapshot) { return }
        guard let components = flightService as? GeneratorComponentProviding,
              let makkahHotel = selectedHotel else { return }
        if trip.scope == .makkahAndMadinah, selectedMadinahHotel == nil { return }

        cancelHotelPricePrefetch()
        let generation = UUID()
        hotelPricePrefetchGeneration = generation
        isSearchingHotelPrices = true

        let tripSnapshot = trip
        let madinahHotel = selectedMadinahHotel
        let makkahRoomId = selectedRoom?.id ?? selectedRoomCategory?.id
        let makkahRoomName = selectedRoom?.name ?? selectedRoomCategory?.displayName
        let makkahRoomCapacity = selectedRoom?.maxGuests ?? selectedRoomCategory?.maxGuests
        let madinahRoomId = selectedMadinahRoom?.id ?? selectedMadinahRoomCategory?.id
        let madinahRoomName = selectedMadinahRoom?.name ?? selectedMadinahRoomCategory?.displayName
        let madinahRoomCapacity = selectedMadinahRoom?.maxGuests ?? selectedMadinahRoomCategory?.maxGuests

        hotelPricePrefetchTask = Task { @MainActor [weak self] in
            // Coalesce hotel + room callbacks before reading the same catalog cache.
            // A forced retry bypasses this tiny debounce and rechecks the public hotel detail.
            if !forceRefresh { try? await Task.sleep(for: .milliseconds(180)) }
            guard !Task.isCancelled else {
                if self?.hotelPricePrefetchGeneration == generation { self?.isSearchingHotelPrices = false }
                return
            }
            let snapshot = await components.ensureHotelPrices(
                trip: tripSnapshot,
                makkahHotel: makkahHotel,
                madinahHotel: madinahHotel,
                makkahRoomId: makkahRoomId,
                makkahRoomName: makkahRoomName,
                makkahRoomCapacity: makkahRoomCapacity,
                madinahRoomId: madinahRoomId,
                madinahRoomName: madinahRoomName,
                madinahRoomCapacity: madinahRoomCapacity,
                forceRefresh: forceRefresh
            )
            guard let self,
                  !Task.isCancelled,
                  self.hotelPricePrefetchGeneration == generation else { return }
            self.hotelPriceSnapshot = snapshot
            self.isSearchingHotelPrices = false
            self.hotelPricePrefetchTask = nil
        }
    }

    private func cancelHotelPricePrefetch() {
        hotelPricePrefetchGeneration = UUID()
        hotelPricePrefetchTask?.cancel()
        hotelPricePrefetchTask = nil
        isSearchingHotelPrices = false
    }

    private func isCompleteHotelSnapshot(_ snapshot: HotelPriceSearchSnapshot) -> Bool {
        !snapshot.makkah.isEmpty && (trip.scope != .makkahAndMadinah || !snapshot.madinah.isEmpty)
    }

    /// Projects compatible return legs from the complete Ignav itineraries already
    /// fetched for the outbound screen. In the normal path this does not buy/search a
    /// second one-way ticket and does not add another fare; it only warms return UI rows.
    func prefetchReturnFlightsIfNeeded(referenceOutbound: FlightOffer) {
        guard trip.isRoundTripFlight, prefetchedInboundOffers.isEmpty, inboundFlightPrefetchTask == nil,
              let makkahHotel = selectedHotel else { return }
        if trip.scope == .makkahAndMadinah, selectedMadinahHotel == nil { return }
        let tripSnapshot = trip
        let madinahHotel = selectedMadinahHotel
        inboundFlightPrefetchTask = Task { @MainActor [weak self] in
            defer { self?.inboundFlightPrefetchTask = nil }
            do {
                let values = try await self?.flightService.searchReturn(
                    trip: tripSnapshot,
                    makkahHotel: makkahHotel,
                    madinahHotel: madinahHotel,
                    outbound: referenceOutbound
                ) ?? []
                guard !Task.isCancelled else { return }
                self?.prefetchedInboundOffers = values.filter(\.isVerifiedForBooking)
            } catch {
                // Prefetch is opportunistic. ReturnFlightView still has its normal
                // explicit search/retry path and should not show a failure here.
            }
        }
    }

    func clearPrefetchedReturnFlights() {
        inboundFlightPrefetchTask?.cancel()
        inboundFlightPrefetchTask = nil
        prefetchedInboundOffers = []
    }

    func awaitPrefetchedReturnFlights() async -> [FlightOffer] {
        if let task = inboundFlightPrefetchTask { await task.value }
        return prefetchedInboundOffers
    }

    /// Uses the exact same Expedia-style pricing engine as FinalPackageView.
    /// Every visible round-trip row already carries one complete Ignav itinerary fare;
    /// previews never add two separately priced one-way tickets.
    func packagePricePreviews(
        offers: [FlightOffer],
        direction: FlightDirection,
        oppositeLeg: FlightOffer?
    ) async -> [String: Decimal] {
        guard !offers.isEmpty, let hotel = selectedHotel else { return [:] }
        if trip.scope == .makkahAndMadinah, selectedMadinahHotel == nil { return [:] }

        let requestedTrip = trip
        let makkahRoomID = selectedRoom?.id ?? selectedRoomCategory?.id
        let madinahHotelID = selectedMadinahHotel?.id
        let madinahRoomID = selectedMadinahRoom?.id ?? selectedMadinahRoomCategory?.id
        let train = haramainTrainSelected
        let vehicle = selectedTransferVehicle
        let fareClass = haramainFareClass
        let tickets = haramainTicketCount
        var output: [String: Decimal] = [:]
        for offer in offers where offer.isVerifiedForBooking {
            guard !Task.isCancelled else { return [:] }
            let outbound = direction == .outbound ? offer : oppositeLeg
            guard let outbound, outbound.isVerifiedForBooking else { continue }
            let inbound = direction == .inbound ? offer : nil
            if let preview = try? await packageEngine.packageQuote(
                trip: requestedTrip,
                pricingOffer: offer,
                outboundOffer: outbound,
                inboundOffer: inbound,
                makkahHotelID: hotel.id,
                makkahRoomID: makkahRoomID,
                madinahHotelID: madinahHotelID,
                madinahRoomID: madinahRoomID,
                includeHaramainTrain: train,
                transferVehicle: vehicle,
                haramainFareClass: fareClass,
                haramainTicketCount: tickets
            ) {
                guard !Task.isCancelled else { return [:] }
                output[offer.id] = preview.pricePerPerson
            }
        }
        return output
    }

    var hasFinalGeneratorQuote: Bool {
        guard let quote, let id = quote.quoteId, let proof = quote.quoteProof else { return false }
        return id.hasPrefix("server-") && !proof.isEmpty && quote.totalPackagePrice > 0 && quote.pricePerPerson > 0
    }

    private func buildNuiteeJourneyQuote() async {
        guard localRoomsComplete, let tier = localPackageTier else {
            quote = nil; errorMessage = "NUITEE_ROOM_SELECTION_INCOMPLETE"; return
        }
        if trip.packageTier != tier { trip.packageTier = tier }
        let identity = localBookingInputKey
        let revision = packageQuoteRevision
        let requestedTrip = trip
        let selectedRooms = localBookingRooms
        quote = nil; errorMessage = nil
        do {
            let pair: (outbound: FlightOffer, inbound: FlightOffer?)
            if let identity = mixedFlightIdentity {
                let providerIDs = identity.dropFirst("mixed:".count).components(separatedBy: "~")
                guard identity.hasPrefix("mixed:"), providerIDs.count == 2,
                      providerIDs.allSatisfy({ !$0.isEmpty }), localJourneyFlights.count == 2 else { throw LocalPricingError.invalidFlightFare }
                let offers = try localJourneyFlights.enumerated().map { index, flight -> FlightOffer in
                    guard let departure = aviasalesDate(flight.departureAt) else { throw LocalPricingError.invalidFlightFare }
                    return makeAviasalesFlightOffer(id: flight.id, direction: index == 0 ? .outbound : .inbound,
                        origin: flight.origin, destination: flight.destination, airlineCode: flight.airlineCode,
                        flightNumber: flight.flightNumber, departure: departure, durationMinutes: flight.durationMinutes,
                        stops: flight.stops, price: flight.displayedPrice ?? 0, currency: "USD", bookingURL: nil, providerID: identity,
                        sourceLabel: providerIDs[index].hasPrefix("curated:") ? "iumrah Published" : "Aviasales Data")
                }
                pair = (offers[0], offers[1])
            } else if packageFlightPath == .aviasalesSelected {
                guard let value = makeAviasalesFlightPair() else { throw LocalPricingError.invalidFlightFare }
                pair = value
            } else if packageFlightPath == .flexibleDates {
                guard let out = selectedOutbound, let back = selectedInbound,
                      out.isVerifiedForBooking, back.isVerifiedForBooking,
                      out.providerItineraryID != nil, out.providerItineraryID == back.providerItineraryID,
                      out.requiresSelfTransfer != true, back.requiresSelfTransfer != true,
                      returnPairMatches(back, outbound: out) else { throw LocalPricingError.invalidFlightFare }
                pair = (out, back)
            } else {
                let resolved = try await CuratedFlightRecommendationService.shared.resolvePublishedSelection(trip: requestedTrip, selection: publishedFlightSelection)
                pair = (resolved.outbound, resolved.inbound)
            }
            guard revision == packageQuoteRevision, localBookingInputKey == identity, !Task.isCancelled else { return }
            guard let makkah = localJourneyRooms["makkah:0"], let inbound = pair.inbound else { throw LocalPricingError.invalidFlightFare }
            let madinah = localJourneyRooms["madinah:0"]
            let resolved = try await packageEngine.packageQuote(trip: requestedTrip, pricingOffer: inbound,
                outboundOffer: pair.outbound, inboundOffer: inbound, makkahHotelID: makkah.hotel.id,
                makkahRoomID: makkah.rate.roomId, madinahHotelID: madinah?.hotel.id, madinahRoomID: madinah?.rate.roomId,
                includeHaramainTrain: haramainTrainSelected, transferVehicle: selectedTransferVehicle,
                haramainFareClass: haramainFareClass, haramainTicketCount: haramainTicketCount,
                nuiteeRooms: selectedRooms, packageApprovalHeaders: tripSummaryApprovalHeaders)
            guard revision == packageQuoteRevision, localBookingInputKey == identity, !Task.isCancelled else { return }
            guard resolved.resolvedTier == tier.rawValue else { throw APIError.server(409, "PACKAGE_TIER_MISMATCH") }
            selectedOutbound = pair.outbound; selectedInbound = inbound
            selectedHotel = makkah.bookingHotel; selectedRoom = makkah.bookingRoom
            selectedRoomCategory = nil; selectedMadinahRoomCategory = nil
            selectedMadinahHotel = madinah?.bookingHotel; selectedMadinahRoom = madinah?.bookingRoom
            quote = resolved; errorMessage = nil
        } catch {
            guard revision == packageQuoteRevision, localBookingInputKey == identity, !Task.isCancelled else { return }
            quote = nil; errorMessage = error.localizedDescription
        }
    }

    func buildQuote(forceHotelRefresh: Bool = false, forceQuoteRefresh: Bool = false) async {
        // Transfer preview, confirmation and final review may request the same quote.
        // Share a single request instead of repeatedly prebooking the same supplier offers.
        if usesLocalJourney, let tier = localPackageTier, trip.packageTier != tier { trip.packageTier = tier }
        let key = usesLocalJourney ? "local|" + localBookingInputKey + "|" + String(packageQuoteRevision) : "catalog|" + String(packageQuoteRevision) + "|" + String(trip.hashValue)
        if quoteTaskKey == key, let task = quoteTask { await task.value; return }
        if usesLocalJourney, !forceHotelRefresh, !forceQuoteRefresh, completedQuoteKey == key, hasFinalGeneratorQuote, quote?.tripSummary != nil, quote?.bookingAllowed == true,
           let completedQuoteAt, Date().timeIntervalSince(completedQuoteAt) < 300 { return }
        quoteTask?.cancel()
        let generation = UUID()
        quoteRequestGeneration = generation
        quoteTaskKey = key
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            await self.performQuote(forceHotelRefresh: forceHotelRefresh)
        }
        quoteTask = task
        await task.value
        if quoteRequestGeneration == generation {
            if hasFinalGeneratorQuote { completedQuoteKey = key; completedQuoteAt = Date() }
            quoteTask = nil; quoteTaskKey = nil
        }
    }

    private func performQuote(forceHotelRefresh: Bool) async {
        guard !Task.isCancelled else { return }
        if usesLocalJourney { await buildNuiteeJourneyQuote(); return }
        let revision = packageQuoteRevision
        let tripForQuote = trip
        guard let hotel = selectedHotel,
              let outbound = selectedOutbound,
              outbound.isVerifiedForBooking else {
            errorMessage = LocalPricingError.invalidFlightFare.localizedDescription
            quote = nil
            return
        }

        let inbound: FlightOffer?
        let pricingOffer: FlightOffer
        if trip.isRoundTripFlight {
            guard let value = selectedInbound,
                  value.isVerifiedForBooking,
                  returnPairMatches(value, outbound: outbound),
                  value.providerItineraryID != nil else {
                errorMessage = LocalPricingError.invalidFlightFare.localizedDescription
                quote = nil
                return
            }
            inbound = value
            pricingOffer = value
        } else {
            guard outbound.providerItineraryID != nil else {
                errorMessage = LocalPricingError.invalidFlightFare.localizedDescription
                quote = nil
                return
            }
            inbound = nil
            pricingOffer = outbound
        }

        if trip.scope == .makkahAndMadinah, selectedMadinahHotel == nil {
            errorMessage = LocalPricingError.missingHotelPrice("Madinah").localizedDescription
            quote = nil
            return
        }

        do {
            // Keep the existing refresh UX, but the client no longer performs any
            // supplier-cost arithmetic. The Worker always re-reads accepted D1 rates.
            if let task = hotelPricePrefetchTask { await task.value }
            if forceHotelRefresh, let components = flightService as? GeneratorComponentProviding {
                hotelPriceSnapshot = await components.ensureHotelPrices(
                    trip: trip,
                    makkahHotel: hotel,
                    madinahHotel: selectedMadinahHotel,
                    makkahRoomId: selectedRoom?.id ?? selectedRoomCategory?.id,
                    makkahRoomName: selectedRoom?.name ?? selectedRoomCategory?.displayName,
                    makkahRoomCapacity: selectedRoom?.maxGuests ?? selectedRoomCategory?.maxGuests,
                    madinahRoomId: selectedMadinahRoom?.id ?? selectedMadinahRoomCategory?.id,
                    madinahRoomName: selectedMadinahRoom?.name ?? selectedMadinahRoomCategory?.displayName,
                    madinahRoomCapacity: selectedMadinahRoom?.maxGuests ?? selectedMadinahRoomCategory?.maxGuests,
                    forceRefresh: true
                )
            }

            let makkahRoom = selectedRoom?.id ?? selectedRoomCategory?.id
            let madinahRoom = selectedMadinahRoom?.id ?? selectedMadinahRoomCategory?.id
            let madinahHotel = selectedMadinahHotel?.id
            let train = haramainTrainSelected
            let vehicle = selectedTransferVehicle
            let fareClass = haramainFareClass
            let tickets = haramainTicketCount
            guard revision == packageQuoteRevision, trip == tripForQuote, !Task.isCancelled else { return }
            let resolved = try await packageEngine.packageQuote(
                trip: tripForQuote,
                pricingOffer: pricingOffer,
                outboundOffer: outbound,
                inboundOffer: inbound,
                makkahHotelID: hotel.id,
                makkahRoomID: makkahRoom,
                madinahHotelID: madinahHotel,
                madinahRoomID: madinahRoom,
                includeHaramainTrain: train,
                transferVehicle: vehicle,
                haramainFareClass: fareClass,
                haramainTicketCount: tickets
            )
            guard revision == packageQuoteRevision, trip == tripForQuote, !Task.isCancelled else { return }
            pricingMakkahRoomID = makkahRoom
            pricingMadinahRoomID = madinahRoom
            quote = resolved
            errorMessage = nil
        } catch {
            guard revision == packageQuoteRevision, trip == tripForQuote, !Task.isCancelled else { return }
            quote = nil
            errorMessage = error.localizedDescription
        }
    }

    /// Builds the four customer-facing package levels for the final review carousel.
    /// The selected flight itinerary, dates, travelers and explicit transfer/Haramain
    /// choices stay fixed. Only the package hotel pair and tier pricing policy change.
    ///
    /// Hotel rates come from the server-maintained iumrah Business catalog. For
    /// Comfort/Luxury comparison cards, paid lunch/dinner allocations are intentionally
    /// disabled: the hotel breakfast remains included at zero extra allocation.
    func buildPackageTierComparisons() async -> [PackageTierComparisonOption] {
        let currentTier = trip.packageTier
        let currentOption = PackageTierComparisonOption(
            tier: currentTier,
            quote: quote,
            makkahHotel: selectedHotel,
            madinahHotel: selectedMadinahHotel,
            unavailableReason: quote == nil ? "CURRENT_QUOTE_UNAVAILABLE" : nil
        )

        guard let context = await packageTierComparisonFlightContext() else {
            return PackageTier.allCases.map { tier in
                if tier == currentTier { return currentOption }
                return PackageTierComparisonOption(
                    tier: tier, quote: nil, makkahHotel: nil, madinahHotel: nil,
                    unavailableReason: "FLIGHT_PRICE_UNAVAILABLE"
                )
            }
        }

        let makkahCatalog = await comparisonMakkahCatalog()
        let madinahCatalog: [HotelSummary]
        if trip.scope == .makkahAndMadinah {
            madinahCatalog = await comparisonMadinahCatalog()
        } else {
            madinahCatalog = []
        }

        var output: [PackageTierComparisonOption] = []
        for tier in PackageTier.allCases {
            if tier == currentTier, currentOption.isAvailable {
                output.append(currentOption)
                continue
            }

            let option = await makePackageTierComparisonOption(
                tier: tier,
                flight: context,
                makkahCatalog: makkahCatalog,
                madinahCatalog: madinahCatalog
            )
            output.append(option)
        }
        return output
    }

    /// Applies an explicitly selected carousel level without touching the verified
    /// flights or the transfer choices. This keeps the final-review interaction
    /// reversible and prevents a tier swipe from silently changing the booking.
    func applyPackageTierComparison(_ option: PackageTierComparisonOption) {
        guard let comparisonQuote = option.quote,
              let makkahHotel = option.makkahHotel else { return }
        if trip.scope == .makkahAndMadinah, option.madinahHotel == nil { return }

        var updatedTrip = trip
        updatedTrip.packageTier = option.tier
        updatedTrip.hotelStars = option.tier.primaryHotelStars
        if option.tier == .comfort || option.tier == .luxury {
            updatedTrip.mealSelection = PackageMealSelection(
                makkahLunch: false,
                makkahDinner: false,
                madinahDinner: false
            )
        } else {
            updatedTrip.mealSelection = nil
        }
        trip = updatedTrip

        selectedHotel = makkahHotel
        selectedRoom = nil
        selectedRoomCategory = nil
        selectedMadinahHotel = option.madinahHotel
        selectedMadinahRoom = nil
        selectedMadinahRoomCategory = nil

        // The comparison quote already uses the accepted D1 room-night rates for
        // the exact trip nights. Clear only the old selected-hotel cache snapshot.
        cancelHotelPricePrefetch()
        hotelPriceSnapshot = nil
        pricingMakkahRoomID = nil
        pricingMadinahRoomID = nil
        (flightService as? AutomaticFlightSearchService)?.invalidateHotelPrices()

        quote = comparisonQuote
        errorMessage = nil
    }

    private func packageTierComparisonFlightContext() async -> PackageTierComparisonFlightContext? {
        guard let outbound = selectedOutbound, outbound.isVerifiedForBooking else { return nil }

        let inbound: FlightOffer?
        let pricingOffer: FlightOffer
        if trip.isRoundTripFlight {
            guard let value = selectedInbound,
                  value.isVerifiedForBooking,
                  returnPairMatches(value, outbound: outbound),
                  value.providerItineraryID != nil else { return nil }
            inbound = value
            pricingOffer = value
        } else {
            guard outbound.providerItineraryID != nil else { return nil }
            inbound = nil
            pricingOffer = outbound
        }

        return PackageTierComparisonFlightContext(
            pricingOffer: pricingOffer,
            outboundOffer: outbound,
            inboundOffer: inbound
        )
    }

    private func makePackageTierComparisonOption(
        tier: PackageTier,
        flight: PackageTierComparisonFlightContext,
        makkahCatalog: [HotelSummary],
        madinahCatalog: [HotelSummary]
    ) async -> PackageTierComparisonOption {
        guard let makkahHotel = await comparisonHotel(for: tier, city: "Makkah", catalog: makkahCatalog) else {
            return PackageTierComparisonOption(
                tier: tier, quote: nil, makkahHotel: nil, madinahHotel: nil,
                unavailableReason: "MAKKAH_PRIMARY_HOTEL_UNAVAILABLE"
            )
        }

        let madinahHotel: HotelSummary?
        if trip.scope == .makkahAndMadinah {
            guard let resolved = await comparisonHotel(for: tier, city: "Madinah", catalog: madinahCatalog) else {
                return PackageTierComparisonOption(
                    tier: tier, quote: nil, makkahHotel: makkahHotel, madinahHotel: nil,
                    unavailableReason: "MADINAH_PRIMARY_HOTEL_UNAVAILABLE"
                )
            }
            madinahHotel = resolved
        } else {
            madinahHotel = nil
        }

        var comparisonTrip = trip
        comparisonTrip.packageTier = tier
        comparisonTrip.hotelStars = tier.primaryHotelStars
        if tier == .comfort || tier == .luxury {
            comparisonTrip.mealSelection = PackageMealSelection(
                makkahLunch: false,
                makkahDinner: false,
                madinahDinner: false
            )
        } else {
            comparisonTrip.mealSelection = nil
        }

        do {
            let comparisonQuote = try await packageEngine.packageQuote(
                trip: comparisonTrip,
                pricingOffer: flight.pricingOffer,
                outboundOffer: flight.outboundOffer,
                inboundOffer: flight.inboundOffer,
                makkahHotelID: makkahHotel.id,
                makkahRoomID: nil,
                madinahHotelID: madinahHotel?.id,
                madinahRoomID: nil,
                includeHaramainTrain: haramainTrainSelected,
                transferVehicle: selectedTransferVehicle,
                haramainFareClass: haramainFareClass,
                haramainTicketCount: haramainTicketCount
            )
            return PackageTierComparisonOption(
                tier: tier,
                quote: comparisonQuote,
                makkahHotel: makkahHotel,
                madinahHotel: madinahHotel,
                unavailableReason: nil
            )
        } catch {
            return PackageTierComparisonOption(
                tier: tier, quote: nil, makkahHotel: makkahHotel, madinahHotel: madinahHotel,
                unavailableReason: "PACKAGE_PRICE_UNAVAILABLE"
            )
        }
    }

    private func comparisonMakkahCatalog() async -> [HotelSummary] {
        if !hotels.isEmpty { return hotels }
        return (try? await hotelService.listHotels(city: "Makkah")) ?? []
    }

    private func comparisonMadinahCatalog() async -> [HotelSummary] {
        if !madinahHotels.isEmpty { return madinahHotels }

        let aliases = [
            "Madinah", "Medina", "Madina", "Medinah",
            "Al Madinah", "Al Medina",
            "Madinah Al Munawwarah", "Al Madinah Al Munawwarah"
        ]
        var merged: [String: HotelSummary] = [:]
        for city in aliases {
            if let values = try? await hotelService.listHotels(city: city) {
                for hotel in values { merged[hotel.id] = hotel }
            }
        }
        return Array(merged.values)
    }

    private func comparisonHotel(for tier: PackageTier, city: String, catalog: [HotelSummary]) async -> HotelSummary? {
        if let policy = comparisonHotelPolicy(for: tier, city: city) {
            // Standard / Comfort / Luxury comparison is intentionally deterministic:
            // these are the concrete hotels agreed for the final-page price ladder.
            // Do not silently substitute another same-star property, because then
            // the displayed upgrade delta would no longer represent the product.
            return fixedComparisonHotel(
                in: catalog,
                preferredNames: policy.preferredNames,
                requiredTokenGroups: policy.requiredTokenGroups
            )
        }

        // Economy intentionally follows the Business Primary Hotels 2★ slot first,
        // then the 1★ Super Economy slot, as its concrete hotel remains Business-led.
        let requestedStars = [2, 1]
        for stars in requestedStars {
            if let resolved = try? await packageEngine.primaryHotel(tier: tier, stars: stars, city: city),
               let hotel = catalog.first(where: { $0.id == resolved.hotelId }) {
                return hotel
            }
        }

        for stars in requestedStars {
            if let priced = catalog.first(where: { $0.stars == stars && $0.price?.isUsableForPackage == true }) {
                return priced
            }
            if let any = catalog.first(where: { $0.stars == stars }) { return any }
        }
        return nil
    }

    private func comparisonNightlyUsd(for hotel: HotelSummary) async -> Decimal? {
        if let value = decimalNightlyUsd(hotel.price) { return value }
        guard let detail = try? await hotelService.hotelDetail(id: hotel.id) else { return nil }
        return decimalNightlyUsd(detail.price)
    }

    private func decimalNightlyUsd(_ price: HotelCatalogPrice?) -> Decimal? {
        guard let price, price.isUsableForPackage,
              let amount = price.nightlyUSD, amount.isFinite, amount > 0 else { return nil }
        return NSDecimalNumber(value: amount).decimalValue
    }

    private func comparisonHotelPolicy(
        for tier: PackageTier,
        city: String
    ) -> (preferredNames: [String], requiredTokenGroups: [[String]])? {
        let isMadinah = city.caseInsensitiveCompare("Madinah") == .orderedSame
        switch (tier, isMadinah) {
        case (.standard, false):
            return (["Nawazi Hotel", "Nawazi Watheer Hotel"], [["nawazi"]])
        case (.standard, true), (.comfort, true):
            return (["Mihrab Tayyiba", "Mihrab Tayba", "Mihrab Taiba"], [["mihrab"], ["tayyiba", "tayba", "taiba"]])
        case (.comfort, false):
            return (["Shohada Hotel", "Al Shohada Hotel", "Shuhada Hotel", "Al Shuhada Hotel"], [["shohada", "shuhada"]])
        case (.luxury, false):
            return (["Address Jabal Omar Makkah", "Address Jabal Omar", "Jabal Omar Address"], [["address"], ["jabal"], ["omar", "umar"]])
        case (.luxury, true):
            return (["Pullman Zamzam Madina", "Pullman Zamzam Madinah", "Pullman Zamzam"], [["pullman"], ["zamzam", "zam zam"]])
        case (.economy, _):
            return nil
        }
    }

    private func fixedComparisonHotel(
        in catalog: [HotelSummary],
        preferredNames: [String],
        requiredTokenGroups: [[String]]
    ) -> HotelSummary? {
        let preferred = preferredNames.map(normalizedHotelComparisonText)
        if let exact = catalog.first(where: { preferred.contains(normalizedHotelComparisonText($0.name)) }) {
            return exact
        }

        return catalog.first { hotel in
            let normalized = normalizedHotelComparisonText(hotel.name)
            return requiredTokenGroups.allSatisfy { alternatives in
                alternatives.contains { token in normalized.contains(normalizedHotelComparisonText(token)) }
            }
        }
    }

    private func normalizedHotelComparisonText(_ value: String) -> String {
        let folded = value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        let scalars = folded.unicodeScalars.map { scalar -> Character in
            CharacterSet.alphanumerics.contains(scalar) ? Character(String(scalar)) : " "
        }
        return String(scalars)
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
            .lowercased()
    }

    /// The Ignav path relies on a `pairedLeg` attached to its complete provider
    /// itinerary. Flight First deliberately makes separate FlightOffer display
    /// models for the *same* round-trip Data row; they have no pairedLeg. Their
    /// actual identity is server-revalidated and never priced from the client.
    private func returnPairMatches(_ inbound: FlightOffer, outbound: FlightOffer) -> Bool {
        if packageFlightPath == .aviasalesSelected || packageFlightPath == .publishedDirect {
            guard let outboundID = outbound.providerItineraryID,
                  let inboundID = inbound.providerItineraryID,
                  !outboundID.isEmpty, outboundID == inboundID,
                  outbound.origin.uppercased() == inbound.destination.uppercased(),
                  inbound.departureAt > outbound.departureAt else { return false }
            if let mixedFlightIdentity, outboundID == mixedFlightIdentity {
                return ["JED", "MED"].contains(outbound.destination.uppercased()) &&
                    ["JED", "MED"].contains(inbound.origin.uppercased())
            }
            if packageFlightPath == .aviasalesSelected {
                return outboundID.hasPrefix("aviasales:") &&
                    (outbound.destination.uppercased() == inbound.origin.uppercased() ||
                     (["JED", "MED"].contains(outbound.destination.uppercased()) && ["JED", "MED"].contains(inbound.origin.uppercased())))
            }
            return outboundID.hasPrefix("curated:") &&
                ["JED", "MED"].contains(inbound.origin.uppercased())
        }
        return returnOffer(inbound, matches: outbound)
    }

    private func returnOffer(_ inbound: FlightOffer, matches outbound: FlightOffer) -> Bool {
        guard let paired = inbound.pairedLeg else { return false }
        let selectedNumbers = Set(outbound.displaySegments.compactMap { FlightReferenceCatalog.normalizedVerifiedFlightNumber($0.flightNumber) })
        let pairedNumbers = Set((paired.segments ?? []).compactMap { FlightReferenceCatalog.normalizedVerifiedFlightNumber($0.flightNumber) })
        if !selectedNumbers.isEmpty && selectedNumbers != pairedNumbers { return false }
        return paired.origin.caseInsensitiveCompare(outbound.origin) == .orderedSame &&
            paired.destination.caseInsensitiveCompare(outbound.destination) == .orderedSame &&
            abs(paired.departureAt.timeIntervalSince(outbound.departureAt)) < 5 * 60
    }


    private func travelCalendarDay(for date: Date, airportCode: String) -> Date {
        var source = Calendar(identifier: .gregorian)
        source.timeZone = FlightReferenceCatalog.timeZone(for: airportCode) ?? TimeZone(secondsFromGMT: 0)!
        let parts = source.dateComponents([.year, .month, .day], from: date)

        var local = Calendar.current
        local.timeZone = .current
        return local.date(from: DateComponents(year: parts.year, month: parts.month, day: parts.day, hour: 12))
            ?? local.startOfDay(for: date)
    }

}

@MainActor extension JourneyStore {
    /// Resolve the already selected itinerary once, without touching the retired hotel-price catalogue.
    func prepareUnifiedHotelSelection() async throws {
        let requested = trip
        let path = packageFlightPath
        let selection = publishedFlightSelection
        let staged = stagedAviasalesOffers
        let pair: (outbound: FlightOffer, inbound: FlightOffer?)
        if path == .publishedDirect {
            let value = try await CuratedFlightRecommendationService.shared.resolvePublishedSelection(trip: requested, selection: selection)
            pair = (value.outbound, value.inbound)
        } else if path == .aviasalesSelected, let value = makeAviasalesFlightPair() {
            pair = value
        } else { throw LocalPricingError.invalidFlightFare }
        try Task.checkCancellation()
        guard trip == requested, packageFlightPath == path,
              let back = pair.inbound, pair.outbound.isVerifiedForBooking, back.isVerifiedForBooking,
              back.departureAt > pair.outbound.arrivalAt else { throw LocalPricingError.invalidFlightFare }
        // The identities themselves can change while dates stay unchanged.
        if path == .publishedDirect {
            guard publishedFlightSelection.completeID == selection.completeID,
                  publishedFlightSelection.outboundID == selection.outboundID,
                  publishedFlightSelection.returnID == selection.returnID else { throw CancellationError() }
        } else { guard stagedAviasalesOffers == staged else { throw CancellationError() } }
        let start = travelCalendarDay(for: pair.outbound.arrivalAt, airportCode: pair.outbound.destination)
        let end = travelCalendarDay(for: back.departureAt, airportCode: back.origin)
        let nights = Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: start), to: Calendar.current.startOfDay(for: end)).day ?? 0
        guard nights >= (trip.scope == .makkahAndMadinah ? 2 : 1) else { throw LocalPricingError.invalidFlightFare }
        cancelHotelPricePrefetch()
        invalidateTripSummaryQuote()
        usesLocalJourney = true
        trip.departureDate = travelCalendarDay(for: pair.outbound.departureAt, airportCode: pair.outbound.origin)
        trip.saudiArrivalDate = start; trip.returnDate = end
        trip.arrivalAirport = pair.outbound.destination.uppercased() == "MED" ? .madinah : .jeddah
        trip.selectedReturnAirport = back.origin.uppercased() == "MED" ? .madinah : .jeddah
        trip.flightTripType = .roundTrip
        selectedOutbound = pair.outbound; selectedInbound = back
        let iso = ISO8601DateFormatter()
        localJourneyFlights = [pair.outbound, back].map { offer in
            LocalJourneyFlight(id: offer.id, origin: offer.origin, destination: offer.destination, airline: offer.airline,
                flightNumber: offer.flightNumber, airlineCode: offer.airlineCode ?? "", durationMinutes: offer.durationMinutes,
                stops: offer.stops, departureAt: iso.string(from: offer.departureAt), arrivalAt: iso.string(from: offer.arrivalAt),
                displayedPrice: offer.fareAmount.map { NSDecimalNumber(decimal: $0).doubleValue })
        }
        localJourneyRooms = [:]
        selectedHotel = nil; selectedRoom = nil; selectedRoomCategory = nil
        selectedMadinahHotel = nil; selectedMadinahRoom = nil; selectedMadinahRoomCategory = nil
    }

    func invalidateTripSummaryQuote() {
        quoteTask?.cancel(); quoteTask = nil; quoteTaskKey = nil
        quoteRequestGeneration = UUID()
        tripSummaryRevision &+= 1
        packageQuoteRevision &+= 1
        cachedLocalBookingInputKey = nil
        quote = nil
    }
    func applyTripSummaryGuests(_ next: TripDraft, ages: [Int]) {
        invalidateTripSummaryQuote()
        trip = next
        tripSummaryChildAges = ages
        // Keep hotel and room identity. Old supplier tokens cannot price a changed occupancy.
        let previous = localJourneyRooms
        var preserved: [String: LocalJourneyRoom] = [:]
        for city in ["makkah", "madinah"] {
            let old = previous.values.filter { $0.city == city }.sorted { $0.id < $1.id }
            guard let first = old.first else { continue }
            for index in 0..<next.rooms {
                let key = "\(city):\(index)"
                let existing = previous[key]
                let source = existing ?? first
                let adults = next.adults / next.rooms + (index < next.adults % next.rooms ? 1 : 0)
                let children = ages.enumerated().filter { $0.offset % next.rooms == index }.map(\.element)
                let pending = existing == nil || source.requiresRateRefresh == true || source.adults != adults || source.childrenAges != children
                var hotel = source.hotel
                if pending { hotel.minimumRate = nil; hotel.rateStatus = nil }
                preserved[key] = LocalJourneyRoom(id: key, city: city, hotel: hotel, rate: source.rate,
                    checkin: source.checkin, checkout: source.checkout, adults: adults, childrenAges: children,
                    meals: source.meals, requiresRateRefresh: pending)
            }
        }
        localJourneyRooms = preserved
        hotelPriceSnapshot = nil; cancelHotelPricePrefetch()
        if let vehicle = selectedTransferVehicle, vehicle.passengerCapacity < next.travelerCount {
            selectedTransferVehicle = TransferVehicleKind.carnival.passengerCapacity >= next.travelerCount ? .carnival : nil
            transferSelectionConfirmed = false
        }
        if haramainTrainSelected { haramainAdultTickets = next.adults; haramainChildTickets = next.children; transferSelectionConfirmed = false }
    }
    func tripSummaryEditingCopy() -> JourneyStore {
        let copy = JourneyStore()
        copy.trip = trip; copy.tripSummaryChildAges = tripSummaryChildAges; copy.tripSummaryApprovalHeaders = tripSummaryApprovalHeaders; copy.usesLocalJourney = usesLocalJourney
        copy.localJourneyFlights = localJourneyFlights; copy.localJourneyRooms = localJourneyRooms
        copy.packageFlightPath = packageFlightPath; copy.flightSearchFlexDays = flightSearchFlexDays
        copy.selectedPublishedCompleteID = selectedPublishedCompleteID; copy.selectedPublishedOutboundID = selectedPublishedOutboundID; copy.selectedPublishedReturnID = selectedPublishedReturnID
        copy.stagedUmrahFlights = stagedUmrahFlights; copy.stagedAviasalesOffers = stagedAviasalesOffers; copy.mixedFlightIdentity = mixedFlightIdentity
        copy.selectedHotel = selectedHotel; copy.selectedRoom = selectedRoom; copy.selectedRoomCategory = selectedRoomCategory
        copy.selectedMadinahHotel = selectedMadinahHotel; copy.selectedMadinahRoom = selectedMadinahRoom; copy.selectedMadinahRoomCategory = selectedMadinahRoomCategory
        copy.hotels = hotels; copy.madinahHotels = madinahHotels
        copy.selectedOutbound = selectedOutbound; copy.selectedInbound = selectedInbound
        copy.selectedTransferVehicle = selectedTransferVehicle; copy.transferSelectionConfirmed = transferSelectionConfirmed
        copy.haramainTrainSelected = haramainTrainSelected; copy.haramainFareClass = haramainFareClass; copy.haramainAdultTickets = haramainAdultTickets; copy.haramainChildTickets = haramainChildTickets
        return copy
    }
    func applyTripSummaryEditor(_ session: TripSummaryEditSession) {
        let copy = session.draft
        invalidateTripSummaryQuote()
        switch session.kind {
        case .flights:
            let old = trip
            trip = copy.trip; usesLocalJourney = copy.usesLocalJourney
            packageFlightPath = copy.packageFlightPath; flightSearchFlexDays = copy.flightSearchFlexDays
            selectedPublishedCompleteID = copy.selectedPublishedCompleteID; selectedPublishedOutboundID = copy.selectedPublishedOutboundID; selectedPublishedReturnID = copy.selectedPublishedReturnID
            stagedUmrahFlights = copy.stagedUmrahFlights; stagedAviasalesOffers = copy.stagedAviasalesOffers; mixedFlightIdentity = copy.mixedFlightIdentity
            localJourneyFlights = copy.localJourneyFlights; selectedOutbound = copy.selectedOutbound; selectedInbound = copy.selectedInbound
            let sameStay = old.departureDate == trip.departureDate && old.returnDate == trip.returnDate && old.hotelStayStartDate == trip.hotelStayStartDate && old.arrivalAirport == trip.arrivalAirport && old.scope == trip.scope
            if !sameStay { localJourneyRooms = [:]; selectedRoom = nil; selectedMadinahRoom = nil; selectedRoomCategory = nil; selectedMadinahRoomCategory = nil }
            if !old.isRoundTripFlight || !sameStay { transferSelectionConfirmed = false }
        case .hotel, .allHotels:
            localJourneyRooms = copy.localJourneyRooms; trip.packageTier = copy.trip.packageTier
            let ages = copy.localJourneyRooms.values.filter { $0.city == "makkah" }.sorted { $0.id < $1.id }.flatMap(\.childrenAges)
            if ages.count == trip.children + trip.infants { tripSummaryChildAges = ages }
        case .catalog:
            selectedHotel = copy.selectedHotel; selectedRoom = copy.selectedRoom; selectedRoomCategory = copy.selectedRoomCategory
            selectedMadinahHotel = copy.selectedMadinahHotel; selectedMadinahRoom = copy.selectedMadinahRoom; selectedMadinahRoomCategory = copy.selectedMadinahRoomCategory
        case .transfer:
            selectedTransferVehicle = copy.selectedTransferVehicle; transferSelectionConfirmed = copy.transferSelectionConfirmed
        }
        hotelPriceSnapshot = nil; cancelHotelPricePrefetch()
    }
}
