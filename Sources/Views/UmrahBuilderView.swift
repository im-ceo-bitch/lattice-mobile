import SwiftUI
import UIKit

struct UmrahBuilderView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store: UmrahDraftStore

    private let editingOffer: BusinessOffer?
    private let embedded: Bool
    private let pushed: Bool
    @State private var studioHome = true
    #if targetEnvironment(macCatalyst)
    @State private var presentation = true
    #else
    @State private var presentation = false
    #endif
    @State private var comparison: StudioQuoteSnapshot?
    @State private var showComparison = false
    @State private var conciergeReady = false
    @State private var deletingDraft: BusinessSavedUmrahDraft?
    @State private var confirmDeleteDraft = false
    @State private var finishAsOffer: Bool
    init(owner: String, editingOffer: BusinessOffer? = nil, initial: UmrahPackageDraft? = nil, preferOffer: Bool = false, embedded: Bool = false, pushed: Bool = false) {
        self.embedded = embedded; self.pushed = pushed
        self.editingOffer = editingOffer
        _finishAsOffer = State(initialValue: preferOffer || editingOffer != nil)
        _store = StateObject(wrappedValue: UmrahDraftStore(owner: editingOffer.map { owner + ":" + $0.id + ":" + String($0.revision) } ?? owner, initial: initial))
    }
    private var step: Int { min(5, max(0, store.draft.builderStage ?? 0)) }
    private var flightPhase: Int { min(2, max(0, store.draft.builderFlightPhase ?? (store.draft.outbound == nil ? 0 : store.draft.inbound == nil ? 1 : 2))) }
    private var hotelPhase: Int { store.draft.builderHotelPhase == 1 && store.draft.includeMedina ? 1 : 0 }
    private func go(_ stage: Int) {
        let target = min(5, max(0, stage))
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        store.draft.builderStage = target; error = nil; studioHome = false
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
        GeometryReader { geometry in
            let active = store.draft.requestSecret == nil && store.draft.offerReceipt == nil && store.draft.receipt == nil
            let wide = geometry.size.width >= 800 && active
            HStack(alignment: .top, spacing: 16) {
                if wide && geometry.size.width >= 1100 && !studioHome {
                    ScrollView { studioRail }.frame(width: 172)
                }
                ScrollViewReader { reader in
                    ScrollView {
                        VStack(alignment: .leading, spacing: presentation ? 24 : 14) {
                            Color.clear.frame(height: 0).id("top")
                            if active {
                                studioModeBar
                                if presentation { studioHero }
                                else { BusinessPageHeading(title: studioHome ? "Создать умру" : steps[step], subtitle: "Рабочее пространство менеджера") }
                                if !studioHome && (!wide || geometry.size.width < 1100) { compactRail }
                            } else {
                                BusinessPageHeading(title: store.draft.offerReceipt != nil || store.draft.submissionMode == "offer" ? "Предложение" : "Бронирование", subtitle: "Управление поездкой")
                            }
                            if let offer = store.draft.offerReceipt { offerReceiptView(offer) }
                            else if let receipt = store.draft.receipt { receiptView(receipt) }
                            else if store.draft.requestSecret != nil { pendingView }
                            else if studioHome { studioDashboard }
                            else { switch step {
                            case 0: parameters
                            case 1: UmrahFlightStep(draft: $store.draft)
                            case 2: UmrahHotelStep(draft: $store.draft)
                            case 3: UmrahTransferStep(draft: $store.draft)
                            case 4: summary
                            default: finalReview; if !presentation { clientForm }
                            } }
                            if let error { Label(error, systemImage: "exclamationmark.circle").font(.subheadline).foregroundStyle(.red).id("validation") }
                            if let storageError = store.storageError { Text(storageError).font(.caption).foregroundStyle(.red) }
                        }.frame(maxWidth: wide ? .infinity : 760, alignment: .leading).frame(maxWidth: .infinity).padding(.vertical, 8)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .onChange(of: step) { _, _ in reader.scrollTo("top", anchor: .top) }
                    .onChange(of: studioHome) { _, _ in reader.scrollTo("top", anchor: .top) }
                    .onChange(of: flightPhase) { _, _ in reader.scrollTo("top", anchor: .top) }
                    .onChange(of: hotelPhase) { _, _ in reader.scrollTo("top", anchor: .top) }
                    .onChange(of: error) { _, value in if value != nil { reader.scrollTo("validation", anchor: .bottom) } }
                }
                if wide { ScrollView { liveSummary }.frame(width: geometry.size.width >= 1100 ? 284 : 250) }
            }.padding(.horizontal, wide ? 20 : BusinessDesign.Space.page).padding(.top, 8)
        }
        .environment(\.studioPresentation, presentation)
        .sheet(isPresented: $showComparison) {
            NavigationStack { ScrollView { comparisonView.padding(20) }.navigationTitle("Сравнить варианты").navigationBarTitleDisplayMode(.inline).toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { showComparison = false } } } }
        }
        .background(BusinessDesign.background)
        .navigationBarTitleDisplayMode(.inline)
        .businessNavigationSurface()
        .toolbar {
            ToolbarItem(placement: .principal) { BusinessBrandLogo(width: 150, foreground: .white).frame(height: 36) }
            ToolbarItem(placement: .topBarLeading) { if !embedded && !pushed { Button("Закрыть") { store.save(); if store.storageError == nil { dismiss() } }.foregroundStyle(.white) } }
            ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Готово") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) } }
            ToolbarItem(placement: .topBarTrailing) {
                Menu { Button("Сохранить черновик") { store.save(); saved = store.storageError == nil }; if editingOffer == nil { Button("Начать заново", role: .destructive) { restart = true }.disabled(store.draft.requestSecret != nil && store.draft.receipt == nil && store.draft.offerReceipt == nil) } } label: { Image(systemName: "ellipsis.circle").foregroundStyle(.white) }
            }
        }
        .confirmationDialog("Удалить текущий черновик?", isPresented: $restart, titleVisibility: .visible) {
            Button("Начать заново", role: .destructive) { comparison = nil; store.draft = UmrahPackageDraft(); go(0); studioHome = true; store.save() }.disabled(submitting)
        }
        .safeAreaInset(edge: .bottom) { if !studioHome && store.draft.requestSecret == nil && store.draft.offerReceipt == nil && store.draft.receipt == nil { footer } }
        .environment(\.locale, Locale(identifier: "ru_RU"))
        .onChange(of: scenePhase) { _, phase in if phase != .active { store.save() } }
        .onDisappear { store.save() }
         .onChange(of: store.draft) { _, _ in store.save() }
        .onAppear {
            if store.draft.builderStage == nil { store.draft.builderStage = 0 }
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
        .confirmationDialog("Удалить сохранённый черновик?", isPresented: $confirmDeleteDraft) { Button("Удалить", role: .destructive) { if let deletingDraft { store.deleteSaved(deletingDraft) }; deletingDraft = nil }; Button("Отмена", role: .cancel) { deletingDraft = nil } }
        .alert("Черновик сохранён", isPresented: $saved) {
            Button("Хорошо", role: .cancel) { }
        } message: { Text("Пакет сохранён на этом устройстве.") }
    }

    private var studioModeBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack { Label("UMRAH STUDIO", systemImage: "sparkles").font(.caption.bold()).tracking(1); Spacer(); Text(store.storageError == nil ? "Черновик · автосохранение" : "Ошибка сохранения").font(.caption2).foregroundStyle(.secondary) }
            Picker("Режим", selection: $presentation) { Text("С клиентом").tag(true); Text("Рабочий").tag(false) }.pickerStyle(.segmented)
        }
    }
    private var studioHero: some View {
        let copy = StudioEditorial.stage(home: studioHome, step: step, flight: flightPhase, medina: hotelPhase == 1)
        return VStack(alignment: .leading, spacing: 12) {
            HStack { Text(copy.kicker).font(.caption.bold()).tracking(2); Spacer(); Image(systemName: copy.symbol).font(.title2) }.foregroundStyle(.white.opacity(0.72))
            Text(copy.title).font(.system(size: studioHome ? 34 : 29, weight: .bold, design: .rounded)).foregroundStyle(.white).fixedSize(horizontal: false, vertical: true)
            Text(copy.detail).font(.subheadline).foregroundStyle(.white.opacity(0.78)).fixedSize(horizontal: false, vertical: true)
            if studioHome { Text("Индивидуальная умра. Прозрачная стоимость. Персональная забота.").font(.caption.weight(.semibold)).foregroundStyle(.white) }
        }.padding(24).frame(maxWidth: .infinity, alignment: .leading).background(alignment: .bottomTrailing) {
            ZStack(alignment: .bottomTrailing) {
                Color.black
                StudioOrbitArtwork().stroke(Color.white.opacity(0.10), lineWidth: 1).frame(width: 230, height: 180).accessibilityHidden(true)
            }
        }.clipShape(RoundedRectangle(cornerRadius: 28))
    }
    private var railItems: [(String, String, Int, Int?)] {
        var result: [(String, String, Int, Int?)] = [("Параметры", "person.2", 0, nil), ("Рейс туда", "airplane.departure", 1, 0), ("Рейс обратно", "airplane.arrival", 1, 1), ("Цена перелёта", "creditcard", 1, 2), ("Мекка", "bed.double", 2, 0)]
        if store.draft.includeMedina { result.append(("Медина", "bed.double", 2, 1)) }
        result += [("Сопровождение", "car", 3, nil), ("Стоимость", "calculator", 4, nil), ("Итого", "doc.text", 5, nil)]
        return result
    }
    private func railButton(_ item: (String, String, Int, Int?)) -> some View {
        let active = !studioHome && step == item.2 && (item.2 != 1 || flightPhase == (item.3 ?? 0)) && (item.2 != 2 || hotelPhase == (item.3 ?? 0))
        return Button {
            if item.2 == 1 { store.draft.builderFlightPhase = item.3 }
            if item.2 == 2 { store.draft.builderHotelPhase = item.3 }
            go(item.2)
        } label: {
            Label(item.0, systemImage: item.1).font(.subheadline.weight(active ? .semibold : .regular)).padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .foregroundStyle(active ? BusinessDesign.onAccent : BusinessDesign.ink).background(active ? BusinessDesign.accent : BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 12))
        }.buttonStyle(.plain).accessibilityAddTraits(active ? .isSelected : [])
    }
    private var studioRail: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { studioHome = true; error = nil } label: { Label("Все компоненты", systemImage: "square.grid.2x2").font(.subheadline.bold()) }.buttonStyle(.plain).padding(.vertical, 12)
            ForEach(Array(railItems.enumerated()), id: \.offset) { _, item in railButton(item) }
        }.padding(.vertical, 8)
    }
    private var compactRail: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { studioHome = true; error = nil } label: { Label("Все компоненты", systemImage: "square.grid.2x2") }.font(.caption.weight(.semibold)).tint(BusinessDesign.ink)
            ScrollView(.horizontal, showsIndicators: false) { HStack(spacing: 6) { ForEach(Array(railItems.enumerated()), id: \.offset) { _, item in railButton(item).fixedSize(horizontal: true, vertical: false) } } }
        }
    }
    private var quoteTotal: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(footerPrice.isComplete ? "Стоимость за семью" : footerPrice.title).font(.caption.weight(.semibold)).foregroundStyle(.white.opacity(0.75))
            if let amount = footerPrice.amount {
                Text(amount, format: .currency(code: "USD")).font(.system(size: 32, weight: .bold, design: .rounded)).monospacedDigit().minimumScaleFactor(0.6).lineLimit(1)
                if footerPrice.isComplete { Text(amount / Double(max(1, store.draft.travelers)), format: .currency(code: "USD")) + Text(" / чел.") }
            } else { Text("Уточняется").font(.title2.bold()) }
            Text("Наличие не зарезервировано").font(.caption2).foregroundStyle(.white.opacity(0.65))
        }.foregroundStyle(.white).padding(18).frame(maxWidth: .infinity, alignment: .leading).background(Color.black, in: RoundedRectangle(cornerRadius: 22))
    }
    private var liveSummary: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Ваша умра").font(.title2.bold())
            Text("\(store.draft.travelers) чел. · \(StudioEditorial.category(store.draft.comfort))").font(.caption).foregroundStyle(.secondary)
            if let arrival = store.draft.arrival, let departure = store.draft.departure {
                Text("\(arrival.formatted(date: .abbreviated, time: .omitted)) — \(departure.formatted(date: .abbreviated, time: .omitted))").font(.caption).foregroundStyle(.secondary).environment(\.timeZone, TimeZone(identifier: "Asia/Riyadh")!)
            }
            let complete = (0..<5).filter { store.draft.builderIssue(at: $0) == nil }.count
            ProgressView(value: Double(complete), total: 5).tint(BusinessDesign.ink)
            Text("Готово \(complete) из 5 разделов").font(.caption2).foregroundStyle(.secondary)
            summaryItem("Рейс туда", store.draft.outbound.map(UmrahAirportLabel.route), "airplane.departure")
            summaryItem("Рейс обратно", store.draft.inbound.map(UmrahAirportLabel.route), "airplane.arrival")
            summaryItem("Мекка", store.draft.makkah.id.isEmpty ? nil : store.draft.makkah.name + " · \(store.draft.makkah.nights) ноч.", "bed.double")
            if store.draft.includeMedina { summaryItem("Медина", store.draft.medina.id.isEmpty ? nil : store.draft.medina.name + " · \(store.draft.medina.nights) ноч.", "bed.double") }
            summaryItem("Трансфер", store.draft.vehicle, "car")
            if store.draft.ziyaratMakkah || (store.draft.includeMedina && store.draft.ziyaratMedina) { summaryItem("Зияраты", [store.draft.ziyaratMakkah ? "Мекка" : nil, store.draft.includeMedina && store.draft.ziyaratMedina ? "Медина" : nil].compactMap { $0 }.joined(separator: " · "), "map") }
            if (UmrahPackageDraft.amount(store.draft.guidePrice ?? "0") ?? 0) > 0 { summaryItem("Гид", "В расчёте", "person.2") }
            quoteTotal
            Button("Сохранить вариант для сравнения") { comparison = StudioQuoteSnapshot(draft: store.draft); showComparison = true }.font(.caption.weight(.semibold)).buttonStyle(.bordered).disabled(!footerPrice.isComplete)
            if comparison != nil { Button("Сравнить с текущим") { showComparison = true }.font(.caption.weight(.semibold)).buttonStyle(.bordered) }
        }.padding(14).businessCard(radius: 22).padding(.vertical, 8)
    }
    private func summaryItem(_ title: String, _ detail: String?, _ icon: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon).frame(width: 22).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 3) { Text(title).font(.caption.bold()); Text(detail ?? "Не выбрано").font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
            Spacer(minLength: 0)
        }
    }
    private var comparisonView: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let comparison { comparison.card("Вариант A · сохранённый") }
            StudioQuoteSnapshot(draft: store.draft).card("Вариант B · текущий")
            Text("Сравнивайте даты, состав и стоимость. Сохранённая оценка не резервирует услуги; цены необходимо перепроверить.").font(.caption).foregroundStyle(.secondary)
        }
    }

    private var studioDashboard: some View {
        VStack(alignment: .leading, spacing: 14) {
            UmrahPanel(title: "Черновик поездки") {
                Text("\(store.draft.travelers) чел. · \(store.draft.comfort)").font(.title2.bold())
                if let start = store.draft.preferredStart { Text("Желаемые даты: \(start) — \(store.draft.preferredEnd ?? "уточнить")").font(.caption).foregroundStyle(.secondary) }
                if !presentation && !store.draft.clientName.isEmpty { Text(store.draft.clientName + " " + (store.draft.lastName ?? "")).font(.subheadline) }
                let complete = (0..<5).filter { store.draft.builderIssue(at: $0) == nil }.count
                ProgressView(value: Double(complete), total: 5).tint(BusinessDesign.ink)
                Text("Готово \(complete) из 5 разделов · автосохранение на устройстве").font(.caption).foregroundStyle(.secondary)
            }
            if embedded && presentation { Button("Открыть черновики в рабочем режиме") { presentation = false }.buttonStyle(BusinessActionStyle(primary: false)) }
            if embedded && !presentation {
                Button { if store.archiveAndStartNew() { comparison = nil; studioHome = true; finishAsOffer = false } } label: { Label("Сохранить и начать новый", systemImage: "plus.square.on.square") }.buttonStyle(BusinessActionStyle(primary: false))
                if !store.savedDrafts.isEmpty {
                    DisclosureGroup("Сохранённые черновики · \(store.savedDrafts.count)") {
                        ForEach(store.savedDrafts) { entry in
                            HStack {
                                Button { if store.openSaved(entry) { comparison = nil; studioHome = true; finishAsOffer = store.draft.builderFinishAsOffer ?? false } } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(entry.draft.clientName.isEmpty ? "\(entry.draft.travelers) чел. · \(entry.draft.comfort)" : entry.draft.clientName).font(.headline)
                                        Text(entry.updatedAt.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
                                    }.frame(maxWidth: .infinity, alignment: .leading)
                                }.buttonStyle(.plain)
                                Button(role: .destructive) { deletingDraft = entry; confirmDeleteDraft = true } label: { Image(systemName: "trash").frame(width: 44, height: 44) }.buttonStyle(.plain)
                            }.padding(.vertical, 5)
                        }
                    }.padding(14).businessCard(radius: 18)
                }
            }
            Button("Начать подбор") { go(0) }.buttonStyle(BusinessActionStyle())
            UmrahPanel(title: "Компоненты поездки") {
                reviewRow("Параметры", detail: "\(store.draft.travelers) чел. · \(store.draft.comfort)", symbol: "person.2", stage: 0)
                reviewRow("Рейс туда", detail: store.draft.outbound.map(UmrahAirportLabel.route) ?? "Выбрать рейс", symbol: "airplane.departure", stage: 1, phase: 0)
                reviewRow("Рейс обратно", detail: store.draft.inbound.map(UmrahAirportLabel.route) ?? "Выбрать рейс", symbol: "airplane.arrival", stage: 1, phase: 1)
                reviewRow("Цена перелёта", detail: store.draft.flightPrice.isEmpty ? "Указать цену на человека" : "$" + store.draft.flightPrice, symbol: "creditcard", stage: 1, phase: 2)
                reviewRow("Мекка", detail: store.draft.makkah.id.isEmpty ? "Выбрать отель" : stayReview(store.draft.makkah), symbol: "bed.double", stage: 2, phase: 0)
                if store.draft.includeMedina { reviewRow("Медина", detail: store.draft.medina.id.isEmpty ? "Выбрать отель" : stayReview(store.draft.medina), symbol: "bed.double", stage: 2, phase: 1) }
                reviewRow("Транспорт и услуги", detail: store.draft.vehicle, symbol: "car", stage: 3)
                reviewRow("Стоимость", detail: store.draft.saleTotal.map { $0.formatted(.currency(code: "USD")) } ?? "Ещё не рассчитана", symbol: "creditcard", stage: 4)
            }
            if footerPrice.isComplete, let total = store.draft.saleTotal { Text(total, format: .currency(code: "USD")).font(.largeTitle.bold()).monospacedDigit() }
            Button("Проверить и оформить") { go(5) }.buttonStyle(BusinessActionStyle())
            if footerPrice.isComplete { Button("Сохранить вариант для сравнения") { comparison = StudioQuoteSnapshot(draft: store.draft); showComparison = true }.buttonStyle(BusinessActionStyle(primary: false)) }
            if comparison != nil { Button("Сравнить с текущим") { showComparison = true }.buttonStyle(BusinessActionStyle(primary: false)) }
        }
    }
    private var builderRail: some View {
        VStack(alignment: .leading, spacing: BusinessDesign.Space.xs) {
            BusinessStageRail(titles: steps, symbols: ["person.2", "airplane", "bed.double", "car", "creditcard", "doc.text"], current: step, maximumReachable: store.draft.firstIncompleteBuilderStage, goBack: go)
            HStack {
                Text("Шаг \(step + 1) из \(steps.count)").font(.caption.weight(.semibold)).foregroundStyle(BusinessDesign.ink)
                Spacer()
                Text("Черновик · \(store.draft.travelers) чел.").font(.caption).foregroundStyle(BusinessDesign.muted)
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
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 145), spacing: 10)], spacing: 10) {
                    ForEach(["Economy", "Standard", "Comfort", "Premium"], id: \.self) { option in
                        Button { store.draft.comfort = option } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack { Image(systemName: StudioEditorial.categoryIcon(option)); Spacer(); Image(systemName: store.draft.comfort == option ? "checkmark.circle.fill" : "circle") }.font(.title3)
                                Text(StudioEditorial.category(option)).font(.headline)
                                Text(StudioEditorial.categoryDetail(option)).font(.caption).fixedSize(horizontal: false, vertical: true)
                            }.padding(14).frame(maxWidth: .infinity, minHeight: 108, alignment: .leading).foregroundStyle(store.draft.comfort == option ? BusinessDesign.onAccent : BusinessDesign.ink).background(store.draft.comfort == option ? BusinessDesign.accent : BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 18))
                        }.buttonStyle(.plain).accessibilityAddTraits(store.draft.comfort == option ? .isSelected : [])
                    }
                }
            }
            UmrahPanel(title: "Желаемые даты путешествия") {
                Text("Выберите предпочтительные даты или оставьте поиск гибким. Фактические даты определяются выбранными рейсами.").font(.subheadline).foregroundStyle(.secondary)
                preferredDateRow("Вылет туда", key: \.preferredStart, zone: "Asia/Tashkent")
                preferredDateRow("Обратный вылет", key: \.preferredEnd, zone: "Asia/Riyadh")
            }
            UmrahPanel(title: "Город вылета") {
                Picker("Город Узбекистана", selection: Binding(get: { store.draft.builderOrigin ?? store.draft.outbound?.legs.first?.origin ?? "Все" }, set: { value in
                    store.draft.builderOrigin = value
                    if value != "Все", let existing = store.draft.outbound?.legs.first?.origin, existing != value {
                        store.draft.outbound = nil; store.draft.inbound = nil; store.draft.flightPrice = ""; store.draft.flightFares = nil; store.draft.selectedFareKeys = nil; store.draft.selectedFareKinds = nil; store.draft.builderFlightPhase = 0
                        store.draft.makkah.price = ""; store.draft.medina.price = ""
                    }
                })) { ForEach(["Все", "TAS", "FEG", "NMA", "AZN", "SKD", "BHK", "KSQ", "TMJ", "UGC"], id: \.self) { Text(UmrahAirportLabel.city($0)).tag($0) } }
                .pickerStyle(.menu).tint(BusinessDesign.ink)
                Toggle("Проживание в Медине", isOn: $store.draft.includeMedina).tint(BusinessDesign.ink)
            }
        }
    }
    private func preferredDateRow(_ title: String, key: WritableKeyPath<UmrahPackageDraft, String?>, zone: String) -> some View {
        let format = DateFormatter()
        format.locale = Locale(identifier: "en_US_POSIX"); format.dateFormat = "yyyy-MM-dd"; format.timeZone = TimeZone(identifier: zone)
        return VStack(alignment: .leading, spacing: 8) {
            Toggle(title, isOn: Binding(get: { store.draft[keyPath: key] != nil }, set: { enabled in store.draft[keyPath: key] = enabled ? format.string(from: Date().addingTimeInterval(86400 * (key == \UmrahPackageDraft.preferredStart ? 7 : 17))) : nil })).tint(BusinessDesign.ink)
            if store.draft[keyPath: key] != nil {
                DatePicker(title, selection: Binding(get: { store.draft[keyPath: key].flatMap { format.date(from: $0) } ?? Date() }, set: { store.draft[keyPath: key] = format.string(from: $0) }), displayedComponents: .date).environment(\.timeZone, TimeZone(identifier: zone)!)
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
        default: return presentation ? "Перейти к оформлению" : editingOffer != nil ? "Сохранить предложение" : finishAsOffer ? "Создать предложение" : "Создать бронирование"
        }
    }
    private var currentIssue: String? {
        if step == 1 && flightPhase == 0 { return store.draft.outbound == nil ? "Выберите рейс туда." : nil }
        if step == 1 && flightPhase == 1 { return store.draft.inbound == nil ? "Выберите обратный рейс." : nil }
        if step == 2 && hotelPhase == 0 && store.draft.includeMedina { return store.draft.stayIssue(store.draft.makkah) }
        if step == 5 {
            if presentation { return nil }
            if let issue = (0..<5).compactMap({ store.draft.builderIssue(at: $0) }).first { return issue }
            return finishAsOffer || editingOffer != nil ? nil : store.draft.bookingIssue
        }
        return store.draft.builderIssue(at: step)
    }
    private func advance() {
        error = nil
        if step == 5 {
            if presentation { presentation = false; UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil); return }
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
    private var footerPrice: BusinessConfiguratorPricePreview {
        BusinessConfiguratorPricePreview(draft: store.draft, stage: 3)
    }
    private var footer: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                if step > 0 {
                    Button { back() } label: { Image(systemName: "arrow.left").frame(width: 44, height: 44) }
                        .buttonStyle(.plain).accessibilityLabel("Предыдущий этап")
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("За \(store.draft.travelers) чел.").font(.caption).foregroundStyle(BusinessDesign.muted)
                    Text(footerPrice.title).font(.caption.weight(.medium)).foregroundStyle(BusinessDesign.ink)
                }
                Spacer(minLength: 0)
                if let amount = footerPrice.amount {
                    Text(amount, format: .currency(code: "USD")).font(.headline).monospacedDigit().lineLimit(1).minimumScaleFactor(0.75)
                } else { Text("—").font(.headline).foregroundStyle(BusinessDesign.muted).accessibilityLabel("Стоимость ещё не рассчитана") }
            }
            if let issue = currentIssue { Text(issue).font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading) }
            if step == 5 && store.draft.firstIncompleteBuilderStage < 5 { Button("Исправить незаполненный раздел") { go(store.draft.firstIncompleteBuilderStage) }.font(.subheadline.weight(.semibold)) }
            if step < 5 && store.draft.firstIncompleteBuilderStage == 5 {
                Button("Вернуться к оформлению") { go(5) }.font(.caption.weight(.semibold)).tint(BusinessDesign.ink)
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
                Image(systemName: symbol).font(.title3).foregroundStyle(BusinessDesign.ink).frame(width: 32)
                VStack(alignment: .leading, spacing: 4) { Text(title).font(.headline); Text(detail).font(.caption).foregroundStyle(.secondary) }
                Spacer(); Image(systemName: "pencil").foregroundStyle(BusinessDesign.ink)
            }.frame(maxWidth: .infinity, minHeight: BusinessDesign.Size.tap, alignment: .leading).padding(.vertical, 6).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }
    private func stayReview(_ stay: UmrahPackageDraft.Stay) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "ru_RU"); f.timeZone = TimeZone(identifier: "Asia/Riyadh"); f.dateFormat = "d MMM"
        return "\(stay.name) · \(f.string(from: stay.checkIn))–\(f.string(from: stay.checkOut)) · \(stay.nights) ночей · \(stay.rooms) ном. · \(stay.room) · \(stay.meals)"
    }
    private var finalReview: some View {
        VStack(alignment: .leading, spacing: 16) {
        if presentation {
            quoteTotal
            if let out = store.draft.outbound { UmrahFlightCard(title: "Перелёт туда", flight: out) }
            if let back = store.draft.inbound { UmrahFlightCard(title: "Обратный перелёт", flight: back) }
            if !store.draft.makkah.id.isEmpty { UmrahStayCard(title: "Мекка", stay: store.draft.makkah) }
            if store.draft.includeMedina && !store.draft.medina.id.isEmpty { UmrahStayCard(title: "Медина", stay: store.draft.medina) }
            UmrahPanel(title: "Персональные услуги") {
                summaryItem("Транспорт", store.draft.vehicle, "car")
                if (UmrahPackageDraft.amount(store.draft.guidePrice ?? "0") ?? 0) > 0 { summaryItem("Гид", "Включён в расчёт · условия согласуются", "person.2") }
                if store.draft.ziyaratMakkah { summaryItem("Зияраты", "Мекка", "map") }
                if store.draft.includeMedina && store.draft.ziyaratMedina { summaryItem("Зияраты", "Медина", "map") }
            }
            if footerPrice.isComplete { summary }
        }
        UmrahPanel(title: "Проверка пакета") {
            HStack(spacing: 12) {
                IumrahOrbitAssemblyMoment(services: orbitServices, logo: Image("Logo"), maxDiameter: 84, accessibilityTitle: "iumrah Business")
                VStack(alignment: .leading, spacing: 4) { Text(store.draft.firstIncompleteBuilderStage == 5 ? "Ваша индивидуальная умра готова" : "Ваш пакет ещё в процессе").font(.headline); Text("Проверьте компоненты перед отправкой").font(.caption).foregroundStyle(.secondary) }
            }.accessibilityIdentifier("business.orbit.package")
            reviewRow("Параметры", detail: "\(store.draft.travelers) чел. · \(store.draft.comfort)", symbol: "person.2", stage: 0)
            if let out = store.draft.outbound { reviewRow("Рейс туда", detail: UmrahAirportLabel.route(out), symbol: "airplane.departure", stage: 1, phase: 0) }
            if let back = store.draft.inbound { reviewRow("Рейс обратно", detail: UmrahAirportLabel.route(back), symbol: "airplane.arrival", stage: 1, phase: 1) }
            reviewRow("Мекка", detail: stayReview(store.draft.makkah), symbol: "bed.double", stage: 2, phase: 0)
            if store.draft.includeMedina { reviewRow("Медина", detail: stayReview(store.draft.medina), symbol: "bed.double", stage: 2, phase: 1) }
            reviewRow("Услуги", detail: store.draft.vehicle + " · " + pickupText, symbol: "car", stage: 3)
            reviewRow("Стоимость", detail: footerPrice.isComplete ? (store.draft.saleTotal?.formatted(.currency(code: "USD")) ?? "Проверить") : "Проверить", symbol: "creditcard", stage: 4)
        }
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
            Text("\(store.draft.travelers) чел. · \(StudioEditorial.category(store.draft.comfort))").foregroundStyle(.secondary)
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
                Button("Изменить услуги") { go(3) }.font(.subheadline).tint(BusinessDesign.ink)
                if !presentation {
                    UmrahMoneyField(title: "Комиссия платформы · %", text: optional(\.commission))
                    UmrahMoneyField(title: "Скидка · на весь пакет, USD", text: optional(\.discount))
                } else { Button("Настроить комиссию и скидку") { presentation = false; go(4) }.font(.caption).tint(BusinessDesign.ink) }
                if let subtotal = store.draft.costSubtotal { priceRow(presentation ? "Стоимость компонентов" : "Себестоимость", subtotal) }
                if let fee = store.draft.commissionAmount { priceRow("Комиссия · USD", fee) }
                if let discount = UmrahPackageDraft.amount(store.draft.discount ?? "0"), discount > 0 { priceRow("Скидка", -discount) }
                if footerPrice.isComplete, let total = store.draft.saleTotal {
                    priceRow("Итого для клиента", total).font(.headline)
                    priceRow("На человека", (total * 100 / Double(store.draft.travelers)).rounded() / 100)
                }
                Text(presentation ? "Стоимость по выбранным компонентам. Наличие и цены поставщиков требуют подтверждения." : "Внутренний расчёт. Наличие и цены поставщиков требуют подтверждения.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
    private func optional(_ key: WritableKeyPath<UmrahPackageDraft, String?>, default fallback: String = "0") -> Binding<String> {
        Binding(get: { store.draft[keyPath: key] ?? fallback }, set: { store.draft[keyPath: key] = $0 })
    }
    private var clientForm: some View {
        VStack(alignment: .leading, spacing: 16) {
            if footerPrice.isComplete, let total = store.draft.saleTotal {
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
            Image(systemName: "checkmark.seal.fill").font(.largeTitle).foregroundStyle(BusinessDesign.securityBlue)
            Text(receipt.bookingNumber.map { String(format: "№%04d", $0) } ?? receipt.bookingID).font(.title.bold())
            if let id = receipt.pilgrimID { Text("iumrah ID: \(id)") }
            if !receipt.identityReady { Text("Номер паломника ещё синхронизируется. Повторите проверку.").font(.caption) }
            Text(receipt.totalUsd, format: .currency(code: "USD")).font(.title2.bold())
            Text("Проверка наличия · оплата пока не требуется").font(.caption).foregroundStyle(.secondary)
            Text("Email: \(receipt.emailDescription)").font(.subheadline)
            if !receipt.shareURL.isEmpty, let url = URL(string: receipt.shareURL) { ShareLink(item: url) { Label("Отправить ссылку", systemImage: "square.and.arrow.up") }.buttonStyle(BusinessActionStyle()); Link("Предпросмотр поездки", destination: url).buttonStyle(BusinessActionStyle(primary: false)) }
            Button("Проверить отправку и ID") { Task { await submit() } }.disabled(submitting)
            NavigationLink("Открыть бронирование") { BookingDetailView(bookingID: receipt.bookingID) }
            Button("Создать новую умру") { comparison = nil; store.draft = UmrahPackageDraft(); go(0); studioHome = true; store.save() }.disabled(submitting)
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
            Image(systemName: "checkmark.seal.fill").font(.largeTitle).foregroundStyle(BusinessDesign.securityBlue)
            Text(offer.id).font(.caption.monospaced()).textSelection(.enabled)
            Text(offer.totalUsd, format: .currency(code: "USD")).font(.title2.bold())
            Text("Наличие не зарезервировано · " + offer.statusTitle).font(.caption).foregroundStyle(.secondary)
            if let url = URL(string: offer.shareURL) {
                ShareLink(item: url) { Label("Поделиться предложением", systemImage: "square.and.arrow.up") }.buttonStyle(BusinessActionStyle())
                if let preview = offerPreviewURL(url) { Link("Предпросмотр без учёта просмотра", destination: preview) }
            }
            if let requestID = store.draft.conciergeID {
                Button(conciergeReady ? "Заявка отмечена готовой" : "Отметить заявку: предложение готово") { Task { do { try await APIClient.shared.changeConciergeRequest(id: requestID, status: "READY"); error = nil; conciergeReady = true } catch { self.error = error.localizedDescription } } }.buttonStyle(BusinessActionStyle(primary: false)).disabled(conciergeReady)
            }
            NavigationLink("Управление предложением") { BusinessOfferDetailView(id: offer.id) }.buttonStyle(BusinessActionStyle(primary: false))
            if editingOffer == nil && store.draft.conciergeID == nil { Button("Дублировать пакет") { comparison = nil; var copy = store.draft; copy.requestSecret = nil; copy.offerReceipt = nil; copy.receipt = nil; copy.submissionMode = nil; copy.clientName = ""; copy.lastName = nil; copy.phone = ""; copy.email = nil; copy.telegram = ""; copy.notes = ""; copy.sendEmail = false; copy.flightPrice = ""; copy.flightFares = nil; copy.selectedFareKeys = nil; copy.selectedFareKinds = nil; copy.makkah.price = ""; copy.medina.price = ""; store.draft = copy; studioHome = true; store.save() }.buttonStyle(BusinessActionStyle(primary: false)) }
            Button(editingOffer == nil && store.draft.conciergeID == nil ? "Создать новую умру" : "Готово") {
                if editingOffer != nil || store.draft.conciergeID != nil { dismiss() } else { comparison = nil; store.draft = UmrahPackageDraft(); go(0); studioHome = true; store.save() }
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
            .frame(maxWidth: .infinity, alignment: .leading).padding(BusinessDesign.Space.md).businessCard()
    }
}

private struct UmrahFlightStep: View {
    @Binding var draft: UmrahPackageDraft
    @State private var source = 0
    private var phase: Int { min(2, max(0, draft.builderFlightPhase ?? (draft.outbound == nil ? 0 : draft.inbound == nil ? 1 : 2))) }
    private var direction: Int { phase == 1 ? 1 : 0 }
    @State private var showFilters = false
    @State private var directOnly = false
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
                if let preferred = direction == 0 ? draft.preferredStart : draft.preferredEnd { Text("Желаемая дата: " + preferred).font(.caption).foregroundStyle(.secondary) }
                if phase == 1, let outbound = draft.outbound {
                    Label(UmrahAirportLabel.route(outbound), systemImage: "checkmark.circle.fill").font(.subheadline).foregroundStyle(BusinessDesign.securityBlue)
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
                    Button { showFilters.toggle() } label: { Image(systemName: "slider.horizontal.3").font(.title3).frame(width: 44, height: 44).background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 12)) }.buttonStyle(.plain).foregroundStyle(BusinessDesign.ink).accessibilityLabel("Фильтры рейсов")
                }.padding(12).businessCard(radius: 18)
                Toggle("Только прямые рейсы", isOn: $directOnly).tint(BusinessDesign.ink)
                if directOnly { Text("Меньше пересадок — больше времени для себя. Выдача ограничена рейсами без остановок.").font(.caption).foregroundStyle(.secondary) }
                if filterDate { Text("Дата: \(searchDate.formatted(date: .abbreviated, time: .omitted))").font(.caption).foregroundStyle(.secondary) }
                if showFilters {
                    UmrahPanel(title: "Фильтры") {
                        if direction == 0 { Picker("Город Узбекистана", selection: $origin) { ForEach(["Все","TAS","FEG","NMA","AZN","SKD","BHK","KSQ","TMJ","UGC"], id: \.self) { Text(UmrahAirportLabel.city($0)).tag($0) } }.pickerStyle(.menu) }
                        Picker(direction == 0 ? "Аэропорт прилёта" : "Аэропорт вылета", selection: $airport) { ForEach(["Все","JED","MED"], id: \.self) { Text(UmrahAirportLabel.city($0)).tag($0) } }.pickerStyle(.menu)
                        Toggle("Выбрать дату", isOn: $filterDate).tint(BusinessDesign.ink)
                        if filterDate { DatePicker("Дата", selection: $searchDate, displayedComponents: .date).environment(\.timeZone, TimeZone(identifier: direction == 0 ? "Asia/Tashkent" : "Asia/Riyadh")!) }
                        Button("Сбросить фильтры") { origin = draft.builderOrigin ?? "Все"; airport = "Все"; filterDate = false }
                    }
                }
                HStack(spacing: BusinessDesign.Space.xs) {
                    sourceButton("Umrah Direct Flights", index: 0)
                    sourceButton("Aviasales", index: 1)
                }.accessibilityElement(children: .contain).accessibilityLabel("Источник авиабилета")
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
        .task { origin = draft.builderOrigin ?? draft.outbound?.legs.first?.origin ?? "Все"; resetManual(); applyPreferredDate(); if phase != 2 { await load(); catalogLoaded = true } }
        .onChange(of: phase) { _, value in
            error = nil; filterDate = false; directOnly = false; airport = "Все"; candidates = []; key = ""; showFilters = false; resetManual(); applyPreferredDate()
            if value != 2 && !catalogLoaded { Task { await load(); catalogLoaded = true } }
        }
    }
    private func applyPreferredDate() {
        let raw = direction == 0 ? draft.preferredStart : draft.preferredEnd
        guard let raw else { return }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"; formatter.timeZone = TimeZone(identifier: direction == 0 ? "Asia/Tashkent" : "Asia/Riyadh")
        if let value = formatter.date(from: raw) { searchDate = value; filterDate = true }
    }
    private func sourceButton(_ title: String, index: Int) -> some View {
        Button { source = index } label: {
            Text(title).font(.subheadline.weight(.semibold))
                .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, BusinessDesign.Space.xs).padding(.vertical, 8)
                .frame(maxWidth: .infinity, minHeight: BusinessDesign.Size.tap)
                .foregroundStyle(source == index ? BusinessDesign.onAccent : BusinessDesign.ink)
                .background(source == index ? BusinessDesign.accent : BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: BusinessDesign.Radius.control))
        }.buttonStyle(.plain).accessibilityAddTraits(source == index ? .isSelected : [])
    }
    private var effectiveOrigin: String { direction == 1 ? draft.outbound?.legs.first?.origin ?? origin : origin }
    private func phaseButton(_ title: String, index: Int, completed: Bool) -> some View {
        Button { draft.builderFlightPhase = index } label: {
            HStack(spacing: 4) { if completed && phase != index { Image(systemName: "checkmark.circle.fill") }; Text(title).font(.subheadline.weight(.semibold)) }
                .frame(maxWidth: .infinity, minHeight: 44).foregroundStyle(phase == index ? BusinessDesign.onAccent : completed ? BusinessDesign.securityBlue : BusinessDesign.ink)
                .background(phase == index ? BusinessDesign.accent : BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 12))
        }.buttonStyle(.plain).accessibilityAddTraits(phase == index ? .isSelected : [])
    }
    private var fareConfirmation: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Подтверждение стоимости").font(.title2.bold())
            if let out = draft.outbound { UmrahFlightCard(title: "Туда", flight: out) }
            if let back = draft.inbound { UmrahFlightCard(title: "Обратно", flight: back) }
            UmrahPanel(title: "Перелёт на человека · USD") {
                if let suggested = draft.suggestedFlightPrice {
                    Button { draft.flightPrice = String(format: "%.2f", suggested) } label: {
                        HStack { VStack(alignment: .leading) { Text("Использовать тариф из базы").font(.headline); Text(suggested, format: .currency(code: "USD")).font(.subheadline) }; Spacer(); Image(systemName: "arrow.down.circle").foregroundStyle(BusinessDesign.ink) }
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
        if directOnly && !(legs.count == 1 && first.stops == 0) { return false }
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
                        if index == 0, let selected { Image(systemName: selected ? "checkmark.circle.fill" : "circle").font(.title2).foregroundStyle(selected ? BusinessDesign.securityBlue : Color.secondary) }
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
        }.padding(BusinessDesign.Space.md).frame(maxWidth: .infinity, alignment: .leading).businessCard(radius: BusinessDesign.Radius.compact)
            .overlay { RoundedRectangle(cornerRadius: BusinessDesign.Radius.compact).strokeBorder(selected == true ? BusinessDesign.securityBlue : Color.clear, lineWidth: 2) }
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
            TextField("Сумма в USD", text: $text)
                .keyboardType(.decimalPad).textFieldStyle(.plain)
                .padding(.horizontal, BusinessDesign.Space.sm).frame(minHeight: BusinessDesign.Size.tap)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: BusinessDesign.Radius.control))
                .overlay { RoundedRectangle(cornerRadius: BusinessDesign.Radius.control).strokeBorder(BusinessDesign.line) }
                .accessibilityLabel(title)
        }
    }
}

private struct UmrahHotelStep: View {
    @Binding var draft: UmrahPackageDraft
    private var medinaPhase: Bool { draft.includeMedina && draft.builderHotelPhase == 1 }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Picker("Город", selection: Binding(get: { medinaPhase ? 1 : 0 }, set: { draft.builderHotelPhase = $0 })) {
                Text("Мекка").tag(0); if draft.includeMedina { Text("Медина").tag(1) }
            }.pickerStyle(.segmented)
            if draft.arrival == nil || draft.departure == nil { Text("Можно выбрать отель заранее. Для итогового расчёта подтвердите даты рейсов.").font(.caption).foregroundStyle(.secondary) }
            if medinaPhase { UmrahStayEditor(title: "Медина", city: "madinah", stay: $draft.medina, travelers: draft.travelers).id("medina") }
            else { UmrahStayEditor(title: "Мекка", city: "makkah", stay: $draft.makkah, travelers: draft.travelers).id("makkah") }
            if draft.includeMedina { Text("Даты двух городов должны идти подряд, без пропусков и пересечений.").font(.caption).foregroundStyle(.secondary) }
        }.task { seedDates() }
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
}

private struct UmrahStayEditor: View {
    let title: String
    let city: String
    @Binding var stay: UmrahPackageDraft.Stay
    let travelers: Int
    @State private var picker = false
    private var datesValid: Bool { stay.nights > 0 }
    var body: some View {
        UmrahPanel(title: title) {
            if !stay.id.isEmpty {
                UmrahStayCard(title: title, stay: stay)
                if !stay.id.hasPrefix("lp") { Text("Отель из сохранённого пакета. Для новой подборки используйте Nuitee.").font(.caption).foregroundStyle(.secondary) }
            }
            DatePicker("Заселение", selection: $stay.checkIn, displayedComponents: .date)
            DatePicker("Выселение", selection: $stay.checkOut, displayedComponents: .date)
            Text("\(stay.nights) ночей").font(.caption).foregroundStyle(datesValid ? Color.secondary : Color.red)
            Stepper("Номера: \(stay.rooms)", value: $stay.rooms, in: 1...6)
            Button { picker.toggle() } label: { Label(picker ? "Скрыть каталог" : stay.id.isEmpty ? "Выбрать отель" : "Изменить отель", systemImage: "building.2") }.buttonStyle(BusinessActionStyle(primary: false))
            if picker {
                BusinessNuiteeHotelsView(fixedCity: city, onSelect: { hotel in
                    stay.id = hotel.id; stay.name = hotel.name; stay.stars = hotel.starCount; stay.imageURL = hotel.photo
                    stay.room = ""; stay.meals = "Без питания"; stay.price = ""; picker = false
                }, inline: true)
            }
            if stay.id.hasPrefix("lp") && stay.rooms == 1 && datesValid {
                BusinessNuiteeRatePanel(id: stay.id, checkIn: stay.checkIn, checkOut: stay.checkOut, guests: travelers, select: { rate in
                    stay.room = rate.roomName; stay.meals = rate.mealPlan.isEmpty ? "Уточнить питание" : rate.mealPlan
                    stay.price = String(format: "%.2f", rate.price)
                })
            } else if stay.rooms > 1 { Text("API тарифов поддерживает один номер. Для нескольких номеров введите подтверждённую общую цену вручную.").font(.caption).foregroundStyle(.secondary) }
            TextField("Категория номера / размещение", text: Binding(get: { stay.room }, set: { if stay.room != $0 { stay.room = $0; stay.price = "" } }))
            TextField("Питание", text: Binding(get: { stay.meals }, set: { if stay.meals != $0 { stay.meals = $0; stay.price = "" } }))
            UmrahMoneyField(title: "Все номера · весь срок · USD", text: $stay.price)
            Text("Цена для индивидуального предложения, не подтверждение бронирования.").font(.caption).foregroundStyle(.secondary)
            if let amount = UmrahPackageDraft.amount(stay.price), amount > 0, datesValid { Text("\(amount / Double(stay.nights) / Double(stay.rooms), format: .currency(code: "USD")) / номер / ночь").font(.caption).foregroundStyle(.secondary) }
        }
        .onAppear { picker = stay.id.isEmpty }
        .onChange(of: stay.checkIn) { _, _ in stay.price = "" }
        .onChange(of: stay.checkOut) { _, _ in stay.price = "" }
        .onChange(of: stay.rooms) { _, _ in stay.price = "" }
        .environment(\.calendar, UmrahPackageDraft.stayCalendar)
        .environment(\.timeZone, TimeZone(identifier: "Asia/Riyadh")!)

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
                Text("\(stay.nights) ночей · \(stay.rooms) номер(а) · \(stay.room.isEmpty ? "номер уточняется" : stay.room)").font(.caption).foregroundStyle(.secondary)
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
            StudioEditorialBlock(title: "От первого до последнего километра", detail: "Встреча в аэропорту, дорога до отеля, переезд между городами и трансфер на обратный рейс. Отдельный автомобиль для вашей семьи на согласованных маршрутах.", note: "Дополнительные поездки и время ожидания уточняются отдельно.", symbol: "car.side")
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), spacing: 12)], spacing: 12) {
                ForEach(vehicles, id: \.self) { name in
                    Button { draft.vehicle = name } label: { UmrahVehicleCard(name: name, selected: draft.vehicle == name) }.buttonStyle(.plain).accessibilityAddTraits(draft.vehicle == name ? .isSelected : []).disabled(name == "Chevrolet Malibu" && draft.travelers > 3).opacity(name == "Chevrolet Malibu" && draft.travelers > 3 ? 0.45 : 1)
                }
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
                StudioEditorialBlock(title: "Не просто посетить. Понять историю.", detail: "Познакомьтесь с историческими местами Мекки и Медины в удобном для вашей семьи темпе.", note: "Маршрут, длительность и сопровождение согласовываются отдельно.", symbol: "map")
                Toggle("Зияраты в Мекке", isOn: $draft.ziyaratMakkah)
                if draft.includeMedina { Toggle("Зияраты в Медине", isOn: $draft.ziyaratMedina) }
                if draft.ziyaratMakkah || (draft.includeMedina && draft.ziyaratMedina) {
                    UmrahMoneyField(title: "Зияраты · вся группа · USD", text: $draft.ziyaratPrice)
                }
            }.tint(BusinessDesign.ink)
            UmrahPanel(title: "Персональный гид") {
                StudioEditorialBlock(title: "Одна семья. Один персональный гид.", detail: "Персональное сопровождение во время умры, помощь с обрядами и организационными вопросами на протяжении путешествия. В вашем темпе, без необходимости подстраиваться под группу.", note: "Периоды личного присутствия и доступность гида фиксируются при согласовании пакета.", symbol: "person.2")
                UmrahMoneyField(title: "Персональный гид · вся группа · USD", text: fee(\.guidePrice))
            }
            UmrahPanel(title: "Визы и дополнительные услуги · USD") {
                StudioEditorialBlock(title: "Забота о деталях", detail: "Предусмотрите визы и дополнительные услуги, включая связь, если она согласована. Стоимость отражается в вашем расчёте.", note: "Состав других услуг уточняется с менеджером.", symbol: "checkmark.shield")
                UmrahMoneyField(title: "Визы · вся группа", text: fee(\.visaPrice))
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

private struct StudioPresentationKey: EnvironmentKey { static let defaultValue = true }
extension EnvironmentValues {
    var studioPresentation: Bool {
        get { self[StudioPresentationKey.self] }
        set { self[StudioPresentationKey.self] = newValue }
    }
}

struct StudioEditorialBlock: View {
    @Environment(\.studioPresentation) private var presentation
    let title: String
    let detail: String
    let note: String
    let symbol: String
    var body: some View {
        if presentation {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: symbol).font(.title2).foregroundStyle(BusinessDesign.ink)
                Text(title).font(.title2.weight(.bold))
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
                if !note.isEmpty { Text(note).font(.caption).foregroundStyle(.secondary) }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(16).background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 20))
        } else if !note.isEmpty { Text(note).font(.caption).foregroundStyle(.secondary) }
    }
}

private struct StudioOrbitArtwork: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        for i in 0..<6 {
            let offset = CGFloat(i) * 15
            path.addEllipse(in: CGRect(x: offset, y: offset, width: max(1, rect.width - offset), height: max(1, rect.height - offset)))
        }
        return path
    }
}

private enum StudioEditorial {
    static func stage(home: Bool, step: Int, flight: Int, medina: Bool) -> (kicker: String, title: String, detail: String, symbol: String) {
        if home { return ("INDIVIDUAL UMRAH", "Создаём вашу индивидуальную умру", "Ближе к своим близким. Ближе к поклонению. Соберите путешествие под ваши даты, пожелания и бюджет.", "sparkles") }
        switch step {
        case 0: return ("01 / ПЕРСОНАЛИЗАЦИЯ", "Ваше путешествие начинается здесь", "Выберите формат, город вылета и состав семьи. Каждый компонент можно настроить индивидуально.", "person.2")
        case 1:
            if flight == 2 { return ("02 / ПЕРЕЛЁТ", "Прозрачная стоимость перелёта", "Проверим общую стоимость билетов туда и обратно для каждого паломника.", "creditcard") }
            return ("02 / ПЕРЕЛЁТ", flight == 0 ? "Удобный перелёт. Спокойное начало." : "Обратный рейс в удобное время", "Выбирайте рейсы под свои даты, без привязки к расписанию туристической группы. Проверяйте тариф и условия багажа.", "airplane")
        case 2: return (medina ? "04 / МЕДИНА" : "03 / МЕККА", medina ? "Спокойные дни в Медине" : "Ближе к Хараму. Больше времени для поклонения.", "Выбирайте отель, номер и питание с учётом расположения, бюджета и потребностей вашей семьи.", "bed.double")
        case 3: return ("05 / ПЕРСОНАЛЬНАЯ ЗАБОТА", "Ваше поклонение. Наша забота.", "Организуйте личный транспорт, сопровождение и дополнительные услуги под вашу поездку.", "heart")
        case 4: return ("06 / СТОИМОСТЬ", "Вы знаете, за что платите", "Детализация перелёта, проживания, услуг, комиссии и согласованной скидки.", "receipt")
        default: return ("07 / ВАША ПОЕЗДКА", "Индивидуальная умра для вашей семьи", "Проверьте выбранные компоненты и стоимость перед подтверждением наличия и отправкой предложения.", "checkmark.seal")
        }
    }
    static func category(_ value: String) -> String { ["Economy":"Эконом", "Standard":"Стандарт", "Comfort":"Комфорт", "Premium":"Люкс"][value] ?? value }
    static func categoryDetail(_ value: String) -> String { ["Economy":"Самое необходимое без лишних расходов", "Standard":"Баланс удобства и бюджета", "Comfort":"Больше удобства для вашей семьи", "Premium":"Премиальное проживание и сервис"][value] ?? "Индивидуальные параметры" }
    static func categoryIcon(_ value: String) -> String { ["Economy":"wallet.pass", "Standard":"checkmark.circle", "Comfort":"chair.lounge", "Premium":"sparkles"][value] ?? "person.2" }
}

private struct StudioQuoteSnapshot {
    let travelers: Int
    let category: String
    let route: String
    let dates: String
    let hotels: String
    let services: String
    let amount: Double?
    init(draft: UmrahPackageDraft) {
        travelers = draft.travelers; category = StudioEditorial.category(draft.comfort)
        route = [draft.outbound.map(UmrahAirportLabel.route), draft.inbound.map(UmrahAirportLabel.route)].compactMap { $0 }.joined(separator: " / ")
        let format = DateFormatter(); format.locale = Locale(identifier: "ru_RU"); format.timeZone = TimeZone(identifier: "Asia/Riyadh"); format.dateFormat = "dd.MM.yyyy"
        dates = [draft.arrival, draft.departure].compactMap { $0.map { format.string(from: $0) } }.joined(separator: " – ")
        hotels = ([draft.makkah] + (draft.includeMedina ? [draft.medina] : [])).map { "\($0.name) · \($0.nights) ноч. · \($0.rooms) ном. · \($0.meals)" }.joined(separator: "\n")
        var parts = [draft.vehicle]
        if draft.ziyaratMakkah { parts.append("Зияраты в Мекке") }
        if draft.includeMedina && draft.ziyaratMedina { parts.append("Зияраты в Медине") }
        if (UmrahPackageDraft.amount(draft.guidePrice ?? "0") ?? 0) > 0 { parts.append("Гид") }
        services = parts.joined(separator: " · ")
        amount = draft.firstIncompleteBuilderStage == 5 ? draft.saleTotal : nil
    }
    func card(_ title: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.title2.bold())
            Text("\(travelers) чел. · \(category)").font(.headline)
            Text(dates).font(.subheadline); Text(route).font(.caption); Text(hotels).font(.subheadline); Text(services).font(.caption)
            if let amount { Text(amount, format: .currency(code: "USD")).font(.title.bold()) } else { Text("Расчёт не завершён").font(.headline) }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(18).businessCard()
    }
}
