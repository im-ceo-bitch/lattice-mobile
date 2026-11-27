import SwiftUI
import UIKit

/// Shared presentation for the catalogue and both configurator legs.
struct IumrahFlightResultCard: View {
    @EnvironmentObject private var settings: AppSettingsStore
    let airline: String
    let airlineCode: String
    let flightNumber: String
    let origin: String
    let destination: String
    let departureAt: String
    let arrivalAt: String?
    let duration: Int
    let stops: Int
    let price: Double?
    let isAviasales: Bool
    var isRoundTripFare = false
    var selected = false
    var selectionAccent: Color = .primary
    var selectedSearchDay: String? = nil
    var onSelect: (() -> Void)? = nil
    static let standardHeight: CGFloat = 224
    @ScaledMetric(relativeTo: .body) private var cardHeight: CGFloat = 224
    let action: () -> Void

    private func tr(_ ru: String, _ en: String, _ uz: String, _ cy: String) -> String {
        IumrahFlightCopy.text(settings.language, ru, en, uz, cy)
    }
    private var arrival: IumrahFlightClock.Arrival? {
        IumrahFlightClock.arrival(actual: arrivalAt, departure: departureAt, duration: duration, origin: origin, destination: destination)
    }
    private var localDeparture: String { IumrahFlightClock.local(departureAt, airport: origin) }
    private var number: String? {
        IumrahPremiumFlightLeg(airline: airline, airlineCode: airlineCode, number: flightNumber, origin: origin, destination: destination, departure: departureAt, arrival: arrivalAt, duration: duration, stops: stops).verifiedNumber
    }
    private var usablePrice: Double? { guard let price, price.isFinite, price > 0 else { return nil }; return price }
    private var locale: Locale { Locale(identifier: settings.language.localeIdentifier) }
    private var durationTitle: String {
        if duration % 60 == 0 { return tr("\(duration / 60) ч", "\(duration / 60)h", "\(duration / 60) soat", "\(duration / 60) соат") }
        if duration < 60 { return tr("\(duration) мин", "\(duration)m", "\(duration) daq", "\(duration) дақ") }
        return tr("\(duration / 60) ч \(duration % 60) мин", "\(duration / 60)h \(duration % 60)m", "\(duration / 60) soat \(duration % 60) daq", "\(duration / 60) соат \(duration % 60) дақ")
    }
    var body: some View {
        let arrival = self.arrival
        let localDeparture = self.localDeparture
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    AirlineLogoView(airlineCode: airlineCode, size: 34)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(airline).font(IumrahType.bold(16, relativeTo: .headline)).lineLimit(1).minimumScaleFactor(0.75)
                        HStack(spacing: 6) {
                            if let number { Text(number).font(IumrahType.bold(12, relativeTo: .caption)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.75) }
                            Text(isAviasales ? tr("Авиабилет", "Flight", "Aviachipta", "Авиачипта") : "iumrah Direct")
                                .font(IumrahType.regular(10, relativeTo: .caption2)).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 6)
                    if selected && onSelect == nil { Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.primary) }
                }
                .padding(.trailing, onSelect == nil ? 0 : 44)
                .frame(height: 42)
                HStack(alignment: .top, spacing: 8) {
                    endpoint(origin, time: IumrahFlightClock.time(localDeparture), day: localDeparture, trailing: false)
                    VStack(spacing: 5) {
                        Text(duration > 0 ? durationTitle : "—").font(IumrahType.regular(11)).foregroundStyle(.secondary).lineLimit(2).minimumScaleFactor(0.75).multilineTextAlignment(.center).frame(height: 28)
                        Image(systemName: stops == 0 ? "airplane" : "arrow.triangle.branch")
                            .font(.system(size: 18, weight: .medium)).foregroundStyle(.primary)
                            .frame(height: 22).accessibilityHidden(true)
                        if stops >= 0 {
                            Text(stops == 0 ? tr("Прямой", "Direct", "To‘g‘ri", "Тўғри") : tr("Пересадок: \(stops)", "Stops: \(stops)", "Transfer: \(stops)", "Трансфер: \(stops)"))
                                .font(IumrahType.regular(11, relativeTo: .caption2)).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.7).multilineTextAlignment(.center)
                        }
                    }.frame(width: 76).padding(.top, 2)
                    endpoint(destination, time: arrival?.time, day: arrival?.day, trailing: true, estimated: arrival?.estimated == true)
                }
                Spacer(minLength: 0)
                Rectangle().fill(Color.primary.opacity(0.08)).frame(height: 1)
                HStack(alignment: .center, spacing: 8) {
                    if usablePrice != nil {
                        Text(isRoundTripFare ? tr("Туда и обратно · за пассажира", "Round trip · per passenger", "Borib qaytish · bir yo‘lovchi", "Бориб қайтиш · бир йўловчи") : tr("За пассажира", "Per passenger", "Bir yo‘lovchi uchun", "Бир йўловчи учун"))
                            .font(IumrahType.regular(12, relativeTo: .caption)).foregroundStyle(.secondary).lineLimit(2).minimumScaleFactor(0.8)
                    }
                    Spacer(minLength: 6)
                    if let price = usablePrice {
                        Text("$" + price.formatted(.number.precision(.fractionLength(0)))).font(IumrahType.bold(25, relativeTo: .title2)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.65)
                    } else {
                        Text(tr("Подробнее", "Details", "Batafsil", "Батафсил")).font(IumrahType.bold(15)).lineLimit(1).minimumScaleFactor(0.7)
                    }
                    if onSelect == nil { Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary).accessibilityHidden(true) }
                }.frame(height: 35)
            }
            .foregroundStyle(Color.primary).padding(14)
            .frame(maxWidth: .infinity)
            .frame(height: max(Self.standardHeight, cardHeight))
            .background(IumrahFlightPalette.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(selected ? selectionAccent : Color.primary.opacity(0.07), lineWidth: selected ? 1.5 : 0.75))
            .contentShape(RoundedRectangle(cornerRadius: 22))
        }.buttonStyle(.plain)
        .accessibilityHint(tr("Открыть рейс", "Open flight", "Reysni ochish", "Рейсни очиш"))
        .overlay(alignment: .topTrailing) {
            if let onSelect {
                Button(action: onSelect) {
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 24, weight: .medium))
                        .foregroundStyle(selected ? selectionAccent : Color.secondary)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tr("Выбрать рейс", "Select flight", "Reysni tanlash", "Рейсни танлаш"))
                .accessibilityAddTraits(selected ? .isSelected : [])
                .padding(9)
            }
        }
    }
    private func endpoint(_ code: String, time: String?, day: String?, trailing: Bool, estimated: Bool = false) -> some View {
        VStack(alignment: trailing ? .trailing : .leading, spacing: 3) {
            Text(time ?? "—").font(IumrahType.bold(28, relativeTo: .title2)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
            Text(code.uppercased()).font(IumrahType.bold(19, relativeTo: .headline)).lineLimit(1).minimumScaleFactor(0.75)
            Text(day.map { IumrahFlightClock.day($0, locale: locale) } ?? "—").font(IumrahType.regular(12)).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.75)
            Text(tr("Расчётное", "Estimated", "Hisoblangan", "Ҳисобланган")).font(IumrahType.regular(10)).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.7).opacity(estimated ? 1 : 0).accessibilityHidden(!estimated)
        }.frame(maxWidth: .infinity, alignment: trailing ? .trailing : .leading)
    }

}

enum IumrahFlightCopy {
    static func text(_ language: AppSettingsStore.Language, _ ru: String, _ en: String, _ uz: String, _ cy: String) -> String {
        switch language { case .russian: return ru; case .uzbek: return uz; case .uzbekCyrillic: return cy; default: return en }
    }
}

/// A calculated arrival is display-only, never written into a supplier itinerary.
enum IumrahFlightClock {
    struct Arrival { let time: String; let day: String; let estimated: Bool }
    private static let localCache: NSCache<NSString, NSString> = {
        let cache = NSCache<NSString, NSString>(); cache.countLimit = 8192; return cache
    }()
    private static let dayCache: NSCache<NSString, NSString> = {
        let cache = NSCache<NSString, NSString>(); cache.countLimit = 1024; return cache
    }()
    private static let formatterLock = NSLock()
    private static let isoStandard = ISO8601DateFormatter()
    private static let isoFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let localFormatters = NSCache<NSString, DateFormatter>()
    private static func instant(_ value: String) -> Date? {
        formatterLock.lock(); defer { formatterLock.unlock() }
        return isoStandard.date(from: value) ?? isoFractional.date(from: value)
    }
    private static func localTimestamp(_ date: Date, zone: TimeZone) -> String {
        formatterLock.lock(); defer { formatterLock.unlock() }
        let key = zone.identifier as NSString
        let formatter: DateFormatter
        if let existing = localFormatters.object(forKey: key) { formatter = existing }
        else {
            formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = zone; formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
            localFormatters.countLimit = 64; localFormatters.setObject(formatter, forKey: key)
        }
        return formatter.string(from: date)
    }
    static func time(_ value: String) -> String {
        guard value.count >= 16 else { return "—" }
        return String(value.dropFirst(11).prefix(5))
    }
    static func day(_ value: String, locale: Locale) -> String {
        let key = (locale.identifier + "|" + String(value.prefix(10))) as NSString
        if let cached = dayCache.object(forKey: key) { return cached as String }
        let parser = DateFormatter(); parser.locale = Locale(identifier: "en_US_POSIX"); parser.timeZone = TimeZone(secondsFromGMT: 0); parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: String(value.prefix(10))) else { return "" }
        let output = DateFormatter(); output.locale = locale; output.timeZone = parser.timeZone; output.setLocalizedDateFormatFromTemplate("d MMM")
        let result = output.string(from: date)
        dayCache.setObject(result as NSString, forKey: key)
        return result
    }
    static func local(_ value: String, airport: String) -> String {
        let key = (airport.uppercased() + "|" + value) as NSString
        if let cached = localCache.object(forKey: key) { return cached as String }
        guard let zone = FlightReferenceCatalog.timeZone(for: airport) else { return value }
        guard let date = instant(value) else {
            localCache.setObject(value as NSString, forKey: key)
            return value
        }
        let result = localTimestamp(date, zone: zone)
        localCache.setObject(result as NSString, forKey: key)
        return result
    }
    static func arrival(actual: String?, departure: String, duration: Int, origin: String, destination: String) -> Arrival? {
        if let actual, actual.count >= 16 {
            let localized = local(actual, airport: destination)
            return Arrival(time: time(localized), day: String(localized.prefix(10)), estimated: false)
        }
        guard duration > 0, let originZone = FlightReferenceCatalog.timeZone(for: origin),
              let destinationZone = FlightReferenceCatalog.timeZone(for: destination) else { return nil }
        var date = instant(departure)
        if date == nil {
            let parser = DateFormatter(); parser.locale = Locale(identifier: "en_US_POSIX"); parser.timeZone = originZone
            parser.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
            date = parser.date(from: String(departure.prefix(19)))
            if date == nil { parser.dateFormat = "yyyy-MM-dd'T'HH:mm"; date = parser.date(from: String(departure.prefix(16))) }
        }
        guard let date else { return nil }
        let output = DateFormatter(); output.locale = Locale(identifier: "en_US_POSIX"); output.timeZone = destinationZone
        let arrival = date.addingTimeInterval(TimeInterval(duration * 60))
        output.dateFormat = "HH:mm"; let time = output.string(from: arrival)
        output.dateFormat = "yyyy-MM-dd"
        return Arrival(time: time, day: output.string(from: arrival), estimated: true)
    }
}

struct IumrahFlightFilterState: Equatable {
    var directOnly = false
    var airline = ""
    var sort = 0
    var day: String? = nil
    func accepts(stops: Int, airline: String, departure: String, includeDay: Bool = true) -> Bool {
        (!directOnly || stops == 0) && (self.airline.isEmpty || self.airline == airline) && (!includeDay || day == nil || day == String(departure.prefix(10)))
    }
}
struct IumrahFlightPriceDay: Identifiable, Equatable {
    let id: String
    let price: Double
}

/// Bars are minimum observed fares, not interpolated prices or a live quote.
struct IumrahFlightSearchControls: View {
    @EnvironmentObject private var settings: AppSettingsStore
    @Binding var filters: IumrahFlightFilterState
    let airlines: [String]
    let days: [IumrahFlightPriceDay]
    var selectedDay: String? = nil
    var minimumDay: String? = nil
    var onSelectDay: ((String) -> Void)? = nil
    @State private var showCalendar = false
    @State private var calendarDate = Date()
    private func tr(_ ru: String, _ en: String, _ uz: String, _ cy: String) -> String { IumrahFlightCopy.text(settings.language, ru, en, uz, cy) }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Button { filters.directOnly.toggle() } label: {
                        Text(tr("Прямой", "Direct", "To‘g‘ri", "Тўғри"))
                            .foregroundStyle(filters.directOnly ? Color.iumrahPrimaryButtonText : Color.primary)
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            .background(filters.directOnly ? Color.iumrahPrimaryButtonBackground : IumrahFlightPalette.card, in: Capsule())
                    }.buttonStyle(.plain)
                    Menu {
                        Picker(tr("Авиакомпания", "Airline", "Aviakompaniya", "Авиакомпания"), selection: $filters.airline) {
                            Text(tr("Все", "All", "Barchasi", "Барчаси")).tag("")
                            ForEach(airlines, id: \.self) { Text(FlightReferenceCatalog.airlineName(code: $0, fallback: $0)).tag($0) }
                        }
                    } label: { pill(filters.airline.isEmpty ? tr("Авиакомпания", "Airline", "Aviakompaniya", "Авиакомпания") : filters.airline) }
                    Menu {
                        Picker(tr("Сортировка", "Sort", "Saralash", "Саралаш"), selection: $filters.sort) {
                            Text(tr("По дате", "Date", "Sana", "Сана")).tag(0)
                            Text(tr("Дешевле", "Cheapest", "Arzonroq", "Арзонроқ")).tag(1)
                            Text(tr("Быстрее", "Fastest", "Tezroq", "Тезроқ")).tag(2)
                        }
                    } label: { pill(filters.sort == 1 ? tr("Дешевле", "Cheapest", "Arzonroq", "Арзонроқ") : filters.sort == 2 ? tr("Быстрее", "Fastest", "Tezroq", "Тезроқ") : tr("По дате", "Date", "Sana", "Сана")) }
                    Button {
                        calendarDate = max(earliestDate, Self.localDate(selectedDay ?? filters.day) ?? earliestDate)
                        showCalendar = true
                    } label: { pill(tr("Календарь", "Calendar", "Taqvim", "Тақвим")) }.buttonStyle(.plain)
                }.font(.subheadline.weight(.medium))
            }
            if !days.isEmpty || selectedDay != nil || filters.day != nil {
                HStack {
                    Text(tr("Цены по датам", "Fares by date", "Sanalar bo‘yicha narx", "Саналар бўйича нарх")).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    if filters.day != nil {
                        Button(tr("Все даты", "All dates", "Barcha sanalar", "Барча саналар")) { filters.day = nil }.font(.caption)
                    }
                }
                IumrahCenteredFareChart(days: days, selectedDay: selectedDay ?? filters.day,
                    minimumDay: minimumDay, locale: Locale(identifier: settings.language.localeIdentifier),
                    noPriceLabel: tr("Нет опубликованной цены", "No published fare", "E’lon qilingan narx yo‘q", "Эълон қилинган нарх йўқ"),
                    onSelect: { select($0, feedback: false) })
                    .frame(height: 112)
                if days.isEmpty {
                    Text(tr("Цены появятся после поиска", "Fares appear after search", "Narxlar qidiruvdan keyin chiqadi", "Нархлар қидирувдан кейин чиқади"))
                        .font(.caption2).foregroundStyle(.secondary)
                }

            }
        }
        .tint(Color.primary)
        .sheet(isPresented: $showCalendar) {
            NavigationStack {
                VStack(spacing: 20) {
                    DatePicker(tr("Дата вылета", "Departure date", "Uchish sanasi", "Учиш санаси"), selection: $calendarDate, in: earliestDate..., displayedComponents: .date)
                        .datePickerStyle(.graphical)
                    Button(tr("Выбрать дату", "Select date", "Sanani tanlash", "Санани танлаш")) {
                        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"
                        select(formatter.string(from: calendarDate)); showCalendar = false
                    }.buttonStyle(IumrahPrimaryButtonStyle())
                    Spacer()
                }.padding(20)
                .navigationTitle(tr("Календарь цен", "Fare calendar", "Narxlar taqvimi", "Нархлар тақвими"))
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(tr("Закрыть", "Close", "Yopish", "Ёпиш")) { showCalendar = false } } }
            }.tint(Color.primary).presentationDetents([.large])
        }
    }
    private var earliestDate: Date { max(Calendar.current.startOfDay(for: Date()), Self.localDate(minimumDay) ?? .distantPast) }
    private static func localDate(_ day: String?) -> Date? {
        guard let day else { return nil }
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
    private func select(_ day: String, feedback: Bool = true) {
        guard day != (selectedDay ?? filters.day), let date = Self.localDate(day), date >= earliestDate else { return }
        if feedback { IumrahHaptics.selection() }
        if let onSelectDay { onSelectDay(day) } else { filters.day = day }
    }
    private func pill(_ title: String) -> some View {
        Text(title).foregroundStyle(Color.primary).padding(.horizontal, 14).padding(.vertical, 10).background(IumrahFlightPalette.card, in: Capsule())
    }
    static func priceDays(_ fares: [(String, Double?)]) -> [IumrahFlightPriceDay] {
        var lowest: [String: Double] = [:]
        for (date, price) in fares {
            guard let price, price.isFinite, price > 0 else { continue }
            let key = String(date.prefix(10))
            lowest[key] = min(lowest[key] ?? price, price)
        }
        return lowest.keys.sorted().map { IumrahFlightPriceDay(id: $0, price: lowest[$0]!) }
    }
}

/// Continuous calendar rail. Unknown fares remain nil, never zero or interpolated.
enum IumrahFareDateWindow {
    struct Day: Equatable { let day: String; let price: Double? }
    static func items(prices: [IumrahFlightPriceDay], selected: String?, minimum: String?, now: Date = Date()) -> [Day] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let formatter = DateFormatter(); formatter.calendar = calendar; formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = calendar.timeZone; formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
        func date(_ key: String?) -> Date? {
            guard let key, key.count == 10, let parsed = formatter.date(from: key), formatter.string(from: parsed) == key else { return nil }
            return parsed
        }
        // Use the user's calendar date, not UTC midnight, for the default lower bound.
        let local = DateFormatter(); local.calendar = Calendar(identifier: .gregorian); local.locale = Locale(identifier: "en_US_POSIX"); local.dateFormat = "yyyy-MM-dd"
        let today = date(local.string(from: now)) ?? calendar.startOfDay(for: now)
        let floor = max(today, date(minimum) ?? today)
        var observed: [String: Double] = [:]
        for value in prices where value.price.isFinite && value.price > 0 {
            guard let day = date(value.id), day >= floor else { continue }
            observed[value.id] = min(observed[value.id] ?? value.price, value.price)
        }
        let firstObserved = observed.keys.sorted().first.flatMap { date($0) }
        let anchor = max(floor, date(selected) ?? firstObserved ?? floor)
        let start = max(floor, calendar.date(byAdding: .day, value: -14, to: anchor) ?? anchor)
        let end = calendar.date(byAdding: .day, value: 14, to: anchor) ?? anchor
        let count = max(0, calendar.dateComponents([.day], from: start, to: end).day ?? 0)
        return (0...count).compactMap { offset in
            guard let day = calendar.date(byAdding: .day, value: offset, to: start) else { return nil }
            let key = formatter.string(from: day)
            return Day(day: key, price: observed[key])
        }
    }
}

/// Native horizontal scrolling, center snapping and a single commit after scrolling stops.
/// The selected day remains represented even when no fare has been received for it.
private struct IumrahCenteredFareChart: UIViewRepresentable {
    let days: [IumrahFlightPriceDay]
    let selectedDay: String?
    let minimumDay: String?
    let locale: Locale
    let noPriceLabel: String
    let onSelect: (String) -> Void

    struct Item: Equatable {
        let day: String
        let price: Double?
    }
    final class Rail: UICollectionView {
        var onResize: (() -> Void)?
        private var previousWidth: CGFloat = 0
        override func layoutSubviews() {
            super.layoutSubviews()
            guard bounds.width > 0, abs(previousWidth - bounds.width) > 0.5 else { return }
            previousWidth = bounds.width
            let inset = max(0, (bounds.width - 64) / 2)
            contentInset = UIEdgeInsets(top: 0, left: inset, bottom: 0, right: inset)
            onResize?()
        }
    }
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> Rail {
        let layout = UICollectionViewFlowLayout()
        layout.scrollDirection = .horizontal
        layout.itemSize = CGSize(width: 64, height: 110)
        layout.minimumLineSpacing = 8
        let view = Rail(frame: .zero, collectionViewLayout: layout)
        view.backgroundColor = .clear
        view.contentInsetAdjustmentBehavior = .never
        view.showsHorizontalScrollIndicator = false
        view.decelerationRate = .fast
        view.alwaysBounceHorizontal = false
        view.register(UICollectionViewCell.self, forCellWithReuseIdentifier: "fare")
        view.dataSource = context.coordinator
        view.delegate = context.coordinator
        view.onResize = { [weak coordinator = context.coordinator, weak view] in
            guard let view else { return }; coordinator?.align(view)
        }
        return view
    }
    func updateUIView(_ view: Rail, context: Context) { context.coordinator.update(self, view) }
    static func dismantleUIView(_ view: Rail, coordinator: Coordinator) {
        view.onResize = nil; view.delegate = nil; view.dataSource = nil
    }

    final class Coordinator: NSObject, UICollectionViewDataSource, UICollectionViewDelegate {
        private var parent: IumrahCenteredFareChart
        private var deferredParent: IumrahCenteredFareChart?
        private var items: [Item] = []
        private var lastBuiltDay: Date?
        private var maxPrice: Double = 1
        private var focus = 0
        private var committedDay: String?
        private var userScrolling = false
        private var pendingTap = false
        private var isAligning = false
        private let feedback = UISelectionFeedbackGenerator()
        private let stride: CGFloat = 72
        init(_ parent: IumrahCenteredFareChart) { self.parent = parent }

        func update(_ next: IumrahCenteredFareChart, _ view: Rail) {
            if userScrolling || pendingTap { deferredParent = next; return }
            deferredParent = nil
            let selectionChanged = parent.selectedDay != next.selectedDay
            let localeChanged = parent.locale != next.locale || parent.noPriceLabel != next.noPriceLabel
            let oldDay = items.indices.contains(focus) ? items[focus].day : nil
            let today = Calendar.current.startOfDay(for: Date())
            let needsRebuild = lastBuiltDay != today || parent.days != next.days || parent.minimumDay != next.minimumDay || selectionChanged || localeChanged
            parent = next // Always retain the current callback, even when data is unchanged.
            guard needsRebuild else { return }
            lastBuiltDay = today
            let newItems = IumrahFareDateWindow.items(prices: next.days, selected: next.selectedDay ?? oldDay, minimum: next.minimumDay)
                .map { Item(day: $0.day, price: $0.price) }
            let changed = newItems != items || localeChanged
            if changed || selectionChanged {
                let oldFocus = items.indices.contains(focus) ? items[focus].day : nil
                items = newItems
                maxPrice = max(items.compactMap(\.price).max() ?? 1, 1)
                committedDay = next.selectedDay
                focus = items.firstIndex(where: { $0.day == (next.selectedDay ?? oldFocus) }) ?? items.firstIndex(where: { $0.price != nil }) ?? 0
                if changed { view.reloadData() }
                align(view)
                refresh(view)
            }
        }
        func align(_ view: UICollectionView) {
            guard !items.isEmpty, view.bounds.width > 0, !userScrolling else { return }
            isAligning = true
            view.layoutIfNeeded()
            view.setContentOffset(CGPoint(x: CGFloat(focus) * stride - view.contentInset.left, y: 0), animated: false)
            isAligning = false
        }
        func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { items.count }
        func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
            let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "fare", for: indexPath)
            configure(cell, at: indexPath.item)
            return cell
        }
        private func configure(_ cell: UICollectionViewCell, at index: Int) {
            guard items.indices.contains(index) else { return }
            let item = items[index]
            let selected = focus == index
            let barHeight = item.price.map { max(10, 55 * $0 / maxPrice) } ?? 3
            let date = IumrahFlightClock.day(item.day, locale: parent.locale)
            let price = item.price.map { "$" + $0.formatted(.number.precision(.fractionLength(0))) } ?? "—"
            cell.contentConfiguration = UIHostingConfiguration {
                VStack(spacing: 5) {
                    Spacer(minLength: 0)
                    Text(price).font(IumrahType.bold(12)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.65)
                    RoundedRectangle(cornerRadius: 5).fill(item.price == nil ? Color.primary.opacity(selected ? 0.55 : 0.12) : (selected ? Color.primary : IumrahFlightPalette.bar))
                        .frame(width: 40, height: CGFloat(barHeight))
                    Text(date).font(selected ? IumrahType.bold(11) : IumrahType.regular(11)).lineLimit(1).minimumScaleFactor(0.75)
                    Capsule().fill(selected ? Color.primary : Color.clear).frame(width: 14, height: 2)
                }
                .foregroundStyle(selected ? Color.primary : Color.secondary)
                .frame(width: 64, height: 106)
                .accessibilityHidden(true)
            }.margins(.all, 0)
            cell.isAccessibilityElement = true
            cell.accessibilityLabel = "\(date), \(item.price == nil ? parent.noPriceLabel : price)"
            cell.accessibilityTraits = selected ? [.button, .selected] : [.button]
        }
        private func refresh(_ view: UICollectionView) {
            for cell in view.visibleCells {
                if let index = view.indexPath(for: cell)?.item { configure(cell, at: index) }
            }
        }
        private func index(at offset: CGFloat, in view: UIScrollView) -> Int {
            min(max(Int(((offset + view.contentInset.left) / stride).rounded()), 0), max(items.count - 1, 0))
        }
        private func moveFocus(_ index: Int, in view: UICollectionView, haptic: Bool) {
            guard items.indices.contains(index), focus != index else { return }
            let previous = focus
            focus = index
            if haptic { feedback.selectionChanged(); feedback.prepare() }
            for changed in [previous, index] {
                if let cell = view.cellForItem(at: IndexPath(item: changed, section: 0)) { configure(cell, at: changed) }
            }
        }
        func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
            pendingTap = false; userScrolling = true; feedback.prepare()
        }
        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            guard userScrolling, !isAligning, let view = scrollView as? UICollectionView else { return }
            moveFocus(index(at: view.contentOffset.x, in: view), in: view, haptic: true)
        }
        func scrollViewWillEndDragging(_ scrollView: UIScrollView, withVelocity velocity: CGPoint, targetContentOffset: UnsafeMutablePointer<CGPoint>) {
            let target = index(at: targetContentOffset.pointee.x, in: scrollView)
            targetContentOffset.pointee.x = CGFloat(target) * stride - scrollView.contentInset.left
        }
        func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
            if !decelerate { finish(scrollView) }
        }
        func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { finish(scrollView) }
        func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) {
            if pendingTap {
                pendingTap = false
                if let view = scrollView as? Rail { commit(in: view) }
            } else { finish(scrollView) }
        }
        func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
            collectionView.deselectItem(at: indexPath, animated: false)
            guard items.indices.contains(indexPath.item) else { return }
            userScrolling = false
            feedback.prepare()
            if focus == indexPath.item { feedback.selectionChanged() }
            moveFocus(indexPath.item, in: collectionView, haptic: true)
            let x = CGFloat(focus) * stride - collectionView.contentInset.left
            if abs(collectionView.contentOffset.x - x) > 0.5 {
                pendingTap = true
                collectionView.setContentOffset(CGPoint(x: x, y: 0), animated: true)
            } else if let view = collectionView as? Rail { commit(in: view) }
        }
        private func finish(_ scrollView: UIScrollView) {
            guard userScrolling, let view = scrollView as? UICollectionView else { return }
            moveFocus(index(at: view.contentOffset.x, in: view), in: view, haptic: true)
            userScrolling = false
            align(view)
            if let rail = view as? Rail { commit(in: rail) }
        }
        private func commit(in view: Rail) {
            guard items.indices.contains(focus) else { return }
            let day = items[focus].day
            let deferred = deferredParent
            deferredParent = nil
            if day != committedDay {
                committedDay = day
                // The next SwiftUI update supplies the newly committed date.
                (deferred ?? parent).onSelect(day)
            } else if let deferred {
                update(deferred, view)
            }
        }
    }
}
