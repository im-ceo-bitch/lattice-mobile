import SwiftUI

/// Package selection uses the same Nuitee detail/rate UI as the Hotels tab.
struct NuiteeJourneyHotelsView: View {
    @EnvironmentObject private var settings: AppSettingsStore
    @EnvironmentObject private var journey: JourneyStore
    var transferAlreadySelected = false
    var smartCity: String? = nil
    var smartConfirm: (() -> Void)? = nil
    var reviewEditing = false
    var familyFlow = false

    init(transferAlreadySelected: Bool = false, smartCity: String? = nil, smartChildAges: [Int] = [], reviewEditing: Bool = false, familyFlow: Bool = false, smartConfirm: (() -> Void)? = nil) {
        self.transferAlreadySelected = transferAlreadySelected
        self.smartCity = smartCity
        self.smartConfirm = smartConfirm
        self.reviewEditing = reviewEditing
        self.familyFlow = familyFlow
        _city = State(initialValue: smartCity ?? "makkah")
        _ages = State(initialValue: smartChildAges)
    }
    @State private var showFinalAfterHotels = false
    @State private var city = "makkah"
    @State private var roomIndex = 0
    @State private var stars = 0
    @State private var hotelQuery = ""
    @State private var favorites: Set<String> = []
    @StateObject private var catalog = NuiteeCatalogModel()
    @State private var opened: NuiteeHotel?
    @State private var showTransfer = false
    @State private var advanceAfterRoomSelection = false
    @State private var selectedMeals = HotelMealChoices()
    @State private var ages: [Int] = []

    private var window: TripStayWindow {
        let windows = TripStayPlanner.windows(for: journey.trip)
        return city == "madinah" ? (windows.madinah ?? windows.makkah) : windows.makkah
    }
    private var key: String { "\(city):\(roomIndex)" }
    private var roomAdults: Int {
        ConfiguratorRepricingPolicy.adultsInRoom(journey.trip.adults, rooms: journey.trip.rooms, index: roomIndex)
    }
    private var roomChildren: [Int] { ages.enumerated().filter { $0.offset % max(1, journey.trip.rooms) == roomIndex }.map(\.element) }
    private var ready: Bool { journey.trip.rooms >= ConfiguratorRepricingPolicy.minimumRooms(journey.trip.adults) && journey.trip.rooms <= journey.trip.adults && ages.count == journey.trip.children + journey.trip.infants && !ages.contains(-1) && roomAdults > 0 && window.checkOut > window.checkIn }
    private var catalogCity: NuiteeCity { city == "madinah" ? .madinah : .makkah }
    private var catalogMatches: Bool {
        catalog.matches(city: catalogCity, checkin: window.checkIn, checkout: window.checkOut,
                        adults: max(1, roomAdults), childrenAges: roomChildren, stars: stars, query: "", favorites: nil)
    }
    private var filtered: [NuiteeHotel] { ready && catalogMatches ? catalog.visibleHotels(stars: stars, query: hotelQuery) : [] }
    private var loading: Bool { ready && (catalog.busy || !catalogMatches) }
    private var error: String? { catalogMatches ? catalog.errorMessage ?? catalog.rateError : nil }
    private var sandbox: Bool { catalog.sandbox }
    private var searchID: String { "\(city):\(roomAdults):\(roomChildren):\(ready):\(window.checkIn):\(window.checkOut)" }

    var body: some View {
        let results = filtered
        let stay = window
        let adults = roomAdults
        ScrollViewReader { proxy in
        ScrollView {
            LazyVStack(spacing: 18) {
                IumrahJourneyHeader {
                    IumrahJourneyDisclosureCard(title: "Отели и номера", total: "\(journey.trip.travelerCount) чел. · \(journey.trip.rooms) ном.",
                        subtitle: "\(window.checkIn.formatted(date: .abbreviated, time: .omitted)) — \(window.checkOut.formatted(date: .abbreviated, time: .omitted)) · \(roomAdults) взр. · \(roomChildren.count) дет.",
                        priceCaption: "Состав поездки") {
                        if smartCity == nil {
                        if !reviewEditing { Stepper("Номера: \(journey.trip.rooms)", value: $journey.trip.rooms, in: min(max(1, journey.trip.adults), ConfiguratorRepricingPolicy.minimumRooms(journey.trip.adults))...max(1, journey.trip.adults)) }
                        ForEach(ages.indices, id: \.self) { index in
                            Picker("Возраст ребёнка \(index + 1)", selection: $ages[index]) {
                                Text("Укажите возраст").tag(-1)
                                ForEach(0...17, id: \.self) { Text("\($0)").tag($0) }
                            }
                        }
                        } else {
                            Text(city == "makkah" ? "Мекка" : "Медина").font(.headline)
                        }
                    }
                }
                .id("hotels-top")
                Group {
                    IumrahPageHelpCard(!ready ? "hotels.child_ages" : journey.localRoomsComplete ? "hotels.complete" : journey.trip.rooms > 1 ? "hotels.multiple_rooms" : city == "madinah" ? "hotels.madinah" : "hotels.makkah")
                    if smartCity == nil && journey.trip.scope == .makkahAndMadinah {
                        Picker("Город", selection: $city) {
                            Text("Мекка").tag("makkah")
                            Text("Медина").tag("madinah")
                        }.pickerStyle(.segmented)
                    }
                    if journey.trip.rooms > 1 {
                        Picker("Номер", selection: $roomIndex) {
                            ForEach(0..<journey.trip.rooms, id: \.self) { Text("Номер \($0 + 1)").tag($0) }
                        }.pickerStyle(.segmented)
                    }
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                        TextField(NuiteeCopy.text("Название отеля", "Mehmonxona nomi", "Hotel name", settings.language), text: $hotelQuery)
                            .autocorrectionDisabled()
                        if !hotelQuery.isEmpty { Button { hotelQuery = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }.buttonStyle(.plain) }
                    }.padding(12).background(Color.iumrahCardBackground, in: RoundedRectangle(cornerRadius: 16))
                    Picker("Звёзды", selection: $stars) {
                        Text("Все").tag(0)
                        ForEach(1...5, id: \.self) { Text("\($0) ★").tag($0) }
                    }.pickerStyle(.segmented)
                    if window.checkOut <= window.checkIn {
                        Text(NuiteeCopy.text("Измените даты поездки: для каждого города нужна минимум одна ночь.", "Safar sanalarini o‘zgartiring: har bir shahar uchun kamida bir tun kerak.", "Change trip dates: each city requires at least one night.", settings.language)).font(.footnote)
                    } else if journey.trip.adults < ConfiguratorRepricingPolicy.minimumRooms(journey.trip.adults) {
                        Text(IumrahFlightCopy.text(settings.language, "Для размещения этой семьи обратитесь в поддержку: в каждом номере должен быть взрослый.", "Contact support for this family arrangement: each room needs an adult.", "Bu oila uchun yordam xizmatiga murojaat qiling: har bir xonada katta kishi bo‘lishi kerak.", "Бу оила учун ёрдам хизматига мурожаат қилинг: ҳар бир хонада катта киши бўлиши керак.")).font(.footnote)
                    } else if !ready { Text("Раскройте карточку сверху и укажите возраст детей для точного тарифа.").font(.footnote) }
                    if let selection = journey.localJourneyRooms[key] {
                        Label(selection.hotel.name + " · " + IumrahHotelRoomTitle.display(rate: selection.rate.roomName, fallback: NuiteeCopy.text("Номер", "Xona", "Room", settings.language)), systemImage: "checkmark.circle.fill")
                            .font(.subheadline).foregroundStyle(Color.iumrahJourneyGreen)
                        Text(selection.requiresRateRefresh == true ? NuiteeCopy.text("Тариф уточняется", "Narx aniqlanmoqda", "Rate pending", settings.language) : NuiteeHotelService.usd(selection.rate.price) + " · " + NuiteeCopy.text("за номер, весь срок", "butun muddat uchun xona narxi", "per room, entire stay", settings.language)).font(.caption)
                    }
                    if loading && results.isEmpty { ProgressView().frame(maxWidth: .infinity) }

                    if error != nil && !loading && !catalog.pricesLoading { Text(NuiteeCopy.text("Не удалось проверить наличие", "Mavjudlikni tekshirib bo‘lmadi", "Could not check availability", settings.language)).font(.footnote).foregroundStyle(.secondary) }
                    if !results.isEmpty {
                        Text(IumrahFlightCopy.text(settings.language, "Показано \(results.count) отелей", "Showing \(results.count) hotels", "\(results.count) ta mehmonxona ko‘rsatildi", "\(results.count) та меҳмонхона кўрсатилди"))
                            .font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                    }
                    ForEach(results) { hotel in
                        NuiteeHotelListingCard(hotel: hotel, nights: stay.nights, adults: adults, childrenCount: roomChildren.count, sandbox: sandbox,
                            favorite: favorites.contains(hotel.id), onOpen: { if ready { opened = hotel } }, onFavorite: {
                                if favorites.contains(hotel.id) { favorites.remove(hotel.id) } else { favorites.insert(hotel.id) }
                            })

                    }
                    if ready && !loading && results.isEmpty && error == nil && catalog.nextOffset == nil { Text("На эти даты отели не найдены.").foregroundStyle(.secondary) }
                    if ready && !loading && error != nil && !catalog.pricesLoading {
                        Button(NuiteeCopy.text("Повторить", "Qayta urinish", "Retry", settings.language)) {
                            Task {
                                if catalog.errorMessage != nil { await load(forceRefresh: true) }
                                else { await catalog.retryMissingPrices(city: catalogCity, checkin: window.checkIn, checkout: window.checkOut, adults: max(1, roomAdults), childrenAges: roomChildren) }
                            }
                        }.buttonStyle(IumrahSecondaryButtonStyle())
                    }
                }.padding(.horizontal, 18)
            }.padding(.bottom, 24)
        }
        .onChange(of: key) { _, _ in hotelQuery = ""; proxy.scrollTo("hotels-top", anchor: .top) }
        }
        .background(Color.iumrahPageBackground.ignoresSafeArea(edges: .bottom))
        .toolbar(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .modifier(IumrahJourneyRefresh {
            await load(forceRefresh: true)
        })
        .task(id: searchID) { guard !showTransfer, !showFinalAfterHotels else { return }; await load() }
        .onAppear {
            let minimum = ConfiguratorRepricingPolicy.minimumRooms(journey.trip.adults)
            if journey.trip.rooms < minimum, minimum <= journey.trip.adults { journey.trip.rooms = minimum }
            if smartCity == nil && ages.count != journey.trip.children + journey.trip.infants {
                let saved = journey.tripSummaryChildAges
                ages = saved.count == journey.trip.children + journey.trip.infants ? saved : Array(repeating: -1, count: journey.trip.children + journey.trip.infants)
            }
        }
        .onChange(of: journey.trip.rooms) { _, _ in
            guard !showTransfer, !showFinalAfterHotels else { return }
            invalidateRooms()
        }
        .onChange(of: ages) { _, value in
            guard smartCity == nil, !showTransfer, !showFinalAfterHotels else { return }
            if journey.tripSummaryChildAges != value {
                journey.tripSummaryChildAges = value
                if !journey.localJourneyRooms.isEmpty && !value.contains(where: { $0 < 0 }) { journey.applyTripSummaryGuests(journey.trip, ages: value); Task { await journey.repricePendingJourneyRooms(language: settings.language.hotelContentCode) } }
            }
        }
        .navigationDestination(item: $opened) { hotel in
            NuiteeHotelDetailView(hotel: hotel, checkin: window.checkIn, nights: window.nights,
                adults: roomAdults, sandbox: sandbox, childrenAges: roomChildren, cataloguePriceForStay: true, onSelectRate: { rate in
                    guard rate.currency == "USD", rate.price.isFinite, rate.price > 0 else { return }
                    // A canonical booking has one hotel per city; changing it resets that city's room choices.
                    journey.localJourneyRooms = journey.localJourneyRooms.filter { $0.value.city != city || $0.value.hotel.id == hotel.id }
                    journey.localJourneyRooms[key] = LocalJourneyRoom(id: key, city: city, hotel: hotel, rate: rate,
                        checkin: window.checkIn, checkout: window.checkOut, adults: roomAdults, childrenAges: roomChildren, meals: selectedMeals)
                    if let tier = journey.localPackageTier { journey.trip.packageTier = tier }
                    if !transferAlreadySelected { journey.transferSelectionConfirmed = false }
                    journey.invalidateLocalJourneyQuote()
                    advanceAfterRoomSelection = true
                }, onSelectMeals: { selectedMeals = $0 }, onRatesLoaded: { start, end, guests, rates in
                    catalog.acceptDetailRates(hotelID: hotel.id, city: city, checkin: start, checkout: end, adults: guests, childrenAges: roomChildren, rates: rates)
                })
                .onDisappear {
                    guard advanceAfterRoomSelection else { return }
                    advanceAfterRoomSelection = false
                    advanceToNextSelection()
                }
        }
        .navigationDestination(isPresented: $showTransfer) { AnyView(TransferSelectionView(familyFlow: familyFlow)) }
        .navigationDestination(isPresented: $showFinalAfterHotels) { AnyView(OfficialJourneyGuideStep(familyFlow: familyFlow)) }
        .safeAreaInset(edge: .bottom) {
            if ready && reviewRoomsComplete {
                Button(smartCity != nil ? IumrahFlightCopy.text(settings.language, "Подтвердить отель", "Confirm hotel", "Mehmonxonani tasdiqlash", "Меҳмонхонани тасдиқлаш") : transferAlreadySelected ? IumrahFlightCopy.text(settings.language, "Выбрать гида", "Choose guide", "Gidni tanlash", "Гидни танлаш") : IumrahFlightCopy.text(settings.language, "Выбрать трансфер", "Choose transfer", "Transferni tanlash", "Трансферни танлаш")) { finishRooms() }
                    .buttonStyle(IumrahPrimaryButtonStyle()).padding(.horizontal, 18).padding(.vertical, 8)
            }
        }
    }

    private func advanceToNextSelection() {
        // Advance only after the detail view has popped. Never mutate its city/date bindings mid-dismissal.
        let cities = smartCity.map { [$0] } ?? (journey.trip.scope == .makkahAndMadinah ? ["makkah", "madinah"] : ["makkah"])
        let orderedCities = [city] + cities.filter { $0 != city }
        for nextCity in orderedCities {
            if let nextRoom = (0..<journey.trip.rooms).first(where: { journey.localJourneyRooms["\(nextCity):\($0)"] == nil || journey.localJourneyRooms["\(nextCity):\($0)"]?.requiresRateRefresh == true }) {
                city = nextCity
                roomIndex = nextRoom
                stars = 0
                return
            }
        }
        // Keep the completed selection visible; only the explicit CTA advances.
    }

    private var reviewRoomsComplete: Bool {
        if let smartCity { return (0..<journey.trip.rooms).allSatisfy { journey.localJourneyRooms["\(smartCity):\($0)"] != nil && journey.localJourneyRooms["\(smartCity):\($0)"]?.requiresRateRefresh != true } }
        return journey.localRoomsComplete
    }

    private func finishRooms() {
        journey.invalidateLocalJourneyQuote()
        if let smartConfirm { smartConfirm(); return }
        if transferAlreadySelected { journey.confirmTransferSelection(); showFinalAfterHotels = true }
        else { showTransfer = true }
    }

    private func invalidateRooms() {
        roomIndex = 0
        journey.applyTripSummaryGuests(journey.trip, ages: ages)
        if ready { Task { await journey.repricePendingJourneyRooms(language: settings.language.hotelContentCode) } }
    }
    @MainActor private func load(forceRefresh: Bool = false) async {
        guard ready else { return }
        let trace = IumrahPerformanceTrace.begin("Journey hotel load")
        defer { IumrahPerformanceTrace.end("Journey hotel load", trace) }
        await catalog.reload(city: catalogCity, checkin: window.checkIn, checkout: window.checkOut,
                             adults: max(1, roomAdults), childrenAges: roomChildren, stars: stars, forceRefresh: forceRefresh)
    }
    @MainActor private func loadMore() async {
        guard ready else { return }
        await catalog.loadMore(city: catalogCity, checkin: window.checkIn, checkout: window.checkOut,
                               adults: max(1, roomAdults), childrenAges: roomChildren, stars: stars)
    }
}
