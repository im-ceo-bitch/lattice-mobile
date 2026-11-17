import SwiftUI

struct UmrahBuilderView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store: UmrahDraftStore

    private let editingOffer: BusinessOffer?
    @State private var finishAsOffer: Bool
    init(owner: String, editingOffer: BusinessOffer? = nil, initial: UmrahPackageDraft? = nil, preferOffer: Bool = false) {
        self.editingOffer = editingOffer
        _finishAsOffer = State(initialValue: preferOffer || editingOffer != nil)
        _store = StateObject(wrappedValue: UmrahDraftStore(owner: editingOffer.map { owner + ":" + $0.id + ":" + String($0.revision) } ?? owner, initial: initial))
    }
    private var step: Int { min(5, max(0, store.draft.builderStage ?? 0)) }
    private var flightPhase: Int { min(2, max(0, store.draft.builderFlightPhase ?? (store.draft.outbound == nil ? 0 : store.draft.inbound == nil ? 1 : 2))) }
    private var hotelPhase: Int { store.draft.builderHotelPhase == 1 && store.draft.includeMedina ? 1 : 0 }
    private func go(_ stage: Int) {
        let target = min(5, max(0, stage))
        store.draft.builderStage = min(target, store.draft.firstIncompleteBuilderStage); error = nil
        if store.draft.builderStage == 1 {
            if store.draft.outbound == nil { store.draft.builderFlightPhase = 0 }
            else if store.draft.inbound == nil { store.draft.builderFlightPhase = 1 }
        }
        if store.draft.builderStage == 2 && store.draft.stayIssue(store.draft.makkah) != nil { store.draft.builderHotelPhase = 0 }
    }
    private func back() {
        error = nil
        if step == 1 && flightPhase > 0 { store.draft.builderFlightPhase = flightPhase - 1 }
        else if step == 2 && hotelPhase == 1 { store.draft.builderHotelPhase = 0 }
        else { go(step - 1) }
    }
    @State private var error: String?
    @State private var saved = false
    @State private var restart = false
    private let steps = ["Параметры", "Авиабилеты", "Отели", "Услуги", "Стоимость", "Оформление"]
    @State private var submitting = false
    @State private var showConfirmation = false
    @State private var showOfferConfirmation = false

    var body: some View {
        ScrollViewReader { reader in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Color.clear.frame(height: 0).id("top")
                    BusinessPageHeading(title: store.draft.offerReceipt != nil ? "Предложение" : store.draft.receipt != nil ? "Бронирование" : store.draft.requestSecret != nil ? (store.draft.submissionMode == "offer" ? "Предложение" : "Бронирование") : steps[step], subtitle: editingOffer == nil ? "Создание индивидуальной умры" : "Редактирование предложения")
                    if store.draft.requestSecret == nil && store.draft.offerReceipt == nil && store.draft.receipt == nil {
                        builderRail
                    }
                    if let offer = store.draft.offerReceipt { offerReceiptView(offer) }
                    else if let receipt = store.draft.receipt { receiptView(receipt) }
                    else if store.draft.requestSecret != nil { pendingView }
                    else { switch step {
                    case 0: parameters
                    case 1: UmrahFlightStep(draft: $store.draft)
                    case 2: UmrahHotelStep(draft: $store.draft)
                    case 3: UmrahTransferStep(draft: $store.draft)
                    case 4: summary
                    default: finalReview; clientForm
                    } }
                    if let error { Label(error, systemImage: "exclamationmark.circle").font(.subheadline).foregroundStyle(.red).id("validation") }
                    if let storageError = store.storageError { Text(storageError).font(.caption).foregroundStyle(.red) }
                }.businessAdaptiveReadableWidth().padding(BusinessDesign.Space.page)
            }
            .onChange(of: step) { _, _ in reader.scrollTo("top", anchor: .top) }
            .onChange(of: flightPhase) { _, _ in reader.scrollTo("top", anchor: .top) }
            .onChange(of: hotelPhase) { _, _ in reader.scrollTo("top", anchor: .top) }
            .onChange(of: error) { _, value in if value != nil { reader.scrollTo("validation", anchor: .bottom) } }
        }
        .background(BusinessDesign.background)
        .navigationBarTitleDisplayMode(.inline)
        .businessNavigationSurface()
        .toolbar {
            ToolbarItem(placement: .principal) { BusinessBrandLogo(width: 150, foreground: .white).frame(height: 36) }
            ToolbarItem(placement: .topBarLeading) { Button("Закрыть") { store.save(); if store.storageError == nil { dismiss() } }.foregroundStyle(.white) }
            ToolbarItem(placement: .topBarTrailing) {
                Menu { Button("Сохранить черновик") { store.save(); saved = store.storageError == nil }; if editingOffer == nil { Button("Начать заново", role: .destructive) { restart = true }.disabled(store.draft.requestSecret != nil && store.draft.receipt == nil && store.draft.offerReceipt == nil) } } label: { Image(systemName: "ellipsis.circle").foregroundStyle(.white) }
            }
        }
        .confirmationDialog("Удалить текущий черновик?", isPresented: $restart, titleVisibility: .visible) {
            Button("Начать заново", role: .destructive) { store.draft = UmrahPackageDraft(); go(0); store.save() }.disabled(submitting)
        }
        .safeAreaInset(edge: .bottom) { if store.draft.requestSecret == nil && store.draft.offerReceipt == nil && store.draft.receipt == nil { footer } }
        .environment(\.locale, Locale(identifier: "ru_RU"))
        .onChange(of: scenePhase) { _, phase in if phase != .active { store.save() } }
        .onDisappear { store.save() }
         .onChange(of: store.draft) { _, _ in store.save() }
        .onAppear {
            if store.draft.builderStage == nil { go(editingOffer != nil ? store.draft.firstIncompleteBuilderStage : 0) }
            else { go(step) }
            if editingOffer == nil, let savedMode = store.draft.builderFinishAsOffer { finishAsOffer = savedMode }
        }
        .onChange(of: finishAsOffer) { _, value in store.draft.builderFinishAsOffer = value }
        .onChange(of: store.draft.includeMedina) { _, _ in
            store.draft.builderHotelPhase = 0; store.draft.makkah.price = ""; store.draft.medina.price = ""
        }
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

    private var builderRail: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 5) {
                ForEach(steps.indices, id: \.self) { index in
                    Button { go(index) } label: {
                        Capsule().fill(index <= step ? Color.blue : BusinessDesign.line).frame(height: 5)
                            .frame(minHeight: 22).contentShape(Rectangle())
                    }.buttonStyle(.plain).disabled(index > step && index > store.draft.firstIncompleteBuilderStage)
                    .accessibilityLabel("Шаг \(index + 1): \(steps[index])")
                }
            }
            HStack {
                Text("Шаг \(step + 1) из \(steps.count)").font(.caption.weight(.semibold)).foregroundStyle(.blue)
                Spacer()
                Text("Черновик · \(store.draft.travelers) чел.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
    private var parameters: some View {
        VStack(alignment: .leading, spacing: 16) {
            UmrahPanel(title: "Паломники") {
                HStack {
                    Text("Количество человек").font(.subheadline)
                    Spacer()
                    Stepper(value: Binding(get: { store.draft.travelers }, set: { value in
                        if value != store.draft.travelers { store.draft.travelers = value; store.draft.makkah.price = ""; store.draft.medina.price = ""; store.draft.flightPrice = "" }
                    }), in: 1...6) { Text("\(store.draft.travelers)").font(.title2.bold()).monospacedDigit() }.fixedSize()
                }
            }
            UmrahPanel(title: "Категория поездки") {
                ForEach(["Economy", "Standard", "Comfort", "Premium"], id: \.self) { option in
                    Button { store.draft.comfort = option } label: {
                        HStack { Text(option == "Premium" ? "Luxury · Premium" : option); Spacer(); Image(systemName: store.draft.comfort == option ? "checkmark.circle.fill" : "circle").foregroundStyle(store.draft.comfort == option ? Color.blue : Color.secondary) }.padding(.vertical, 5).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                }
            }
            UmrahPanel(title: "Город вылета") {
                Picker("Город Узбекистана", selection: Binding(get: { store.draft.builderOrigin ?? store.draft.outbound?.legs.first?.origin ?? "Все" }, set: { value in
                    store.draft.builderOrigin = value
                    if value != "Все", let existing = store.draft.outbound?.legs.first?.origin, existing != value {
                        store.draft.outbound = nil; store.draft.inbound = nil; store.draft.flightPrice = ""; store.draft.flightFares = nil; store.draft.selectedFareKeys = nil; store.draft.selectedFareKinds = nil; store.draft.builderFlightPhase = 0
                        store.draft.makkah.price = ""; store.draft.medina.price = ""
                    }
                })) { ForEach(["Все", "TAS", "FEG", "NMA", "AZN", "SKD", "BHK", "KSQ", "TMJ", "UGC"], id: \.self) { Text(UmrahAirportLabel.city($0)).tag($0) } }
                .pickerStyle(.menu).tint(.blue)
                Toggle("Проживание в Медине", isOn: $store.draft.includeMedina).tint(.blue)
            }
        }
    }
    private var nextTitle: String {
        switch step {
        case 0: return "Выбрать авиабилеты"
        case 1: return flightPhase == 0 ? "Выбрать обратный рейс" : flightPhase == 1 ? "Подтвердить стоимость" : "Перейти к отелям"
        case 2: return hotelPhase == 0 && store.draft.includeMedina ? "Выбрать отель в Медине" : "Перейти к услугам"
        case 3: return "Рассчитать стоимость"
        case 4: return "Проверить и оформить"
        default: return editingOffer != nil ? "Сохранить предложение" : finishAsOffer ? "Создать предложение" : "Создать бронирование"
        }
    }
    private var currentIssue: String? {
        if step == 1 && flightPhase == 0 { return store.draft.outbound == nil ? "Выберите рейс туда." : nil }
        if step == 1 && flightPhase == 1 { return store.draft.inbound == nil ? "Выберите обратный рейс." : nil }
        if step == 2 && hotelPhase == 0 && store.draft.includeMedina { return store.draft.stayIssue(store.draft.makkah) }
        if step == 5 {
            if let issue = (0..<5).compactMap({ store.draft.builderIssue(at: $0) }).first { return issue }
            return finishAsOffer || editingOffer != nil ? nil : store.draft.bookingIssue
        }
        return store.draft.builderIssue(at: step)
    }
    private func advance() {
        error = nil
        if step == 5 {
            if let invalid = (0..<5).first(where: { store.draft.builderIssue(at: $0) != nil }) { go(invalid); error = store.draft.builderIssue(at: invalid); return }
            if finishAsOffer || editingOffer != nil { showOfferConfirmation = true; return }
            if let issue = store.draft.bookingIssue { error = issue; return }
            showConfirmation = true; return
        }
        if let issue = currentIssue { error = issue; return }
        if step == 1 && flightPhase < 2 { store.draft.builderFlightPhase = flightPhase + 1; return }
        if step == 2 && hotelPhase == 0 && store.draft.includeMedina { store.draft.builderHotelPhase = 1; return }
        go(step + 1)
    }
    private var footer: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                if step > 0 {
                    Button { back() } label: { Image(systemName: "arrow.left").frame(width: 44, height: 44) }
                        .buttonStyle(.plain).accessibilityLabel("Предыдущий этап")
                }
                Text("За \(store.draft.travelers) чел.").font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 0)
                if step >= 4, let total = store.draft.saleTotal { Text(total, format: .currency(code: "USD")).font(.headline).monospacedDigit() }
                else if step == 1 && flightPhase == 2, let fare = UmrahPackageDraft.amount(store.draft.flightPrice), fare > 0 { Text(fare * Double(store.draft.travelers), format: .currency(code: "USD")).font(.headline).monospacedDigit() }
                else { Text(steps[step]).font(.caption).foregroundStyle(.secondary) }
            }
            if let issue = currentIssue { Text(issue).font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading) }
            if step < 5 && store.draft.firstIncompleteBuilderStage == 5 {
                Button("Вернуться к оформлению") { go(5) }.font(.caption.weight(.semibold)).tint(.blue)
            }
            Button(nextTitle) { advance() }.buttonStyle(BusinessActionStyle()).disabled(submitting || currentIssue != nil)
        }.businessAdaptiveReadableWidth().padding(.horizontal, BusinessDesign.Space.page).padding(.vertical, 10).background(BusinessDesign.background).overlay(alignment: .top) { Divider() }
    }
    private func reviewRow(_ title: String, detail: String, symbol: String, stage: Int, phase: Int? = nil) -> some View {
        Button {
            if stage == 1 { store.draft.builderFlightPhase = phase ?? 0 }
            if stage == 2 { store.draft.builderHotelPhase = phase ?? 0 }
            go(stage)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: symbol).font(.title3).foregroundStyle(.blue).frame(width: 32)
                VStack(alignment: .leading, spacing: 4) { Text(title).font(.headline); Text(detail).font(.caption).foregroundStyle(.secondary) }
                Spacer(); Image(systemName: "pencil").foregroundStyle(.blue)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 6).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }
    private func stayReview(_ stay: UmrahPackageDraft.Stay) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "ru_RU"); f.timeZone = TimeZone(identifier: "Asia/Riyadh"); f.dateFormat = "d MMM"
        return "\(stay.name) · \(f.string(from: stay.checkIn))–\(f.string(from: stay.checkOut)) · \(stay.nights) ночей · \(stay.rooms) ном. · \(stay.room) · \(stay.meals)"
    }
    private var finalReview: some View {
        UmrahPanel(title: "Проверка пакета") {
            HStack(spacing: 12) {
                IumrahOrbitAssemblyMoment(services: orbitServices, logo: Image("Logo"), maxDiameter: 84, accessibilityTitle: "iumrah Business")
                VStack(alignment: .leading, spacing: 4) { Text("Пакет собран").font(.headline); Text("Проверьте компоненты перед отправкой").font(.caption).foregroundStyle(.secondary) }
            }.accessibilityIdentifier("business.orbit.package")
            reviewRow("Параметры", detail: "\(store.draft.travelers) чел. · \(store.draft.comfort)", symbol: "person.2", stage: 0)
            if let out = store.draft.outbound { reviewRow("Рейс туда", detail: UmrahAirportLabel.route(out), symbol: "airplane.departure", stage: 1, phase: 0) }
            if let back = store.draft.inbound { reviewRow("Рейс обратно", detail: UmrahAirportLabel.route(back), symbol: "airplane.arrival", stage: 1, phase: 1) }
            reviewRow("Мекка", detail: stayReview(store.draft.makkah), symbol: "bed.double", stage: 2, phase: 0)
            if store.draft.includeMedina { reviewRow("Медина", detail: stayReview(store.draft.medina), symbol: "bed.double", stage: 2, phase: 1) }
            reviewRow("Услуги", detail: store.draft.vehicle + " · " + pickupText, symbol: "car", stage: 3)
            reviewRow("Стоимость", detail: store.draft.saleTotal.map { $0.formatted(.currency(code: "USD")) } ?? "Проверить", symbol: "creditcard", stage: 4)
        }
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
            UmrahPanel(title: "Стоимость · USD") {
                priceRow("Перелёт × \(store.draft.travelers)", (UmrahPackageDraft.amount(store.draft.flightPrice) ?? 0) * Double(store.draft.travelers))
                priceRow("Мекка · все номера и ночи", UmrahPackageDraft.amount(store.draft.makkah.price) ?? 0)
                if store.draft.includeMedina { priceRow("Медина · все номера и ночи", UmrahPackageDraft.amount(store.draft.medina.price) ?? 0) }
                priceRow("Трансфер", UmrahPackageDraft.amount(store.draft.transferPrice) ?? 0)
                if store.draft.ziyaratMakkah || (store.draft.includeMedina && store.draft.ziyaratMedina) { priceRow("Зияраты", UmrahPackageDraft.amount(store.draft.ziyaratPrice) ?? 0) }
                Divider()
                priceRow("Визы", UmrahPackageDraft.amount(store.draft.visaPrice ?? "0") ?? 0)
                priceRow("Гид", UmrahPackageDraft.amount(store.draft.guidePrice ?? "0") ?? 0)
                priceRow("Другие услуги", UmrahPackageDraft.amount(store.draft.otherPrice ?? "0") ?? 0)
                Button("Изменить услуги") { go(3) }.font(.subheadline).tint(.blue)
                UmrahMoneyField(title: "Комиссия платформы · %", text: optional(\.commission))
                UmrahMoneyField(title: "Скидка · на весь пакет, USD", text: optional(\.discount))
                if let subtotal = store.draft.costSubtotal { priceRow("Себестоимость", subtotal) }
                if let fee = store.draft.commissionAmount { priceRow("Комиссия · USD", fee) }
                if let discount = UmrahPackageDraft.amount(store.draft.discount ?? "0"), discount > 0 { priceRow("Скидка", -discount) }
                if let total = store.draft.saleTotal {
                    priceRow("Итого для клиента", total).font(.headline)
                    priceRow("На человека", (total * 100 / Double(store.draft.travelers)).rounded() / 100)
                }
                Text("Внутренний расчёт. Клиент увидит только итоговую стоимость. Наличие и цены поставщиков требуют подтверждения.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
    private func optional(_ key: WritableKeyPath<UmrahPackageDraft, String?>, default fallback: String = "0") -> Binding<String> {
        Binding(get: { store.draft[keyPath: key] ?? fallback }, set: { store.draft[keyPath: key] = $0 })
    }
    private var clientForm: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let total = store.draft.saleTotal {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Стоимость поездки").font(.subheadline).foregroundStyle(.secondary)
                    Text(total, format: .currency(code: "USD")).font(BusinessDesign.TypeStyle.hero).monospacedDigit()
                    Text("За \(store.draft.travelers) паломников").font(.caption).foregroundStyle(.secondary)
                }.padding(18).frame(maxWidth: .infinity, alignment: .leading).businessCard(radius: BusinessDesign.Radius.compact)
            }
            if editingOffer == nil {
                Button { finishAsOffer = true; error = nil } label: {
                    BusinessChoiceRow(title: "Создать предложение", subtitle: "Клиент ещё думает. Контакты не нужны.", symbol: "doc.text", selected: finishAsOffer)
                }.buttonStyle(.plain)
                Button { finishAsOffer = false; error = nil } label: {
                    BusinessChoiceRow(title: "Создать бронирование", subtitle: "Клиент согласен. Начать проверку наличия.", symbol: "suitcase.rolling", selected: !finishAsOffer)
                }.buttonStyle(.plain)
            }
            if finishAsOffer || editingOffer != nil {
                UmrahPanel(title: "Условия предложения") {
                    Text("Постоянная ссылка. Наличие и цена подтверждаются при бронировании.").font(.subheadline).foregroundStyle(.secondary)
                    Picker("Срок действия", selection: Binding(get: { store.draft.offerHours ?? 24 }, set: { store.draft.offerHours = $0 })) { Text("24 часа").tag(24); Text("48 часов").tag(48); Text("7 дней").tag(168) }.pickerStyle(.segmented)
                    languagePicker
                }
            } else {
                UmrahPanel(title: "Контакт паломника") {
                    TextField("Имя как в паспорте", text: $store.draft.clientName).textContentType(.givenName)
                    Divider()
                    TextField("Фамилия как в паспорте", text: optional(\.lastName, default: "")).textContentType(.familyName)
                    Divider()
                    TextField("Телефон +998…", text: $store.draft.phone).keyboardType(.phonePad).textContentType(.telephoneNumber)
                    Divider()
                    TextField("Email", text: optional(\.email, default: "")).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    languagePicker
                    Toggle("Отправить подтверждение на email", isOn: Binding(get: { store.draft.sendEmail ?? false }, set: { store.draft.sendEmail = $0 }))
                    Text("После создания можно поделиться защищённой ссылкой. Регистрация не нужна.").font(.caption).foregroundStyle(.secondary)
                }
            }
            Button { store.save(); saved = store.storageError == nil } label: { Label("Сохранить черновик", systemImage: "tray.and.arrow.down") }.buttonStyle(BusinessActionStyle(primary: false))
        }
    }
    private var languagePicker: some View {
        Picker("Язык клиента", selection: optional(\.language, default: "ru")) { Text("Русский").tag("ru"); Text("O‘zbekcha").tag("uz"); Text("Ўзбекча").tag("uz-cyrl"); Text("English").tag("en") }
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
            if !receipt.shareURL.isEmpty, let url = URL(string: receipt.shareURL) { ShareLink(item: url) { Label("Отправить ссылку", systemImage: "square.and.arrow.up") }.buttonStyle(BusinessActionStyle()); Link("Предпросмотр поездки", destination: url).buttonStyle(BusinessActionStyle(primary: false)) }
            Button("Проверить отправку и ID") { Task { await submit() } }.disabled(submitting)
            NavigationLink("Открыть бронирование") { BookingDetailView(bookingID: receipt.bookingID) }
            Button("Создать новую умру") { store.draft = UmrahPackageDraft(); go(0); store.save() }.disabled(submitting)
        }
    }
    @MainActor private func submit() async {
        guard !submitting else { return }; error = nil
        if store.draft.requestSecret == nil {
            if let issue = (0..<5).compactMap({ store.draft.builderIssue(at: $0) }).first ?? store.draft.bookingIssue { error = issue; return }
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
                ShareLink(item: url) { Label("Поделиться предложением", systemImage: "square.and.arrow.up") }.buttonStyle(BusinessActionStyle())
                if let preview = offerPreviewURL(url) { Link("Предпросмотр без учёта просмотра", destination: preview) }
            }
            NavigationLink("Управление предложением") { BusinessOfferDetailView(id: offer.id) }.buttonStyle(BusinessActionStyle(primary: false))
            Button(editingOffer == nil ? "Создать новую умру" : "Готово") {
                if editingOffer != nil { dismiss() } else { store.draft = UmrahPackageDraft(); go(0); store.save() }
            }
        }
    }
    @MainActor private func submitOffer() async {
        guard !submitting else { return }; error = nil
        if store.draft.requestSecret == nil {
            if let issue = (0..<5).compactMap({ store.draft.builderIssue(at: $0) }).first { error = issue; return }
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
    private var phase: Int { min(2, max(0, draft.builderFlightPhase ?? (draft.outbound == nil ? 0 : draft.inbound == nil ? 1 : 2))) }
    private var direction: Int { phase == 1 ? 1 : 0 }
    @State private var showFilters = false
    @State private var catalogLoaded = false
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
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                phaseButton("Туда", index: 0, completed: draft.outbound != nil)
                phaseButton("Обратно", index: 1, completed: draft.inbound != nil)
                phaseButton("Цена", index: 2, completed: (UmrahPackageDraft.amount(draft.flightPrice) ?? 0) > 0)
            }
            if phase == 2 {
                fareConfirmation
            } else {
                if phase == 1, let outbound = draft.outbound {
                    Label(UmrahAirportLabel.route(outbound), systemImage: "checkmark.circle.fill").font(.subheadline).foregroundStyle(.blue)
                }
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Откуда").font(.caption).foregroundStyle(.secondary)
                        Text(UmrahAirportLabel.city(direction == 0 ? effectiveOrigin : airport == "Все" ? "Саудия" : airport)).font(.headline)
                    }
                    Spacer(); Image(systemName: "arrow.right").foregroundStyle(.secondary); Spacer()
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Куда").font(.caption).foregroundStyle(.secondary)
                        Text(UmrahAirportLabel.city(direction == 0 ? airport == "Все" ? "Саудия" : airport : effectiveOrigin)).font(.headline)
                    }
                    Spacer(minLength: 4)
                    Button { showFilters.toggle() } label: { Image(systemName: "slider.horizontal.3").font(.title3).frame(width: 44, height: 44).background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 12)) }.buttonStyle(.plain).foregroundStyle(.blue).accessibilityLabel("Фильтры рейсов")
                }.padding(12).businessCard(radius: 18)
                if filterDate { Text("Дата: \(searchDate.formatted(date: .abbreviated, time: .omitted))").font(.caption).foregroundStyle(.secondary) }
                if showFilters {
                    UmrahPanel(title: "Фильтры") {
                        if direction == 0 { Picker("Город Узбекистана", selection: $origin) { ForEach(["Все","TAS","FEG","NMA","AZN","SKD","BHK","KSQ","TMJ","UGC"], id: \.self) { Text(UmrahAirportLabel.city($0)).tag($0) } }.pickerStyle(.menu) }
                        Picker(direction == 0 ? "Аэропорт прилёта" : "Аэропорт вылета", selection: $airport) { ForEach(["Все","JED","MED"], id: \.self) { Text(UmrahAirportLabel.city($0)).tag($0) } }.pickerStyle(.menu)
                        Toggle("Выбрать дату", isOn: $filterDate).tint(.blue)
                        if filterDate { DatePicker("Дата", selection: $searchDate, displayedComponents: .date).environment(\.timeZone, TimeZone(identifier: direction == 0 ? "Asia/Tashkent" : "Asia/Riyadh")!) }
                        Button("Сбросить фильтры") { origin = draft.builderOrigin ?? "Все"; airport = "Все"; filterDate = false }
                    }
                }
                Picker("Источник авиабилета", selection: $source) { Text("iumrah Flights").tag(0); Text("Aviasales").tag(1) }.pickerStyle(.segmented)
                if let chosen { UmrahFlightCard(title: "Выбранный рейс", flight: chosen) }
                catalog
                DisclosureGroup("Добавить рейс вручную") {
                    UmrahPanel(title: "Без внешнего API") {
                        TextField("Авиакомпания", text: $manualAirline)
                        TextField("Номер рейса", text: $number).textInputAutocapitalization(.characters)
                        TextField("Аэропорт вылета · IATA", text: $manualOrigin).textInputAutocapitalization(.characters)
                        TextField("Аэропорт прилёта · IATA", text: $manualDestination).textInputAutocapitalization(.characters)
                        DatePicker("Вылет", selection: $manualDeparture)
                        DatePicker("Прилёт", selection: $manualArrival)
                        Text("Время устройства: \(TimeZone.current.identifier). Пересчитайте местное время аэропорта перед вводом.").font(.caption).foregroundStyle(.secondary)
                        Button("Добавить без проверки") { addManualFlight() }
                    }
                    manual
                }
                if source == 1 { Link("Открыть Aviasales", destination: URL(string: "https://www.aviasales.com/")!).font(.subheadline) }
            }
            if let error { Label(error, systemImage: "exclamationmark.circle").font(.subheadline).foregroundStyle(.red) }
        }
        .task { origin = draft.builderOrigin ?? draft.outbound?.legs.first?.origin ?? "Все"; resetManual(); if phase != 2 { await load(); catalogLoaded = true } }
        .onChange(of: phase) { _, value in
            error = nil; filterDate = false; airport = "Все"; candidates = []; key = ""; showFilters = false; resetManual()
            if value != 2 && !catalogLoaded { Task { await load(); catalogLoaded = true } }
        }
    }
    private var effectiveOrigin: String { direction == 1 ? draft.outbound?.legs.first?.origin ?? origin : origin }
    private func phaseButton(_ title: String, index: Int, completed: Bool) -> some View {
        Button { draft.builderFlightPhase = index } label: {
            HStack(spacing: 4) { if completed && phase != index { Image(systemName: "checkmark.circle.fill") }; Text(title).font(.subheadline.weight(.semibold)) }
                .frame(maxWidth: .infinity, minHeight: 44).foregroundStyle(phase == index ? Color.white : completed ? Color.blue : BusinessDesign.ink)
                .background(phase == index ? Color.blue : BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 12))
        }.buttonStyle(.plain).disabled(index == 1 && draft.outbound == nil || index == 2 && (draft.outbound == nil || draft.inbound == nil))
    }
    private var fareConfirmation: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Подтверждение стоимости").font(.title2.bold())
            if let out = draft.outbound { UmrahFlightCard(title: "Туда", flight: out) }
            if let back = draft.inbound { UmrahFlightCard(title: "Обратно", flight: back) }
            UmrahPanel(title: "Перелёт на человека · USD") {
                if let suggested = draft.suggestedFlightPrice {
                    Button { draft.flightPrice = String(format: "%.2f", suggested) } label: {
                        HStack { VStack(alignment: .leading) { Text("Использовать тариф из базы").font(.headline); Text(suggested, format: .currency(code: "USD")).font(.subheadline) }; Spacer(); Image(systemName: "arrow.down.circle").foregroundStyle(.blue) }
                    }.buttonStyle(.plain)
                    Text("Сохранённый тариф — ориентир, подтвердите актуальную цену.").font(.caption).foregroundStyle(.secondary)
                } else { Text("Нет подтверждённого общего тарифа. Введите сумму за оба направления вручную.").font(.caption).foregroundStyle(.secondary) }
                UmrahMoneyField(title: "Туда и обратно · на человека", text: $draft.flightPrice)
                if let fare = UmrahPackageDraft.amount(draft.flightPrice), fare > 0 { HStack { Text("За \(draft.travelers) чел."); Spacer(); Text(fare * Double(draft.travelers), format: .currency(code: "USD")).font(.title2.bold()) } }
            }
        }
    }
    private func resetManual() {
        manualOrigin = direction == 0 ? (effectiveOrigin == "Все" ? "TAS" : effectiveOrigin) : "JED"
        manualDestination = direction == 0 ? "JED" : (effectiveOrigin == "Все" ? "TAS" : effectiveOrigin)
        manualAirline = ""; number = ""
        manualDeparture = max(Date().addingTimeInterval(86400), (direction == 1 ? draft.arrival ?? Date() : Date()).addingTimeInterval(86400))
        manualArrival = manualDeparture.addingTimeInterval(18000)
    }
    private var catalog: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack { Text(source == 0 ? "Опубликованные рейсы iumrah" : "Сохранённые предложения Aviasales").font(.headline); Spacer(); Button { Task { await load() } } label: { Image(systemName: "arrow.clockwise") }.disabled(loading) }
            if loading { ProgressView("Загрузка каталога…") }
            if !loading && !sourceOffers.contains(where: { offer in
                guard let itinerary = offer.itinerary else { return false }
                return flightGroups(itinerary.legs).contains { isDirection($0) && matchesFilters($0) }
            }) { ContentUnavailableView("Нет подходящих рейсов", systemImage: "airplane", description: Text("Измените фильтры или добавьте рейс вручную.")) }
            ForEach(sourceOffers) { offer in
                if let itinerary = offer.itinerary, !itinerary.legs.isEmpty {
                    let groups = flightGroups(itinerary.legs)
                    ForEach(Array(groups.enumerated()), id: \.offset) { index, legs in
                        let flight = UmrahPackageDraft.Flight(id: offer.id + "-\(index)", source: source == 0 ? "Umrah Direct Flights" : "Aviasales · сохранённое предложение", legs: legs)
                        if isDirection(legs) && matchesFilters(legs) {
                            Button { select(flight, offer: offer) } label: {
                                UmrahFlightCard(title: "", flight: flight, fare: offer.perTravelerFare, currency: offer.currency, fareKind: offer.offerType ?? offer.itinerary?.effectiveOfferType ?? "unknown", selected: chosen?.id == flight.id)
                                    .accessibilityAddTraits(chosen?.id == flight.id ? .isSelected : [])
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
        if effectiveOrigin != "Все" && (direction == 0 ? first.origin : last.destination) != effectiveOrigin { return false }
        if airport != "Все" && (direction == 0 ? last.destination : first.origin) != airport { return false }
        if filterDate {
            var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: direction == 0 ? "Asia/Tashkent" : "Asia/Riyadh")!
            if !calendar.isDate(departure, inSameDayAs: searchDate) { return false }
        }
        return true
    }
    private func select(_ flight: UmrahPackageDraft.Flight, offer: BusinessCuratedFlightOffer? = nil) {
        guard isDirection(flight.legs), matchesFilters(flight.legs) else { error = "Рейс не соответствует направлению, датам или фильтрам."; return }
        error = nil
        let previous = chosen
        let oldSuggestion = draft.suggestedFlightPrice
        let oldArrival = draft.arrival, oldDeparture = draft.departure
        let key = direction == 0 ? "out" : "back"
        var fares = draft.flightFares ?? [:], keys = draft.selectedFareKeys ?? [:], kinds = draft.selectedFareKinds ?? [:]
        if let offer, offer.currency.uppercased() == "USD", offer.perTravelerFare > 0 {
            fares[key] = offer.perTravelerFare; keys[key] = offer.id; kinds[key] = offer.offerType ?? offer.itinerary?.effectiveOfferType ?? "unknown"
        } else { fares.removeValue(forKey: key); keys.removeValue(forKey: key); kinds.removeValue(forKey: key) }
        draft.flightFares = fares; draft.selectedFareKeys = keys; draft.selectedFareKinds = kinds
        if direction == 0 {
            if let previous = draft.inbound, previous.legs.last?.destination != flight.legs.first?.origin || (UmrahPackageDraft.date(previous.legs.first?.departureAt) ?? .distantPast) <= (UmrahPackageDraft.date(flight.legs.last?.arrivalAt) ?? .distantFuture) {
                draft.inbound = nil; draft.flightFares?["back"] = nil; draft.selectedFareKeys?["back"] = nil; draft.selectedFareKinds?["back"] = nil
            }
            draft.outbound = flight
            if let origin = flight.legs.first?.origin { draft.builderOrigin = origin; self.origin = origin }
            if previous?.legs != flight.legs, let arrival = draft.arrival { draft.pickup = arrival }
        } else { draft.inbound = flight }
        if previous?.id != flight.id || previous?.legs != flight.legs || draft.inbound == nil || oldSuggestion != draft.suggestedFlightPrice { draft.flightPrice = "" }
        if oldArrival != draft.arrival || oldDeparture != draft.departure { draft.makkah.price = ""; draft.medina.price = "" }
        draft.builderFlightPhase = direction == 0 ? 1 : 2
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

private enum UmrahAirportLabel {
    static func city(_ code: String) -> String {
        ["Все":"Все города", "TAS":"Ташкент", "FEG":"Фергана", "NMA":"Наманган", "AZN":"Андижан", "SKD":"Самарканд", "BHK":"Бухара", "KSQ":"Карши", "TMJ":"Термез", "UGC":"Ургенч", "JED":"Джидда", "MED":"Медина"][code] ?? code
    }
    static func route(_ flight: UmrahPackageDraft.Flight) -> String {
        let route = "\(flight.legs.first?.origin ?? "—") → \(flight.legs.last?.destination ?? "—") · \(flight.legs.first?.flightNumber ?? "")"
        guard let leg = flight.legs.first, let date = UmrahPackageDraft.date(leg.departureAt) else { return route }
        let f = DateFormatter(); f.locale = Locale(identifier: "ru_RU"); f.timeZone = TimeZone(identifier: ["JED", "MED"].contains(leg.origin) ? "Asia/Riyadh" : "Asia/Tashkent"); f.dateFormat = "d MMM, HH:mm"
        return route + " · " + f.string(from: date)
    }
}
private struct UmrahFlightCard: View {
    let title: String
    let flight: UmrahPackageDraft.Flight
    var fare: Double? = nil
    var currency: String = "USD"
    var fareKind: String = "unknown"
    var selected: Bool? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !title.isEmpty { Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary) }
            ForEach(Array(flight.legs.enumerated()), id: \.offset) { index, leg in
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        BusinessAirlineLogoView(airlineIATA: leg.airlineCode, size: 32)
                        VStack(alignment: .leading, spacing: 2) { Text(leg.airline).font(.subheadline.weight(.semibold)); Text(leg.flightNumber).font(.caption).foregroundStyle(.secondary) }
                        Spacer()
                        if index == 0, let selected { Image(systemName: selected ? "checkmark.circle.fill" : "circle").font(.title2).foregroundStyle(selected ? Color.blue : Color.secondary) }
                    }
                    HStack(alignment: .center) {
                        endpoint(leg.origin, leg.departureAt).frame(maxWidth: .infinity, alignment: .leading)
                        Image(systemName: "airplane").foregroundStyle(.secondary)
                        endpoint(leg.destination, leg.arrivalAt).frame(maxWidth: .infinity, alignment: .trailing)
                    }
                }
            }
            Text(flight.legs.count == 1 && flight.legs.first?.stops == 0 ? "Без пересадок · местное время" : "Сегменты: \(flight.legs.count) · время аэропортов").font(.caption).foregroundStyle(.secondary)
            if let fare, fare > 0 {
                Divider()
                HStack(alignment: .center) {
                    Text(fareKind == "round_trip" ? "Туда-обратно · 1 чел." : fareKind == "one_way" ? "В одну сторону · 1 чел." : "Тариф из базы · 1 чел.").font(.caption).foregroundStyle(.secondary)
                    Spacer(); Text(fare, format: .currency(code: currency)).font(.headline).monospacedDigit()
                }
            }
        }.padding(14).frame(maxWidth: .infinity, alignment: .leading).businessCard(radius: 18)
            .overlay { RoundedRectangle(cornerRadius: 18).strokeBorder(selected == true ? Color.blue : Color.clear, lineWidth: 2) }
            .contentShape(Rectangle())
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
        return formatter.string(from: date)
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
    private var medinaPhase: Bool { draft.includeMedina && draft.builderHotelPhase == 1 }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                cityButton("Мекка", phase: 0, completed: draft.stayIssue(draft.makkah) == nil)
                if draft.includeMedina { cityButton("Медина", phase: 1, completed: draft.stayIssue(draft.medina) == nil) }
            }
            if let arrival = draft.arrival, let departure = draft.departure {
                Text("Поездка: \(UmrahPackageDraft.stayCalendar.dateComponents([.day], from: UmrahPackageDraft.stayCalendar.startOfDay(for: arrival), to: UmrahPackageDraft.stayCalendar.startOfDay(for: departure)).day ?? 0) ночей · все ночи должны быть покрыты").font(.caption).foregroundStyle(.secondary)
            }
            if loading { ProgressView("Загрузка отелей…") }
            if let error { Text(error).foregroundStyle(.red); Button("Повторить") { Task { await load() } } }
            if medinaPhase {
                UmrahStayEditor(title: "Медина", stay: $draft.medina, travelers: draft.travelers, hotels: hotels.filter { city($0.city) == "medina" }).id("medina")
            } else {
                UmrahStayEditor(title: "Мекка", stay: $draft.makkah, travelers: draft.travelers, hotels: hotels.filter { city($0.city) == "makkah" }).id("makkah")
            }
            if draft.includeMedina { Text("Даты Мекки и Медины должны идти подряд, без пропусков и пересечений.").font(.caption).foregroundStyle(.secondary) }
        }
        .task { seedDates(); await load() }
    }
    private func cityButton(_ title: String, phase: Int, completed: Bool) -> some View {
        let active = medinaPhase == (phase == 1)
        return Button { draft.builderHotelPhase = phase } label: {
            HStack { if completed && !active { Image(systemName: "checkmark.circle.fill") }; Text(title).font(.subheadline.weight(.semibold)) }
                .frame(maxWidth: .infinity, minHeight: 44).foregroundStyle(active ? Color.white : completed ? Color.blue : BusinessDesign.ink)
                .background(active ? Color.blue : BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 12))
        }.buttonStyle(.plain).disabled(phase == 1 && draft.stayIssue(draft.makkah) != nil)
    }
    private func seedDates() {
        guard let arrival = draft.arrival, let departure = draft.departure else { return }
        let calendar = UmrahPackageDraft.stayCalendar
        let start = calendar.startOfDay(for: arrival), end = calendar.startOfDay(for: departure)
        let nights = calendar.dateComponents([.day], from: start, to: end).day ?? 0
        guard nights > 0 else { return }
        // Existing selected dates are never silently changed, except an untouched draft.
        guard draft.makkah.id.isEmpty && draft.medina.id.isEmpty else { return }
        let medinaFirst = draft.outbound?.legs.last?.destination == "MED"
        let firstNights = medinaFirst ? min(3, max(1, nights - 1)) : max(1, nights - 3)
        let split = calendar.date(byAdding: .day, value: firstNights, to: start) ?? end
        if medinaFirst && draft.includeMedina {
            draft.medina.checkIn = start; draft.medina.checkOut = split
            draft.makkah.checkIn = split; draft.makkah.checkOut = end
        } else {
            draft.makkah.checkIn = start; draft.makkah.checkOut = draft.includeMedina ? split : end
            draft.medina.checkIn = split; draft.medina.checkOut = end
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
            if !stay.id.isEmpty {
                HStack(spacing: 12) {
                    UmrahRemoteImage(raw: stay.imageURL).frame(width: 86, height: 72).clipShape(RoundedRectangle(cornerRadius: 12))
                    VStack(alignment: .leading, spacing: 4) { Text(stay.name).font(.headline); if let stars = stay.stars { Text("\(stars) ★").font(.caption).foregroundStyle(.secondary) } }
                    Spacer()
                    Button("Изменить") { picker = true }.font(.subheadline.weight(.semibold)).tint(.blue)
                }
            }
            if stay.id.isEmpty { Button { picker = true } label: { Label("Выбрать отель", systemImage: "building.2") }.buttonStyle(BusinessActionStyle(primary: false)).tint(.blue) }
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
            if priceMode == 0 { Button("Перенести подходящую цену") { applyCachedPrice() }; Text("Только свежая цена для тех же дат, количества номеров и гостей. Категорию номера и питание подтвердите самостоятельно.").font(.caption).foregroundStyle(.secondary) }
            UmrahMoneyField(title: "Все номера · весь срок · USD", text: $stay.price)
            if let amount = UmrahPackageDraft.amount(stay.price), amount > 0, stay.nights > 0 { Text("\(amount / Double(stay.nights) / Double(stay.rooms), format: .currency(code: "USD")) / номер / ночь").font(.caption).foregroundStyle(.secondary) }
        }
        .task(id: stay.id) {
            rooms = []
            if !stay.id.isEmpty, let detail = try? await APIClient.shared.hotelDetail(id: stay.id), detail.id == stay.id { rooms = detail.rooms }
        }
        .onChange(of: stay.checkIn) { _, _ in stay.price = "" }
        .onChange(of: stay.checkOut) { _, _ in stay.price = "" }
        .onChange(of: stay.rooms) { _, _ in stay.price = "" }
        .onChange(of: stay.room) { _, _ in stay.price = "" }
        .onChange(of: stay.meals) { _, _ in stay.price = "" }
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
                .navigationTitle("Отели · \(title)").navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Закрыть") { picker = false } } }
            }
        }
    }
    private func applyCachedPrice() {
        let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd"; formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(identifier: "Asia/Riyadh")
        guard let cached = hotels.first(where: { $0.id == stay.id })?.price,
              cached.status == "fresh", let expires = UmrahPackageDraft.date(cached.expiresAt), expires > Date(), cached.checkIn == formatter.string(from: stay.checkIn), cached.checkOut == formatter.string(from: stay.checkOut), cached.rooms == stay.rooms, cached.adults == travelers,
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
    private func fee(_ key: WritableKeyPath<UmrahPackageDraft, String?>) -> Binding<String> {
        Binding(get: { draft[keyPath: key] ?? "0" }, set: { draft[keyPath: key] = $0 })
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Личный автомобиль на весь маршрут").font(.title3.bold())
            Text("Выберите автомобиль. Стоимость подтвердите для всей группы.").font(.subheadline).foregroundStyle(.secondary)
            ForEach(vehicles, id: \.self) { name in
                Button { draft.vehicle = name } label: {
                    HStack(spacing: 12) {
                        Image(name == "GMC Yukon" ? "TransferYukon" : name == "Kia Carnival" ? "TransferCarnival" : "TransferMalibu").resizable().scaledToFit().frame(width: 94, height: 56)
                        VStack(alignment: .leading, spacing: 4) { Text(name).font(.headline); Text(name == "Chevrolet Malibu" ? "До 3 человек" : "До 6 человек").font(.caption).foregroundStyle(.secondary) }
                        Spacer(); Image(systemName: draft.vehicle == name ? "checkmark.circle.fill" : "circle").foregroundStyle(draft.vehicle == name ? Color.blue : Color.secondary)
                    }.padding(12).businessCard(radius: 18)
                        .overlay { RoundedRectangle(cornerRadius: 18).strokeBorder(draft.vehicle == name ? Color.blue : Color.clear, lineWidth: 2) }
                }.buttonStyle(.plain).disabled(name == "Chevrolet Malibu" && draft.travelers > 3).opacity(name == "Chevrolet Malibu" && draft.travelers > 3 ? 0.45 : 1)
            }
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
            }.tint(.blue)
            UmrahPanel(title: "Дополнительные услуги · USD") {
                UmrahMoneyField(title: "Визы · вся группа", text: fee(\.visaPrice))
                UmrahMoneyField(title: "Персональный гид · вся группа", text: fee(\.guidePrice))
                UmrahMoneyField(title: "Другие услуги · вся группа", text: fee(\.otherPrice))
                Text("Питание указано в настройках каждого отеля. Стоимость должна входить в цену проживания.").font(.caption).foregroundStyle(.secondary)
            }
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
