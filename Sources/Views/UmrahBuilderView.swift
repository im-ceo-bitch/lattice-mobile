import SwiftUI

struct UmrahBuilderView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store: UmrahDraftStore

    private let editingOffer: BusinessOffer?
    init(owner: String, editingOffer: BusinessOffer? = nil, initial: UmrahPackageDraft? = nil) {
        self.editingOffer = editingOffer
        _store = StateObject(wrappedValue: UmrahDraftStore(owner: editingOffer.map { owner + ":" + $0.id + ":" + String($0.revision) } ?? owner, initial: initial))
    }
    @State private var step = 0
    @State private var error: String?
    @State private var saved = false
    @State private var restart = false
    private let steps = ["Авиабилеты", "Проживание", "Услуги", "Стоимость", "Клиент"]
    @State private var submitting = false
    @State private var showConfirmation = false
    @State private var showOfferConfirmation = false

    var body: some View {
        ScrollViewReader { reader in
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Color.clear.frame(height: 0).id("top")
                    Text("СОЗДАТЬ UMRAH").font(.caption.weight(.semibold)).tracking(3).foregroundStyle(.secondary)
                    Text(store.draft.offerReceipt != nil ? "Предложение" : store.draft.requestSecret != nil ? (store.draft.submissionMode == "offer" ? "Предложение" : "Бронирование") : steps[step]).font(.system(size: 34, weight: .bold, design: .rounded)).tracking(-1)
                    HStack(spacing: 6) {
                        ForEach(steps.indices, id: \.self) { index in
                            Capsule().fill(index <= step ? BusinessDesign.ink : BusinessDesign.line).frame(height: 4)
                        }
                    }.accessibilityLabel("Шаг \(step + 1) из \(steps.count): \(steps[step])")
                    if let offer = store.draft.offerReceipt { offerReceiptView(offer) }
                    else if let receipt = store.draft.receipt { receiptView(receipt) }
                    else if store.draft.requestSecret != nil { pendingView }
                    else { switch step {
                    case 0: UmrahFlightStep(draft: $store.draft)
                    case 1: UmrahHotelStep(draft: $store.draft)
                    case 2: UmrahTransferStep(draft: $store.draft)
                    case 3: summary
                    default: clientForm
                    } }
                    if let error { Label(error, systemImage: "exclamationmark.circle").font(.subheadline).foregroundStyle(.red) }
                    if let storageError = store.storageError { Text(storageError).font(.caption).foregroundStyle(.red) }
                }.businessAdaptiveReadableWidth().padding(22)
            }
            .onChange(of: step) { _, _ in reader.scrollTo("top", anchor: .top) }
        }
        .background(BusinessDesign.background)
        .navigationBarTitleDisplayMode(.inline)
        .businessNavigationSurface()
        .toolbar {
            ToolbarItem(placement: .principal) { BusinessBrandLogo(width: 150, foreground: .white).frame(height: 36) }
            ToolbarItem(placement: .topBarLeading) { Button("Закрыть") { store.save(); if store.storageError == nil { dismiss() } } }
            ToolbarItem(placement: .topBarTrailing) {
                Menu { Button("Начать заново", role: .destructive) { restart = true }.disabled(store.draft.requestSecret != nil && store.draft.receipt == nil && store.draft.offerReceipt == nil) } label: { Image(systemName: "ellipsis.circle") }
            }
        }
        .confirmationDialog("Удалить текущий черновик?", isPresented: $restart, titleVisibility: .visible) {
            Button("Начать заново", role: .destructive) { store.draft = UmrahPackageDraft(); step = 0; error = nil; store.save() }.disabled(submitting)
        }
        .safeAreaInset(edge: .bottom) { if store.draft.requestSecret == nil && store.draft.offerReceipt == nil { footer } }
        .environment(\.locale, Locale(identifier: "ru_RU"))
        .onChange(of: scenePhase) { _, phase in if phase != .active { store.save() } }
        .onDisappear { store.save() }
        .onChange(of: store.draft) { _, _ in store.save() }
        .confirmationDialog("Создать заявку на умру?", isPresented: $showConfirmation, titleVisibility: .visible) {
            Button("Создать бронирование") { Task { await submit() } }
        } message: { Text("Начнётся проверка наличия. Оплата и подтверждение поставщиков пока не выполняются.") }
        .confirmationDialog(editingOffer == nil ? "Создать предложение?" : "Обновить предложение?", isPresented: $showOfferConfirmation, titleVisibility: .visible) {
            Button(editingOffer == nil ? "Создать предложение" : "Обновить предложение") { Task { await submitOffer() } }
        } message: { Text("Наличие не резервируется. Клиент сможет принять актуальную версию по той же ссылке.") }
        .alert("Черновик сохранён", isPresented: $saved) {
            Button("Хорошо", role: .cancel) { }
        } message: { Text("Пакет сохранён на этом устройстве.") }
    }

    private var footer: some View {
        HStack(spacing: 16) {
            if step > 0 { Button { step -= 1; error = nil } label: { Image(systemName: "arrow.left").frame(width: 44, height: 44) }.tint(BusinessDesign.ink) }
            VStack(alignment: .leading, spacing: 3) {
                Text("За \(store.draft.travelers) чел.").font(.caption).foregroundStyle(.secondary)
                if let total = store.draft.saleTotal { Text(total, format: .currency(code: "USD")).font(.headline) }
                else { Text("Цена не заполнена").font(.caption) }
            }
            Spacer(minLength: 0)
            Button(step == 4 ? (editingOffer == nil ? "Создать бронь" : "Сохранить") : "Продолжить") {
                if step < 4 {
                    if let issue = store.draft.issue(at: step) { error = issue; return }
                    step += 1; error = nil
                } else {
                    for index in 0..<3 {
                        if let issue = store.draft.issue(at: index) { error = issue; step = index; return }
                    }
                    if editingOffer != nil { if store.draft.saleTotal == nil { error = "Проверьте стоимость"; return }; showOfferConfirmation = true; return }
                    if let issue = store.draft.bookingIssue { error = issue; return }
                    showConfirmation = true
                }
            }
            .font(.subheadline.bold()).padding(.horizontal, 20).frame(minHeight: 56)
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
            VStack(spacing: 5) {
                IumrahOrbitAssemblyMoment(services: orbitServices, logo: Image("Logo"),
                                          maxDiameter: 220, accessibilityTitle: "iumrah Business")
                Text("Компоненты в одном пакете").font(.headline)
                Text("Предложение · наличие проверяется отдельно").font(.footnote).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(16).frame(maxWidth: .infinity).businessCard(radius: 28)
            .accessibilityIdentifier("business.orbit.package")
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
                UmrahMoneyField(title: "Визы · вся группа", text: optional(\.visaPrice))
                UmrahMoneyField(title: "Гид · вся группа", text: optional(\.guidePrice))
                UmrahMoneyField(title: "Другие услуги · вся группа", text: optional(\.otherPrice))
                UmrahMoneyField(title: "Комиссия платформы · %", text: optional(\.commission))
                if let subtotal = store.draft.costSubtotal { priceRow("Себестоимость", subtotal) }
                if let total = store.draft.saleTotal {
                    priceRow("Итого для клиента", total).font(.headline)
                    priceRow("На человека", total / Double(store.draft.travelers))
                }
                Text("Предложение менеджера. Наличие и цены поставщиков требуют подтверждения.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
    private func optional(_ key: WritableKeyPath<UmrahPackageDraft, String?>, default fallback: String = "0") -> Binding<String> {
        Binding(get: { store.draft[keyPath: key] ?? fallback }, set: { store.draft[keyPath: key] = $0 })
    }
    private var clientForm: some View {
        VStack(alignment: .leading, spacing: 18) {
            UmrahPanel(title: "Предложение") {
                Text("Клиент ещё не принял решение. Контакты не обязательны: отправьте постоянную ссылку.").font(.subheadline).foregroundStyle(.secondary)
                Picker("Срок действия", selection: Binding(get: { store.draft.offerHours ?? 24 }, set: { store.draft.offerHours = $0 })) { Text("24 часа").tag(24); Text("48 часов").tag(48); Text("7 дней").tag(168) }.pickerStyle(.segmented)
                Picker("Язык клиента", selection: optional(\.language, default: "ru")) { Text("Русский").tag("ru"); Text("O‘zbekcha").tag("uz"); Text("Ўзбекча").tag("uz-cyrl"); Text("English").tag("en") }
                Button { for index in 0..<3 { if let issue = store.draft.issue(at: index) { error = issue; step = index; return } }; if store.draft.saleTotal == nil { error = "Проверьте стоимость"; return }; showOfferConfirmation = true } label: { Label(editingOffer == nil ? "Создать предложение" : "Обновить предложение", systemImage: "doc.text").frame(maxWidth: .infinity) }.buttonStyle(.borderedProminent).tint(.blue).disabled(submitting)
            }
            if editingOffer == nil { UmrahPanel(title: "Бронирование · клиент согласен") {
                TextField("Имя как в паспорте", text: $store.draft.clientName).textContentType(.givenName)
                TextField("Фамилия как в паспорте", text: optional(\.lastName, default: "")).textContentType(.familyName)
                TextField("Телефон +998…", text: $store.draft.phone).keyboardType(.phonePad).textContentType(.telephoneNumber)
                TextField("Email", text: optional(\.email, default: "")).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                Picker("Язык", selection: optional(\.language, default: "ru")) { Text("Русский").tag("ru"); Text("O‘zbekcha").tag("uz"); Text("Ўзбекча").tag("uz-cyrl"); Text("English").tag("en") }
                Toggle("Отправить подтверждение на email", isOn: Binding(get: { store.draft.sendEmail ?? false }, set: { store.draft.sendEmail = $0 }))
                Text("После создания можно отправить защищённую ссылку через сообщения или WhatsApp. Регистрация для просмотра не нужна.").font(.caption).foregroundStyle(.secondary)
            }
            }
            Button("Сохранить черновик") { store.save(); saved = store.storageError == nil }
        }
    }
    private var pendingView: some View {
        UmrahPanel(title: "Отправка заявки") {
            Text("Черновик зафиксирован. Повтор отправки использует тот же ключ, чтобы не создавать дубликат.").font(.subheadline)
            Button(submitting ? "Отправляем…" : "Повторить / проверить") { Task { if store.draft.submissionMode == "offer" { await submitOffer() } else { await submit() } } }.disabled(submitting)
        }
    }
    private func receiptView(_ receipt: BusinessManualBookingReceipt) -> some View {
        UmrahPanel(title: "Заявка создана") {
            Image(systemName: "checkmark.seal.fill").font(.largeTitle).foregroundStyle(.blue)
            Text(receipt.bookingNumber.map { String(format: "№%04d", $0) } ?? receipt.bookingID).font(.title.bold())
            if let id = receipt.pilgrimID { Text("iumrah ID: \(id)") }
            if !receipt.identityReady { Text("Номер паломника ещё синхронизируется. Повторите проверку.").font(.caption) }
            Text(receipt.totalUsd, format: .currency(code: "USD")).font(.title2.bold())
            Text("Проверка наличия · оплата пока не требуется").font(.caption).foregroundStyle(.secondary)
            Text("Email: \(receipt.emailDescription)").font(.subheadline)
            if !receipt.shareURL.isEmpty, let url = URL(string: receipt.shareURL) { ShareLink(item: url) { Label("Отправить ссылку", systemImage: "square.and.arrow.up") }; Link("Предпросмотр поездки", destination: url) }
            Button("Проверить отправку и ID") { Task { await submit() } }.disabled(submitting)
            NavigationLink("Открыть бронирование") { BookingDetailView(bookingID: receipt.bookingID) }
            Button("Создать новую умру") { store.draft = UmrahPackageDraft(); step = 0; error = nil; store.save() }.disabled(submitting)
        }
    }
    @MainActor private func submit() async {
        guard !submitting else { return }; error = nil
        if store.draft.requestSecret == nil {
            if let issue = store.draft.bookingIssue { error = issue; return }
            store.draft.submissionMode = "booking"
            store.draft.requestSecret = (UUID().uuidString + UUID().uuidString).replacingOccurrences(of: "-", with: "").lowercased()
            store.save()
            if let issue = store.storageError { store.draft.requestSecret = nil; error = issue; return }
        }
        submitting = true; defer { submitting = false }
        do {
            let receipt = try await APIClient.shared.createManualBooking(store.draft)
            store.draft.receipt = receipt; store.save()
            NotificationCenter.default.post(name: .iumrahBusinessBookingChanged, object: receipt.bookingID)
        } catch {
            if case APIError.server(let code) = error, ["INVALID_REQUEST", "INVALID_BOOKING", "INVALID_MANUAL_COST", "TRIP_DATE_IN_PAST", "INVALID_EMAIL", "INVALID_OFFER", "INVALID_CONTACT"].contains(code), store.draft.receipt == nil {
                store.draft.requestSecret = nil; store.save()
            }
            self.error = error.localizedDescription
        }
    }
    private func offerPreviewURL(_ url: URL) -> URL? { var c = URLComponents(url: url, resolvingAgainstBaseURL: false); c?.queryItems = [URLQueryItem(name: "preview", value: "1")]; return c?.url }
    private func offerReceiptView(_ offer: BusinessOffer) -> some View {
        UmrahPanel(title: "Предложение готово") {
            Image(systemName: "checkmark.seal.fill").font(.largeTitle).foregroundStyle(.blue)
            Text(offer.id).font(.caption.monospaced()).textSelection(.enabled)
            Text(offer.totalUsd, format: .currency(code: "USD")).font(.title2.bold())
            Text("Наличие не зарезервировано · " + offer.statusTitle).font(.caption).foregroundStyle(.secondary)
            if let url = URL(string: offer.shareURL) {
                ShareLink(item: url) { Label("Поделиться предложением", systemImage: "square.and.arrow.up") }
                if let preview = offerPreviewURL(url) { Link("Предпросмотр без учёта просмотра", destination: preview) }
            }
            NavigationLink("Управление предложением") { BusinessOfferDetailView(id: offer.id) }
            Button(editingOffer == nil ? "Создать новую умру" : "Готово") {
                if editingOffer != nil { dismiss() } else { store.draft = UmrahPackageDraft(); step = 0; error = nil; store.save() }
            }
        }
    }
    @MainActor private func submitOffer() async {
        guard !submitting else { return }; error = nil
        if store.draft.requestSecret == nil {
            store.draft.submissionMode = "offer"
            store.draft.requestSecret = (UUID().uuidString + UUID().uuidString).replacingOccurrences(of: "-", with: "").lowercased()
            store.save()
            if let issue = store.storageError { store.draft.requestSecret = nil; error = issue; return }
        }
        submitting = true; defer { submitting = false }
        do {
            let offer: BusinessOffer
            if let editingOffer { offer = try await APIClient.shared.editOffer(editingOffer, draft: store.draft) }
            else { offer = try await APIClient.shared.createOffer(store.draft) }
            store.draft.offerReceipt = offer; store.save()
            NotificationCenter.default.post(name: .iumrahBusinessOfferChanged, object: offer.id)
        } catch {
            if case APIError.server(let code) = error, ["INVALID_OFFER", "INVALID_REQUEST", "OFFER_CHANGED"].contains(code) { store.draft.requestSecret = nil; store.save() }
            self.error = error.localizedDescription
        }
    }
    private var orbitServices: [IumrahOrbitV5Service] {
        var services: [IumrahOrbitV5Service] = []
        if store.draft.outbound != nil || store.draft.inbound != nil { services.append(.init(id: "flight", symbol: "airplane")) }
        if !store.draft.makkah.id.isEmpty || (store.draft.includeMedina && !store.draft.medina.id.isEmpty) {
            services.append(.init(id: "hotel", symbol: "building.2.fill"))
        }
        if UmrahPackageDraft.amount(store.draft.transferPrice) != nil { services.append(.init(id: "transfer", symbol: "car.side.fill")) }
        if store.draft.ziyaratMakkah || (store.draft.includeMedina && store.draft.ziyaratMedina) {
            services.append(.init(id: "ziyarat", symbol: "map.fill"))
        }
        return services
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
    @State private var origin = "Все"
    @State private var airport = "Все"
    @State private var filterDate = false
    @State private var searchDate = Date()
    @State private var offers: [BusinessCuratedFlightOffer] = []
    @State private var loading = false
    @State private var error: String?
    @State private var number = ""
    @State private var date = Date()
    @State private var candidates: [FlightVerificationCandidate] = []
    @State private var key = ""
    @State private var verificationProvider = "Расписание"
    @State private var manualAirline = ""
    @State private var manualOrigin = "TAS"
    @State private var manualDestination = "JED"
    @State private var manualDeparture = Date().addingTimeInterval(86400)
    @State private var manualArrival = Date().addingTimeInterval(100800)
    private var chosen: UmrahPackageDraft.Flight? { direction == 0 ? draft.outbound : draft.inbound }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            UmrahPanel(title: "Параметры поездки") {
                Stepper("Паломники: \(draft.travelers)", value: $draft.travelers, in: 1...6)
                Picker("Уровень комфорта", selection: $draft.comfort) {
                    ForEach(["Economy", "Standard", "Comfort", "Premium"], id: \.self) { Text($0) }
                }
                UmrahMoneyField(title: "Перелёт туда и обратно / человек · USD", text: $draft.flightPrice)
                Text("Цена из базы переносится как ориентир. Проверьте сумму за оба направления перед созданием заявки.").font(.caption).foregroundStyle(.secondary)
            }
            Picker("Направление", selection: $direction) { Text("Туда").tag(0); Text("Обратно").tag(1) }.pickerStyle(.segmented)
            // System segmented control and system Liquid Glass; no hand-drawn glass substitute.
            Picker("Источник авиабилета", selection: $source) { Text("Umrah Direct Flights").tag(0); Text("Aviasales").tag(1) }
                .pickerStyle(.segmented).padding(6).businessGlass(in: Capsule(), interactive: true)
            if let chosen { UmrahFlightCard(title: "Выбранный рейс", flight: chosen) }
            UmrahPanel(title: "Фильтры") {
                Picker("Город Узбекистана", selection: $origin) { ForEach(["Все","TAS","FEG","NMA","AZN","SKD","BHK","KSQ","TMJ","UGC"], id: \.self) { Text($0) } }
                Picker("Аэропорт Саудии", selection: $airport) { ForEach(["Все","JED","MED"], id: \.self) { Text($0) } }
                Toggle("Выбрать дату", isOn: $filterDate)
                if filterDate { DatePicker("Дата", selection: $searchDate, displayedComponents: .date) }
            }
            catalog
            DisclosureGroup("Добавить рейс вручную") {
                UmrahPanel(title: "Без внешнего API") {
                    TextField("Авиакомпания", text: $manualAirline)
                    TextField("Номер рейса", text: $number).textInputAutocapitalization(.characters)
                    TextField("Аэропорт вылета · IATA", text: $manualOrigin).textInputAutocapitalization(.characters)
                    TextField("Аэропорт прилёта · IATA", text: $manualDestination).textInputAutocapitalization(.characters)
                    DatePicker("Вылет", selection: $manualDeparture)
                    DatePicker("Прилёт", selection: $manualArrival)
                    Text("Время в часовом поясе устройства: \(TimeZone.current.identifier). Пересчитайте местное время аэропорта перед вводом.").font(.caption).foregroundStyle(.secondary)
                    Button("Добавить без проверки") { addManualFlight() }
                }
                manual
            }
            if source == 1 { Link("Открыть Aviasales", destination: URL(string: "https://www.aviasales.com/")!).font(.subheadline) }
            if let error { Text(error).font(.subheadline).foregroundStyle(.red) }
        }
        .task { await load() }
    }
    private var catalog: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack { Text(source == 0 ? "Опубликованные рейсы iumrah" : "Сохранённые предложения Aviasales").font(.headline); Spacer(); Button { Task { await load() } } label: { Image(systemName: "arrow.clockwise") }.disabled(loading) }
            if loading { ProgressView("Загрузка каталога…") }
            if !loading && sourceOffers.isEmpty { ContentUnavailableView("Рейсов пока нет", systemImage: "airplane", description: Text("Обновите каталог или добавьте рейс вручную.")) }
            ForEach(sourceOffers) { offer in
                if let itinerary = offer.itinerary, !itinerary.legs.isEmpty {
                    let groups = flightGroups(itinerary.legs)
                    ForEach(Array(groups.enumerated()), id: \.offset) { index, legs in
                        let flight = UmrahPackageDraft.Flight(id: offer.id + "-\(index)", source: source == 0 ? "Umrah Direct Flights" : "Aviasales · сохранённое предложение", legs: legs)
                        if isDirection(legs) && matchesFilters(legs) {
                            Button { select(flight, offer: offer) } label: {
                                VStack(alignment: .leading, spacing: 4) { UmrahFlightCard(title: chosen?.id == flight.id ? "Выбрано ✓" : "Выбрать", flight: flight); Text("\(offer.perTravelerFare, specifier: "%.2f") \(offer.currency) · \(offer.offerType == "round_trip" ? "туда-обратно" : "тариф из базы")").font(.caption).foregroundStyle(.secondary) }
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
            Text("Опциональная проверка расписания может обращаться к внешнему API. Она не проверяет наличие мест или цену.").font(.caption).foregroundStyle(.secondary)
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
    private func addManualFlight() {
        let a = manualOrigin.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let b = manualDestination.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let n = number.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let airline = manualAirline.trimmingCharacters(in: .whitespacesAndNewlines)
        guard a.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil, b.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil, a != b, !n.isEmpty, !airline.isEmpty, manualArrival > manualDeparture else { error = "Проверьте данные ручного рейса."; return }
        let iso = ISO8601DateFormatter()
        let leg = BusinessFlightCurationItinerary.Leg(airline: airline, flightNumber: n, airlineCode: String(n.prefix(2)), origin: a, destination: b, departureAt: iso.string(from: manualDeparture), arrivalAt: iso.string(from: manualArrival), durationMinutes: Int(manualArrival.timeIntervalSince(manualDeparture)/60), stops: 0, cabinClass: "economy")
        select(.init(id: UUID().uuidString, source: "Ручной ввод · не проверено", legs: [leg]))
    }
    private var sourceOffers: [BusinessCuratedFlightOffer] {
        offers.filter { offer in
            guard offer.published, let i = offer.itinerary else { return false }
            let isAvia = [i.source, i.sourceName].compactMap { $0 }.joined(separator: " ").lowercased().contains("aviasales")
            return source == 1 ? isAvia : !isAvia
        }
    }
    private func matchesFilters(_ legs: [BusinessFlightCurationItinerary.Leg]) -> Bool {
        guard let first = legs.first, let last = legs.last, let departure = UmrahPackageDraft.date(first.departureAt), departure > Date() else { return false }
        if direction == 1, let arrival = draft.arrival, departure <= arrival { return false }
        if direction == 1, let outboundOrigin = draft.outbound?.legs.first?.origin, last.destination != outboundOrigin { return false }
        if origin != "Все" && (direction == 0 ? first.origin : last.destination) != origin { return false }
        if airport != "Все" && (direction == 0 ? last.destination : first.origin) != airport { return false }
        if filterDate && !Calendar.current.isDate(departure, inSameDayAs: searchDate) { return false }
        return true
    }
    private func select(_ flight: UmrahPackageDraft.Flight, offer: BusinessCuratedFlightOffer? = nil) {
        guard isDirection(flight.legs), matchesFilters(flight.legs) else { error = "Рейс не соответствует направлению, датам или фильтрам."; return }
        let key = direction == 0 ? "out" : "back"
        var fares = draft.flightFares ?? [:], keys = draft.selectedFareKeys ?? [:], kinds = draft.selectedFareKinds ?? [:]
        if let offer, offer.currency.uppercased() == "USD", offer.perTravelerFare > 0 {
            fares[key] = offer.perTravelerFare
            keys[key] = offer.id
            kinds[key] = offer.offerType ?? offer.itinerary?.effectiveOfferType ?? "unknown"
        } else { fares.removeValue(forKey: key); keys.removeValue(forKey: key); kinds.removeValue(forKey: key) }
        draft.flightFares = fares; draft.selectedFareKeys = keys; draft.selectedFareKinds = kinds
        if let out = fares["out"], let back = fares["back"], keys["out"] == keys["back"] || (kinds["out"] == "one_way" && kinds["back"] == "one_way") { draft.flightPrice = String(format: "%.2f", keys["out"] == keys["back"] ? out : out + back) }
        else { draft.flightPrice = "" }
        if direction == 0 {
            if let previous = draft.inbound, previous.legs.last?.destination != flight.legs.first?.origin || (UmrahPackageDraft.date(previous.legs.first?.departureAt) ?? .distantPast) <= (UmrahPackageDraft.date(flight.legs.last?.arrivalAt) ?? .distantFuture) { draft.inbound = nil; draft.flightFares?["back"] = nil; draft.selectedFareKeys?["back"] = nil; draft.selectedFareKinds?["back"] = nil; draft.flightPrice = "" }
            draft.outbound = flight; if let arrival = draft.arrival { draft.pickup = arrival }
            direction = 1; filterDate = false
        } else { draft.inbound = flight }
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
            UmrahStayEditor(title: "Мекка", stay: $draft.makkah, travelers: draft.travelers, hotels: hotels.filter { city($0.city) == "makkah" })
            if draft.includeMedina {
                UmrahStayEditor(title: "Медина", stay: $draft.medina, travelers: draft.travelers, hotels: hotels.filter { city($0.city) == "medina" })
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
    let travelers: Int
    let hotels: [HotelListItem]
    @State private var picker = false
    @State private var search = ""
    @State private var rooms: [HotelAdminDetailRoom] = []
    @State private var priceMode = 1
    var body: some View {
        UmrahPanel(title: title) {
            if !stay.id.isEmpty { UmrahStayCard(title: title, stay: stay) }
            Button(stay.id.isEmpty ? "Выбрать отель" : "Изменить отель") { picker = true }
                .font(.headline).tint(BusinessDesign.ink)
            DatePicker("Заселение", selection: $stay.checkIn, displayedComponents: .date)
            DatePicker("Выселение", selection: $stay.checkOut, displayedComponents: .date)
            Text("\(stay.nights) ночей").font(.caption).foregroundStyle(stay.nights > 0 ? Color.secondary : Color.red)
            Stepper("Номера: \(stay.rooms)", value: $stay.rooms, in: 1...6)
            if !rooms.isEmpty { Picker("Категория номера", selection: $stay.room) { Text("Выбрать").tag(""); ForEach(rooms) { Text($0.name).tag($0.name) } } }
            TextField("Категория номера / размещение", text: $stay.room)
            Picker("Питание", selection: $stay.meals) {
                ForEach(["Без питания", "Завтрак", "Завтрак и ужин", "Завтрак, обед и ужин"], id: \.self) { Text($0) }
            }
            Picker("Стоимость", selection: $priceMode) { Text("Цена из базы").tag(0); Text("Своя цена").tag(1) }.pickerStyle(.segmented)
            if priceMode == 0 { Button("Перенести подходящую цену") { applyCachedPrice() }; Text("Только точное совпадение дат, номеров и свежего предложения. Перепроверьте цену.").font(.caption).foregroundStyle(.secondary) }
            UmrahMoneyField(title: "Все номера · весь срок · USD", text: $stay.price)
        }
        .task(id: stay.id) {
            rooms = []
            if !stay.id.isEmpty, let detail = try? await APIClient.shared.hotelDetail(id: stay.id), detail.id == stay.id { rooms = detail.rooms }
        }
        .onChange(of: stay.checkIn) { _, _ in if priceMode == 0 { applyCachedPrice() } }
        .onChange(of: stay.checkOut) { _, _ in if priceMode == 0 { applyCachedPrice() } }
        .onChange(of: stay.rooms) { _, _ in if priceMode == 0 { applyCachedPrice() } }
        .environment(\.calendar, UmrahPackageDraft.stayCalendar)
        .environment(\.timeZone, TimeZone(identifier: "Asia/Riyadh")!)
        .sheet(isPresented: $picker) {
            NavigationStack {
                List(hotels.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) }) { hotel in
                    Button {
                        stay.id = hotel.id; stay.name = hotel.name; stay.imageURL = hotel.coverImageURL; stay.stars = hotel.stars
                        stay.price = ""; stay.room = ""; stay.meals = "Без питания"; priceMode = 1; picker = false
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
    private func applyCachedPrice() {
        let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd"; formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(identifier: "Asia/Riyadh")
        guard let cached = hotels.first(where: { $0.id == stay.id })?.price,
              cached.status == "fresh", cached.checkIn == formatter.string(from: stay.checkIn), cached.checkOut == formatter.string(from: stay.checkOut), cached.rooms == stay.rooms, cached.adults == travelers,
              let amount = cached.quoteTotalUSD, amount > 0 else { stay.price = ""; return }
        stay.price = String(format: "%.2f", amount)
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
