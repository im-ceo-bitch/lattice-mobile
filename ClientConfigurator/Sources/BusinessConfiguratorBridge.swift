import SwiftUI
import Foundation

/// Only immutable, public catalogue/quote information crosses the module boundary.
/// Staff authentication, financial overrides and submission never enter the client module.
public struct BusinessConfiguratorSnapshot: Hashable {
    public struct Leg: Hashable {
        public let airline, flightNumber, airlineCode, origin, destination, departureAt, arrivalAt, cabinClass: String
        public let durationMinutes: Int
    }
    public struct Flight: Hashable {
        public let id, source: String
        public let legs: [Leg]
    }
    public struct Stay: Hashable {
        public let id, name, room, meals: String
        public let imageURL: String?
        public let stars: Int?
        public let checkIn, checkOut: Date
        public let rooms: Int
    }
    public let quoteID: String
    public let adults, children, infants: Int
    public let tier: String
    public let outbound, inbound: Flight
    public let makkah: Stay
    public let madinah: Stay?
    public let vehicle: String
    public let pickup: Date
    public let guideID, guideName: String?
    public let haramain: Bool
    public let amounts: [String: Double]
    public let originalTotal: Double
    public let originalSubtotal: Double
    public let unsupported: [String]

    @MainActor static func make(journey: JourneyStore, price: TripSummaryPublicPrice?) -> Self? {
        guard journey.hasFinalGeneratorQuote, journey.tripSummaryRoomAlternatives.isEmpty,
              let quote = journey.quote, quote.bookingAllowed == true, let price,
              price == quote.tripSummary, price.reconciles(with: quote.totalPackagePrice),
              let quoteID = quote.quoteId, let out = journey.selectedOutbound,
              let back = journey.selectedInbound, let vehicle = journey.selectedTransferVehicle,
              journey.transferSelectionConfirmed, vehicle.passengerCapacity >= journey.trip.travelerCount,
              journey.localRoomsComplete else { return nil }
        var issues: [String] = []
        let iso = ISO8601DateFormatter()
        let saudiDay = DateFormatter()
        saudiDay.calendar = Calendar(identifier: .gregorian)
        saudiDay.locale = Locale(identifier: "en_US_POSIX")
        saudiDay.timeZone = TimeZone(identifier: "Asia/Riyadh")
        saudiDay.dateFormat = "yyyy-MM-dd"
        func flight(_ offer: FlightOffer) -> Flight {
            let segments = offer.displaySegments
            if segments.count != offer.stops + 1 { issues.append("Не получены все сегменты перелёта \(offer.flightNumber).") }
            return Flight(id: offer.id, source: offer.sourceLabel, legs: segments.map { segment in
                Leg(airline: segment.airline, flightNumber: segment.flightNumber, airlineCode: segment.airlineCode ?? offer.airlineCode ?? "", origin: segment.origin.code,
                    destination: segment.destination.code, departureAt: iso.string(from: segment.departureAt), arrivalAt: iso.string(from: segment.arrivalAt),
                    cabinClass: segment.cabin ?? offer.cabinClass ?? "unknown", durationMinutes: segment.durationMinutes)
            })
        }
        func meals(_ choices: HotelMealChoices) -> String {
            let labels = [(choices.breakfast,"Завтрак"),(choices.lunch,"Обед"),(choices.dinner,"Ужин")].filter { $0.0 }.map { $0.1 }
            return labels.isEmpty ? "Без питания" : labels.joined(separator: " + ")
        }
        func stay(_ city: String, _ window: TripStayWindow) -> Stay? {
            let rooms = journey.localJourneyRooms.values.filter { $0.city == city }.sorted { $0.id < $1.id }
            if let first = rooms.first {
                guard rooms.count == journey.trip.rooms, rooms.allSatisfy({ $0.hotel.id == first.hotel.id && $0.requiresRateRefresh != true }) else { return nil }
                let names = rooms.map { $0.rate.roomName }
                let boards = rooms.map { meals($0.bookingSelection.meals ?? HotelMealChoices()) }
                let room = Set(names).count == 1 ? names[0] : names.enumerated().map { "\($0.offset + 1): \($0.element)" }.joined(separator: "; ")
                let board = Set(boards).count == 1 ? boards[0] : boards.enumerated().map { "\($0.offset + 1): \($0.element)" }.joined(separator: "; ")
                if room.count > 160 || board.count > 160 { issues.append("Список номеров или питания превышает лимит Business.") }
                guard let checkIn = saudiDay.date(from: NuiteeHotelService.dateText(first.checkin)), let checkOut = saudiDay.date(from: NuiteeHotelService.dateText(first.checkout)) else { return nil }
                return Stay(id: first.hotel.id, name: first.hotel.name, room: room, meals: board, imageURL: first.hotel.coverImageURL, stars: first.hotel.roundedStars,
                    checkIn: checkIn, checkOut: checkOut, rooms: rooms.count)
            }
            // Official Nuitee flow must carry the exact room selection, not a guessed room.
            return nil
        }
        let windows = TripStayPlanner.windows(for: journey.trip)
        guard let makkah = stay("makkah", windows.makkah) else { return nil }
        let medina = windows.madinah.flatMap { stay("madinah", $0) }
        if journey.trip.scope == .makkahAndMadinah && medina == nil { return nil }
        let outbound = flight(out), inbound = flight(back)
        if journey.haramainTrainSelected { issues.append("Haramain: текущий ручной API Business не сохраняет класс и билеты поезда. До расширения контракта отправка заблокирована.") }
        if journey.trip.travelerCount > 6 { issues.append("Ручной API Business принимает не более шести паломников.") }
        if journey.trip.rooms > 6 { issues.append("Ручной API Business принимает не более шести номеров.") }
        let amounts = Dictionary(uniqueKeysWithValues: price.components.map { ($0.code, NSDecimalNumber(decimal: $0.amountUsd).doubleValue) })
        return Self(quoteID: quoteID, adults: journey.trip.adults, children: journey.trip.children, infants: journey.trip.infants,
            tier: journey.trip.packageTier.rawValue, outbound: outbound, inbound: inbound, makkah: makkah, madinah: medina,
            vehicle: vehicle.modelName, pickup: out.arrivalAt, guideID: journey.trip.guidePreference?.memberID,
            guideName: journey.trip.guidePreference?.displayName, haramain: journey.haramainTrainSelected, amounts: amounts,
            originalTotal: NSDecimalNumber(decimal: price.totalUsd).doubleValue,
            originalSubtotal: NSDecimalNumber(decimal: price.servicesSubtotalUsd).doubleValue, unsupported: issues)
    }
}

struct BusinessConfiguratorContext {
    let review: (BusinessConfiguratorSnapshot) -> AnyView
    let homeActions: () -> AnyView
}
private struct BusinessConfiguratorContextKey: EnvironmentKey {
    static let defaultValue: BusinessConfiguratorContext? = nil
}
extension EnvironmentValues {
    var businessConfigurator: BusinessConfiguratorContext? {
        get { self[BusinessConfiguratorContextKey.self] }
        set { self[BusinessConfiguratorContextKey.self] = newValue }
    }
}

/// Mount the original client graph inside the Business navigation stack. The client
/// application entry, onboarding, tab shell and staff authentication are not mounted.
@MainActor public struct IumrahNativeConfigurator: View {
    @StateObject private var settings = AppSettingsStore()
    @StateObject private var chrome = AppChromeStore()
    @StateObject private var journey = JourneyStore()
    @StateObject private var manual = IumrahManualJourneyStore()
    private let context: BusinessConfiguratorContext
    private let onNotifications: () -> Void
    private let homeRequest: Int
    public init(review: @escaping (BusinessConfiguratorSnapshot) -> AnyView, homeActions: @escaping () -> AnyView, onNotifications: @escaping () -> Void, homeRequest: Int = 0) {
        context = .init(review: review, homeActions: homeActions)
        self.onNotifications = onNotifications
        self.homeRequest = homeRequest
    }
    public var body: some View {
        IumrahAdaptiveLayoutHost {
            Group {
                if chrome.currentTab == .hotels { HotelsHomeView() }
                else { HomeDashboardView() }
            }
        }
            .environment(\.businessConfigurator, context)
            .environmentObject(settings)
            .environmentObject(chrome)
            .environmentObject(journey)
            .environmentObject(manual)
            .environment(\.locale, Locale(identifier: settings.language.localeIdentifier))
            .environment(\.layoutDirection, settings.language.isRightToLeft ? .rightToLeft : .leftToRight)
            .onAppear { settings.language = .russian }
            .onChange(of: homeRequest, initial: true) { _, revision in
                if revision > 0 { chrome.currentTab = .home; chrome.openUmrahPlan() }
            }
            .onChange(of: chrome.requestedTab) { _, next in
                guard let next else { return }
                if next == .home || next == .hotels { chrome.currentTab = next }
                else { chrome.currentTab = .home }
                chrome.requestedTab = nil
            }
            .sheet(isPresented: $chrome.isSidebarOpen) {
                NavigationStack {
                    List {
                        Button("Собрать умру") { chrome.closeSidebar(); chrome.openUmrahPlan() }
                        Button("Отели") { chrome.closeSidebar(); chrome.openHotels(board: .hotels) }
                        Button("Авиабилеты") { chrome.closeSidebar(); chrome.openHotels(board: .flights) }
                        Button("Трансфер") { chrome.closeSidebar(); chrome.openHotels(board: .transfer) }
                        Button("Гиды и команда") { chrome.closeSidebar(); chrome.openHotels(board: .guide) }
                        Button("Мой пакет") { chrome.closeSidebar(); chrome.openHotels(board: .summary) }
                    }.navigationTitle("iumrah Business")
                }
            }
            .onChange(of: chrome.isNotificationsPresented) { _, presented in
                if presented { chrome.isNotificationsPresented = false; onNotifications() }
            }
            .toolbar(.hidden, for: .navigationBar)
    }
}
