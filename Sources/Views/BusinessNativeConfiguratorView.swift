import SwiftUI
import IumrahClientConfigurator

/// Client-native flow is the default new-package workspace. Existing staff
/// drafts, offer amendments and concierge cases retain their original editor.
@MainActor struct BusinessNativeConfiguratorView: View {
    let owner: String
    @EnvironmentObject private var navigation: BusinessNavigationStore
    var body: some View {
        IumrahNativeConfigurator(review: { snapshot in
            AnyView(BusinessNativeConfiguratorReview(owner: owner, snapshot: snapshot))
        }, homeActions: {
            AnyView(VStack(spacing: 20) {
                OverviewView()
                NavigationLink {
                UmrahBuilderView(owner: owner, embedded: true)
            } label: {
                Label("Черновики и ручное оформление", systemImage: "tray.full")
                    .frame(maxWidth: .infinity)
            }.buttonStyle(BusinessActionStyle(primary: false))
            })
        }, onNotifications: { navigation.navigate(to: .notifications) }, homeRequest: navigation.configuratorRequest)
        .id(owner)
    }
}

extension UmrahPackageDraft {
    /// Public client line amounts seed the editable estimate; they are NOT
    /// confidential supplier costs and must be verified by the staff member.
    init(client snapshot: BusinessConfiguratorSnapshot) {
        self.init()
        travelers = snapshot.adults + snapshot.children + snapshot.infants
        clientAdults = snapshot.adults; clientChildren = snapshot.children; clientInfants = snapshot.infants
        comfort = ["economy":"Economy", "standard":"Standard", "comfort":"Comfort", "luxury":"Premium"][snapshot.tier] ?? "Standard"
        func money(_ n: Double) -> String { String(format: "%.2f", locale: Locale(identifier: "en_US_POSIX"), n) }
        func sum(_ keys: [String]) -> Double { keys.reduce(0) { $0 + (snapshot.amounts[$1] ?? 0) } }
        func flight(_ f: BusinessConfiguratorSnapshot.Flight) -> Flight {
            Flight(id: f.id, source: f.source, legs: f.legs.map { l in
                BusinessFlightCurationItinerary.Leg(airline: l.airline, flightNumber: l.flightNumber, airlineCode: l.airlineCode,
                    origin: l.origin, destination: l.destination, departureAt: l.departureAt, arrivalAt: l.arrivalAt,
                    durationMinutes: l.durationMinutes, stops: 0, cabinClass: l.cabinClass)
            })
        }
        outbound = flight(snapshot.outbound); inbound = flight(snapshot.inbound)
        let count = Double(max(1, travelers))
        if let out = snapshot.amounts["flight_outbound"], let back = snapshot.amounts["flight_inbound"], snapshot.amounts["flight_roundtrip"] == nil {
            setLegPrice(money(out / count), outbound: true); setLegPrice(money(back / count), outbound: false)
        } else { setCombinedFlightPrice(money(sum(["flight_roundtrip", "flight_outbound", "flight_inbound"]) / count)) }
        func stay(_ s: BusinessConfiguratorSnapshot.Stay, _ price: Double) -> Stay {
            Stay(id: s.id, name: s.name, imageURL: s.imageURL, stars: s.stars, checkIn: s.checkIn, checkOut: s.checkOut,
                 rooms: s.rooms, room: s.room, meals: s.meals, price: money(price))
        }
        makkah = stay(snapshot.makkah, sum(["makkah_hotel"]))
        includeMedina = snapshot.madinah != nil
        if let s = snapshot.madinah { medina = stay(s, sum(["madinah_hotel"])) }
        vehicle = snapshot.vehicle; pickup = snapshot.pickup
        transferPrice = money(sum(["transfers", "vip_transfer_upgrade"]))
        ziyaratMakkah = snapshot.amounts["ziyarat_makkah"] != nil
        ziyaratMedina = snapshot.amounts["ziyarat_madinah"] != nil
        ziyaratPrice = money(sum(["ziyarat_makkah", "ziyarat_madinah"]))
        visaPrice = money(sum(["visa"])); guidePrice = money(sum(["accompaniment"]))
        preferredGuideID = snapshot.guideID; preferredGuideName = snapshot.guideName
        let known = Set(["flight_roundtrip", "flight_outbound", "flight_inbound", "makkah_hotel", "madinah_hotel", "transfers", "vip_transfer_upgrade", "ziyarat_makkah", "ziyarat_madinah", "visa", "accompaniment"])
        otherPrice = money(snapshot.amounts.filter { !known.contains($0.key) }.values.reduce(0, +))
        includesClientESIM = snapshot.amounts["esim"] != nil
        includesClientGuide = snapshot.amounts["accompaniment"] != nil
        includesClientVisa = snapshot.amounts["visa"] != nil
        clientComponentPrices = snapshot.amounts.mapValues { money($0) }
        // The staff API uses one combined adjustable percentage, not the consumer
        // 9% + gross-payment 2% contract. Seed it from the public total, then staff edit.
        let base = costSubtotal ?? snapshot.originalSubtotal
        commission = base > 0 ? String(format: "%.8f", locale: Locale(identifier: "en_US_POSIX"), max(0, (snapshot.originalTotal - base) * 100 / base)) : "0"
        discount = "0"; builderStage = 5; builderFlightPhase = 2; builderHotelPhase = includeMedina ? 1 : 0
        builderOrigin = snapshot.outbound.legs.first?.origin
        clientUnsupported = snapshot.unsupported.isEmpty ? nil : snapshot.unsupported
    }
}

@MainActor private struct BusinessNativeConfiguratorReview: View {
    let owner: String
    let snapshot: BusinessConfiguratorSnapshot
    @State private var draft: UmrahPackageDraft
    @State private var expanded = false
    @State private var verified = false
    @State private var message: String?
    private struct Checkout: Identifiable { let id = UUID(); let draft: UmrahPackageDraft; let offer: Bool }
    @State private var checkout: Checkout?
    init(owner: String, snapshot: BusinessConfiguratorSnapshot) {
        self.owner = owner; self.snapshot = snapshot; _draft = State(initialValue: UmrahPackageDraft(client: snapshot))
    }
    private var issue: String? {
        snapshot.unsupported.first ?? (0..<5).compactMap { draft.builderIssue(at: $0) }.first
    }
    private var ready: Bool { verified && issue == nil && !owner.isEmpty }
    private func optional(_ key: WritableKeyPath<UmrahPackageDraft, String?>) -> Binding<String> {
        Binding(get: { draft[keyPath: key] ?? "0" }, set: { draft[keyPath: key] = $0 })
    }
    private func componentTitle(_ code: String) -> String {
        ["transfers": "Трансфер", "vip_transfer_upgrade": "VIP-трансфер · доплата", "ziyarat_makkah": "Зиярат Мекка", "ziyarat_madinah": "Зиярат Медина", "esim": "eSIM", "meals": "Питание", "makkah_meals": "Питание Мекка", "madinah_meals": "Питание Медина"][code] ?? code.replacingOccurrences(of: "_", with: " ")
    }
    private func componentField(_ code: String) -> some View {
        UmrahMoneyField(title: componentTitle(code), text: Binding(get: { draft.clientComponentPrices?[code] ?? "0" }, set: { draft.setClientComponentPrice(code, $0) }))
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Стоимость путешествия").font(.title2.bold())
            Text("Внутренний расчёт Business · USD").font(.caption).foregroundStyle(.secondary)
            if let total = draft.saleTotal {
                Text(total, format: .currency(code: "USD")).font(.system(.largeTitle, design: .rounded, weight: .bold)).monospacedDigit()
                Text("На человека: " + (total / Double(max(1, draft.travelers))).formatted(.currency(code: "USD"))).font(.subheadline)
            } else { Text("Укажите корректные суммы").font(.headline) }
            Text("Исходные публичные цены: " + snapshot.originalTotal.formatted(.currency(code: "USD")) + ". Это не подтверждённая себестоимость поставщиков.").font(.caption).foregroundStyle(.secondary)
            DisclosureGroup(isExpanded: $expanded) {
                VStack(alignment: .leading, spacing: 12) {
                    BusinessFlightPriceEditor(draft: $draft)
                    UmrahMoneyField(title: "Мекка · все номера и ночи", text: $draft.makkah.price)
                    if draft.includeMedina { UmrahMoneyField(title: "Медина · все номера и ночи", text: $draft.medina.price) }
                    if !UmrahPackageDraft.clientTransferCodes.contains(where: { snapshot.amounts[$0] != nil }) { UmrahMoneyField(title: "Трансфер", text: $draft.transferPrice) }
                    ForEach(UmrahPackageDraft.clientTransferCodes.filter { snapshot.amounts[$0] != nil }, id: \.self) { componentField($0) }
                    ForEach(UmrahPackageDraft.clientZiyaratCodes.filter { snapshot.amounts[$0] != nil }, id: \.self) { componentField($0) }
                    UmrahMoneyField(title: "Персональный гид", text: optional(\.guidePrice))
                    UmrahMoneyField(title: "Визы", text: optional(\.visaPrice))
                    ForEach(snapshot.amounts.keys.filter { !UmrahPackageDraft.clientCoreCodes.contains($0) }.sorted(), id: \.self) { componentField($0) }
                    if snapshot.amounts.keys.allSatisfy({ UmrahPackageDraft.clientCoreCodes.contains($0) }) { UmrahMoneyField(title: "Прочие услуги", text: optional(\.otherPrice)) }
                    Divider()
                    UmrahMoneyField(title: "Комиссия Business · %", text: optional(\.commission))
                    UmrahMoneyField(title: "Скидка на пакет · USD", text: optional(\.discount))
                    if let base = draft.costSubtotal { Text("Себестоимость: " + base.formatted(.currency(code: "USD"))) }
                    if let fee = draft.commissionAmount { Text("Комиссия: " + fee.formatted(.currency(code: "USD"))) }
                    Button("Применить цены") { withAnimation { expanded = false } }.buttonStyle(BusinessActionStyle(primary: false))
                }.padding(.top, 12)
            } label: { Label("Цена под капотом", systemImage: "slider.horizontal.3").font(.headline) }.tint(.black)
            if let issue { Label(issue, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.red) }
            Toggle("Я проверил внутренние цены", isOn: $verified).font(.subheadline)
            Menu {
                Button("Для предложения") { save(offer: true) }
                Button("Для бронирования") { save(offer: false) }
            } label: { Label("Сохранить пакет", systemImage: "bookmark").frame(maxWidth: .infinity) }
                .buttonStyle(BusinessActionStyle(primary: false)).disabled(!ready)
            Button("Создать предложение") { open(offer: true) }.buttonStyle(BusinessActionStyle()).disabled(!ready)
            Button("Создать бронирование") { open(offer: false) }.buttonStyle(BusinessActionStyle(primary: false)).disabled(!ready)
            if let message { Text(message).font(.caption).foregroundStyle(.secondary) }
            Text("Сохранение создаёт локальный черновик. Отправка заявки и предложения выполняется только после подтверждения в Business.").font(.caption).foregroundStyle(.secondary)
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(.white, in: RoundedRectangle(cornerRadius: 24))
        .onChange(of: draft) { _, _ in verified = false; message = nil }
        .sheet(item: $checkout) { item in
            NavigationStack {
                UmrahBuilderView(owner: owner, initial: item.draft, preferOffer: item.offer, pushed: true, startAtCheckout: true)
            }
        }
    }
    private func prepared(offer: Bool) -> UmrahPackageDraft {
        var d = draft; d.builderStage = 5; d.builderFinishAsOffer = offer; return d
    }
    private func save(offer: Bool) {
        guard ready else { return }
        let store = UmrahDraftStore(owner: owner)
        message = store.saveIndependentSnapshot(prepared(offer: offer)) ? "Пакет сохранён в черновиках." : (store.storageError ?? "Не удалось сохранить пакет.")
    }
    private func open(offer: Bool) {
        guard ready else { return }
        let store = UmrahDraftStore(owner: owner)
        let next = prepared(offer: offer)
        guard store.installIndependentSnapshot(next) else { message = store.storageError; return }
        checkout = Checkout(draft: next, offer: offer)
    }
}

struct BusinessFlightPriceEditor: View {
    @Binding var draft: UmrahPackageDraft
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("Тариф перелёта", selection: Binding(get: { draft.splitFlightPricing }, set: { split in
                if split { draft.beginSplitFlightPricing() } else { draft.setCombinedFlightPrice(draft.flightPrice) }
            })) { Text("Общий тариф").tag(false); Text("По направлениям").tag(true) }.pickerStyle(.segmented)
            if draft.splitFlightPricing {
                UmrahMoneyField(title: "Туда · на человека, USD", text: Binding(get: { draft.outboundPrice ?? "" }, set: { draft.setLegPrice($0, outbound: true) }))
                UmrahMoneyField(title: "Обратно · на человека, USD", text: Binding(get: { draft.inboundPrice ?? "" }, set: { draft.setLegPrice($0, outbound: false) }))
                Text(draft.flightPrice.isEmpty ? "Укажите обе суммы" : "Общий тариф: $" + draft.flightPrice).font(.caption).foregroundStyle(.secondary)
            } else {
                UmrahMoneyField(title: "Туда и обратно · на человека, USD", text: Binding(get: { draft.flightPrice }, set: { draft.setCombinedFlightPrice($0) }))
            }
        }
    }
}

