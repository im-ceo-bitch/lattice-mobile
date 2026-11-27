import SwiftUI

/// Dedicated Flight First screen. No tab switch, basket, fabricated fare or new API contract.
/// All published and Data API rows are normalized into one visible list, then ranked.
struct IumrahGuidedFlightSelectionView: View {
    @EnvironmentObject private var journey: JourneyStore
    @EnvironmentObject private var settings: AppSettingsStore
    @Environment(\.dismiss) private var dismiss

    var smartConfirm: (() -> Void)? = nil

    @State private var filters = IumrahFlightFilterState()
    @State private var visibleCount = 20
    @State private var editingSearch = false
    @State private var step: LegStep = .outbound
    @State private var published: [CuratedFlightRecommendation] = []
    @State private var dataOutbound: [FlightDiscoveryOffer] = []
    @State private var dataReturn: [FlightDiscoveryOffer] = []
    @State private var outboundCalendar: [FlightDiscoveryCalendarDay] = []
    @State private var returnCalendar: [FlightDiscoveryCalendarDay] = []
    @State private var calendarCache: [String: CalendarCacheEntry] = [:]
    private struct CalendarCacheEntry { let days: [FlightDiscoveryCalendarDay]; let expires: Date }
    @State private var outbound: FlightChoice?
    @State private var inbound: FlightChoice?
    @State private var isLoading = false
    @State private var loadingRequestID = UUID()
    @State private var loadedTrip: FlightQueryKey?
    @State private var requestedTrip: FlightQueryKey?
    private struct FlightQueryKey: Equatable {
        let origin: String, destination: String, returning: String
        let departure: Date, back: Date
        let adults: Int, children: Int, infants: Int, flexibility: Int
        let cabin: FlightCabinClass
        init(_ trip: TripDraft, flexibility: Int) {
            origin = trip.originCode; destination = trip.outboundDestinationCode; returning = trip.returnOriginCode
            departure = Calendar.current.startOfDay(for: trip.departureDate); back = Calendar.current.startOfDay(for: trip.returnDate)
            adults = trip.adults; children = trip.children; infants = trip.infants; self.flexibility = flexibility
            cabin = trip.effectiveFlightFilters.cabinClass
        }
    }
    private var queryKey: FlightQueryKey { FlightQueryKey(journey.trip, flexibility: flexDays) }
    @State private var loadError: String?
    @State private var pendingChoice: FlightChoice?
    @State private var advanceAfterFlightDetail = false
    @State private var selectedDetail: FlightChoice?
    @State private var showHotelPicker = false
    @State private var isFlightHeaderVisible = true
    @State private var isShowingSourceHelp = false
    @State private var dataRevision = 0
    private struct SnapshotKey: Equatable {
        let revision: Int
        let trip: TripDraft
        let step: LegStep
        let outbound: FlightChoice?
        let filters: IumrahFlightFilterState
        let today: Date
        let timeZone: String
        let flexDays: Int
    }
    private struct Snapshot {
        let available: [FlightChoice]
        let airlines: [String]
        let days: [IumrahFlightPriceDay]
        let direct: [FlightChoice]
        let connecting: [FlightChoice]
        let nearby: [FlightChoice]
    }
    @State private var memo = IumrahViewMemo<SnapshotKey, Snapshot>()

    private enum LegStep: Hashable { case outbound, inbound }
    fileprivate enum Source: Hashable { case published, dataAPI }

    fileprivate enum FlightChoice: Hashable, Identifiable {
        case published(CuratedFlightRecommendation, isReturn: Bool)
        case dataAPI(FlightDiscoveryOffer)

        var id: String {
            switch self {
            case .published(let item, let isReturn): return "pub:\(item.id):\(isReturn)"
            case .dataAPI(let offer): return "api:\(offer.id)"
            }
        }
        var source: Source {
            switch self { case .published: return .published; case .dataAPI: return .dataAPI }
        }
        var origin: String {
            switch self {
            case .published(let item, let isReturn): return isReturn ? (item.inbound?.origin ?? item.outbound.origin) : item.outbound.origin
            case .dataAPI(let offer): return offer.origin
            }
        }
        var destination: String {
            switch self {
            case .published(let item, let isReturn): return isReturn ? (item.inbound?.destination ?? item.outbound.destination) : item.outbound.destination
            case .dataAPI(let offer): return offer.destination
            }
        }
        var airlineCode: String {
            switch self {
            case .published(let item, let isReturn): return isReturn ? (item.inbound?.airlineCode ?? item.outbound.airlineCode) : item.outbound.airlineCode
            case .dataAPI(let offer): return offer.airlineCode
            }
        }
        var airlineName: String {
            switch self {
            case .published(let item, let isReturn): return isReturn ? (item.inbound?.airline ?? item.primaryAirlineName) : item.primaryAirlineName
            case .dataAPI(let offer): return offer.airlineName
            }
        }
        var flightNumber: String {
            switch self {
            case .published(let item, let isReturn): return isReturn ? (item.inbound?.flightNumber ?? item.outbound.flightNumber) : item.outbound.flightNumber
            case .dataAPI(let offer): return offer.flightNumber
            }
        }
        var departureAt: String {
            switch self {
            case .published(let item, let isReturn): return isReturn ? (item.inbound?.departureAt ?? item.outbound.departureAt) : item.outbound.departureAt
            case .dataAPI(let offer): return offer.departureAt
            }
        }
        var arrivalAt: String? {
            switch self {
            case .published(let item, let isReturn):
                return isReturn ? (item.inbound?.arrivalAt ?? item.outbound.arrivalAt) : item.outbound.arrivalAt
            case .dataAPI(let offer):
                return offer.arrivalAt ?? FlightDiscoveryItineraryValidator.verified(offer.outboundSegments,
                    origin: offer.origin, destination: offer.destination, transfers: offer.transfers)?.last?.arrivalAt
            }
        }
        var stops: Int {
            switch self {
            case .published(let item, let isReturn): return isReturn ? (item.inbound?.stops ?? item.outbound.stops) : item.outbound.stops
            case .dataAPI(let offer): return offer.transfers
            }
        }
        var duration: Int {
            switch self {
            case .published(let item, let isReturn): return isReturn ? (item.inbound?.durationMinutes ?? item.outbound.durationMinutes) : item.outbound.durationMinutes
            case .dataAPI(let offer): return offer.durationMinutes
            }
        }
        var price: Double? {
            switch self { case .published(let item, _): return item.fareUsdPerTraveler; case .dataAPI(let offer): return offer.price > 0 ? offer.price : nil }
        }
        var dedupeKey: String {
            // Same operating flight can be represented in local time or UTC by
            // the two providers. Compare its flight number and local travel day.
            let flight = flightNumber.trimmingCharacters(in: .whitespacesAndNewlines)
            let date = String(IumrahFlightClock.local(departureAt, airport: origin).prefix(10))
            return [origin.uppercased(), destination.uppercased(), airlineCode.uppercased(),
                    flight.uppercased(), date, flight.isEmpty ? String(departureAt.prefix(16)) : ""].joined(separator: "|")
        }
        var isCompletePublishedPair: Bool {
            if case .published(let item, _) = self { return item.inbound != nil }
            return false
        }
    }

    private var outboundCode: String { journey.trip.originCode.uppercased() }
    private var destinationCode: String { journey.trip.outboundDestinationCode.uppercased() }
    private var returnCode: String { journey.trip.returnOriginCode.uppercased() }
    private var flexDays: Int { min(max(3, journey.flightSearchFlexDays), 4) }
    private var selectedCabin: FlightCabinClass { journey.trip.effectiveFlightFilters.cabinClass }
    private var currentTarget: Date { step == .outbound ? journey.trip.departureDate : journey.trip.returnDate }
    private var currentOrigin: String { step == .outbound ? outboundCode : returnCode }
    private var currentDestination: String { step == .outbound ? destinationCode : outboundCode }
    private var hasSelection: Bool { outbound != nil && inbound != nil }

    private func tr(_ ru: String, _ en: String, _ uz: String, _ uzCy: String) -> String {
        switch settings.language {
        case .russian: return ru
        case .uzbek: return uz
        case .uzbekCyrillic: return uzCy
        default: return en
        }
    }

    var body: some View {
        let key = SnapshotKey(revision: dataRevision, trip: journey.trip, step: step,
            outbound: outbound, filters: filters, today: Calendar.current.startOfDay(for: Date()),
            timeZone: TimeZone.current.identifier, flexDays: flexDays)
        let snapshot = memo.value(for: key) {
            let available = availableCandidates
            let visible = visibleCandidates(available)
            var direct: [FlightChoice] = [], connecting: [FlightChoice] = [], nearby: [FlightChoice] = []
            for choice in visible {
                if dayOffset(for: choice) != 0 { nearby.append(choice) }
                else if choice.stops == 0 { direct.append(choice) }
                else if choice.stops > 0 { connecting.append(choice) }
            }
            return Snapshot(available: available, airlines: Array(Set(available.map(\.airlineCode))).sorted(),
                days: observedFareDays, direct: direct, connecting: connecting, nearby: nearby)
        }
        ScrollViewReader { proxy in
            ScrollView(showsIndicators: false) {
                LazyVStack(spacing: 0) {
                    blackHero
                        .id("flight-header")
                        .background {
                            GeometryReader { geo in
                                Color.clear.preference(key: IumrahScrollingHeroBottomKey.self,
                                    value: geo.frame(in: .named("flightFirstScroll")).maxY)
                            }
                        }
                    LazyVStack(alignment: .leading, spacing: 16) {
                        stepSelector.id("flight-step-selector")
                        searchControls(snapshot)
                        resultsSection(snapshot)
                            .id("flight-results")
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 18)
                    .padding(.bottom, 50)
                }
                .background(IumrahFlightPalette.page)
                .background(IumrahNoVerticalBounce())
            }
            .modifier(IumrahJourneyRefresh { await loadFlights() })
            .coordinateSpace(name: "flightFirstScroll")
            .onPreferenceChange(IumrahScrollingHeroBottomKey.self) { bottom in
                let visible = bottom > 35
                if isFlightHeaderVisible != visible { isFlightHeaderVisible = visible }
            }
            .onChange(of: step) { _, _ in
                visibleCount = 20
                pendingChoice = nil
                filters = IumrahFlightFilterState()
                withAnimation(.easeInOut(duration: 0.28)) {
                    proxy.scrollTo("flight-header", anchor: .top)
                }
            }
        }
        .background(IumrahFlightPalette.page.ignoresSafeArea(edges: .bottom))
        .tint(Color.primary)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            stageContinueButton
        }
        .toolbar(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .navigationDestination(item: $selectedDetail) { choice in
            IumrahGuidedFlightDetailView(
                choice: choice,
                language: settings.language,
                adults: journey.trip.adults,
                children: journey.trip.children,
                infants: journey.trip.infants,
                onChoose: { pendingChoice = choice; advanceAfterFlightDetail = true }
            )
            .onDisappear {
                if advanceAfterFlightDetail {
                    advanceAfterFlightDetail = false
                    confirmPendingChoice()
                }
            }
        }
        .navigationDestination(isPresented: $showHotelPicker) {
            NuiteeJourneyHotelsView()
        }
        .task {
            guard loadedTrip != queryKey, !isLoading else { return }
            await loadFlights(preserveCalendar: requestedTrip == queryKey)
        }
        .onChange(of: filters) { _, _ in visibleCount = 20 }
        .alert(tr("Совместимость тарифов", "Fare compatibility", "Tarif mosligi", "Тариф мослиги"), isPresented: $isShowingSourceHelp) {
            Button(tr("Понятно", "OK", "Tushunarli", "Тушунарли"), role: .cancel) { }
        } message: {
            Text(tr("Для одного пакета оба рейса должны быть из совместимого источника. Выберите другую пару.",
                    "Both legs must use a compatible source for one package. Please select another pair.",
                    "Bir paketda ikkala reys ham mos manbadan bo‘lishi kerak. Boshqa juftlik tanlang.",
                    "Бир пакетда иккала рейс ҳам мос манбадан бўлиши керак. Бошқа жуфтлик танланг."))
        }
    }

    @ViewBuilder
    private var stageContinueButton: some View {
        if pendingChoice != nil || (step == .outbound ? outbound != nil : inbound != nil) {
            Button {
                if pendingChoice == nil { pendingChoice = step == .outbound ? outbound : inbound }
                confirmPendingChoice()
            } label: {
                Text(step == .outbound ? tr("Выбрать этот авиабилет", "Choose this flight", "Shu reysni tanlash", "Шу рейсни танлаш") : tr("Выбрать обратный рейс", "Choose this return flight", "Qaytish reysini tanlash", "Қайтиш рейсини танлаш"))
            }.buttonStyle(IumrahPrimaryButtonStyle()).padding(.horizontal, 20).padding(.vertical, 8)
        }
    }

    private var blackHero: some View {
        IumrahJourneyHeader(pageBackground: IumrahFlightPalette.page, flightHeading: .init(
            origin: currentOrigin, destination: currentDestination,
            title: step == .outbound
                ? tr("Выберите рейс туда", "Choose outbound flight", "Borish reysini tanlang", "Бориш рейсини танланг")
                : tr("Выберите обратный рейс", "Choose return flight", "Qaytish reysini tanlang", "Қайтиш рейсини танланг"))) {
            searchSummary
        }
    }

    private var searchSummary: some View {
        IumrahGraphiteSearchSurface(isExpanded: $editingSearch,
            summary: "\(currentOrigin) → \(currentDestination)",
            subtitle: "\(dayText(journey.trip.departureDate)) – \(dayText(journey.trip.returnDate)) · \(journey.trip.travelerCount) · \(cabinTitle)") {
            IumrahCompactSearchFields {
                IumrahFlightSearchEditor(lockParty: smartConfirm != nil) {
                    editingSearch = false
                    guard requestedTrip != queryKey else { return }
                    pendingChoice = nil
                    outbound = nil
                    inbound = nil
                    step = .outbound
                    Task { await loadFlights() }
                }
            }
        }
    }

    private var cabinTitle: String {
        switch selectedCabin {
        case .economy: return tr("Эконом", "Economy", "Ekonom", "Эконом")
        case .premiumEconomy: return tr("Премиум-эконом", "Premium economy", "Premium ekonom", "Премиум эконом")
        case .business: return tr("Бизнес", "Business", "Biznes", "Бизнес")
        case .first: return tr("Первый", "First", "Birinchi", "Биринчи")
        }
    }

    private var stepSelector: some View {
        IumrahGlassPillSelector(options: [
            .init(LegStep.outbound, tr("Туда", "Outbound", "Borish", "Бориш")),
            .init(LegStep.inbound, tr("Обратно", "Return", "Qaytish", "Қайтиш"), enabled: outbound != nil)
        ], selection: step, onSelect: { step = $0 }, height: 58)
    }

    private func resultsSection(_ snapshot: Snapshot) -> some View {
        LazyVStack(alignment: .leading, spacing: 15) {
            if isLoading && snapshot.available.isEmpty { ProgressView().frame(maxWidth: .infinity) }

            if step == .inbound && outbound != nil && snapshot.available.isEmpty && !isLoading && loadError == nil {
                Text(tr("Для выбранного рейса туда пока нет совместимых обратных вариантов. Выберите другой рейс туда или измените даты.",
                        "No compatible return flights for your outbound choice. Choose another outbound flight or change dates.",
                        "Tanlangan borish reysiga mos qaytish reysi yo‘q. Boshqa reys yoki sanani tanlang.",
                        "Танланган бориш рейсига мос қайтиш рейси йўқ. Бошқа рейс ёки санани танланг."))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(16)
                    .background(IumrahFlightPalette.card, in: RoundedRectangle(cornerRadius: 18))
                Button(tr("Изменить рейс туда", "Change outbound", "Borish reysini o‘zgartirish", "Бориш рейсини ўзгартириш")) {
                    inbound = nil
                    outbound = nil
                    withAnimation(.easeInOut(duration: 0.2)) { step = .outbound }
                }
                .buttonStyle(IumrahSecondaryButtonStyle())
            }

            if loadError != nil, snapshot.available.isEmpty {
                Text(tr("Не удалось загрузить рейсы. Повторите поиск.", "Could not load flights. Try again.", "Reyslar yuklanmadi. Qayta urinib ko‘ring.", "Рейслар юкланмади. Қайта уриниб кўринг.")).font(.footnote).foregroundStyle(.secondary)
                Button(tr("Повторить", "Retry", "Qayta urinish", "Қайта уриниш")) {
                    Task { await loadFlights() }
                }
                .buttonStyle(IumrahSecondaryButtonStyle())
            }

            if !isLoading && snapshot.available.isEmpty && loadError == nil {
                Label(tr("Подходящих рейсов пока нет. Попробуйте другие даты или класс.",
                         "No matching flights yet. Try different dates or cabin class.",
                         "Mos reyslar hozircha yo‘q. Boshqa sana yoki klassni tanlang.",
                         "Мос рейслар ҳозирча йўқ. Бошқа сана ёки классни танланг."), systemImage: "airplane.circle")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(18)
                    .background(IumrahFlightPalette.card, in: RoundedRectangle(cornerRadius: 18))
            }

            flightGroup(snapshot.direct, title: tr("Прямые рейсы", "Non-stop flights", "To‘g‘ridan-to‘g‘ri reyslar", "Тўғридан-тўғри рейслар"))
            flightGroup(snapshot.connecting, title: tr("Рейсы с пересадкой", "Connecting flights", "Transferli reyslar", "Трансферли рейслар"))
            flightGroup(snapshot.nearby, title: tr("Соседние даты", "Nearby dates", "Yaqin sanalar", "Яқин саналар"))

            Text(tr("Наличие и стоимость проверим после заявки, до оплаты.",
                    "Availability and price are checked after your request, before payment.",
                    "Mavjudlik va narx arizadan keyin, to‘lovdan oldin tekshiriladi.",
                    "Мавжудлик ва нарх аризадан кейин, тўловдан олдин текширилади."))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func flightGroup(_ flights: [FlightChoice], title: String) -> some View {
        if !flights.isEmpty {
            LazyVStack(alignment: .leading, spacing: 10) {
                Text(title)
                    .font(.headline)
                ForEach(flights) { choice in
                    flightCard(choice)
                }
            }
        }
    }

    private func flightCard(_ choice: FlightChoice) -> some View {
        IumrahFlightResultCard(airline: choice.airlineName, airlineCode: choice.airlineCode,
            flightNumber: choice.flightNumber, origin: choice.origin, destination: choice.destination,
            departureAt: choice.departureAt, arrivalAt: choice.arrivalAt, duration: choice.duration,
            stops: choice.stops, price: choice.price, isAviasales: choice.source == .dataAPI,
            isRoundTripFare: choice.isCompletePublishedPair, selected: (pendingChoice?.id ?? (step == .outbound ? outbound?.id : inbound?.id)) == choice.id,
            selectedSearchDay: dayKey(IumrahFlightDiscoveryStore.dayFormatter.string(from: currentTarget)),
            onSelect: { IumrahHaptics.selection(); withAnimation { pendingChoice = pendingChoice?.id == choice.id ? nil : choice } }) {
                selectedDetail = choice
                IumrahHaptics.soft()
            }
    }

    private var minimumSearchDay: String {
        let today = Calendar.current.startOfDay(for: Date())
        let afterOutbound = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: journey.trip.departureDate)) ?? today
        return IumrahFlightDiscoveryStore.dayFormatter.string(from: step == .outbound ? today : max(today, afterOutbound))
    }
    private var observedFareDays: [IumrahFlightPriceDay] {
        let prices = calendarOffers.map { (IumrahFlightClock.local($0.departureAt, airport: $0.origin), Optional($0.price)) }
        return IumrahFlightSearchControls.priceDays(prices + calendarPrices)
    }
    private func searchControls(_ snapshot: Snapshot) -> some View {
        IumrahFlightSearchControls(filters: $filters,
            airlines: snapshot.airlines,
            days: snapshot.days,
            selectedDay: dayKey(IumrahFlightDiscoveryStore.dayFormatter.string(from: currentTarget)),
            minimumDay: minimumSearchDay,
            onSelectDay: { key in
                guard let date = dateFromISODay(key), date >= Calendar.current.startOfDay(for: Date()),
                      !Calendar.current.isDate(date, inSameDayAs: currentTarget) else { return }
                pendingChoice = nil
                if step == .outbound {
                    journey.trip.departureDate = date
                    outbound = nil; inbound = nil
                    if journey.trip.returnDate <= date {
                        journey.trip.returnDate = Calendar.current.date(byAdding: .day, value: 7, to: date) ?? date
                    }
                } else {
                    guard date > journey.trip.departureDate else { return }
                    journey.trip.returnDate = date; inbound = nil
                }
                Task { await loadFlights(preserveCalendar: true) }
            })
            .id(step)
    }
    private var calendarPrices: [(String, Double?)] {
        guard selectedCabin == .economy, filters.airline.isEmpty else { return [] }
        return (step == .outbound ? outboundCalendar : returnCalendar).filter { day in
            day.origin.uppercased() == currentOrigin && day.destination.uppercased() == currentDestination &&
            (day.returnAt ?? "").isEmpty && filters.accepts(stops: day.transfers, airline: day.airlineCode, departure: day.date, includeDay: false)
        }.map { ($0.date, Optional($0.price)) }
    }
    private var calendarOffers: [FlightDiscoveryOffer] {
        guard selectedCabin == .economy else { return [] }
        return (step == .outbound ? dataOutbound : dataReturn).filter {
            !$0.isRoundTrip && $0.origin == currentOrigin && $0.destination == currentDestination &&
            dayKey(IumrahFlightClock.local($0.departureAt, airport: $0.origin)) >= IumrahFlightDiscoveryStore.dayFormatter.string(from: Calendar.current.startOfDay(for: Date())) &&
            (step == .outbound || dayKey(IumrahFlightClock.local($0.departureAt, airport: $0.origin)) > IumrahFlightDiscoveryStore.dayFormatter.string(from: journey.trip.departureDate)) &&
            filters.accepts(stops: $0.transfers, airline: $0.airlineCode, departure: $0.departureAt, includeDay: false)
        }
    }
    private func visibleCandidates(_ candidates: [FlightChoice]) -> [FlightChoice] {
        candidates.filter {
            filters.accepts(stops: $0.stops, airline: $0.airlineCode, departure: $0.departureAt, includeDay: false)
        }.sorted { a, b in
            if filters.sort == 1, a.price != b.price { return (a.price ?? .infinity) < (b.price ?? .infinity) }
            if filters.sort == 2, a.duration != b.duration { return (a.duration > 0 ? a.duration : Int.max) < (b.duration > 0 ? b.duration : Int.max) }
            return a.departureAt == b.departureAt ? a.id < b.id : a.departureAt < b.departureAt
        }
    }

    private func confirmPendingChoice() {
        guard let choice = pendingChoice else { return }
        IumrahHaptics.selection()
        switch step {
        case .outbound:
            if outbound?.id != choice.id { inbound = nil }
            outbound = choice

        case .inbound:
            guard let outbound, !outbound.isCompletePublishedPair || choice.isCompletePublishedPair else {
                isShowingSourceHelp = true
                return
            }
            inbound = choice
        }
        pendingChoice = nil
        advanceFlightSelection()
    }

    private func advanceFlightSelection() {
        if step == .outbound { withAnimation { step = .inbound } }
        else { commitSelection() }
    }

    private var availableCandidates: [FlightChoice] {
        var candidates: [FlightChoice] = []
        for item in published where item.nonstop && publishedCabinMatches(item) {
            if step == .outbound {
                if item.outbound.origin.uppercased() == outboundCode && item.outbound.destination.uppercased() == destinationCode {
                    // Complete published packages may only be offered when their
                    // fixed return leg matches the traveler’s selected return window.
                    if let returnLeg = item.inbound {
                        let candidateReturn = FlightChoice.published(item, isReturn: true)
                        guard returnLeg.origin.uppercased() == returnCode,
                              returnLeg.destination.uppercased() == outboundCode,
                              abs(dayOffset(for: candidateReturn, from: journey.trip.returnDate)) <= flexDays else { continue }
                    }
                    candidates.append(.published(item, isReturn: false))
                }
            } else if item.inbound != nil {
                if case .published(let selected, _) = outbound,
                   selected.outbound.origin.uppercased() == item.outbound.origin.uppercased(),
                   selected.outbound.destination.uppercased() == item.outbound.destination.uppercased(),
                   selected.outbound.flightNumber == item.outbound.flightNumber,
                   selected.outbound.departureAt == item.outbound.departureAt,
                   let inboundLeg = item.inbound,
                   inboundLeg.origin.uppercased() == returnCode && inboundLeg.destination.uppercased() == outboundCode {
                    candidates.append(.published(item, isReturn: true))
                }
            } else if item.effectiveJourneyRole == "return" &&
                      item.outbound.origin.uppercased() == returnCode &&
                      item.outbound.destination.uppercased() == outboundCode {
                candidates.append(.published(item, isReturn: true))
            }
        }
        // The Data API has no reliably verified cabin metadata. It is offered
        // only for the economy preference and explicitly rechecked later.
        if selectedCabin == .economy {
            for offer in step == .outbound ? dataOutbound : dataReturn where !offer.isRoundTrip {
                candidates.append(.dataAPI(offer))
            }
        }
        if step == .inbound, let outbound {
            if case .published(let paired, _) = outbound, paired.inbound != nil {
                candidates = candidates.filter {
                    if case .published(let item, _) = $0 {
                        return item.outbound.flightNumber == paired.outbound.flightNumber &&
                               item.outbound.departureAt == paired.outbound.departureAt
                    }
                    return false
                }
            } else {
                candidates = candidates.filter { !$0.isCompletePublishedPair }
            }
        }
        // Prefer bookable complete publications when a one-way publication
        // duplicates the same operating outbound flight.
        candidates.sort { a, b in
            if a.source != b.source { return a.source == .published }
            if a.isCompletePublishedPair != b.isCompletePublishedPair {
                return a.isCompletePublishedPair
            }
            return a.id < b.id
        }
        var seen = Set<String>()
        let today = Calendar.current.startOfDay(for: Date())
        let outboundDay = dayKey(outbound.map { IumrahFlightClock.local($0.departureAt, airport: $0.origin) } ?? "")
        var ranked: [(choice: FlightChoice, offset: Int, rank: Int)] = []
        for choice in candidates {
            let day = dayKey(IumrahFlightClock.local(choice.departureAt, airport: choice.origin))
            guard choice.stops >= 0, let flightDay = dateFromISODay(day), flightDay >= today else { continue }
            let offset = dayOffset(for: choice)
            guard abs(offset) <= flexDays, !(step == .inbound && day <= outboundDay),
                  seen.insert(choice.dedupeKey).inserted else { continue }
            ranked.append((choice, offset, offset == 0 ? (choice.stops == 0 ? 0 : 1) : 2))
        }
        return ranked.sorted { a, b in
            if a.rank != b.rank { return a.rank < b.rank }
            if a.offset != 0 && b.offset != 0 && abs(a.offset) != abs(b.offset) { return abs(a.offset) < abs(b.offset) }
            if a.choice.departureAt != b.choice.departureAt { return a.choice.departureAt < b.choice.departureAt }
            return a.choice.id < b.choice.id
        }.map { $0.choice }
    }

    private func publishedCabinMatches(_ item: CuratedFlightRecommendation) -> Bool {
        let cabin = item.cabinClass.lowercased().replacingOccurrences(of: " ", with: "_")
        return cabin == selectedCabin.rawValue
    }

    private func dayOffset(for choice: FlightChoice) -> Int {
        dayOffset(for: choice, from: currentTarget)
    }
    private func dayOffset(for choice: FlightChoice, from target: Date) -> Int {
        guard let date = dateFromISODay(dayKey(IumrahFlightClock.local(choice.departureAt, airport: choice.origin))) else { return 9999 }
        return Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: target),
                                               to: Calendar.current.startOfDay(for: date)).day ?? 9999
    }
    private func dayKey(_ iso: String) -> String { String(iso.prefix(10)) }
    private func dateFromISODay(_ value: String) -> Date? {
        let components = value.split(separator: "-").compactMap { Int($0) }
        guard components.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: components[0], month: components[1], day: components[2]))
    }
    private func dayText(_ date: Date) -> String {
        date.formatted(.dateTime.day().month(.abbreviated).locale(Locale(identifier: settings.language.localeIdentifier)))
    }
    private func dayTextFromISO(_ iso: String) -> String {
        guard let date = dateFromISODay(dayKey(iso)) else { return dayKey(iso) }
        return dayText(date)
    }
    private func timeText(_ iso: String) -> String {
        let part = iso.split(separator: "T")
        guard part.count >= 2 else { return "—" }
        return String(part[1].prefix(5))
    }

    private func loadFlights(preserveCalendar: Bool = false) async {
        let trace = IumrahPerformanceTrace.begin("Guided flight load")
        defer { IumrahPerformanceTrace.end("Guided flight load", trace) }
        let trip = journey.trip
        let searchCabin = trip.effectiveFlightFilters.cabinClass
        let searchFlex = flexDays
        let legs: [(String, String, Date)] = [(trip.originCode, trip.outboundDestinationCode, trip.departureDate),
                                              (trip.returnOriginCode, trip.originCode, trip.returnDate)]
        let orderedLegs = step == .outbound ? [0, 1] : [1, 0]
        let requestKey = FlightQueryKey(trip, flexibility: searchFlex)
        let sameSearch = requestedTrip == requestKey
        if !sameSearch { visibleCount = 20 }
        editingSearch = false
        let requestID = UUID()
        loadingRequestID = requestID
        requestedTrip = requestKey
        if !sameSearch {
            published = []; dataOutbound = []; dataReturn = []
            if !preserveCalendar { outboundCalendar = []; returnCalendar = [] }
            dataRevision &+= 1
        }
        isLoading = true
        loadError = nil
        defer { if loadingRequestID == requestID { isLoading = false } }
        let curatedService = CuratedFlightRecommendationService.shared
        let service = AviasalesFlightDiscoveryService()
        // Both exact-date searches and published fares start together, independently
        // of the optional calendar/nearby-date enrichment.
        func exact(_ index: Int) async -> Result<[FlightDiscoveryOffer], Error> {
            guard searchCabin == .economy else { return .success([]) }
            let (origin, destination, target) = legs[index]
            let selected = IumrahFlightDiscoveryStore.dayFormatter.string(from: target)
            do {
                let value = try await service.offers(origin: origin, destination: destination, departure: selected, direct: false, limit: 100)
                return .success(value.offers.filter { $0.origin.uppercased() == origin && $0.destination.uppercased() == destination })
            } catch { return .failure(error) }
        }
        func publishedResult() async -> Result<[CuratedFlightRecommendation], Error> {
            do { return .success(try await curatedService.load(trip: trip)) }
            catch { return .failure(error) }
        }
        async let exactOutbound = exact(0)
        async let exactReturn = exact(1)
        async let curated = publishedResult()
        var exactRows: [Int: [FlightDiscoveryOffer]] = [:]
        for index in orderedLegs {
            let result = index == 0 ? await exactOutbound : await exactReturn
            guard !Task.isCancelled, loadingRequestID == requestID else { return }
            switch result {
            case .success(let rows):
                exactRows[index] = rows
                if !rows.isEmpty || !sameSearch {
                    if index == 0 { dataOutbound = rows } else { dataReturn = rows }; dataRevision &+= 1
                }
            case .failure(let error): loadError = error.localizedDescription
            }
        }
        switch await curated {
        case .success(let result):
            guard !Task.isCancelled, loadingRequestID == requestID else { return }
            published = result; dataRevision &+= 1
        case .failure(let error):
            guard !Task.isCancelled, loadingRequestID == requestID else { return }
            loadError = error.localizedDescription
        }
        if searchCabin != .economy { dataOutbound = []; dataReturn = []; outboundCalendar = []; returnCalendar = []; dataRevision &+= 1; loadedTrip = requestKey; return }
        for index in orderedLegs {
            if Task.isCancelled || loadingRequestID != requestID { return }
            let (origin, destination, target) = legs[index]
            let calendarMonths = Set((-14...14).compactMap { Calendar.current.date(byAdding: .day, value: $0, to: target) }.map { IumrahFlightDiscoveryStore.monthFormatter.string(from: $0) })
            let offerMonths = Set((-searchFlex...searchFlex).compactMap { Calendar.current.date(byAdding: .day, value: $0, to: target) }.map { IumrahFlightDiscoveryStore.monthFormatter.string(from: $0) })
            var collected = exactRows[index] ?? (sameSearch ? (index == 0 ? dataOutbound : dataReturn) : [])
            var calendar: [FlightDiscoveryCalendarDay] = []
            for month in calendarMonths.sorted() {
                if Task.isCancelled || loadingRequestID != requestID { return }
                let cacheKey = "\(origin)|\(destination)|\(month)"
                if let cached = calendarCache[cacheKey], cached.expires > Date() {
                    calendar += cached.days
                } else if let value = try? await service.calendar(origin: origin, destination: destination, month: month) {
                    guard !Task.isCancelled, loadingRequestID == requestID else { return }
                    calendar += value.days
                    calendarCache = calendarCache.filter { $0.value.expires > Date() }
                    calendarCache[cacheKey] = CalendarCacheEntry(days: value.days, expires: Date().addingTimeInterval(300))
                }
                guard !Task.isCancelled, loadingRequestID == requestID else { return }
                if index == 0 { outboundCalendar = calendar } else { returnCalendar = calendar }; dataRevision &+= 1
                if searchFlex > 0, offerMonths.contains(month), let value = try? await service.offers(origin: origin, destination: destination, departure: month, direct: false, limit: 100) {
                    collected += value.offers.filter { $0.origin.uppercased() == origin && $0.destination.uppercased() == destination }
                    guard !Task.isCancelled, loadingRequestID == requestID else { return }
                    // Keep the exact date version if both endpoints returned the same offer ID.
                    var seen = Set<String>()
                    let unique = collected.filter { seen.insert($0.id).inserted }
                    if !sameSearch {
                        if index == 0 { dataOutbound = unique } else { dataReturn = unique }; dataRevision &+= 1
                    }
                }
            }
            guard !Task.isCancelled, loadingRequestID == requestID else { return }
            var seen = Set<String>()
            let unique = collected.filter { seen.insert($0.id).inserted }
            if !unique.isEmpty || !sameSearch {
                if index == 0 { dataOutbound = unique } else { dataReturn = unique }; dataRevision &+= 1
            }
        }
        if !Task.isCancelled && loadingRequestID == requestID { loadedTrip = requestKey }
    }

    private func commitSelection() {
        guard let outbound, let inbound else {
            isShowingSourceHelp = true
            return
        }
        guard let outboundDate = dateFromISODay(dayKey(IumrahFlightClock.local(outbound.departureAt, airport: outbound.origin))),
              let inboundDate = dateFromISODay(dayKey(IumrahFlightClock.local(inbound.departureAt, airport: inbound.origin))),
              let arrival = IumrahFlightClock.arrival(actual: outbound.arrivalAt, departure: outbound.departureAt,
                    duration: outbound.duration, origin: outbound.origin, destination: outbound.destination),
              let arrivalDate = dateFromISODay(arrival.day),
              inboundDate > outboundDate, inboundDate > arrivalDate,
              outbound.origin.uppercased() == outboundCode, outbound.destination.uppercased() == destinationCode,
              inbound.origin.uppercased() == returnCode, inbound.destination.uppercased() == outboundCode else { return }
        if outbound.isCompletePublishedPair || inbound.isCompletePublishedPair {
            guard case .published(let first, _) = outbound, case .published(let second, _) = inbound,
                  first.inbound != nil, second.inbound != nil,
                  first.outbound.flightNumber == second.outbound.flightNumber,
                  first.outbound.departureAt == second.outbound.departureAt else {
                isShowingSourceHelp = true; return
            }
        }
        if journey.trip.scope == .makkahAndMadinah,
           (Calendar.current.dateComponents([.day], from: arrivalDate, to: inboundDate).day ?? 0) < 2 {
            isShowingSourceHelp = true; return
        }
        if journey.localJourneyFlights.map(\.id) == [outbound.id, inbound.id],
           Calendar.current.isDate(journey.trip.departureDate, inSameDayAs: outboundDate),
           Calendar.current.isDate(journey.trip.returnDate, inSameDayAs: inboundDate),
           Calendar.current.isDate(journey.trip.hotelStayStartDate, inSameDayAs: arrivalDate), journey.localRoomsComplete {
            if let smartConfirm { smartConfirm() } else { showHotelPicker = true }
            return
        }
        journey.clearStagedUmrahFlights()
        journey.trip.departureDate = outboundDate
        journey.trip.returnDate = inboundDate
        journey.trip.saudiArrivalDate = arrivalDate
        journey.trip.flightTripType = .roundTrip
        journey.trip.selectedReturnAirport = inbound.origin.uppercased() == "MED" ? .madinah : .jeddah
        journey.trip.arrivalAirport = outbound.destination.uppercased() == "MED" ? .madinah : .jeddah

        if case .published(let chosenOutbound, _) = outbound,
           case .published(let chosenInbound, _) = inbound {
            journey.packageFlightPath = .publishedDirect
            if chosenOutbound.inbound != nil && chosenInbound.inbound != nil &&
               chosenOutbound.outbound.flightNumber == chosenInbound.outbound.flightNumber &&
               chosenOutbound.outbound.departureAt == chosenInbound.outbound.departureAt {
                journey.selectedPublishedCompleteID = chosenInbound.id
                journey.selectedPublishedOutboundID = nil
                journey.selectedPublishedReturnID = nil
                journey.stageUmrahFlight(makeStaged(outbound, kind: .roundTrip,
                    returnAt: inbound.departureAt, returnAirline: inbound.airlineName,
                    returnFlightNumber: inbound.flightNumber))
            } else if chosenOutbound.inbound == nil && chosenInbound.inbound == nil {
                journey.selectedPublishedCompleteID = nil
                journey.selectedPublishedOutboundID = chosenOutbound.id
                journey.selectedPublishedReturnID = chosenInbound.id
                journey.stageUmrahFlight(makeStaged(outbound, kind: .outbound))
                journey.stageUmrahFlight(makeStaged(inbound, kind: .inbound))
            } else {
                isShowingSourceHelp = true
                return
            }
        } else if case .dataAPI(let outboundOffer) = outbound,
                  case .dataAPI(let inboundOffer) = inbound {
            journey.stageUmrahFlight(makeStaged(outbound, kind: .outbound))
            journey.stageAviasalesOffer(outboundOffer, kind: .outbound)
            journey.stageUmrahFlight(makeStaged(inbound, kind: .inbound))
            journey.stageAviasalesOffer(inboundOffer, kind: .inbound)
        } else {
            guard !outbound.isCompletePublishedPair, !inbound.isCompletePublishedPair else {
                isShowingSourceHelp = true
                return
            }
            journey.stageUmrahFlight(makeStaged(outbound, kind: .outbound))
            journey.stageUmrahFlight(makeStaged(inbound, kind: .inbound))
            journey.clearPublishedFlightSelection()
            journey.mixedFlightIdentity = "mixed:" + independentIdentity(outbound) + "~" + independentIdentity(inbound)
        }
        guard journey.hasCompleteStagedFlightSelection else { return }
        journey.prepareFlightFirstHotelStage()
        journey.usesLocalJourney = true
        journey.localJourneyRooms = [:]
        journey.localJourneyFlights = [outbound, inbound].map { flight in
            LocalJourneyFlight(id: flight.id, origin: flight.origin, destination: flight.destination,
                airline: flight.airlineName, flightNumber: flight.flightNumber, airlineCode: flight.airlineCode,
                durationMinutes: flight.duration, stops: flight.stops, departureAt: flight.departureAt,
                arrivalAt: flight.arrivalAt, displayedPrice: flight.price)
        }
        IumrahHaptics.success()
        if let smartConfirm { smartConfirm() } else { showHotelPicker = true }
    }

    private func independentIdentity(_ flight: FlightChoice) -> String {
        switch flight {
        case .published(let item, _): return "curated:" + item.id
        case .dataAPI(let offer):
            return ["aviasales", "ow", offer.origin.uppercased(), offer.destination.uppercased(),
                    String(offer.departureAt.prefix(10)), "-", offer.airlineCode.uppercased(),
                    offer.flightNumber.uppercased().filter { $0.isLetter || $0.isNumber }, "-", "-"].joined(separator: ":")
        }
    }

    private func makeStaged(_ flight: FlightChoice, kind: StagedUmrahFlightKind,
                            returnAt: String? = nil, returnAirline: String? = nil,
                            returnFlightNumber: String? = nil) -> StagedUmrahFlight {
        StagedUmrahFlight(id: flight.id, kind: kind, origin: flight.origin, destination: flight.destination,
                          airline: flight.airlineName,
                          flightNumber: [flight.airlineCode, flight.flightNumber].filter { !$0.isEmpty }.joined(separator: " "),
                          departureAt: flight.departureAt, returnAt: returnAt,
                          returnAirline: returnAirline, returnFlightNumber: returnFlightNumber,
                          source: flight.source == .published ? "iumrah" : "Aviasales")
    }
}


/// A real flight-detail destination, rather than a tap-to-select row.
/// Supplier information is shown only when present in its returned model.
private struct IumrahGuidedFlightDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    let choice: IumrahGuidedFlightSelectionView.FlightChoice
    let language: AppSettingsStore.Language
    let adults: Int
    let children: Int
    let infants: Int
    let onChoose: () -> Void

    private func tr(_ ru: String, _ en: String, _ uz: String, _ uzCyrl: String) -> String {
        switch language {
        case .russian: return ru
        case .uzbek: return uz
        case .uzbekCyrillic: return uzCyrl
        default: return en
        }
    }

    private var ticketURL: URL? {
        if case .dataAPI(let offer) = choice,
           let raw = offer.bookingUrl,
           let url = URL(string: raw),
           ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
           url.host != nil {
            return url
        }
        return AviasalesSearchLinkBuilder.searchURL(
            origin: choice.origin,
            destination: choice.destination,
            departureAt: choice.departureAt,
            returnAt: nil,
            adults: adults,
            children: children,
            infants: infants
        )
    }

    private var legs: [IumrahPremiumFlightLeg] {
        if case .dataAPI(let offer) = choice,
           let segments = FlightDiscoveryItineraryValidator.verified(offer.outboundSegments, origin: choice.origin, destination: choice.destination, transfers: choice.stops) {
            return segments.map { IumrahPremiumFlightLeg($0) }
        }
        var cabin: String?
        if case .published(let item, let isReturn) = choice { cabin = isReturn ? item.inbound?.cabinClass : item.outbound.cabinClass }
        return [IumrahPremiumFlightLeg(airline: choice.airlineName, airlineCode: choice.airlineCode, number: choice.flightNumber, origin: choice.origin, destination: choice.destination, departure: choice.departureAt, arrival: choice.arrivalAt, duration: choice.duration, stops: choice.stops, cabin: cabin)]
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 14) {
                ForEach(Array(legs.enumerated()), id: \.offset) { index, leg in
                    if index > 0 { IumrahPremiumFlightConnection(previous: legs[index - 1], next: leg, language: language) }
                    IumrahPremiumFlightDetail(leg: leg, language: language, pageHeroInset: index == 0 ? IumrahDesign.pagePadding : nil)
                }
                VStack(alignment: .leading, spacing: 9) {
                    Text(tr("Тариф", "Fare", "Tarif", "Тариф")).font(IumrahType.bold(20, relativeTo: .title2))
                    if let price = choice.price, price.isFinite, price > 0 {
                        Text("$" + price.formatted(.number.precision(.fractionLength(0...2))))
                            .font(IumrahType.bold(30, relativeTo: .title)).monospacedDigit()
                        Text(choice.isCompletePublishedPair ? tr("Туда и обратно · за пассажира", "Round trip · per traveler", "Borib qaytish · yo‘lovchiga", "Бориб қайтиш · йўловчига") : tr("За пассажира", "Per traveler", "Yo‘lovchiga", "Йўловчига")).font(IumrahType.regular(12, relativeTo: .caption)).foregroundStyle(.secondary)
                    }
                    Text(tr("Цена, багаж и наличие мест подтверждаются перед оплатой.", "Fare, baggage and availability are confirmed before payment.", "Narx, bagaj va joylar to‘lovdan oldin tasdiqlanadi.", "Нарх, багаж ва жойлар тўловдан олдин тасдиқланади.")).font(IumrahType.regular(13, relativeTo: .subheadline)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }.iumrahFlightCard()
            VStack(spacing: 10) {
                Button { onChoose(); dismiss() } label: {
                    Text(tr("Выбрать авиабилет", "Select flight", "Reysni tanlash", "Рейсни танлаш"))
                        .font(IumrahType.bold(16)).frame(maxWidth: .infinity).frame(height: 52)
                }.buttonStyle(IumrahPrimaryButtonStyle())
                if let ticketURL {
                    Button { openURL(ticketURL) } label: {
                        Text(tr("Проверить на Aviasales", "Check on Aviasales", "Aviasales’da tekshirish", "Aviasales’да текшириш"))
                            .font(IumrahType.bold(14)).frame(maxWidth: .infinity).frame(height: 42)
                    }.buttonStyle(IumrahSecondaryButtonStyle())
                }
            }.padding(.vertical, 10)
            }
            .padding(.horizontal, IumrahDesign.pagePadding)
            .padding(.bottom, IumrahDesign.pagePadding)
        }
        .background(IumrahFlightPalette.page, ignoresSafeAreaEdges: .bottom)
        .iumrahFlightDetailChrome(title: choice.airlineName, shareText: legs.first?.share ?? "\(choice.origin) → \(choice.destination)")
    }

    private func timeText(_ date: String) -> String {
        let parts = date.split(separator: "T")
        return parts.count > 1 ? String(parts[1].prefix(5)) : "—"
    }
}
