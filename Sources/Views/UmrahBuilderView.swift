import SwiftUI

struct UmrahBuilderView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store: UmrahDraftStore

    init(owner: String) {
        _store = StateObject(wrappedValue: UmrahDraftStore(owner: owner))
    }
    @State private var step = 0
    @State private var error: String?
    @State private var saved = false
    @State private var restart = false
    private let steps = ["Авиабилеты", "Проживание", "Трансфер", "Ваш пакет"]

    var body: some View {
        ScrollViewReader { reader in
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Color.clear.frame(height: 0).id("top")
                    Text("СОЗДАТЬ UMRAH").font(.caption.weight(.semibold)).tracking(3).foregroundStyle(.secondary)
                    Text(steps[step]).font(.system(size: 34, weight: .bold)).tracking(-1)
                    HStack(spacing: 6) {
                        ForEach(steps.indices, id: \.self) { index in
                            Capsule().fill(index <= step ? BusinessDesign.ink : BusinessDesign.line).frame(height: 4)
                        }
                    }.accessibilityLabel("Шаг \(step + 1) из 4: \(steps[step])")
                    switch step {
                    case 0: UmrahFlightStep(draft: $store.draft)
                    case 1: UmrahHotelStep(draft: $store.draft)
                    case 2: UmrahTransferStep(draft: $store.draft)
                    default: summary
                    }
                    if let error { Label(error, systemImage: "exclamationmark.circle").font(.subheadline).foregroundStyle(.red) }
                    if let storageError = store.storageError { Text(storageError).font(.caption).foregroundStyle(.red) }
                }.businessAdaptiveReadableWidth().padding(22)
            }
            .onChange(of: step) { _, _ in reader.scrollTo("top", anchor: .top) }
        }
        .background(BusinessDesign.background)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) { BusinessBrandLogo(width: 150).frame(height: 36) }
            ToolbarItem(placement: .topBarLeading) { Button("Закрыть") { store.save(); if store.storageError == nil { dismiss() } } }
            ToolbarItem(placement: .topBarTrailing) {
                Menu { Button("Начать заново", role: .destructive) { restart = true } } label: { Image(systemName: "ellipsis.circle") }
            }
        }
        .confirmationDialog("Удалить текущий черновик?", isPresented: $restart, titleVisibility: .visible) {
            Button("Начать заново", role: .destructive) { store.draft = UmrahPackageDraft(); step = 0; error = nil; store.save() }
        }
        .safeAreaInset(edge: .bottom) { footer }
        .environment(\.locale, Locale(identifier: "ru_RU"))
        .onChange(of: scenePhase) { _, phase in if phase != .active { store.save() } }
        .onDisappear { store.save() }
        .onChange(of: store.draft) { _, _ in store.save(); saved = false; error = nil }
        .alert("Черновик сохранён", isPresented: $saved) {
            Button("Хорошо", role: .cancel) { }
        } message: { Text("Пакет сохранён на этом устройстве. Бронирование и отправка SMS / Telegram пока не подключены.") }
    }

    private var footer: some View {
        HStack(spacing: 16) {
            if step > 0 { Button { step -= 1; error = nil } label: { Image(systemName: "arrow.left").frame(width: 44, height: 44) }.tint(BusinessDesign.ink) }
            VStack(alignment: .leading, spacing: 3) {
                Text("За \(store.draft.travelers) чел.").font(.caption).foregroundStyle(.secondary)
                if let total = store.draft.total { Text(total, format: .currency(code: "USD")).font(.headline) }
                else { Text("Цена не заполнена").font(.caption) }
            }
            Spacer(minLength: 0)
            Button(step == 3 ? "Сохранить" : "Продолжить") {
                if step < 3 {
                    if let issue = store.draft.issue(at: step) { error = issue; return }
                    step += 1; error = nil
                } else {
                    for index in 0..<3 {
                        if let issue = store.draft.issue(at: index) { error = issue; step = index; return }
                    }
                    store.save(); saved = store.storageError == nil
                }
            }
            .font(.subheadline.bold()).padding(.horizontal, 20).frame(minHeight: 48)
            .foregroundStyle(BusinessDesign.onAccent).background(BusinessDesign.accent, in: Capsule())
        }.padding(.horizontal, 20).padding(.vertical, 12).background(.regularMaterial)
    }

    private var pickupText: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.timeZone = TimeZone(identifier: "Asia/Riyadh")
        formatter.dateFormat = "d MMM yyyy, HH:mm"
        return formatter.string(from: store.draft.pickup) + " · время Саудии"
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("\(store.draft.travelers) паломника · \(store.draft.comfort)").foregroundStyle(.secondary)
            if let flight = store.draft.outbound { UmrahFlightCard(title: "Туда", flight: flight) }
            if let flight = store.draft.inbound { UmrahFlightCard(title: "Обратно", flight: flight) }
            UmrahStayCard(title: "Мекка", stay: store.draft.makkah)
            if store.draft.includeMedina { UmrahStayCard(title: "Медина", stay: store.draft.medina) }
            UmrahVehicleCard(name: store.draft.vehicle, selected: true)
            UmrahPanel(title: "Полный маршрут трансфера") {
                ForEach(Array(store.draft.route.enumerated()), id: \.offset) { index, point in
                    Label(point, systemImage: index == 0 || index == store.draft.route.count - 1 ? "airplane" : "building.2")
                }
                Text("Встреча: \(pickupText)").font(.caption)
                Text("Стоимость на всю группу: $\(store.draft.transferPrice)")
            }
            UmrahPanel(title: "Зияраты") {
                Text(store.draft.ziyaratMakkah ? "Мекка — включены" : "Мекка — не включены")
                if store.draft.includeMedina { Text(store.draft.ziyaratMedina ? "Медина — включены" : "Медина — не включены") }
                if store.draft.ziyaratMakkah || (store.draft.includeMedina && store.draft.ziyaratMedina) { Text("На всю группу: $\(store.draft.ziyaratPrice)") }
            }
            UmrahPanel(title: "Стоимость · USD") {
                priceRow("Перелёт × \(store.draft.travelers)", (UmrahPackageDraft.amount(store.draft.flightPrice) ?? 0) * Double(store.draft.travelers))
                priceRow("Мекка · все номера и ночи", UmrahPackageDraft.amount(store.draft.makkah.price) ?? 0)
                if store.draft.includeMedina { priceRow("Медина · все номера и ночи", UmrahPackageDraft.amount(store.draft.medina.price) ?? 0) }
                priceRow("Трансфер", UmrahPackageDraft.amount(store.draft.transferPrice) ?? 0)
                if store.draft.ziyaratMakkah || (store.draft.includeMedina && store.draft.ziyaratMedina) { priceRow("Зияраты", UmrahPackageDraft.amount(store.draft.ziyaratPrice) ?? 0) }
                Divider()
                if let total = store.draft.total {
                    priceRow("Итого", total).font(.headline)
                    priceRow("На человека", total / Double(store.draft.travelers))
                }
                Text("Предложение менеджера. Наличие и цены поставщиков требуют подтверждения.").font(.caption).foregroundStyle(.secondary)
            }
            UmrahPanel(title: "Паломник") {
                TextField("Имя и фамилия", text: $store.draft.clientName).textContentType(.name)
                TextField("Телефон с кодом страны", text: $store.draft.phone).keyboardType(.phonePad).textContentType(.telephoneNumber)
                TextField("Telegram · @username", text: $store.draft.telegram).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("Комментарий к пакету", text: $store.draft.notes, axis: .vertical)
                Text("Контакты сохраняются в черновике. Для уведомлений потребуется привязка Telegram и подключение SMS на сервере.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
    private func priceRow(_ title: String, _ amount: Double) -> some View {
        HStack { Text(title); Spacer(); Text(amount, format: .currency(code: "USD")).monospacedDigit() }
    }
}

private struct UmrahPanel<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 16) { Text(title).font(.headline); content }
            .frame(maxWidth: .infinity, alignment: .leading).padding(20).businessCard(radius: 28)
    }
}

private struct UmrahFlightStep: View {
    @Binding var draft: UmrahPackageDraft
    @State private var source = 0
    @State private var direction = 0
    @State private var offers: [BusinessCuratedFlightOffer] = []
    @State private var loading = false
    @State private var error: String?
    @State private var number = ""
    @State private var date = Date()
    @State private var candidates: [FlightVerificationCandidate] = []
    @State private var key = ""
    @State private var verificationProvider = "Расписание"
    private var chosen: UmrahPackageDraft.Flight? { direction == 0 ? draft.outbound : draft.inbound }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            UmrahPanel(title: "Параметры поездки") {
                Stepper("Паломники: \(draft.travelers)", value: $draft.travelers, in: 1...6)
                Picker("Уровень комфорта", selection: $draft.comfort) {
                    ForEach(["Economy", "Standard", "Comfort", "Premium"], id: \.self) { Text($0) }
                }
                UmrahMoneyField(title: "Перелёт туда и обратно / человек · USD", text: $draft.flightPrice)
                Text("Укажите актуальную сумму за оба направления. Цена каталога не переносится автоматически.").font(.caption).foregroundStyle(.secondary)
            }
            Picker("Направление", selection: $direction) { Text("Туда").tag(0); Text("Обратно").tag(1) }.pickerStyle(.segmented)
            // System segmented control and system Liquid Glass; no hand-drawn glass substitute.
            Picker("Источник авиабилета", selection: $source) { Text("Каталог iUmrah").tag(0); Text("Добавить вручную").tag(1) }
                .pickerStyle(.segmented).padding(6).businessGlass(in: Capsule(), interactive: true)
            if let chosen { UmrahFlightCard(title: "Выбранный рейс", flight: chosen) }
            if source == 0 { catalog } else { manual }
            if let error { Text(error).font(.subheadline).foregroundStyle(.red) }
        }
        .onChange(of: draft.comfort) { _, value in
            if ["Economy", "Standard"].contains(value) { draft.makkah.meals = "Завтрак, обед и ужин"; draft.medina.meals = "Завтрак и ужин" }
        }
        .task { await load() }
    }
    private var catalog: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack { Text("Опубликованные рейсы").font(.headline); Spacer(); Button { Task { await load() } } label: { Image(systemName: "arrow.clockwise") }.disabled(loading) }
            if loading { ProgressView("Загрузка каталога…") }
            if !loading && offers.isEmpty { ContentUnavailableView("Рейсов пока нет", systemImage: "airplane", description: Text("Обновите каталог или добавьте рейс вручную.")) }
            ForEach(offers.filter { $0.published }) { offer in
                if let itinerary = offer.itinerary, !itinerary.legs.isEmpty {
                    let groups = flightGroups(itinerary.legs)
                    ForEach(Array(groups.enumerated()), id: \.offset) { index, legs in
                        let flight = UmrahPackageDraft.Flight(id: offer.id + "-\(index)", source: "Каталог iUmrah", legs: legs)
                        if isDirection(legs) {
                            Button { select(flight) } label: {
                                UmrahFlightCard(title: chosen?.id == flight.id ? "Выбрано ✓" : "Выбрать", flight: flight)
                            }.buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }
    private var manual: some View {
        UmrahPanel(title: "Найти рейс по номеру") {
            TextField("Номер рейса · например HY335", text: $number).textInputAutocapitalization(.characters).autocorrectionDisabled()
            DatePicker("Дата вылета", selection: $date, in: Date()..., displayedComponents: .date)
            Button { Task { await verify() } } label: {
                HStack { if loading { ProgressView() }; Text("Проверить расписание") }
            }.disabled(loading || number.trimmingCharacters(in: .whitespaces).isEmpty)
            Text("Проверяется расписание, а не наличие мест или стоимость билета.").font(.caption).foregroundStyle(.secondary)
            ForEach(candidates) { candidate in
                Button {
                    let leg = BusinessFlightCurationItinerary.Leg(airline: candidate.airlineName, flightNumber: candidate.flightNumber, airlineCode: candidate.airlineIATA, origin: candidate.departureAirportIATA, destination: candidate.arrivalAirportIATA, departureAt: candidate.scheduledDepartureUTC, arrivalAt: candidate.scheduledArrivalUTC, durationMinutes: 0, stops: 0, cabinClass: "economy")
                    select(.init(id: candidate.id, source: "Расписание · \(verificationProvider)", legs: [leg], verificationKey: key))
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(candidate.flightNumber) · \(candidate.departureAirportIATA) → \(candidate.arrivalAirportIATA)").font(.headline)
                        Text("\(candidate.scheduledDepartureLocal) → \(candidate.scheduledArrivalLocal)").font(.caption)
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(14).background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16))
                }.buttonStyle(.plain)
            }
        }
        .onChange(of: number) { _, _ in candidates = [] }
        .onChange(of: date) { _, _ in candidates = [] }
    }
    private func select(_ flight: UmrahPackageDraft.Flight) {
        if direction == 0 { draft.outbound = flight; if let arrival = draft.arrival { draft.pickup = arrival } }
        else { draft.inbound = flight }
    }
    private func isDirection(_ legs: [BusinessFlightCurationItinerary.Leg]) -> Bool {
        guard let first = legs.first, let last = legs.last else { return false }
        return direction == 0 ? ["JED", "MED"].contains(last.destination) : ["JED", "MED"].contains(first.origin)
    }
    /// Split round trips at the first completed arrival in Saudi Arabia, preserving connections.
    private func flightGroups(_ legs: [BusinessFlightCurationItinerary.Leg]) -> [[BusinessFlightCurationItinerary.Leg]] {
        guard let end = legs.firstIndex(where: { ["JED", "MED"].contains($0.destination) }), end < legs.count - 1,
              ["JED", "MED"].contains(legs[end + 1].origin) else { return [legs] }
        return [Array(legs[...end]), Array(legs[(end + 1)...])]
    }
    @MainActor private func load() async {
        loading = true; error = nil
        defer { loading = false }
        do { offers = try await APIClient.shared.curatedFlights() }
        catch { self.error = "Каталог недоступен: \(error.localizedDescription)" }
    }
    @MainActor private func verify() async {
        loading = true; error = nil; candidates = []
        let requestedNumber = number.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let requestedDate = date
        defer { loading = false }
        do {
            let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd"; formatter.locale = Locale(identifier: "en_US_POSIX")
            let result = try await APIClient.shared.verifyFlight(number: requestedNumber, dateLocal: formatter.string(from: requestedDate))
            guard number.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() == requestedNumber, date == requestedDate else { return }
            key = result.verificationKey; verificationProvider = result.provider; candidates = result.candidates
            if candidates.isEmpty { error = "Рейс на эту дату не найден. Проверьте номер и дату." }
        } catch { self.error = "Проверка рейса недоступна: \(error.localizedDescription)" }
    }
}

private struct UmrahFlightCard: View {
    let title: String
    let flight: UmrahPackageDraft.Flight
    var body: some View {
        UmrahPanel(title: title) {
            ForEach(Array(flight.legs.enumerated()), id: \.offset) { _, leg in
                VStack(alignment: .leading, spacing: 12) {
                    HStack { BusinessAirlineLogoView(airlineIATA: leg.airlineCode, size: 34); Text("\(leg.airline) · \(leg.flightNumber)").font(.subheadline.weight(.semibold)) }
                    HStack {
                        endpoint(leg.origin, leg.departureAt)
                        Spacer(); Image(systemName: "airplane").foregroundStyle(.secondary); Spacer()
                        endpoint(leg.destination, leg.arrivalAt)
                    }
                    Text("\(leg.cabinClass) · \(leg.stops == 0 ? "Без пересадок" : "Пересадки: \(leg.stops)")").font(.caption).foregroundStyle(.secondary)
                }
            }
            Text(flight.source).font(.caption2).foregroundStyle(.secondary)
        }
    }
    private func localTime(_ raw: String, airport: String) -> String {
        guard let date = UmrahPackageDraft.date(raw) else { return raw }
        let zone: String
        if ["JED", "MED", "RUH", "DMM"].contains(airport) { zone = "Asia/Riyadh" }
        else if ["TAS", "SKD", "BHK", "UGC", "NMA", "FEG", "AZN", "TMJ", "KSQ", "NCU", "NVI"].contains(airport) { zone = "Asia/Tashkent" }
        else { return date.formatted(.iso8601) + " UTC" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU"); formatter.timeZone = TimeZone(identifier: zone)
        formatter.dateFormat = "d MMM, HH:mm"
        return formatter.string(from: date) + " · местное"
    }
    private func endpoint(_ airport: String, _ raw: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(airport).font(.title2.bold())
            Text(localTime(raw, airport: airport)).font(.caption).fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct UmrahMoneyField: View {
    let title: String
    @Binding var text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            TextField("Сумма в USD", text: $text).keyboardType(.decimalPad).textFieldStyle(.roundedBorder)
        }
    }
}

private struct UmrahHotelStep: View {
    @Binding var draft: UmrahPackageDraft
    @State private var hotels: [HotelListItem] = []
    @State private var loading = false
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Toggle("Добавить Медину", isOn: $draft.includeMedina).tint(BusinessDesign.accent)
            Text("Выберите отели, даты и питание. Стоимость проживания указывается за все номера и весь срок.").font(.subheadline).foregroundStyle(.secondary)
            if loading { ProgressView("Загрузка отелей…") }
            if let error { Text(error).foregroundStyle(.red); Button("Повторить") { Task { await load() } } }
            UmrahStayEditor(title: "Мекка", stay: $draft.makkah, hotels: hotels.filter { city($0.city) == "makkah" })
            if draft.includeMedina {
                UmrahStayEditor(title: "Медина", stay: $draft.medina, hotels: hotels.filter { city($0.city) == "medina" })
            }
        }
        .task {
            // Seed only untouched dates. Returning to this step preserves manager changes.
            if draft.makkah.id.isEmpty, let arrival = draft.arrival, let departure = draft.departure {
                let calendar = UmrahPackageDraft.stayCalendar
                let start = calendar.startOfDay(for: arrival), end = calendar.startOfDay(for: departure)
                let nights = calendar.dateComponents([.day], from: start, to: end).day ?? 0
                let split = calendar.date(byAdding: .day, value: max(1, nights - 3), to: start) ?? end
                if draft.outbound?.legs.last?.destination == "MED" && draft.includeMedina {
                    draft.medina.checkIn = start; draft.medina.checkOut = split
                    draft.makkah.checkIn = split; draft.makkah.checkOut = end
                } else {
                    draft.makkah.checkIn = start; draft.makkah.checkOut = draft.includeMedina ? split : end
                    draft.medina.checkIn = split; draft.medina.checkOut = end
                }
            }
            await load()
        }
    }
    private func city(_ raw: String) -> String {
        let value = raw.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        if ["makkah", "mecca", "мекка", "макка"].contains(value) { return "makkah" }
        if ["medina", "madinah", "медина"].contains(value) { return "medina" }
        return value
    }
    @MainActor private func load() async {
        loading = true; error = nil
        defer { loading = false }
        do { hotels = try await APIClient.shared.hotels() }
        catch { self.error = "Не удалось загрузить отели: \(error.localizedDescription)" }
    }
}

private struct UmrahStayEditor: View {
    let title: String
    @Binding var stay: UmrahPackageDraft.Stay
    let hotels: [HotelListItem]
    @State private var picker = false
    @State private var search = ""
    var body: some View {
        UmrahPanel(title: title) {
            if !stay.id.isEmpty { UmrahStayCard(title: title, stay: stay) }
            Button(stay.id.isEmpty ? "Выбрать отель" : "Изменить отель") { picker = true }
                .font(.headline).tint(BusinessDesign.ink)
            DatePicker("Заселение", selection: $stay.checkIn, displayedComponents: .date)
            DatePicker("Выселение", selection: $stay.checkOut, displayedComponents: .date)
            Text("\(stay.nights) ночей").font(.caption).foregroundStyle(stay.nights > 0 ? Color.secondary : Color.red)
            Stepper("Номера: \(stay.rooms)", value: $stay.rooms, in: 1...6)
            TextField("Категория номера / размещение", text: $stay.room)
            Picker("Питание", selection: $stay.meals) {
                ForEach(["Без питания", "Завтрак", "Завтрак и ужин", "Завтрак, обед и ужин"], id: \.self) { Text($0) }
            }
            UmrahMoneyField(title: "Все номера · весь срок · USD", text: $stay.price)
        }
        .environment(\.calendar, UmrahPackageDraft.stayCalendar)
        .environment(\.timeZone, TimeZone(identifier: "Asia/Riyadh")!)
        .sheet(isPresented: $picker) {
            NavigationStack {
                List(hotels.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) }) { hotel in
                    Button {
                        stay.id = hotel.id; stay.name = hotel.name; stay.imageURL = hotel.coverImageURL; stay.stars = hotel.stars
                        stay.price = ""; stay.room = ""; picker = false
                    } label: {
                        HStack(spacing: 14) {
                            UmrahRemoteImage(raw: hotel.coverImageURL).frame(width: 80, height: 64).clipShape(RoundedRectangle(cornerRadius: 12))
                            VStack(alignment: .leading, spacing: 5) {
                                Text(hotel.name).font(.headline)
                                Text("\(hotel.stars.map { "\($0) ★ · " } ?? "")\(hotel.city)").font(.caption).foregroundStyle(.secondary)
                            }
                        }.foregroundStyle(BusinessDesign.ink)
                    }
                }
                .overlay { if hotels.isEmpty { ContentUnavailableView("Нет отелей в каталоге", systemImage: "building.2", description: Text("Нет доступных отелей. Проверьте подключение нового гостиничного API или выберите существующее размещение.")) } }
                .searchable(text: $search, prompt: "Название отеля")
                .navigationTitle("Отели · \(title)")
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Закрыть") { picker = false } } }
            }
        }
    }
}

private struct UmrahRemoteImage: View {
    let raw: String?
    var body: some View {
        AsyncImage(url: AppConfig.absoluteURL(raw)) { phase in
            if let image = phase.image { image.resizable().scaledToFill() }
            else { ZStack { BusinessDesign.secondarySurface; Image(systemName: "building.2").font(.title).foregroundStyle(.secondary) } }
        }.clipped()
    }
}

private struct UmrahStayCard: View {
    let title: String
    let stay: UmrahPackageDraft.Stay
    private func stayDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU"); formatter.timeZone = TimeZone(identifier: "Asia/Riyadh")
        formatter.dateFormat = "d MMM yyyy"
        return formatter.string(from: date)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            UmrahRemoteImage(raw: stay.imageURL).frame(height: 160).clipped()
            VStack(alignment: .leading, spacing: 8) {
                Text(title.uppercased()).font(.caption.weight(.semibold)).tracking(2).foregroundStyle(.secondary)
                Text(stay.name).font(.title3.bold())
                if let stars = stay.stars { Text(String(repeating: "★", count: min(5, max(0, stars)))).font(.caption) }
                Text("\(stayDate(stay.checkIn)) — \(stayDate(stay.checkOut))").font(.subheadline)
                Text("\(stay.nights) ночей · \(stay.rooms) номер(а) · \(stay.room)").font(.caption).foregroundStyle(.secondary)
                Text(stay.meals).font(.subheadline)
                if !stay.price.isEmpty { Text("$\(stay.price) · за всё проживание").font(.headline) }
            }.padding(18)
        }.businessCard(radius: 26)
    }
}

private struct UmrahTransferStep: View {
    @Binding var draft: UmrahPackageDraft
    private let vehicles = ["Chevrolet Malibu", "Kia Carnival", "GMC Yukon"]
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Личный автомобиль на весь маршрут").font(.title3.bold())
            Text("Свайпните, чтобы выбрать автомобиль. Стоимость подтвердите для всей группы.").font(.subheadline).foregroundStyle(.secondary)
            TabView(selection: $draft.vehicle) {
                ForEach(vehicles, id: \.self) { name in
                    UmrahVehicleCard(name: name, selected: draft.vehicle == name).padding(.horizontal, 4).tag(name)
                }
            }.tabViewStyle(.page(indexDisplayMode: .never)).frame(height: 315)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: draft.vehicle)
            HStack(spacing: 8) {
                ForEach(vehicles, id: \.self) { name in
                    Button { withAnimation { draft.vehicle = name } } label: {
                        Capsule().fill(draft.vehicle == name ? BusinessDesign.ink : BusinessDesign.line).frame(width: draft.vehicle == name ? 24 : 8, height: 8)
                    }.accessibilityLabel(name).padding(.vertical, 10)
                }
            }.frame(maxWidth: .infinity)
            UmrahPanel(title: "Маршрут и встреча") {
                ForEach(Array(draft.route.enumerated()), id: \.offset) { index, point in
                    HStack(alignment: .top) { Text("\(index + 1)").font(.caption.monospacedDigit()).foregroundStyle(.secondary); Text(point) }
                }
                DatePicker("Встреча · время Саудии", selection: $draft.pickup)
                    .environment(\.timeZone, TimeZone(identifier: "Asia/Riyadh")!)
                UmrahMoneyField(title: "Трансфер · вся группа · USD", text: $draft.transferPrice)
            }
            UmrahPanel(title: "Зияраты") {
                Toggle("Зияраты в Мекке", isOn: $draft.ziyaratMakkah)
                if draft.includeMedina { Toggle("Зияраты в Медине", isOn: $draft.ziyaratMedina) }
                if draft.ziyaratMakkah || (draft.includeMedina && draft.ziyaratMedina) {
                    UmrahMoneyField(title: "Зияраты · вся группа · USD", text: $draft.ziyaratPrice)
                }
            }.tint(BusinessDesign.accent)
        }
        .onChange(of: draft.vehicle) { _, value in
            // Existing product defaults, always editable by the manager.
            draft.transferPrice = value == "GMC Yukon" ? "1050" : "300"
        }
    }
}

private struct UmrahVehicleCard: View {
    let name: String
    let selected: Bool
    private var vip: Bool { name == "GMC Yukon" }
    private var asset: String { vip ? "TransferYukon" : name == "Kia Carnival" ? "TransferCarnival" : "TransferMalibu" }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(vip ? "PRIVATE · VIP" : "PRIVATE TRANSFER").font(.caption2.bold()).tracking(2)
                Spacer()
                if selected { Image(systemName: "checkmark.circle.fill").accessibilityLabel("Выбрано") }
            }
            Image(asset).resizable().scaledToFit().frame(maxWidth: .infinity).frame(height: 180)
                .shadow(color: vip ? .white.opacity(0.12) : .black.opacity(0.08), radius: 18, y: 8)
            Text(name).font(.title2.bold())
            Text(name == "Chevrolet Malibu" ? "До 3 паломников · личный водитель" : "До 6 паломников · личный водитель").font(.caption).opacity(0.7)
        }.padding(22).frame(maxWidth: .infinity, alignment: .leading)
            .foregroundStyle(vip ? Color.white : BusinessDesign.ink)
            .background(vip ? Color.black : BusinessDesign.card, in: RoundedRectangle(cornerRadius: 30))
            .overlay(RoundedRectangle(cornerRadius: 30).stroke(vip ? Color.white.opacity(0.12) : BusinessDesign.line))
    }
}
