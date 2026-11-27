import Foundation
import SwiftUI
import Security

// No minor counts towards the special adult-only exception. Hotel supplier
// occupancy still has to be checked, including each actual child's age.
struct TripSummaryGuestDraft {
    enum AgeGroup { case teen, child, infant
        var defaultAge: Int { switch self { case .teen: return -12; case .child: return -2; case .infant: return -3 } }
        func contains(_ age: Int) -> Bool { switch self { case .teen: return age == -12 || (12...17).contains(age); case .child: return age == -2 || (2...11).contains(age); case .infant: return age == -3 || (0...1).contains(age) } }
    }
    var adults: Int
    var rooms: Int
    var ages: [Int]
    var total: Int { adults + ages.count }
    static func minimumRooms(_ adults: Int) -> Int { ConfiguratorRepricingPolicy.minimumRooms(adults) }
    @MainActor init(journey: JourneyStore) {
        adults = journey.trip.adults; rooms = journey.trip.rooms
        let existing = journey.tripSummaryChildAges
        let selected = journey.localJourneyRooms.values.filter { $0.city == "makkah" }.sorted { $0.id < $1.id }.flatMap(\.childrenAges)
        let count = journey.trip.children + journey.trip.infants
        ages = existing.count == count ? existing : selected.count == count ? selected : Array(repeating: -1, count: count)
    }
    func trip(from original: TripDraft) -> TripDraft {
        var next = original
        next.adults = adults; next.rooms = max(rooms, Self.minimumRooms(adults))
        next.children = ages.filter { $0 >= 2 }.count
        next.infants = ages.filter { $0 >= 0 && $0 < 2 }.count
        return next
    }
}

@MainActor
final class TripSummaryEditSession: Identifiable {
    enum Kind: Equatable { case flights, hotel(String), allHotels, catalog(HotelSelectionRole), transfer }
    let id = UUID()
    let kind: Kind
    let draft: JourneyStore
    let ages: [Int]
    init(kind: Kind, journey: JourneyStore) {
        self.kind = kind
        self.draft = journey.tripSummaryEditingCopy()
        ages = TripSummaryGuestDraft(journey: journey).ages
        if case .hotel(let city) = kind { draft.localJourneyRooms = draft.localJourneyRooms.filter { $0.value.city != city } }
    }
}

struct TripSummaryCalendar: View {
    let trip: TripDraft
    let quote: PackageQuote?
    let outbound: FlightOffer?
    let inbound: FlightOffer?
    let language: AppSettingsStore.Language
    @State private var selected: String?
    private func t(_ ru: String, _ en: String, _ uz: String, _ cy: String) -> String { IumrahFlightCopy.text(language, ru, en, uz, cy) }
    private struct Entry: Identifiable {
        let id: String; let day: String; let time: String?; let title: String; let subtitle: String; let icon: String
    }
    private func localizedTitle(_ kind: String?, fallback: String) -> String {
        switch kind {
        case "arrival": return t("Прилёт", "Arrival", "Yetib kelish", "Етиб келиш")
        case "airportExit": return t("Выход из аэропорта", "Airport exit", "Aeroportdan chiqish", "Аэропортдан чиқиш")
        case "hotelTransfer": return t("Трансфер в отель", "Hotel transfer", "Mehmonxonaga transfer", "Меҳмонхонага трансфер")
        case "hotelCheckIn": return t("Заселение", "Check-in", "Joylashish", "Жойлашиш")
        case "hotelCheckOut": return t("Выселение", "Check-out", "Chiqish", "Чиқиш")
        case "intercityTransfer": return t("Переезд между городами", "Intercity transfer", "Shaharlararo transfer", "Шаҳарлараро трансфер")
        case "umrah": return t("Совершение умры", "Umrah", "Umra", "Умра")
        case "makkahZiyarat", "madinahZiyarat": return t("Зияраты", "Ziyarat", "Ziyoratlar", "Зиёратлар")
        case "airportTransfer": return t("Трансфер в аэропорт", "Airport transfer", "Aeroportga transfer", "Аэропортга трансфер")
        case "flightHome": return t("Вылет домой", "Flight home", "Uyga uchish", "Уйга учиш")
        default: return fallback
        }
    }
    private var entries: [Entry] {
        var result: [Entry] = []
        func flight(_ offer: FlightOffer, arrival: Bool, title: String, id: String) {
            let airport = arrival ? offer.destination : offer.origin
            let instant = ISO8601DateFormatter().string(from: arrival ? offer.arrivalAt : offer.departureAt)
            let local = IumrahFlightClock.local(instant, airport: airport)
            result.append(.init(id: id, day: String(local.prefix(10)), time: IumrahFlightClock.time(local), title: title, subtitle: airport, icon: arrival ? "airplane.arrival" : "airplane.departure"))
        }
        if let out = outbound { flight(out, arrival: false, title: t("Вылет", "Departure", "Uchish", "Учиш"), id: "out") }
        if let events = quote?.itineraryPreview, !events.isEmpty {
            result += events.map { .init(id: $0.id, day: $0.dateLocal, time: $0.timeLocal, title: localizedTitle($0.kind, fallback: $0.title), subtitle: $0.location, icon: $0.icon) }
        } else {
            if let out = outbound { flight(out, arrival: true, title: t("Прилёт", "Arrival", "Yetib kelish", "Етиб келиш"), id: "arrival") }
            if let stay = quote?.stayPlan {
                func add(_ id: String, _ day: String, _ title: String, _ city: String) { result.append(.init(id: id, day: day, time: nil, title: title, subtitle: city, icon: "bed.double")) }
                add("m-in", stay.makkahCheckIn, t("Заселение", "Check-in", "Joylashish", "Жойлашиш"), "Makkah")
                add("m-out", stay.makkahCheckOut, t("Выселение", "Check-out", "Chiqish", "Чиқиш"), "Makkah")
                if let d = stay.madinahCheckIn { add("d-in", d, t("Заселение", "Check-in", "Joylashish", "Жойлашиш"), "Madinah") }
                if let d = stay.madinahCheckOut { add("d-out", d, t("Выселение", "Check-out", "Chiqish", "Чиқиш"), "Madinah") }
            }
            if let back = inbound { flight(back, arrival: false, title: t("Вылет домой", "Flight home", "Uyga uchish", "Уйга учиш"), id: "back") }
        }
        if let back = inbound { flight(back, arrival: true, title: t("Возвращение домой", "Arrival home", "Uyga yetish", "Уйга етиш"), id: "home") }
        return result.sorted { ($0.day, $0.time ?? "99:99", $0.id) < ($1.day, $1.time ?? "99:99", $1.id) }
    }
    private var days: [String] {
        let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "Asia/Riyadh"); f.dateFormat = "yyyy-MM-dd"
        let keys = entries.map(\.day)
        let start = (keys.min().flatMap(f.date(from:))) ?? trip.departureDate
        let end = (keys.max().flatMap(f.date(from:))) ?? trip.returnDate
        var cal = Calendar(identifier: .gregorian); cal.timeZone = f.timeZone
        let count = max(1, min(90, (cal.dateComponents([.day], from: cal.startOfDay(for: start), to: cal.startOfDay(for: end)).day ?? 0) + 1))
        return (0..<count).compactMap { cal.date(byAdding: .day, value: $0, to: cal.startOfDay(for: start)).map(f.string(from:)) }
    }
    var body: some View {
        let current = selected.flatMap { days.contains($0) ? $0 : nil } ?? days.first ?? ""
        VStack(alignment: .leading, spacing: 14) {
            Text(t("Расписание поездки · местное время", "Planned schedule · local time", "Taxminiy jadval · mahalliy vaqt", "Тахминий жадвал · маҳаллий вақт")).font(.caption).foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) { HStack(spacing: 8) {
                ForEach(days, id: \.self) { day in
                    Button { selected = day; IumrahHaptics.selection() } label: {
                        VStack(spacing: 5) { Text(String(day.suffix(2))).font(.title3.bold()); Text(IumrahFlightClock.day(day, locale: Locale(identifier: language.localeIdentifier))).font(.caption2).lineLimit(1) }
                            .padding(10).frame(minWidth: 58).foregroundStyle(current == day ? Color.white : Color.primary).background(current == day ? Color.black : Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 15))
                    }.buttonStyle(.plain)
                }
            } }
            Divider()
            let events = entries.filter { $0.day == current }
            if events.isEmpty { Text(t("Время мероприятий согласовывается", "Activities to be arranged", "Tadbirlar vaqti kelishiladi", "Тадбирлар вақти келишилади")).font(.subheadline).foregroundStyle(.secondary) }
            ForEach(events) { e in
                HStack(alignment: .top, spacing: 10) {
                    Text(e.time ?? "—").font(.caption.monospacedDigit()).foregroundStyle(.secondary).frame(width: 47, alignment: .leading)
                    Image(systemName: e.icon).frame(width: 22)
                    VStack(alignment: .leading, spacing: 3) { Text(e.title).font(.subheadline.bold()); if !e.subtitle.isEmpty { Text(e.subtitle).font(.caption).foregroundStyle(.secondary) } }
                    Spacer(minLength: 0)
                }
            }
            Text(t("Время трансферов и мероприятий подтверждается перед поездкой.", "Transfer and activity times are confirmed before travel.", "Transfer va tadbir vaqti safardan oldin tasdiqlanadi.", "Трансфер ва тадбир вақти сафардан олдин тасдиқланади.")).font(.caption2).foregroundStyle(.secondary)
        }
    }
}


// Shared, value-driven building blocks. Smart assembly and final review use the
// same content without creating a second JourneyStore or mounting checkout early.
struct TripSummaryFlightOverview: View {
    let offer: FlightOffer
    let outbound: FlightOffer?
    let inbound: FlightOffer?
    let travelers: Int
    let language: AppSettingsStore.Language
    let title: String
    var compactReview = false
    private func t(_ ru: String,_ en: String,_ uz: String,_ cy: String) -> String { IumrahFlightCopy.text(language,ru,en,uz,cy) }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !compactReview {
                Text(title).font(.headline)
                Text(offer.airlinesSummary + " · " + offer.flightNumbersSummary).font(.caption).foregroundStyle(.secondary)
            }
            HStack(alignment: .top, spacing: 6) {
                endpoint(offer.origin, offer.departureAt, t("Вылет", "Departure", "Uchish", "Учиш"), trailing: false)
                Spacer(minLength: 2)
                VStack(spacing: 4) {
                    Image(systemName: "airplane").font(.title3)
                    Text(offer.stops == 0 ? t("Прямой", "Direct", "To‘g‘ridan to‘g‘ri", "Тўғридан тўғри") : "\(offer.stops) " + (offer.stops == 1 ? t("пересадка", "stop", "bekat", "бекат") : offer.stops < 5 ? t("пересадки", "stops", "bekat", "бекат") : t("пересадок", "stops", "bekat", "бекат"))).font(.caption2)
                }.foregroundStyle(.secondary)
                Spacer(minLength: 2)
                endpoint(offer.destination, offer.arrivalAt, t("Прилёт", "Arrival", "Kelish", "Келиш"), trailing: true)
            }
            if !compactReview {
            IumrahPackageFlightPriceLine(offer: offer, outbound: outbound, inbound: inbound, travelers: travelers, language: language)
            Label(IumrahRefundComponent.flight.badge(language), systemImage: "info.circle").font(.caption.weight(.medium)).foregroundStyle(.secondary)
            }
        }
    }
    private func endpoint(_ code: String, _ date: Date, _ caption: String, trailing: Bool) -> some View {
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: language.localeIdentifier)
        formatter.timeZone = FlightReferenceCatalog.timeZone(for: code) ?? TimeZone(secondsFromGMT: 0)
        formatter.setLocalizedDateFormatFromTemplate("d MMM HH:mm")
        return VStack(alignment: trailing ? .trailing : .leading, spacing: 4) {
            if !compactReview { Text(caption).font(.caption2).foregroundStyle(.secondary) }
            Text(code).font(.system(.title2, design: .rounded, weight: .bold))
            Text(formatter.string(from: date)).font(.caption).monospacedDigit().fixedSize(horizontal: false, vertical: true)
        }.frame(maxWidth: .infinity, alignment: trailing ? .trailing : .leading)
    }
}

struct TripSummaryHotelOverview: View {
    let rooms: [LocalJourneyRoom]
    let language: AppSettingsStore.Language
    let confirmedTotal: Decimal?
    var compactReview = false
    private func t(_ ru: String,_ en: String,_ uz: String,_ cy: String) -> String { IumrahFlightCopy.text(language,ru,en,uz,cy) }
    private var estimate: Decimal? {
        guard !rooms.isEmpty, rooms.allSatisfy({ $0.requiresRateRefresh != true && $0.rate.currency.uppercased() == "USD" && $0.rate.price.isFinite && $0.rate.price > 0 }) else { return nil }
        return rooms.reduce(Decimal.zero) { $0 + Decimal($1.rate.price) }
    }
    var body: some View {
        if let first = rooms.first {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 12) {
                    HotelCachedImage(rawURL: first.hotel.coverImageURL, thumbnailPixelDimension: 256)
                        .frame(width: compactReview ? 112 : 82, height: compactReview ? 112 : 86).clipped().clipShape(RoundedRectangle(cornerRadius: 16))
                    VStack(alignment: .leading, spacing: 5) {
                        Text(L10n.city(first.city == "madinah" ? "Madinah" : "Makkah", language) + " · \(TripStayWindow(checkIn: first.checkin, checkOut: first.checkout).nights) " + t("ночей", "nights", "tun", "тун")).font(.caption).foregroundStyle(.secondary)
                        Text(first.hotel.name).font(.system(.headline, design: .rounded)).fixedSize(horizontal: false, vertical: true)
                        if first.hotel.roundedStars > 0 { Text(String(repeating: "★", count: first.hotel.roundedStars)).font(.caption) }
                        else { Text(t("Категория не указана", "Unrated", "Toifasi ko‘rsatilmagan", "Тоифаси кўрсатилмаган")).font(.caption).foregroundStyle(.secondary) }
                        if compactReview { Text("\(rooms.count) " + t("ном. · ", "rooms · ", "xona · ", "хона · ") + "\(rooms.reduce(0) { $0 + $1.adults + $1.childrenAges.count }) " + t("гостей", "guests", "mehmon", "меҳмон")).font(.caption).foregroundStyle(.secondary) }
                        if let total = confirmedTotal ?? estimate { Text(IumrahPackageDisplayPrices.money(total, currency: "USD", language: language)).font(.title3.bold()).monospacedDigit() }
                        else if rooms.contains(where: { $0.requiresRateRefresh == true }) { Text(t("Тариф уточняется", "Rate pending", "Narx aniqlanmoqda", "Нарх аниқланмоқда")).font(.subheadline).foregroundStyle(.secondary) }
                        Text(confirmedTotal == nil ? t("За все номера и ночи", "All rooms and nights", "Barcha xona va tunlar uchun", "Барча хона ва тунлар учун") : t("За все номера и ночи", "All rooms and nights", "Barcha xona va tunlar", "Барча хона ва тунлар")).font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                }
                Label(first.checkin.formatted(date: .abbreviated, time: .omitted) + " – " + first.checkout.formatted(date: .abbreviated, time: .omitted), systemImage: "calendar").font(.caption).foregroundStyle(.secondary)
                if !compactReview {
                Label("\(rooms.count) " + t("ном. · ", "rooms · ", "xona · ", "хона · ") + "\(rooms.reduce(0) { $0 + $1.adults + $1.childrenAges.count }) " + t("гостей", "guests", "mehmon", "меҳмон"), systemImage: "person.2").font(.caption).foregroundStyle(.secondary)
                ForEach(Array(rooms.enumerated()), id: \.element.id) { index, room in
                    HStack(alignment: .top) {
                        Text("\(index + 1). " + room.rate.roomName).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 6)
                        Label("\(room.adults + room.childrenAges.count)", systemImage: "person.2").font(.caption)
                    }
                }
                }
                if !compactReview {
                    Label(rooms.allSatisfy { $0.rate.refundable } ? t("Возврат по условиям тарифа", "Refundable under rate terms", "Tarif shartlari bo‘yicha qaytarish", "Тариф шартлари бўйича қайтариш") : rooms.allSatisfy { !$0.rate.refundable } ? t("Невозвратный тариф", "Non-refundable rate", "Qaytarilmaydigan tarif", "Қайтарилмайдиган тариф") : t("Условия возврата различаются по номерам", "Refund terms vary by room", "Qaytarish shartlari xonaga bog‘liq", "Қайтариш шартлари хонага боғлиқ"), systemImage: "info.circle").font(.caption.weight(.medium)).foregroundStyle(.secondary)
                }
            }
        }
    }
}

struct TripSummaryVehicleOverview: View {
    let vehicle: TransferVehicleKind
    let language: AppSettingsStore.Language
    var price: String? = nil
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(vehicle.assetName).resizable().scaledToFit().frame(width: 112, height: 74)
            VStack(alignment: .leading, spacing: 5) {
                Text(IumrahFlightCopy.text(language,"Индивидуальный трансфер","Private transfer","Individual transfer","Индивидуал трансфер")).font(.headline)
                Text(vehicle.modelName).font(.subheadline)
                HStack(spacing: 10) { Label("\(vehicle.passengerCapacity)", systemImage: "person.2"); Label("\(vehicle.luggageCapacity)", systemImage: "suitcase.rolling") }.font(.caption).foregroundStyle(.secondary)
                if let price { Text(price).font(.title3.bold()).monospacedDigit() }
            }
            Spacer(minLength: 0)
        }
    }
}
