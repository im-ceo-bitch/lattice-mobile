import SwiftUI
import UIKit

/// Shared native hero and airport / aircraft sections. Used by search, package
/// selection and booked-flight details. No invented fare or telemetry fields.
struct IumrahPremiumFlightDetail: View {
    let leg: IumrahPremiumFlightLeg
    let language: AppSettingsStore.Language
    /// Outer page gutter to cancel for the first segment only; embedded legs stay cards.
    var pageHeroInset: CGFloat? = nil
    var headerShareText: String? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var details: IumrahFlightOperationalDetail?
    @State private var from: Airport?
    @State private var to: Airport?
    @State private var refreshing = false
    @State private var hasLoadedDetail = false
    @State private var enrichmentReason: String?
    @Environment(\.scenePhase) private var scenePhase

    private func t(_ ru: String, _ en: String, _ uz: String, _ cy: String) -> String {
        switch language { case .russian: return ru; case .uzbek: return uz; case .uzbekCyrillic: return cy; default: return en }
    }
    private let graphite = IumrahFlightPalette.hero
    private var live: Bool { ["EnRoute", "Approaching", "Departed"].contains(details?.status ?? "") }
    private var livePosition: IumrahFlightOperationalDetail.Position? {
        guard live, let p = details?.position, let date = IumrahPremiumFlightLeg.instant(p.reportedAt), Date().timeIntervalSince(date) < 900, Date().timeIntervalSince(date) > -60 else { return nil }
        return p
    }
    private var status: String? {
        switch details?.status {
        case "Expected": return t("По расписанию", "Scheduled", "Jadval bo‘yicha", "Жадвал бўйича")
        case "EnRoute": return t("В полёте", "In flight", "Parvozda", "Парвозда")
        case "Departed": return t("Вылетел", "Departed", "Jo‘nadi", "Жўнади")
        case "Approaching": return t("На подлёте", "Approaching", "Yetib kelmoqda", "Етиб келмоқда")
        case "CheckIn": return t("Регистрация", "Check-in", "Ro‘yxatdan o‘tish", "Рўйхатдан ўтиш")
        case "Boarding": return t("Посадка", "Boarding", "Samolyotga chiqish", "Самолётга чиқиш")
        case "GateClosed": return t("Посадка завершена", "Gate closed", "Chiqish yopildi", "Чиқиш ёпилди")
        case "Delayed": return t("Задержан", "Delayed", "Kechikmoqda", "Кечикмоқда")
        case "Arrived": return t("Прибыл", "Arrived", "Yetib keldi", "Етиб келди")
        case "Canceled": return t("Отменён", "Canceled", "Bekor qilindi", "Бекор қилинди")
        case "Diverted": return t("Маршрут изменён", "Diverted", "Yo‘nalish o‘zgardi", "Йўналиш ўзгарди")
        case "CanceledUncertain": return t("Возможна отмена", "Possible cancellation", "Bekor qilinishi mumkin", "Бекор қилиниши мумкин")
        default: return nil
        }
    }
    private var statusColor: Color {
        if live || details?.status == "Arrived" { return .green }
        if ["Canceled", "Diverted", "Delayed", "CanceledUncertain"].contains(details?.status ?? "") { return .orange }
        return Color.white.opacity(0.8)
    }
    private var route: IumrahFlightGlobeRoute? {
        guard leg.stops == 0, let a = from ?? bundled(leg.origin), let b = to ?? bundled(leg.destination) else { return nil }
        return .init(from: a, to: b, position: livePosition)
    }
    private func bundled(_ code: String) -> Airport? { AirportMapBootstrapCatalog.airports.first { $0.iata == code.uppercased() } }
    private func city(_ code: String, airport: Airport?) -> String { airport?.city ?? FlightReferenceCatalog.airport(code)?.city ?? code }
    private func dateLabel(_ day: String) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(secondsFromGMT: 0); f.dateFormat = "yyyy-MM-dd"
        guard let date = f.date(from: day) else { return day }
        f.locale = Locale(identifier: language.localeIdentifier); f.setLocalizedDateFormatFromTemplate("d MMM EEE"); return f.string(from: date)
    }
    private func durationText(_ minutes: Int) -> String {
        if minutes % 60 == 0 { return t("\(minutes / 60) ч", "\(minutes / 60)h", "\(minutes / 60) soat", "\(minutes / 60) соат") }
        if minutes < 60 { return t("\(minutes) мин", "\(minutes)m", "\(minutes) daq", "\(minutes) дақ") }
        return t("\(minutes / 60) ч \(minutes % 60) мин", "\(minutes / 60)h \(minutes % 60)m", "\(minutes / 60) soat \(minutes % 60) daq", "\(minutes / 60) соат \(minutes % 60) дақ")
    }
    private func clean(_ value: String?) -> String? { guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }; return value }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if live { TimelineView(.periodic(from: .now, by: 60)) { _ in hero } } else { hero }
            if live { TimelineView(.periodic(from: .now, by: 60)) { _ in if let p = livePosition { liveMetrics(p).iumrahFlightCard() } } }
            airportSection
            if clean(details?.aircraft) != nil || clean(leg.aircraft) != nil || clean(details?.registration) != nil || clean(leg.cabin) != nil || otherCarrier != nil { aircraftSection }
            if leg.verifiedNumber != nil && leg.stops == 0 { enrichmentFooter }

        }
        .task(id: leg) { await load() }
    }
    private var hero: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 13) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    if let number = leg.verifiedNumber, leg.stops == 0 {
                        Text(number).font(IumrahType.bold(29, relativeTo: .title)).lineLimit(1).minimumScaleFactor(0.75)
                    } else {
                        Text(leg.title).font(IumrahType.bold(20, relativeTo: .title2)).lineLimit(2)
                    }
                    Spacer(minLength: 4)
                    if let status { Text(status).font(IumrahType.bold(12, relativeTo: .caption)).foregroundStyle(statusColor).multilineTextAlignment(.trailing) }
                }.foregroundStyle(.white)
                HStack(alignment: .top, spacing: 6) {
                    endpoint(leg.origin, raw: departureDisplay, trailing: false)
                    VStack(spacing: 5) {
                        Image(systemName: leg.stops == 0 ? "airplane" : "arrow.triangle.branch")
                            .font(.system(size: 24, weight: .medium)).foregroundStyle(livePosition == nil ? Color.white : Color.green)
                            .accessibilityHidden(true)
                        if displayDuration > 0 { Text(durationText(displayDuration)).font(IumrahType.regular(12, relativeTo: .caption)).foregroundStyle(.white.opacity(0.82)).lineLimit(1).minimumScaleFactor(0.7) }
                        if leg.stops >= 0 { Text(leg.stops == 0 ? t("Прямой", "Direct", "To‘g‘ri", "Тўғри") : t("Пересадок: \(leg.stops)", "Stops: \(leg.stops)", "Ulanish: \(leg.stops)", "Уланиш: \(leg.stops)")).font(IumrahType.regular(11, relativeTo: .caption2)).foregroundStyle(.white.opacity(0.76)).lineLimit(2).multilineTextAlignment(.center) }
                    }.frame(maxWidth: .infinity).padding(.top, 6)
                    endpoint(leg.destination, raw: arrivalDisplay, trailing: true, estimated: arrivalEstimated)
                }
            }.padding(.horizontal, 20).padding(.top, pageHeroInset == nil ? 18 : 12).padding(.bottom, 10)
            globe
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(graphite)
        .clipShape(RoundedRectangle(cornerRadius: pageHeroInset == nil ? 22 : 0, style: .continuous))
        .padding(.horizontal, -(pageHeroInset ?? 0))
        .environment(\.colorScheme, .dark)
    }
    private var departureDisplay: String? { clean(details?.departureScheduled) ?? clean(leg.departure) }
    private var displayDuration: Int {
        if let a = IumrahPremiumFlightLeg.instant(details?.departureScheduled), let b = IumrahPremiumFlightLeg.instant(details?.arrivalScheduled), b > a { return Int(b.timeIntervalSince(a) / 60) }
        return leg.effectiveDuration
    }
    private var enrichmentMessage: String {
        if details != nil { return "AeroDataBox" + (IumrahPremiumFlightLeg.instant(details?.updatedAt).map { " · " + $0.formatted(.dateTime.day().month().hour().minute()) } ?? "") }
        switch enrichmentReason {
        case "no_match": return t("Дополнительное расписание ещё не опубликовано", "Additional schedule not published yet", "Qo‘shimcha jadval hali e’lon qilinmagan", "Қўшимча жадвал ҳали эълон қилинмаган")
        case "quota_exhausted", "provider_quota": return t("Лимит обновлений исчерпан", "Flight update limit reached", "Yangilash limiti tugadi", "Янгилаш лимити тугади")
        case "not_configured", "http_404", "http_503": return t("Сервис данных рейса недоступен", "Flight data service unavailable", "Reys ma’lumotlari xizmati mavjud emas", "Рейс маълумотлари хизмати мавжуд эмас")
        default: return t("Не удалось обновить данные рейса", "Could not update flight data", "Reys ma’lumotlarini yangilab bo‘lmadi", "Рейс маълумотларини янгилаб бўлмади")
        }
    }
    private var enrichmentFooter: some View {
        HStack(alignment: .center, spacing: 10) {
            if refreshing || !hasLoadedDetail {
                ProgressView().controlSize(.small)
                Text(t("Обновляем расписание", "Updating schedule", "Jadval yangilanmoqda", "Жадвал янгиланмоқда"))
            } else {
                Image(systemName: details != nil ? "checkmark.circle" : "info.circle").accessibilityHidden(true)
                Text(enrichmentMessage).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 4)
            if hasLoadedDetail && !refreshing && enrichmentReason != "quota_exhausted" && enrichmentReason != "provider_quota" {
                Button { Task { await refreshOperational() } } label: {
                    Image(systemName: "arrow.clockwise").font(.system(size: 15, weight: .medium)).frame(width: 44, height: 44)
                }.buttonStyle(.plain).accessibilityLabel(t("Обновить", "Refresh", "Yangilash", "Янгилаш"))
            }
        }.font(IumrahType.regular(12, relativeTo: .caption)).foregroundStyle(.secondary)
    }
    private var arrivalEstimate: IumrahFlightClock.Arrival? {
        guard clean(leg.arrival) == nil, details?.arrivalScheduled == nil, IumrahPremiumFlightLeg.localParts(leg.departure, code: leg.origin) != nil, leg.stops == 0 else { return nil }
        return IumrahFlightClock.arrival(actual: nil, departure: leg.departure, duration: leg.effectiveDuration, origin: leg.origin, destination: leg.destination)
    }
    private var arrivalDisplay: String? {
        if let raw = clean(details?.arrivalScheduled) { return raw }
        if let raw = clean(leg.arrival) { return raw }
        return arrivalEstimate.map { $0.day + "T" + $0.time }
    }
    private var arrivalEstimated: Bool { arrivalEstimate != nil }
    private func endpoint(_ code: String, raw: String?, trailing: Bool, estimated: Bool = false) -> some View {
        VStack(alignment: trailing ? .trailing : .leading, spacing: 4) {
            Text(code).font(IumrahType.bold(38, relativeTo: .largeTitle)).minimumScaleFactor(0.65).lineLimit(1).foregroundStyle(.white)
            if let local = IumrahPremiumFlightLeg.localParts(raw, code: code) {
                Text(local.time).font(IumrahType.bold(30, relativeTo: .title2)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7).foregroundStyle(.white)
                if estimated { Text(t("Расчётное", "Estimated", "Hisoblangan", "Ҳисобланган")).font(IumrahType.regular(10, relativeTo: .caption2)).foregroundStyle(.white.opacity(0.78)) }
            }
        }.frame(maxWidth: .infinity, alignment: trailing ? .trailing : .leading)
    }
    private var globe: some View {
        GeometryReader { proxy in
            let diameter = min(max(1, proxy.size.width - 32), 324)
            let visibleHeight = proxy.size.height
            let cropOffset = livePosition == nil ? 0 : diameter * 0.22
            ZStack(alignment: .top) {
                IumrahHemisphereMap(projection: route?.projection ?? .arabia,
                    presentation: .globe, palette: .dark, isAnimating: false,
                    lightIntensity: 0.88, mapOpacity: 1)
                    .frame(width: diameter, height: diameter)
                    .offset(y: -cropOffset)
                if let route, livePosition != nil {
                    // Place the live overlay on the same projected sphere, not on the clipped viewport.
                    routeOverlay(route)
                        .frame(width: diameter, height: diameter)
                        .offset(y: -cropOffset)
                }
            }
            .frame(width: proxy.size.width, height: visibleHeight, alignment: .top)
        }
        .frame(height: 142)
        .clipped()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
    private func routeOverlay(_ route: IumrahFlightGlobeRoute) -> some View {
        Canvas { context, size in
            let d = min(size.width, size.height), x = (size.width-d)/2, y = (size.height-d)/2
            func point(_ p: CGPoint) -> CGPoint { CGPoint(x: x+p.x*d, y: y+p.y*d) }
            func line(_ points: ArraySlice<CGPoint>) -> Path { Path { path in if let first = points.first { path.move(to: point(first)); for item in points.dropFirst() { path.addLine(to: point(item)) } } } }
            context.stroke(line(route.points[...]), with: .color(.white.opacity(0.85)), style: StrokeStyle(lineWidth: 1.6, lineCap: .round, dash: [4, 4]))
            if let index = route.progressIndex, route.livePoint != nil {
                context.stroke(line(route.points[...index]), with: .color(.green), style: StrokeStyle(lineWidth: 2.3, lineCap: .round))
            }
            for (p, label) in [(route.points.first, leg.origin), (route.points.last, leg.destination)] {
                guard let p else { continue }; let q = point(p)
                context.fill(Path(ellipseIn: CGRect(x: q.x-3.5, y: q.y-3.5, width: 7, height: 7)), with: .color(.white))
                context.draw(Text(label).font(.system(size: 10, weight: .semibold)).foregroundColor(.white), at: CGPoint(x: q.x, y: q.y + (label == leg.origin ? -14 : 14)))
            }
            if let p = route.livePoint {
                let q = point(p)
                context.draw(Text(Image(systemName: "airplane.circle.fill")).font(.system(size: 17)).foregroundColor(.green), at: q)
            }
        }.allowsHitTesting(false)
    }
    private func liveMetrics(_ p: IumrahFlightOperationalDetail.Position) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                if let altitude = p.altitudeFeet, altitude.isFinite, abs(altitude) < 100_000 { metric(t("Высота", "Altitude", "Balandlik", "Баландлик"), "\(Int(altitude.rounded())) ft") }
                if let speed = p.speedKmh, speed.isFinite, speed >= 0, speed < 3000 { metric(t("Скорость", "Ground speed", "Tezlik", "Тезлик"), "\(Int(speed.rounded())) km/h") }
                if let arrival = IumrahPremiumFlightLeg.instant(details?.arrivalEstimatedUTC), arrival > Date() { metric(t("До прилёта", "Until arrival", "Yetib kelishgacha", "Етиб келишгача"), durationText(Int(arrival.timeIntervalSinceNow / 60))) }
            }
            if let date = IumrahPremiumFlightLeg.instant(p.reportedAt) { Text(t("Позиция на ", "Position at ", "Joylashuv vaqti ", "Жойлашув вақти ") + date.formatted(.dateTime.hour().minute()) + " · " + t("Прогресс ориентировочный", "Approximate progress", "Taxminiy jarayon", "Тахминий жараён")).font(IumrahType.regular(10, relativeTo: .caption2)).foregroundStyle(.secondary) }
        }
    }
    private func metric(_ title: String, _ value: String) -> some View { VStack(alignment: .leading, spacing: 3) { Text(title).font(IumrahType.regular(11)).foregroundStyle(.secondary); Text(value).font(IumrahType.bold(17)).foregroundStyle(.primary).minimumScaleFactor(0.7) }.frame(maxWidth: .infinity, alignment: .leading) }
    private var airportSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(t("Маршрут перелёта", "Flight itinerary", "Parvoz yo‘nalishi", "Парвоз йўналиши")).font(IumrahType.bold(20, relativeTo: .title2))
            airportRow(code: leg.origin, raw: departureDisplay, airport: from ?? bundled(leg.origin), title: t("Вылет", "Departure", "Jo‘nash", "Жўнаш"), icon: "airplane.departure", terminal: details?.departureTerminal ?? leg.departureTerminal, gate: details?.departureGate, revised: details?.departureRevised, actual: details?.departureActual)
            Divider().padding(.leading, 38)
            airportRow(code: leg.destination, raw: arrivalDisplay, airport: to ?? bundled(leg.destination), title: t("Прилёт", "Arrival", "Yetib kelish", "Етиб келиш"), icon: "airplane.arrival", terminal: details?.arrivalTerminal ?? leg.arrivalTerminal, gate: details?.arrivalGate, revised: details?.arrivalRevised, actual: details?.arrivalActual)
            if let belt = clean(details?.baggageBelt) { Divider(); fact(t("Лента багажа", "Baggage belt", "Bagaj lentasi", "Багаж лентаси"), belt) }
        }.iumrahFlightCard()
    }
    private func airportRow(code: String, raw: String?, airport: Airport?, title: String, icon: String, terminal: String?, gate: String?, revised: String?, actual: String?) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).font(.system(size: 16, weight: .medium))
                .frame(width: 30, height: 30).background(IumrahFlightPalette.raised, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(title).font(IumrahType.regular(12, relativeTo: .caption)).foregroundStyle(.secondary)
                    Spacer(minLength: 4)
                    if let local = IumrahPremiumFlightLeg.localParts(raw, code: code) {
                        Text(dateLabel(local.day)).font(IumrahType.regular(12, relativeTo: .caption)).foregroundStyle(.secondary)
                    } else if let raw, raw.count == 10 { Text(dateLabel(raw)).font(IumrahType.regular(12, relativeTo: .caption)).foregroundStyle(.secondary) }
                }
                Text(city(code, airport: airport)).font(IumrahType.bold(18, relativeTo: .headline))
                if let name = airport?.name ?? FlightReferenceCatalog.airport(code)?.name { Text(name).font(IumrahType.regular(13, relativeTo: .subheadline)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                if let terminal = clean(terminal) { fact(t("Терминал", "Terminal", "Terminal", "Терминал"), terminal) }
                if let gate = clean(gate) { fact(t("Выход", "Gate", "Chiqish", "Чиқиш"), gate) }
                if let actual = clean(actual), let time = IumrahPremiumFlightLeg.localParts(actual, code: code) { fact(t("Фактическое время ВПП", "Actual runway time", "Haqiqiy uchish vaqti", "Ҳақиқий учиш вақти"), dateLabel(time.day) + " · " + time.time) }
                else if let revised = clean(revised), let time = IumrahPremiumFlightLeg.localParts(revised, code: code) { fact(t("Обновлённое время", "Revised time", "Yangilangan vaqt", "Янгиланган вақт"), dateLabel(time.day) + " · " + time.time) }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }
    private var otherCarrier: String? {
        guard let carrier = clean(leg.operatingCarrier), carrier.caseInsensitiveCompare(leg.title) != .orderedSame else { return nil }
        return carrier
    }
    private var aircraftSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(t("Самолёт и класс", "Aircraft & cabin", "Samolyot va klass", "Самолёт ва класс")).font(IumrahType.bold(19))
            if let model = clean(details?.aircraft) ?? clean(leg.aircraft) { fact(t("Самолёт", "Aircraft", "Samolyot", "Самолёт"), model) }
            if let reg = clean(details?.registration) { fact(t("Бортовой номер", "Registration", "Bort raqami", "Борт рақами"), reg) }
            if let cabin = clean(leg.cabin) { fact(t("Класс", "Cabin", "Klass", "Класс"), cabin.capitalized) }
            if let carrier = otherCarrier { fact(t("Выполняет рейс", "Operated by", "Parvoz operatori", "Парвоз оператори"), carrier) }
        }.iumrahFlightCard()
    }
    private func fact(_ title: String, _ value: String) -> some View { HStack(alignment: .firstTextBaseline) { Text(title).font(IumrahType.regular(13)).foregroundStyle(.secondary); Spacer(minLength: 10); Text(value).font(IumrahType.bold(13)).multilineTextAlignment(.trailing) } }
    @MainActor private func load() async {
        details = nil; enrichmentReason = nil; hasLoadedDetail = false; from = bundled(leg.origin); to = bundled(leg.destination)
        async let origin = resolve(leg.origin, existing: from)
        async let destination = resolve(leg.destination, existing: to)
        refreshing = true
        let result = await fetchDetail()
        guard !Task.isCancelled else { refreshing = false; return }
        details = result.detail; enrichmentReason = result.reason; refreshing = false; hasLoadedDetail = true
        let (a, b) = await (origin, destination)
        guard !Task.isCancelled else { return }
        from = a; to = b
        // No timer polling by default: avoid consuming provider quota. The
        // user can explicitly refresh the operational data on this screen.
    }
    @MainActor private func refreshOperational() async {
        guard !refreshing else { return }; refreshing = true; defer { refreshing = false }
        let result = await fetchDetail(force: true)
        guard !Task.isCancelled else { return }
        if let new = result.detail { details = new }
        enrichmentReason = result.reason; hasLoadedDetail = true
    }
    private func resolve(_ code: String, existing: Airport?) async -> Airport? {
        if let existing { return existing }
        guard let airports = try? await AirportSearchService().search(code, limit: 4) else { return nil }
        return airports.first { $0.iata.uppercased() == code.uppercased() }
    }
    private func fetchDetail(force: Bool = false) async -> IumrahFlightDetailResult {
        guard leg.stops == 0, let number = leg.verifiedNumber, let local = IumrahPremiumFlightLeg.localParts(leg.departure, code: leg.origin) else { return .init(detail: nil, reason: "invalid_request") }
        return await IumrahFlightDetailService.shared.detail(number: number, day: local.day, time: local.time, origin: leg.origin.uppercased(), destination: leg.destination.uppercased(), force: force)
    }
}

/// Only show connections whose adjacent segments and timestamps are verified.
struct IumrahPremiumFlightConnection: View {
    let previous: IumrahPremiumFlightLeg
    let next: IumrahPremiumFlightLeg
    let language: AppSettingsStore.Language
    var body: some View {
        if previous.destination.uppercased() == next.origin.uppercased(),
           let arrival = IumrahPremiumFlightLeg.instant(previous.arrival),
           let departure = IumrahPremiumFlightLeg.instant(next.departure), departure >= arrival {
            let minutes = Int(departure.timeIntervalSince(arrival) / 60)
            HStack(spacing: 10) {
                Image(systemName: "clock").foregroundStyle(.secondary)
                Text(title + " · " + next.origin).font(IumrahType.bold(14))
                Spacer()
                Text("\(minutes / 60)h \(minutes % 60)m").font(IumrahType.regular(13)).foregroundStyle(.secondary)
            }.iumrahFlightCard()
        }
    }
    private var title: String {
        switch language { case .russian: return "Пересадка"; case .uzbek: return "Ulanish"; case .uzbekCyrillic: return "Уланиш"; default: return "Connection" }
    }
}


/// Flight-only palette: explicit neutral RGB values, not iOS grouped (blue-gray) surfaces.
enum IumrahFlightPalette {
    static let hero = Color(white: 0.065)
    static let page = adaptive(light: 0.95, dark: 0.045)
    static let card = adaptive(light: 1, dark: 0.105)
    static let raised = adaptive(light: 0.90, dark: 0.17)
    static let bar = adaptive(light: 0.75, dark: 0.36)
    private static func adaptive(light: CGFloat, dark: CGFloat) -> Color {
        Color(uiColor: UIColor { traits in UIColor(white: traits.userInterfaceStyle == .dark ? dark : light, alpha: 1) })
    }
}

extension View {
    func iumrahFlightCard() -> some View {
        self.frame(maxWidth: .infinity, alignment: .leading)
            .padding(17)
            .background(IumrahFlightPalette.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Color.primary.opacity(0.07), lineWidth: 0.75) }
    }

    /// Native system back and trailing toolbar actions for every flight detail destination.
    func iumrahFlightDetailChrome(title: String, shareText: String) -> some View {
        modifier(IumrahFlightDetailChromeModifier(title: title, shareText: shareText))
    }
}

private struct IumrahFlightDetailChromeModifier: ViewModifier {
    @EnvironmentObject private var chrome: AppChromeStore
    let title: String
    let shareText: String
    @State private var registered = false
    func body(content: Content) -> some View {
        content
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .toolbarBackground(Color.iumrahSignatureBlack, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar(.hidden, for: .tabBar)
            .navigationBarBackButtonHidden(false)
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    ShareLink(item: shareText) { Image(systemName: "square.and.arrow.up") }
                    IumrahPageHelpButton(inSystemToolbar: true)
                }
            }
            .modifier(IumrahHelpOverlayHost(enabled: true, explicitContext: IumrahHelpContext(key: "flights.details")))
            .background(IumrahFlightPalette.hero, ignoresSafeAreaEdges: .top)
            .background(GeneratorInteractivePopRestorer().frame(width: 0, height: 0))
            .onAppear {
                guard !registered else { return }
                registered = true; chrome.beginInternalNavigation()
            }
            .onDisappear {
                guard registered else { return }
                registered = false; chrome.endInternalNavigation()
            }
    }
}
