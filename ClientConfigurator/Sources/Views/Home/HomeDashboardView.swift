import SwiftUI

struct HomeDashboardView: View {
    @Environment(\.businessConfigurator) private var businessConfigurator
    @EnvironmentObject private var chrome: AppChromeStore
    @EnvironmentObject private var settings: AppSettingsStore
    @EnvironmentObject private var journey: JourneyStore
    @State private var showGuidedFlightSelection = false
    @State private var focusJourneySearchRevision = 0
    @State private var journeySearchExpanded = false
    @StateObject private var publishedSelection = IumrahHomePublishedSelection()
    @State private var publishedSelectionError = false
    @State private var publishedDetail: LocalJourneyFlight?
    @State private var showPublishedHotels = false
    var body: some View {
        marketingHome
            .navigationDestination(isPresented: $showGuidedFlightSelection) {
                IumrahGuidedFlightSelectionView()
            }
            .navigationDestination(isPresented: $showPublishedHotels) { NuiteeJourneyHotelsView() }
            .navigationDestination(item: $publishedDetail) { flight in
                IumrahHomePublishedFlightDetail(flight: flight, selection: publishedSelection)
            }
            .alert(dashboardCopy.t("Проверьте выбранные рейсы", "Check selected flights", "Tanlangan reyslarni tekshiring", "Танланган рейсларни текширинг"), isPresented: $publishedSelectionError) {
                Button(dashboardCopy.t("Понятно", "OK", "Tushunarli", "Тушунарли"), role: .cancel) { }
            } message: {
                Text(dashboardCopy.t("Проверьте даты, маршрут, класс и наличие опубликованного тарифа. Выберите совместимые рейсы.", "Check dates, route, cabin and published fare. Choose compatible flights.", "Sana, yo‘nalish, klass va tarifni tekshiring. Mos reyslarni tanlang.", "Сана, йўналиш, класс ва тарифни текширинг. Мос рейсларни танланг."))
            }
            .onChange(of: journey.trip) { _, next in publishedSelection.reconcile(next) }
    }

    private var marketingHome: some View {
        ScrollViewReader { scrollProxy in
            IumrahRootScrollingPage(onRefresh: {
                await IumrahAllPublishedFlightStore.shared.load(force: true)
            }, searchCardOverlap: 40, helpContext: "home.default", scrollingRefresh: true, header: {
                IumrahHomeJourneySearchHero(onSearch: { showGuidedFlightSelection = true }, presentation: .header, searchExpanded: $journeySearchExpanded)
            }, content: {
                LazyVStack(spacing: 20) {
                    IumrahHomeJourneySearchHero(onSearch: { publishedSelection.clear(); showGuidedFlightSelection = true }, presentation: .search, searchExpanded: $journeySearchExpanded, flightsSelected: publishedSelection.canContinue(journey.trip), onContinue: continuePublishedFlights)
                        .padding(.horizontal, -IumrahDesign.pagePadding)
                        .id("journey-search")
                publishedFlightSection
                if let businessConfigurator { businessConfigurator.homeActions() }
            }
            // Same adaptive page-column rule as Account/Gear. Padding is part of
            // the column first; the outer frame then clamps the whole tree to the viewport.
            .padding(.horizontal, IumrahDesign.pagePadding)
            // The first hero starts flush below the iPhone status-bar safe area.
            // A top gap exposes the page background between the status bar and hero.
            .padding(.bottom, 46)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            })
            .background(Color.iumrahPageBackground.ignoresSafeArea(edges: .bottom))
            .onAppear { consumeHeaderBuildRequest() }
            .onChange(of: chrome.shouldOpenUmrahPlan) { _, _ in consumeHeaderBuildRequest() }
            .onChange(of: focusJourneySearchRevision) { _, _ in
                withAnimation(.easeInOut(duration: 0.28)) {
                    scrollProxy.scrollTo("journey-search", anchor: .top)
                }
            }
        }
        .background(Color.iumrahPageBackground.ignoresSafeArea())
    }


    private var dashboardCopy: IumrahDashboardCopy { .init(language: settings.language) }
    private var publishedFlightSection: some View {
        VStack(alignment: .leading, spacing: 20) {
            IumrahAllPublishedFlightBoard(selection: publishedSelection, horizontal: true, direction: 0, onAllFlights: openOfficialFlights, onOpen: { publishedDetail = $0 })
            IumrahAllPublishedFlightBoard(selection: publishedSelection, horizontal: true, direction: 1, onAllFlights: openOfficialFlights, onOpen: { publishedDetail = $0 })
            if publishedSelection.canContinue(journey.trip) {
                Button(action: continuePublishedFlights) {
                    HStack(spacing: 10) {
                        Text(dashboardCopy.t("Продолжить к отелям", "Continue to hotels", "Mehmonxonalarga o‘tish", "Меҳмонхоналарга ўтиш"))
                            .lineLimit(2).multilineTextAlignment(.center).minimumScaleFactor(0.85)
                        Image(systemName: "arrow.right")
                    }
                }.buttonStyle(IumrahPrimaryButtonStyle())
                .accessibilityIdentifier("iumrah.home.continueToHotels")
            }
        }
    }

    private func openOfficialFlights() {
        // Keep Home's independent selection until the user edits the actual trip.
        // Use the same first step as the existing search, not a second catalogue page.
        journeySearchExpanded = false
        showGuidedFlightSelection = true
    }

    private func continuePublishedFlights() {
        guard publishedSelection.commit(journey) else { IumrahHaptics.error(); publishedSelectionError = true; return }
        showPublishedHotels = true
    }

    private func consumeHeaderBuildRequest() {
        guard chrome.shouldOpenUmrahPlan, chrome.currentTab == .home else { return }
        chrome.shouldOpenUmrahPlan = false
        withAnimation(.easeInOut(duration: 0.28)) { journeySearchExpanded = true }
        focusJourneySearchRevision += 1
    }
 }
private struct IumrahHomeFlatCardModifier: ViewModifier {
    let padding: CGFloat
    let radius: CGFloat

    func body(content: Content) -> some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .background(Color.iumrahCardBackground)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.065), lineWidth: 0.7)
            }
    }
}

private extension View {
    func iumrahHomeFlatCard(padding: CGFloat = 18, radius: CGFloat = IumrahDesign.cardRadius) -> some View {
        modifier(IumrahHomeFlatCardModifier(padding: padding, radius: radius))
    }
}


// MARK: - Violet Signature · home-to-flight-first journey search
/// This search is only a handoff to the live flights catalogue in Hotels.
/// Nothing is priced, booked or marked available by this view.
private struct IumrahHomeJourneySearchHero: View {
    enum Presentation: Equatable { case header, search }
    let onSearch: () -> Void
    var presentation: Presentation = .search
    @Environment(\.iumrahNavigationChromeStyle) private var navigationChromeStyle
    @EnvironmentObject private var settings: AppSettingsStore
    @EnvironmentObject private var journey: JourneyStore
    @EnvironmentObject private var chrome: AppChromeStore
    @ObservedObject private var notifications = ClientNotificationCenter.shared
    @Binding var searchExpanded: Bool
    var flightsSelected: Bool
    var onContinue: () -> Void
    @State private var showingCalendar = false
    @State private var showingPassengers = false

    init(onSearch: @escaping () -> Void, presentation: Presentation = .search, searchExpanded: Binding<Bool>, flightsSelected: Bool = false, onContinue: @escaping () -> Void = {}) {
        self.onSearch = onSearch
        self.presentation = presentation
        _searchExpanded = searchExpanded
        self.flightsSelected = flightsSelected
        self.onContinue = onContinue
    }

    private func tr(_ ru: String, _ en: String, _ uz: String, _ uzCyrl: String) -> String {
        switch settings.language {
        case .russian: return ru
        case .uzbek: return uz
        case .uzbekCyrillic: return uzCyrl
        default: return en
        }
    }

    private var isValidSearch: Bool {
        journey.trip.canContinue &&
        journey.trip.departureDate >= Calendar.current.startOfDay(for: Date()) &&
        journey.trip.infants <= journey.trip.adults
    }

    var body: some View {
        VStack(spacing: 0) {
            if presentation == .header {
                blackTop
            } else {
                searchCard
                    .padding(.horizontal, IumrahDesign.pagePadding)
                    .padding(.top, -40)
                    .padding(.bottom, 2)
                    .task(id: scenePhase == .active && !reduceMotion) {
                        guard scenePhase == .active && !reduceMotion else { return }
                        while !Task.isCancelled {
                            try? await Task.sleep(for: .seconds(5))
                            guard !Task.isCancelled else { break }
                            withAnimation(.easeInOut(duration: 0.25)) {
                                headlineIndex = (headlineIndex + 1) % headlineOptions.count
                            }
                        }
                    }
            }
        }
        .sheet(isPresented: $showingCalendar) {
            FlightDateCalendarView(
                trip: journey.trip,
                initialDeparture: journey.trip.departureDate,
                initialReturn: journey.trip.returnDate,
                publishedOnly: true,
                flexibilityDays: $journey.flightSearchFlexDays
            ) { selection in
                journey.resetAfterTripChange()
                journey.clearStagedUmrahFlights()
                journey.trip.departureDate = selection.departure
                journey.trip.returnDate = selection.returnDate
                journey.trip.flightTripType = .roundTrip
                journey.trip.flexibility = .exact
                // The calendar recommends dates, not tickets. The flight pair
                // must still be chosen explicitly in the next stage.
                journey.packageFlightPath = .publishedDirect
            }
            .environmentObject(settings)
            .modifier(IumrahJourneySheetStyle())
        }
        .sheet(isPresented: $showingPassengers) {
            IumrahHomeJourneyPassengersSheet(language: settings.language,
                                              initialAdults: journey.trip.adults,
                                              initialChildren: journey.trip.children,
                                              initialInfants: journey.trip.infants,
                                              initialCabin: journey.trip.effectiveFlightFilters.cabinClass) { adults, children, infants, cabin in
                guard (adults, children, infants, cabin) != (journey.trip.adults, journey.trip.children,
                                                           journey.trip.infants, journey.trip.effectiveFlightFilters.cabinClass) else { return }
                journey.resetAfterTripChange()
                journey.clearStagedUmrahFlights()
                journey.trip.adults = adults
                journey.trip.children = children
                journey.trip.infants = infants
                var filters = journey.trip.effectiveFlightFilters
                filters.cabinClass = cabin
                journey.trip.flightFilters = filters
            }
            .modifier(IumrahJourneySheetStyle())
        }
    }

    // Main-page-only identity: the existing monochrome world atlas and the
    // existing light wordmark, without changing other tabs or global tokens.
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var headlineIndex = 0

    private var headlineOptions: [String] {
        [
            tr("Ваша умра. Ваш путь.", "Your Umrah. Your way.", "Umrangiz. O‘z yo‘lingiz.", "Умрангиз. Ўз йўлингиз."),
            tr("Вместе с близкими.", "Together with those you love.", "Yaqinlaringiz bilan birga.", "Яқинларингиз билан бирга."),
            tr("Всё путешествие — в одном месте.", "Your entire journey. One place.", "Butun safar bir joyda.", "Бутун сафар бир жойда.")
        ]
    }

    private var blackTop: some View {
        IumrahDiscoveryMasthead(selection: 0)
    }

    private var searchCard: some View {
        IumrahGraphiteSearchSurface(isExpanded: $searchExpanded,
            summary: headlineOptions[headlineIndex],
            subtitle: "\(journey.trip.originCode) · \(journey.trip.departureDate.formatted(.dateTime.day().month(.abbreviated).year().locale(Locale(identifier: settings.language.localeIdentifier))))") {
            searchFields
        }
    }

    private var searchFields: some View {
        VStack(alignment: .leading, spacing: 5) {
            VStack(alignment: .leading, spacing: 5) {
                AirportSelectorButton(airport: $journey.trip.originAirport,
                                      fallbackCode: $journey.trip.origin,
                                      cornerRadius: 0,
                                      monochrome: true, compact: true)
                    .frame(minHeight: 44)
            }

            Divider()
            VStack(alignment: .leading, spacing: 3) {
                fieldCaption(tr("Маршрут умры", "Your Umrah route", "Umra yo‘nalishi", "Умра йўналиши"))
                IumrahGlassPillSelector(options: [
                    .init(.makkahOnly, tr("Только Мекка", "Makkah only", "Faqat Makka", "Фақат Макка")),
                    .init(.makkahAndMadinah, tr("Мекка + Медина", "Makkah + Madinah", "Makka + Madina", "Макка + Мадина"))
                ], selection: journey.trip.scope, onSelect: changeRoute, height: 32)
            }

            if journey.trip.scope == .makkahAndMadinah {
                fieldCaption(tr("Первый аэропорт прилёта", "First arrival airport", "Birinchi kelish aeroporti", "Биринчи келиш аэропорти"))
                IumrahGlassPillSelector(options: [
                    .init(SaudiArrivalAirport.jeddah, tr("Джидда", "Jeddah", "Jidda", "Жидда")),
                    .init(SaudiArrivalAirport.madinah, tr("Медина", "Madinah", "Madina", "Мадина"))
                ], selection: journey.trip.arrivalAirport, onSelect: { airport in
                    guard journey.trip.arrivalAirport != airport else { return }
                    journey.resetAfterTripChange()
                    journey.clearStagedUmrahFlights()
                    journey.trip.arrivalAirport = airport
                    journey.trip.selectedReturnAirport = nil
                }, height: 32)
            }
            Divider()
            Button { showingCalendar = true } label: {
                HStack(spacing: 8) {
                    dateColumn(title: tr("Вылет", "Departure", "Uchish", "Учиш"), date: journey.trip.departureDate)
                    Image(systemName: "arrow.right")
                        .foregroundStyle(Color.iumrahMuted)
                    dateColumn(title: tr("Обратно", "Return", "Qaytish", "Қайтиш"), date: journey.trip.returnDate)
                    Spacer(minLength: 0)
                    Image(systemName: "calendar")
                        .foregroundStyle(Color.iumrahInk)
                }
                .padding(.horizontal, 4)
                .frame(minHeight: 44)

            }
            .buttonStyle(.plain)
            .accessibilityLabel(tr("Выбрать даты поездки", "Choose travel dates", "Safar sanalarini tanlash", "Сафар саналарини танлаш"))

            Divider()
            Button { showingPassengers = true } label: {
                HStack(spacing: 10) {
                    Image(systemName: "person.2")
                        .foregroundStyle(Color.iumrahInk)
                    VStack(alignment: .leading, spacing: 3) {
                        fieldCaption(tr("Паломники", "Travelers", "Ziyoratchilar", "Зиёратчилар"))
                        Text(passengerSummary + " · " + cabinTitle(journey.trip.effectiveFlightFilters.cabinClass))
                            .font(IumrahType.bold(14, relativeTo: .subheadline))
                            .foregroundStyle(Color.iumrahInk)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .foregroundStyle(Color.iumrahMuted)
                }
                .padding(.horizontal, 4)
                .frame(minHeight: 44)

            }
            .buttonStyle(.plain)

            Button(action: { if flightsSelected { onContinue() } else { searchExpanded = false; findFlights() } }) {
                HStack(spacing: 10) {
                    Text(flightsSelected ? tr("Продолжить к отелям", "Continue to hotels", "Mehmonxonalarga o‘tish", "Меҳмонхоналарга ўтиш") : tr("Найти авиабилеты", "Find flights", "Reyslarni topish", "Рейсларни топиш"))
                }
                .font(IumrahType.bold(16, relativeTo: .headline))
                .foregroundStyle(.white)
                .padding(.horizontal, 18)
                .frame(maxWidth: .infinity)
                .frame(height: 48)
                .background(Color.iumrahSignatureBlack,
                            in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(!isValidSearch)
            .opacity(isValidSearch ? 1 : 0.5)


        }

    }

    private func cabinTitle(_ cabin: FlightCabinClass) -> String {
        switch cabin {
        case .economy: return tr("Эконом", "Economy", "Ekonom", "Эконом")
        case .premiumEconomy: return tr("Премиум-эконом", "Premium economy", "Premium ekonom", "Премиум эконом")
        case .business: return tr("Бизнес", "Business", "Biznes", "Бизнес")
        case .first: return tr("Первый", "First", "Birinchi klass", "Биринчи класс")
        }
    }

    private func changeRoute(_ scope: JourneyScope) {
        guard journey.trip.scope != scope else { return }
        journey.resetAfterTripChange()
        journey.clearStagedUmrahFlights()
        journey.trip.scope = scope
        if scope == .makkahOnly {
            journey.trip.arrivalAirport = .jeddah
            journey.trip.selectedReturnAirport = .jeddah
        } else {
            journey.trip.selectedReturnAirport = nil
        }
    }

    private func dateColumn(title: String, date: Date) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            fieldCaption(title)
            Text(date.formatted(.dateTime.day().month(.abbreviated).locale(Locale(identifier: settings.language.localeIdentifier))))
                .font(IumrahType.bold(16, relativeTo: .headline))
                .foregroundStyle(Color.iumrahInk)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func fieldCaption(_ text: String) -> some View {
        Text(text)
            .font(IumrahType.regular(12, relativeTo: .caption))
            .foregroundStyle(Color.iumrahMuted)
    }

    private var passengerSummary: String {
        tr("\(journey.trip.travelerCount) чел.", "\(journey.trip.travelerCount) travelers",
           "\(journey.trip.travelerCount) kishi", "\(journey.trip.travelerCount) киши")
    }

    private func findFlights() {
        guard isValidSearch else { IumrahHaptics.error(); return }
        // A new search invalidates the previous booking draft and staged fares.
        // We preserve the route, dates, party and hotel scope the traveler chose.
        journey.resetAfterTripChange()
        journey.clearStagedUmrahFlights()
        journey.trip.flightTripType = .roundTrip
        journey.trip.flexibility = .exact
        journey.packageFlightPath = .publishedDirect
        onSearch()
    }
}

/// A restrained, native SwiftUI dissolve: opacity, a small vertical drift,
/// and animated blur. Disabled when Reduce Motion is enabled.
private struct IumrahHomeVaporPhase: AnimatableModifier {
    var amount: CGFloat
    var animatableData: CGFloat {
        get { amount }
        set { amount = newValue }
    }

    func body(content: Content) -> some View {
        content
            .opacity(Double(max(0, 1 - amount)))
            .blur(radius: max(0, amount) * 10)
            .offset(y: -amount * 9)
    }
}

private struct IumrahHomeJourneyPassengersSheet: View {
    @Environment(\.dismiss) private var dismiss
    let language: AppSettingsStore.Language
    let onSave: (Int, Int, Int, FlightCabinClass) -> Void
    @State private var adults: Int
    @State private var children: Int
    @State private var infants: Int
    @State private var cabin: FlightCabinClass

    init(language: AppSettingsStore.Language, initialAdults: Int, initialChildren: Int,
         initialInfants: Int, initialCabin: FlightCabinClass,
         onSave: @escaping (Int, Int, Int, FlightCabinClass) -> Void) {
        self.language = language
        self.onSave = onSave
        _adults = State(initialValue: initialAdults)
        _children = State(initialValue: initialChildren)
        _infants = State(initialValue: initialInfants)
        _cabin = State(initialValue: initialCabin)
    }

    private func tr(_ ru: String, _ en: String, _ uz: String, _ uzCyrl: String) -> String {
        switch language {
        case .russian: return ru
        case .uzbek: return uz
        case .uzbekCyrillic: return uzCyrl
        default: return en
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 15) {
                    IumrahPageHelpCard("home.passengers")
                    passengerRow(
                    title: tr("Взрослые", "Adults", "Kattalar", "Катталар"),
                    subtitle: tr("12 лет и старше", "Ages 12+", "12 yosh va yuqori", "12 ёшдан катта"),
                    value: adults, canDecrease: adults > max(1, infants), canIncrease: total < 9,
                    decrease: { adults -= 1 }, increase: { adults += 1 }
                )
                passengerRow(
                    title: tr("Дети", "Children", "Bolalar", "Болалар"),
                    subtitle: tr("2–11 лет", "Ages 2–11", "2–11 yosh", "2–11 ёш"),
                    value: children, canDecrease: children > 0, canIncrease: total < 9,
                    decrease: { children -= 1 }, increase: { children += 1 }
                )
                passengerRow(
                    title: tr("Младенцы", "Infants", "Chaqaloqlar", "Чақалоқлар"),
                    subtitle: tr("До 2 лет, не более одного на взрослого", "Under 2, at most one per adult",
                                 "2 yoshgacha, har kattaga bir nafar", "2 ёшгача, ҳар каттага бир нафар"),
                    value: infants, canDecrease: infants > 0, canIncrease: total < 9 && infants < adults,
                    decrease: { infants -= 1 }, increase: { infants += 1 }
                )
                VStack(alignment: .leading, spacing: 12) {
                    Text(tr("Класс перелёта", "Cabin class", "Parvoz klassi", "Парвоз класси"))
                        .font(IumrahType.bold(16, relativeTo: .headline))
                    Picker(tr("Класс перелёта", "Cabin class", "Parvoz klassi", "Парвоз класси"), selection: $cabin) {
                        Text(tr("Эконом", "Economy", "Ekonom", "Эконом")).tag(FlightCabinClass.economy)
                        Text(tr("Премиум", "Premium", "Premium", "Премиум")).tag(FlightCabinClass.premiumEconomy)
                        Text(tr("Бизнес", "Business", "Biznes", "Бизнес")).tag(FlightCabinClass.business)
                        Text(tr("Первый", "First", "Birinchi", "Биринчи")).tag(FlightCabinClass.first)
                    }
                    .pickerStyle(.segmented)
                    .frame(minHeight: 44)
                }
                .padding(16)
                .background(Color.iumrahCardBackground, in: RoundedRectangle(cornerRadius: 24))
                Text(tr("Максимум 9 путешественников в одном поиске.",
                        "Maximum 9 travelers per search.",
                        "Bir qidiruvda ko‘pi bilan 9 nafar yo‘lovchi.",
                        "Бир қидирувда кўпи билан 9 нафар йўловчи."))
                    .font(IumrahType.secondary)
                    .foregroundStyle(.secondary)
                }
                .padding(20)
            }
            .background(Color.iumrahPageBackground)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Button {
                    onSave(adults, children, infants, cabin)
                    dismiss()
                } label: {
                    Text(tr("Готово", "Done", "Tayyor", "Тайёр"))
                        .frame(maxWidth: .infinity)
                        .frame(height: IumrahDesign.controlHeight)
                }
                .buttonStyle(IumrahPrimaryButtonStyle())
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .background(Color.iumrahPageBackground)
            }
            .navigationTitle(tr("Паломники", "Travelers", "Ziyoratchilar", "Зиёратчилар"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(tr("Закрыть", "Close", "Yopish", "Ёпиш")) { dismiss() } } }
        }
        .presentationDetents([.large])
    }

    private var total: Int { adults + children + infants }

    private func passengerRow(title: String, subtitle: String, value: Int,
                              canDecrease: Bool, canIncrease: Bool,
                              decrease: @escaping () -> Void, increase: @escaping () -> Void) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(IumrahType.bold(16, relativeTo: .headline))
                Text(subtitle).font(IumrahType.regular(12, relativeTo: .caption))
                    .foregroundStyle(Color.iumrahMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 4)
            Button(action: decrease) {
                Image(systemName: "minus")
                    .frame(width: 46, height: 46)
                    .background(Color.iumrahRaisedBackground, in: Circle())
            }
            .disabled(!canDecrease)
            .accessibilityLabel(tr("Уменьшить", "Decrease", "Kamaytirish", "Камайтириш") + " " + title)
            Text(String(value))
                .font(IumrahType.bold(17, relativeTo: .headline))
                .monospacedDigit()
                .frame(width: 30)
            Button(action: increase) {
                Image(systemName: "plus")
                    .frame(width: 46, height: 46)
                    .background(Color.iumrahRaisedBackground, in: Circle())
            }
            .disabled(!canIncrease)
            .accessibilityLabel(tr("Увеличить", "Increase", "Ko‘paytirish", "Кўпайтириш") + " " + title)
        }
        .buttonStyle(.plain)
        .padding(15)
        .background(Color.iumrahCardBackground, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
    }
}
