import Foundation


enum StagedUmrahFlightKind: String, Hashable {
    case roundTrip
    case outbound
    case inbound
}

struct StagedUmrahFlight: Identifiable, Hashable {
    let id: String
    let kind: StagedUmrahFlightKind
    let origin: String
    let destination: String
    let airline: String
    let flightNumber: String
    let departureAt: String
    let returnAt: String?
    let returnAirline: String?
    let returnFlightNumber: String?
    let source: String

    var routeTitle: String { "\(origin.uppercased()) → \(destination.uppercased())" }
}

enum PackageFlightPath: String, Hashable {
    /// A staff-published direct itinerary chosen before the hotel stage.
    /// Pricing resolves from the curated D1 row and must not trigger Ignav search.
    case publishedDirect
    /// A Data API fare selected in the Flights storefront before the hotel stage.
    /// The Package Engine re-resolves the same Aviasales Data identity server-side
    /// before it accepts the fare into a package quote.
    case aviasalesSelected
    /// User-selected dates outside (or instead of) published direct inventory.
    /// After hotel selection the normal Ignav search flow runs for those exact dates.
    case flexibleDates
    /// Existing Weekend Umrah product. Its dedicated behavior remains unchanged.
    case weekend
}

enum PackageTier: String, CaseIterable, Codable, Identifiable, Hashable {
    case economy
    case standard
    case comfort
    case luxury

    var id: String { rawValue }

    func title(_ language: AppSettingsStore.Language) -> String {
        L10n.text("tier_\(rawValue)", language)
    }

    func subtitle(_ language: AppSettingsStore.Language) -> String {
        L10n.text("tier_\(rawValue)_subtitle", language)
    }

    /// Package category is now the single customer-facing hotel preference.
    /// `hotelStars` stays in TripDraft only as an internal compatibility/pricing field.
    var primaryHotelStars: Int {
        switch self {
        case .economy: return 2
        case .standard: return 3
        case .comfort: return 4
        case .luxury: return 5
        }
    }

    /// Economy also exposes 1★ inventory as an explicit Super Economy alternative.
    /// All other package categories are intentionally strict.
    var selectableHotelStars: [Int] {
        switch self {
        case .economy: return [2, 1]
        case .standard: return [3]
        case .comfort: return [4]
        case .luxury: return [5]
        }
    }
}

enum HotelMealCity: String, Codable, Hashable {
    case makkah
    case madinah
}

enum HotelMealKind: String, Codable, Hashable {
    case breakfast
    case lunch
    case dinner
}

/// Customer-selectable hotel meal plan used by Comfort and Luxury packages.
/// Breakfast is always included at no additional cost. Paid lunch/dinner choices
/// are opt-in: the default package contains breakfast only.
struct PackageMealSelection: Codable, Hashable {
    var makkahLunch: Bool = false
    var makkahDinner: Bool = false
    var madinahDinner: Bool = false

    static let defaultSelection = PackageMealSelection()

    func isEnabled(_ meal: HotelMealKind, in city: HotelMealCity) -> Bool {
        switch (city, meal) {
        case (_, .breakfast):
            return true
        case (.makkah, .lunch):
            return makkahLunch
        case (.makkah, .dinner):
            return makkahDinner
        case (.madinah, .lunch):
            return false
        case (.madinah, .dinner):
            return madinahDinner
        }
    }

    mutating func setEnabled(_ enabled: Bool, meal: HotelMealKind, city: HotelMealCity) {
        switch (city, meal) {
        case (_, .breakfast), (.madinah, .lunch):
            return
        case (.makkah, .lunch):
            makkahLunch = enabled
        case (.makkah, .dinner):
            makkahDinner = enabled
        case (.madinah, .dinner):
            madinahDinner = enabled
        }
    }
}

enum DateFlexibility: String, CaseIterable, Codable, Identifiable, Hashable {
    case exact
    /// Retained only so previously persisted drafts continue to decode.
    case plusMinusOne
    case plusMinusTwo
    case weekend

    /// The current product has one flexible flight-discovery mode: search a full
    /// seven-day window around the selected date. The old ±1 raw value remains
    /// decodable and is normalized into the same weekly mode.
    static var allCases: [DateFlexibility] { [.exact, .weekend] }

    var id: String { rawValue }

    var isFlexibleDayRange: Bool {
        self == .plusMinusOne || self == .plusMinusTwo
    }

    /// Weekly provider fan-out is retired. Legacy drafts still decode these raw
    /// values, but date discovery now happens in the D1-backed fare calendar.
    var isWeeklyDiscovery: Bool { false }

    func title(_ language: AppSettingsStore.Language) -> String {
        switch self {
        case .exact: return L10n.text("flex_exact", language)
        case .plusMinusOne, .plusMinusTwo: return L10n.text("flex_pm2", language)
        case .weekend: return L10n.text("flex_weekend", language)
        }
    }
}

enum JourneyScope: String, CaseIterable, Codable, Identifiable, Hashable {
    case makkahOnly
    case makkahAndMadinah

    var id: String { rawValue }

    func title(_ language: AppSettingsStore.Language) -> String {
        switch self {
        case .makkahOnly: return L10n.text("scope_makkah", language)
        case .makkahAndMadinah: return L10n.text("scope_both", language)
        }
    }
}

enum SaudiArrivalAirport: String, CaseIterable, Codable, Identifiable, Hashable {
    case jeddah = "JED"
    case madinah = "MED"

    var id: String { rawValue }

    func title(_ language: AppSettingsStore.Language) -> String {
        switch self {
        case .jeddah: return L10n.text("airport_jeddah_full", language)
        case .madinah: return L10n.text("airport_madinah", language)
        }
    }

    func shortTitle(_ language: AppSettingsStore.Language) -> String {
        switch self {
        case .jeddah: return L10n.text("airport_jeddah", language)
        case .madinah: return L10n.text("airport_madinah", language)
        }
    }
}

enum FlightTripType: String, CaseIterable, Codable, Identifiable, Hashable {
    case roundTrip
    case oneWay

    var id: String { rawValue }
}

/// A preferred person, not a confirmed operational assignment. Nil lets iumrah choose.
struct IumrahGuidePreference: Codable, Hashable {
    let memberID: String
    let displayName: String
}

struct TripDraft: Codable, Hashable {
    var guidePreference: IumrahGuidePreference? = nil
    var origin: String = "TAS"
    var originAirport: Airport? = nil
    var arrivalAirport: SaudiArrivalAirport = .jeddah
    /// A published/Data API return can leave from JED *or* MED, independently of
    /// the hotel scope. Nil preserves the legacy opposite-airport default.
    var selectedReturnAirport: SaudiArrivalAirport? = nil
    var departureDate: Date = Calendar.current.date(byAdding: .day, value: 21, to: Date()) ?? Date()
    /// Actual local calendar day when the selected outbound itinerary reaches Saudi Arabia.
    /// Hotel stays start here, never on the origin-airport departure day.
    var saudiArrivalDate: Date? = nil
    var returnDate: Date = Calendar.current.date(byAdding: .day, value: 28, to: Date()) ?? Date()
    var flexibility: DateFlexibility = .exact
    var adults: Int = 2
    var children: Int = 0
    var infants: Int = 0
    var rooms: Int = 1
    var hotelStars: Int = 3
    var packageTier: PackageTier = .standard
    /// Optional for backward compatibility with drafts created before selectable
    /// Comfort/Luxury hotel meals were introduced. Missing means the current
    /// breakfast-only default; paid lunch/dinner remain opt-in.
    var mealSelection: PackageMealSelection? = nil
    var scope: JourneyScope = .makkahAndMadinah
    /// Hotel First is the only product that uses the fixed two-night Madinah split
    /// requested by the storefront package engine. Optional keeps older saved TripDrafts
    /// fully decodable and leaves Flight First / normal configurator behavior unchanged.
    var hotelFirstStayPolicy: Bool? = nil
    var flightFilters: FlightSearchFilters? = nil
    /// Optional so drafts saved before one-way search was introduced continue to
    /// decode. A missing value always means the historical round-trip flow.
    var flightTripType: FlightTripType? = nil

    var travelerCount: Int { adults + children + infants }
    var hotelStayStartDate: Date { saudiArrivalDate ?? departureDate }
    var effectiveFlightFilters: FlightSearchFilters { flightFilters ?? .default }
    var resolvedFlightTripType: FlightTripType { flightTripType ?? .roundTrip }
    var isRoundTripFlight: Bool { resolvedFlightTripType == .roundTrip }
    var isWeekendUmrah: Bool { flexibility == .weekend }
    var effectiveMealSelection: PackageMealSelection { mealSelection ?? .defaultSelection }

    var originCode: String {
        (originAirport?.iata ?? origin).trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }

    var outboundDestinationCode: String {
        if isWeekendUmrah { return "JED" }
        guard scope == .makkahAndMadinah else { return "JED" }
        return arrivalAirport.rawValue
    }

    var returnOriginCode: String {
        if let selectedReturnAirport { return selectedReturnAirport.rawValue }
        if isWeekendUmrah { return "JED" }
        guard scope == .makkahAndMadinah else { return "JED" }
        return arrivalAirport == .madinah ? "JED" : "MED"
    }

    mutating func selectFlexibility(_ value: DateFlexibility, calendar: Calendar = .current) {
        flexibility = value == .plusMinusOne ? .plusMinusTwo : value
        if flexibility == .weekend {
            applyWeekendWindow(around: departureDate, calendar: calendar)
        }
    }

    /// Weekend Umrah is intentionally a separate product route: origin → JED and
    /// JED → origin, without a Madinah flight leg. The travel window is Friday to
    /// Monday so Saturday/Sunday remain fully available for Umrah.
    mutating func applyWeekendWindow(around referenceDate: Date, calendar: Calendar = .current) {
        scope = .makkahOnly
        arrivalAirport = .jeddah

        let today = calendar.startOfDay(for: Date())
        let reference = max(calendar.startOfDay(for: referenceDate), today)
        let weekday = calendar.component(.weekday, from: reference) // Sunday = 1, Friday = 6
        let daysForwardToFriday = (6 - weekday + 7) % 7
        var friday = calendar.date(byAdding: .day, value: daysForwardToFriday, to: reference) ?? reference

        // If the user is already inside a future Friday–Sunday weekend, preserve
        // that weekend instead of jumping a full week ahead.
        if weekday == 7, let previousFriday = calendar.date(byAdding: .day, value: -1, to: reference), previousFriday >= today {
            friday = previousFriday
        } else if weekday == 1, let previousFriday = calendar.date(byAdding: .day, value: -2, to: reference), previousFriday >= today {
            friday = previousFriday
        }

        departureDate = friday
        saudiArrivalDate = nil
        returnDate = calendar.date(byAdding: .day, value: 3, to: friday) ?? friday.addingTimeInterval(3 * 86_400)
    }

    var canContinue: Bool {
        originCode.count == 3 &&
        adults > 0 &&
        travelerCount <= 9 &&
        rooms > 0 &&
        returnDate > departureDate
    }
}
