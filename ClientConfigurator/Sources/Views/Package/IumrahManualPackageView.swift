import SwiftUI

struct IumrahManualFlightDetail: View {
    @EnvironmentObject private var settings: AppSettingsStore
    @EnvironmentObject private var manual: IumrahManualJourneyStore
    @Environment(\.dismiss) private var dismiss
    let flight: LocalJourneyFlight
    var onConfirm: (() -> Bool)? = nil
    var selectedOverride: Bool? = nil
    var selectionUnavailableMessage: String? = nil
    private var selected: Bool { selectedOverride ?? (manual.outbound?.id == flight.id || manual.inbound?.id == flight.id) }
    private var leg: IumrahPremiumFlightLeg {
        .init(airline: flight.airline, airlineCode: flight.airlineCode, number: flight.flightNumber,
              origin: flight.origin, destination: flight.destination, departure: flight.departureAt,
              arrival: flight.arrivalAt, duration: flight.durationMinutes, stops: flight.stops, cabin: flight.publishedCabin)
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                IumrahPremiumFlightDetail(leg: leg, language: settings.language, pageHeroInset: 18, headerShareText: leg.share)
                if let price = flight.displayedPrice, price > 0 {
                    Text(NuiteeHotelService.usd(price)).font(.title.bold())
                    Text(flight.publishedIsPair == true ? t("Туда и обратно · на человека", "Round trip · per person", "Borish va qaytish · bir kishi uchun", "Бориш ва қайтиш · бир киши учун") : t("Стоимость на человека", "Fare per person", "Bir kishi uchun narx", "Бир киши учун нарх")).foregroundStyle(.secondary)
                }
                if flight.publishedIsPair == true {
                    Text(t("Этот рейс опубликован в паре. Выберите второй рейс из того же маршрута.", "This flight belongs to a published pair. Select its matching leg.", "Bu reys juft yo‘nalishda. Ikkinchi reysni shu yo‘nalishdan tanlang.", "Бу рейс жуфт йўналишда. Иккинчи рейсни шу йўналишдан танланг.")).font(.footnote).foregroundStyle(.secondary)
                }
                if let selectionUnavailableMessage {
                    Text(selectionUnavailableMessage).font(.footnote).foregroundStyle(.secondary)
                    NavigationLink { IumrahGuidedFlightSelectionView() } label: {
                        Text(t("Настроить маршрут", "Configure route", "Yo‘nalishni sozlash", "Йўналишни созлаш")).frame(maxWidth: .infinity)
                    }.buttonStyle(IumrahPrimaryButtonStyle())
                } else {
                    Button {
                        if let onConfirm { if onConfirm() { dismiss() } } else if manual.select(flight) { IumrahHaptics.success(); dismiss() }
                    } label: {
                        Text(selected ? t("Авиабилет добавлен в пакет", "Flight added to package", "Aviachipta paketga qo‘shildi", "Авиачипта пакетга қўшилди") : t("Добавить в мой пакет", "Add to my package", "Paketimga qo‘shish", "Пакетимга қўшиш"))
                            .frame(maxWidth: .infinity)
                    }.buttonStyle(IumrahPrimaryButtonStyle())
                }
            }.padding(.horizontal, 18).padding(.bottom, 30)
        }.background(Color.iumrahPageBackground)
            .iumrahFlightDetailChrome(title: leg.title, shareText: leg.share)
    }
    private func t(_ ru: String,_ en: String,_ uz: String,_ cy: String) -> String { IumrahFlightCopy.text(settings.language, ru, en, uz, cy) }
}

// Shared manual trip controls, using the same state in every catalogue.
struct IumrahManualScopePicker: View {
    @EnvironmentObject private var manual: IumrahManualJourneyStore
    @EnvironmentObject private var settings: AppSettingsStore
    var body: some View {
        Picker(t("Маршрут умры", "Umrah route", "Umra yo‘nalishi", "Умра йўналиши"), selection: Binding(get: { manual.scope }, set: { manual.changeScope($0) })) {
            Text(t("Только Мекка", "Makkah only", "Faqat Makka", "Фақат Макка")).tag(JourneyScope.makkahOnly)
            Text(t("Мекка + Медина", "Makkah + Madinah", "Makka + Madina", "Макка + Мадина")).tag(JourneyScope.makkahAndMadinah)
        }.pickerStyle(.segmented).tint(.primary)
    }
    private func t(_ ru: String,_ en: String,_ uz: String,_ cy: String) -> String { IumrahFlightCopy.text(settings.language, ru, en, uz, cy) }
}

struct IumrahManualTransferCatalog: View {
    @EnvironmentObject private var manual: IumrahManualJourneyStore
    @EnvironmentObject private var settings: AppSettingsStore
    @EnvironmentObject private var chrome: AppChromeStore
    @StateObject private var transferJourney = JourneyStore()
    @State private var expanded = true
    @State private var showVehicles = false
    private func t(_ ru: String,_ en: String,_ uz: String,_ cy: String) -> String { IumrahFlightCopy.text(settings.language, ru, en, uz, cy) }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            IumrahGraphiteSearchSurface(isExpanded: $expanded, summary: t("Ваш приватный трансфер", "Your private transfer", "Shaxsiy transferingiz", "Шахсий трансферингиз"), subtitle: dateRange) {
                VStack(alignment: .leading, spacing: 15) {
                    IumrahManualScopePicker()
                    Text(t("Первый аэропорт прилёта", "First arrival airport", "Birinchi kelish aeroporti", "Биринчи келиш аэропорти")).font(.caption).foregroundStyle(.secondary)
                    Picker("Airport", selection: $manual.plannedArrival) {
                        Text(t("Джидда", "Jeddah", "Jidda", "Жидда")).tag(SaudiArrivalAirport.jeddah)
                        if manual.scope == .makkahAndMadinah { Text(t("Медина", "Madinah", "Madina", "Мадина")).tag(SaudiArrivalAirport.madinah) }
                    }.pickerStyle(.segmented).disabled(manual.outbound != nil)
                    DatePicker(t("Начало поездки", "Trip start", "Safar boshlanishi", "Сафар бошланиши"), selection: $manual.plannedDeparture, in: Calendar.current.startOfDay(for: Date())..., displayedComponents: .date).disabled(manual.outbound != nil)
                    DatePicker(t("Окончание поездки", "Trip end", "Safar tugashi", "Сафар тугаши"), selection: $manual.plannedReturn, in: min(manual.plannedDeparture, manual.plannedReturn)..., displayedComponents: .date).disabled(manual.inbound != nil)
                    Stepper(t("Взрослых", "Adults", "Kattalar", "Катталар") + ": \(manual.adults)", value: $manual.adults, in: 1...6)
                    Divider()
                    Text(t("Ваш маршрут", "Your route", "Yo‘nalishingiz", "Йўналишингиз")).font(.headline)
                    IumrahTransferRouteDetails().environmentObject(transferJourney)
                    Button(t("Выбрать автомобиль", "Choose vehicle", "Avtomobil tanlash", "Автомобил танлаш")) {
                        manual.routeConfigured = true
                        syncTrip()
                        withAnimation(.easeInOut(duration: 0.25)) { expanded = false; showVehicles = true }
                    }.buttonStyle(IumrahPrimaryButtonStyle())
                }.tint(.primary)
            }
            .padding(.top, -40)
            if showVehicles || manual.transfer != nil {
                TransferSelectionView(manualConfirm: { vehicle in
                    manual.transfer = vehicle
                    manual.haramainSelected = transferJourney.haramainTrainSelected
                    manual.haramainFareClass = transferJourney.haramainFareClass
                    manual.haramainAdultTickets = transferJourney.haramainAdultTickets
                    chrome.openHotels(board: .summary)
                }).environmentObject(transferJourney)
            }
        }.padding(.horizontal, IumrahDesign.pagePadding)
            .onAppear { syncTrip() }
            .onChange(of: manual.plannedDeparture) { _, date in
                if manual.plannedReturn <= date && manual.inbound == nil { manual.plannedReturn = Calendar.current.date(byAdding: .day, value: 7, to: date) ?? date }
            }
            .onChange(of: manual.revisionKey) { _, _ in syncTrip() }
    }
    private var dateRange: String {
        let plan = manual.plannedTrip
        return plan.departureDate.formatted(date: .abbreviated, time: .omitted) + " — " + plan.returnDate.formatted(date: .abbreviated, time: .omitted)
    }
    private func syncTrip() {
        transferJourney.trip = manual.plannedTrip
        transferJourney.localJourneyRooms = Dictionary(uniqueKeysWithValues: manual.rooms.values.map { ($0.id, $0) })
        if let vehicle = manual.transfer { transferJourney.chooseTransferVehicle(vehicle) }
        transferJourney.setHaramainFareClass(manual.haramainFareClass)
        transferJourney.setHaramainAdultTickets(manual.haramainAdultTickets)
        transferJourney.setHaramainTrainSelected(manual.haramainSelected)
    }
}

struct IumrahManualPackageView: View {
    @EnvironmentObject private var manual: IumrahManualJourneyStore
    @EnvironmentObject private var settings: AppSettingsStore
    @EnvironmentObject private var chrome: AppChromeStore
    @State private var pricedJourney: JourneyStore?
    @State private var pricedKey: String?
    @State private var estimate: IumrahManualEstimate?
    @State private var estimateKey: String?
    @State private var busy = false
    @State private var showFinal = false
    @State private var expanded = false
    @State private var retry = 0
    @State private var estimateError: String?
    private func t(_ ru: String,_ en: String,_ uz: String,_ cy: String) -> String { IumrahFlightCopy.text(settings.language, ru, en, uz, cy) }
    private var currentQuote: PackageQuote? { pricedKey == manual.revisionKey && pricedJourney?.hasFinalGeneratorQuote == true ? pricedJourney?.quote : nil }
    private var currentEstimate: IumrahManualEstimate? { estimateKey == manual.revisionKey ? estimate : nil }
    private var canBook: Bool { manual.complete && !busy && currentQuote?.bookingAllowed == true }
    private var plan: TripDraft { manual.plannedTrip }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            IumrahGraphiteSearchSurface(isExpanded: $expanded, summary: t("Ваша поездка", "Your journey", "Safaringiz", "Сафарингиз"), subtitle: "\(plan.originCode) → \(plan.outboundDestinationCode) · \(plan.travelerCount) " + t("чел.", "travelers", "kishi", "киши")) { tripDetails }
                .padding(.top, -40)
            Text(t("Мой пакет", "My package", "Mening paketim", "Менинг пакетим")).font(.title.bold())
            flightCard(manual.outbound, title: t("Рейс туда", "Outbound flight", "Borish reysi", "Бориш рейси"), direction: 0)
            flightCard(manual.inbound, title: t("Рейс обратно", "Return flight", "Qaytish reysi", "Қайтиш рейси"), direction: 1)
            if manual.outbound != nil && manual.inbound != nil && (manual.trip == nil || !manual.sourceCompatible) {
                Label(t("Проверьте совместимость рейсов и даты поездки.", "Check flight compatibility and dates.", "Reyslar va sanalarni tekshiring.", "Рейслар ва саналарни текширинг."), systemImage: "exclamationmark.circle").font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(manual.cities, id: \.self) { city in hotelCard(city) }
            transferCard
            guidePreferenceCard
            totalCard
        }.padding(.horizontal, IumrahDesign.pagePadding)
            .task(id: manual.revisionKey + ":\(retry)") { await requestQuote() }
            .navigationDestination(isPresented: $showFinal) {
                if let pricedJourney { FinalPackageView().environmentObject(pricedJourney) }
            }
    }
    private var guidePreferenceCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(t("Персональный гид", "Personal guide", "Shaxsiy gid", "Шахсий гид"), systemImage: "person.crop.circle.badge.checkmark").font(.headline)
            Text(manual.guidePreference?.displayName ?? t("Подбор от iumrah", "Selected by iumrah", "iumrah tanlovi", "iumrah танлови")).font(.title3.bold())
            Text(t("Сопровождение включено в расчёт пакета. Назначение подтверждается после проверки дат.", "Accompaniment is included in the package quote. Assignment is confirmed after checking dates.", "Hamrohlik paket hisobiga kiradi. Gid sanalar tekshirilgach tasdiqlanadi.", "Ҳамроҳлик пакет ҳисобига киради. Гид саналар текширилгач тасдиқланади.")).font(.footnote).foregroundStyle(.secondary)
            Button(t("Выбрать гида", "Choose guide", "Gid tanlash", "Гид танлаш")) { chrome.openHotels(board: .guide) }.buttonStyle(IumrahSecondaryButtonStyle())
        }.padding(20).frame(maxWidth: .infinity, alignment: .leading).background(Color.iumrahCardBackground, in: RoundedRectangle(cornerRadius: 28))
    }
    private var tripDetails: some View {
        VStack(alignment: .leading, spacing: 7) {
            IumrahManualScopePicker()
            fact(t("Аэропорт вылета", "Departure airport", "Jo‘nash aeroporti", "Жўнаш аэропорти"), plan.originCode)
            fact(t("Первый аэропорт прилёта", "First arrival airport", "Birinchi kelish aeroporti", "Биринчи келиш аэропорти"), plan.outboundDestinationCode)
            fact(t("Обратный аэропорт", "Return airport", "Qaytish aeroporti", "Қайтиш аэропорти"), plan.returnOriginCode)
            Divider()
            fact(t("Начало", "Start", "Boshlanish", "Бошланиш"), plan.departureDate.formatted(date: .abbreviated, time: .omitted))
            fact(t("Окончание", "End", "Tugash", "Тугаш"), plan.returnDate.formatted(date: .abbreviated, time: .omitted))
            let stay = TripStayPlanner.breakdown(for: plan)
            fact(t("Дней / ночей", "Days / nights", "Kun / tun", "Кун / тун"), "\(stay.totalDays) / \(stay.totalNights)")
            fact(t("Ночей в Мекке", "Makkah nights", "Makkada tun", "Маккада тун"), "\(stay.makkahNights)")
            if manual.scope == .makkahAndMadinah { fact(t("Ночей в Медине", "Madinah nights", "Madinada tun", "Мадинада тун"), "\(stay.madinahNights)") }
            Divider()
            Stepper(t("Взрослых", "Adults", "Kattalar", "Катталар") + ": \(manual.adults)", value: $manual.adults, in: 1...6)
            fact(t("Номеров на город", "Rooms per city", "Shaharga xona", "Шаҳарга хона"), "1")
            fact(t("Класс перелёта", "Cabin", "Parvoz klassi", "Парвоз класси"), cabinLabel)
            fact(t("Выбрано компонентов", "Selected components", "Tanlangan qismlar", "Танланган қисмлар"), "\(manual.componentCount) / \(manual.cities.count + 3)")
            Button(t("Готово", "Done", "Tayyor", "Тайёр")) { withAnimation { expanded = false } }.buttonStyle(IumrahPrimaryButtonStyle())
        }.tint(.primary)
    }
    private var cabinLabel: String {
        switch manual.cabin {
        case .economy: return t("Эконом", "Economy", "Ekonom", "Эконом")
        case .premiumEconomy: return t("Премиум", "Premium", "Premium", "Премиум")
        case .business: return t("Бизнес", "Business", "Biznes", "Бизнес")
        case .first: return t("Первый", "First", "Birinchi", "Биринчи")
        }
    }
    private func fact(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) { Text(label).foregroundStyle(.secondary); Spacer(); Text(value).fontWeight(.semibold).multilineTextAlignment(.trailing) }.font(.subheadline)
    }
    private var totalCard: some View {
        VStack(alignment: .leading, spacing: 13) {
            Text(currentQuote != nil ? t("Итоговая цена", "Package total", "Yakuniy narx", "Якуний нарх") : t("Стоимость пакета", "Package total", "Paket narxi", "Пакет нархи")).font(.headline)
            if let quote = currentQuote {
                Text(money(quote.totalPackagePrice)).font(.largeTitle.bold().monospacedDigit())
                if quote.bookingAllowed != true { Text(t("Бронирование пока недоступно.", "Booking is not available yet.", "Bron hali ochilmagan.", "Брон ҳали очилмаган.")).foregroundStyle(.secondary) }
            } else if let preview = currentEstimate {
                Text(money(preview.totalPackagePrice)).font(.largeTitle.bold().monospacedDigit())
                Text(t("С учётом выбранных компонентов и обязательных услуг. Невыбранные отели и рейсы не входят в расчёт.", "Includes selected components and mandatory services. Unselected hotels and flights are excluded.", "Tanlangan qismlar va majburiy xizmatlar kiritilgan. Tanlanmagan mehmonxona va reyslar hisobga olinmagan.", "Танланган қисмлар ва мажбурий хизматлар киритилган. Танланмаган меҳмонхона ва рейслар ҳисобга олинмаган.")).font(.footnote).foregroundStyle(.secondary)
                if preview.pairedFareIncluded { Text(t("Включена полная стоимость связанного тарифа туда и обратно.", "The full paired round-trip fare is included.", "Juft borish-qaytish tarifi to‘liq kiritilgan.", "Жуфт бориш-қайтиш тарифи тўлиқ киритилган.")).font(.footnote).foregroundStyle(.secondary) }
                if preview.provisionalTier { Text(t("До выбора отеля применяется тариф Standard.", "Standard tier is assumed until a hotel is selected.", "Mehmonxona tanlanguncha Standard tarif qo‘llanadi.", "Меҳмонхона танлангунча Standard тариф қўлланади.")).font(.footnote).foregroundStyle(.secondary) }
            } else if busy { ProgressView().tint(.primary) }
            else if !manual.hasPriceComponent {
                Text("$0.00").font(.largeTitle.bold().monospacedDigit())
                Text(t("Чтобы получить цену, выберите отель или авиабилет.", "Choose a hotel or a flight to get a price.", "Narx olish uchun mehmonxona yoki aviachipta tanlang.", "Нарх олиш учун меҳмонхона ёки авиачипта танланг.")).foregroundStyle(.secondary)
            } else {
                Text(t("Цена не подтверждена", "Price not confirmed", "Narx tasdiqlanmadi", "Нарх тасдиқланмади")).font(.title3.bold())
                Text(t("Проверьте даты, тарифы и доступность компонентов.", "Check dates, rates and availability.", "Sanalar, tariflar va mavjudlikni tekshiring.", "Саналар, тарифлар ва мавжудликни текширинг.")).font(.footnote).foregroundStyle(.secondary)
                Button(t("Повторить расчёт", "Retry quote", "Qayta hisoblash", "Қайта ҳисоблаш")) { retry += 1 }.tint(.primary)
            }
            if let error = pricedJourney?.errorMessage ?? estimateError {
                Text(ConfiguratorBookingCopy.message(error, language: settings.language)).font(.footnote).foregroundStyle(.secondary)
                if currentEstimate != nil { Button(t("Повторить расчёт", "Retry quote", "Qayta hisoblash", "Қайта ҳисоблаш")) { retry += 1 }.tint(.primary) }
            }
            if !manual.complete { Text(t("Для бронирования выберите все необходимые рейсы, отели и автомобиль.", "Select all required flights, hotels and a vehicle to book.", "Bron uchun barcha reyslar, mehmonxonalar va avtomobilni tanlang.", "Брон учун барча рейслар, меҳмонхоналар ва автомобилни танланг.")).font(.footnote).foregroundStyle(.secondary) }
            Button(t("Перейти к бронированию", "Continue to booking", "Bron qilishga o‘tish", "Брон қилишга ўтиш")) { if canBook { showFinal = true } }
                .buttonStyle(IumrahPrimaryButtonStyle()).disabled(!canBook).opacity(canBook ? 1 : 0.4)
        }.padding(20).frame(maxWidth: .infinity, alignment: .leading).background(Color.iumrahCardBackground, in: RoundedRectangle(cornerRadius: 28))
    }
    private func money(_ value: Decimal) -> String { "$" + String(format: "%.2f", NSDecimalNumber(decimal: value).doubleValue) }
    @MainActor private func requestQuote() async {
        let trace = IumrahPerformanceTrace.begin("Manual package quote")
        defer { IumrahPerformanceTrace.end("Manual package quote", trace) }
        let key = manual.revisionKey
        pricedJourney = nil; pricedKey = nil; estimate = nil; estimateKey = nil; estimateError = nil; busy = false
        guard manual.hasPriceComponent else { return }
        busy = true
        defer { if key == manual.revisionKey && !Task.isCancelled { busy = false } }
        do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
        if let draft = manual.makeQuoteJourney() {
            await draft.buildQuote()
            guard !Task.isCancelled, key == manual.revisionKey else { return }
            pricedJourney = draft; pricedKey = key
            if draft.hasFinalGeneratorQuote { return }
        }
        guard let request = manual.estimateRequest() else { return }
        do {
            let value = try await RemotePackageEngineClient().manualEstimate(request)
            guard !Task.isCancelled, key == manual.revisionKey else { return }
            estimate = value; estimateKey = key
        } catch { if !Task.isCancelled, key == manual.revisionKey { estimateError = error.localizedDescription } }
    }
    private func flightCard(_ flight: LocalJourneyFlight?, title: String, direction: Int) -> some View {
        VStack(alignment: .leading, spacing: 15) {
            status(title, symbol: direction == 0 ? "airplane.departure" : "airplane.arrival", selected: flight != nil)
            if let flight {
                HStack(spacing: 12) {
                    AirlineLogoView(airlineCode: flight.airlineCode, size: 44)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(flight.airline).font(.headline)
                        Text(flight.flightNumber).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(cabinLabel).font(.caption).foregroundStyle(.secondary)
                }
                HStack(alignment: .center) {
                    airport(flight.origin, raw: flight.departureAt)
                    Spacer()
                    Image(systemName: "airplane").font(.title2).foregroundStyle(.secondary)
                    Spacer()
                    airport(flight.destination, raw: flight.arrivalAt)
                }.padding(14).background(Color.iumrahRaisedBackground, in: RoundedRectangle(cornerRadius: 18))
                Text(flight.stops == 0 ? t("Прямой рейс", "Direct flight", "To‘g‘ri reys", "Тўғри рейс") : "\(flight.stops) " + t("пересадок", "stops", "to‘xtash", "тўхташ")).font(.footnote).foregroundStyle(.secondary)
            } else { missingText }
            actions(selected: flight != nil, choose: { chrome.requestedManualFlightDirection = direction; chrome.openHotels(board: .flights) }, remove: { if direction == 0 { manual.outbound = nil } else { manual.inbound = nil } })
        }.modifier(IumrahManualComponentCard(selected: flight != nil))
    }
    private func airport(_ code: String, raw: String?) -> some View {
        let local = IumrahPremiumFlightLeg.localParts(raw, code: code)
        return VStack(alignment: .leading, spacing: 5) {
            Text(code).font(.title2.bold())
            if let local { Text(local.time).font(.title3.bold().monospacedDigit()); Text(local.day).font(.caption).foregroundStyle(.secondary) }
        }
    }
    private func hotelCard(_ city: String) -> some View {
        let room = manual.rooms[city]
        let title = city == "madinah" ? t("Отель в Медине", "Madinah hotel", "Madinadagi mehmonxona", "Мадинадаги меҳмонхона") : t("Отель в Мекке", "Makkah hotel", "Makkadagi mehmonxona", "Маккадаги меҳмонхона")
        return VStack(alignment: .leading, spacing: 14) {
            status(title, symbol: "bed.double", selected: room != nil)
            if let room {
                HotelCachedImage(rawURL: room.hotel.coverImageURL, thumbnailPixelDimension: 768).frame(height: 154).frame(maxWidth: .infinity).clipped().clipShape(RoundedRectangle(cornerRadius: 17))
                Text(room.hotel.name).font(.title3.bold())
                HStack { if room.hotel.roundedStars > 0 { Text(String(repeating: "★", count: room.hotel.roundedStars)) }; if let rating = room.hotel.rating { Text(String(format: "%.1f", rating)) } }.font(.caption).foregroundStyle(.secondary)
                Text(IumrahHotelRoomTitle.display(rate: room.rate.roomName, fallback: IumrahFlightCopy.text(settings.language, "Номер", "Room", "Xona", "Хона"))).font(.subheadline.weight(.medium))
                fact(t("Заезд / выезд", "Check-in / out", "Kirish / chiqish", "Кириш / чиқиш"), room.checkin.formatted(date: .abbreviated, time: .omitted) + " – " + room.checkout.formatted(date: .abbreviated, time: .omitted))
                fact(t("Ночей", "Nights", "Tun", "Тун"), "\(TripStayWindow(checkIn: room.checkin, checkOut: room.checkout).nights)")
                Label(meals(room), systemImage: "fork.knife").font(.subheadline).foregroundStyle(.secondary)
                if manual.trip != nil && !manual.validRoom(city) { Text(t("Проверьте даты и гостей этого номера.", "Check this room’s dates and guests.", "Xona sanalari va mehmonlarini tekshiring.", "Хона саналари ва меҳмонларини текширинг.")).font(.footnote).foregroundStyle(.secondary) }
            } else { missingText }
            actions(selected: room != nil, choose: { chrome.requestedManualHotelCity = city; chrome.openHotels(board: .hotels) }, remove: { manual.rooms.removeValue(forKey: city) })
        }.modifier(IumrahManualComponentCard(selected: room != nil))
    }
    private func meals(_ room: LocalJourneyRoom) -> String {
        let selected = room.bookingSelection.meals ?? HotelMealChoices()
        var names: [String] = []
        if selected.breakfast { names.append(t("Завтрак", "Breakfast", "Nonushta", "Нонушта")) }
        if selected.lunch { names.append(t("Обед", "Lunch", "Tushlik", "Тушлик")) }
        if selected.dinner { names.append(t("Ужин", "Dinner", "Kechki ovqat", "Кечки овқат")) }
        return names.isEmpty ? t("Без питания", "No meals selected", "Ovqatlanishsiz", "Овқатланишсиз") : names.joined(separator: " · ")
    }
    private var transferCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            status(t("Приватный трансфер", "Private transfer", "Shaxsiy transfer", "Шахсий трансфер"), symbol: "car.side", selected: manual.transfer != nil)
            if let vehicle = manual.transfer {
                Image(vehicle.assetName).resizable().scaledToFit().frame(height: 130).frame(maxWidth: .infinity)
                Text(vehicle.modelName).font(.title2.bold())
                Label("\(vehicle.passengerCapacity) " + t("пассажиров", "passengers", "yo‘lovchi", "йўловчи"), systemImage: "person.2").font(.subheadline).foregroundStyle(.secondary)
                if manual.haramainSelected { Label("Haramain · \(min(manual.haramainAdultTickets, manual.adults))", systemImage: "tram").font(.subheadline).foregroundStyle(.secondary) }
            } else { missingText }
            actions(selected: manual.transfer != nil, choose: { chrome.openHotels(board: .transfer) }, remove: { manual.transfer = nil; manual.haramainSelected = false })
        }.modifier(IumrahManualComponentCard(selected: manual.transfer != nil))
    }
    private var missingText: some View { Text(t("Ещё не выбрано", "Not selected yet", "Hali tanlanmagan", "Ҳали танланмаган")).font(.subheadline).foregroundStyle(.secondary) }
    private func status(_ title: String, symbol: String, selected: Bool) -> some View {
        HStack {
            Label(title, systemImage: symbol).font(.headline)
            Spacer(minLength: 6)
            if selected { Image(systemName: "checkmark.circle.fill").font(.title3).foregroundStyle(.green).accessibilityLabel(t("Выбрано", "Selected", "Tanlangan", "Танланган")) }
        }
    }
    private func actions(selected: Bool, choose: @escaping () -> Void, remove: @escaping () -> Void) -> some View {
        HStack {
            Button(selected ? t("Изменить", "Change", "O‘zgartirish", "Ўзгартириш") : t("Выбрать", "Choose", "Tanlash", "Танлаш"), action: choose).font(.subheadline.bold()).tint(.primary)
            Spacer()
            if selected { IumrahGlassIconButton(systemName: "trash", size: 44, accessibilityLabel: t("Удалить", "Remove", "O‘chirish", "Ўчириш"), action: remove) }
        }
    }
}

private struct IumrahManualComponentCard: ViewModifier {
    let selected: Bool
    func body(content: Content) -> some View {
        content.padding(18).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.iumrahCardBackground, in: RoundedRectangle(cornerRadius: 26))
            .overlay(RoundedRectangle(cornerRadius: 26).strokeBorder(Color.primary.opacity(selected ? 0.20 : 0.10), style: StrokeStyle(lineWidth: 1, dash: selected ? [] : [5, 5])))
    }
}
