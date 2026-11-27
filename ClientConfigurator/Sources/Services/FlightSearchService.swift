import Foundation

enum GeneratorSearchStage: Hashable {
    case starting
    case checkingProvider(String)
    case checkingAirlines
    case checkingHotels
    case comparingFares
    case continuing

    func text(_ language: AppSettingsStore.Language) -> String {
        switch (self, language) {
        case (.starting, .russian): return "Запускаем умный поиск"
        case (.starting, .turkish): return TurkishLocalization.phrase("Starting smart search")
        case (.starting, .arabic): return ArabicLocalization.phrase("Starting smart search")
        case (.starting, .indonesian), (.starting, .malay), (.starting, .english): return "Starting smart search"
        case (.starting, .uzbek): return "Aqlli qidiruv boshlanmoqda"
        case (.starting, .uzbekCyrillic): return "Ақлли қидирув бошланмоқда"
        case (.checkingProvider(let name), .russian): return "Проверяем \(name)"
        case (.checkingProvider(let name), .turkish): return "\(name) kontrol ediliyor"
        case (.checkingProvider(let name), .arabic): return "جارٍ التحقق من \(name)"
        case (.checkingProvider(let name), .indonesian), (.checkingProvider(let name), .malay), (.checkingProvider(let name), .english): return "Checking \(name)"
        case (.checkingProvider(let name), .uzbek): return "\(name) tekshirilmoqda"
        case (.checkingProvider(let name), .uzbekCyrillic): return "\(name) текширилмоқда"
        case (.checkingAirlines, .russian): return "Подбираем актуальные рейсы"
        case (.checkingAirlines, .turkish): return TurkishLocalization.phrase("Finding current flights")
        case (.checkingAirlines, .arabic): return ArabicLocalization.phrase("Finding current flights")
        case (.checkingAirlines, .indonesian), (.checkingAirlines, .malay), (.checkingAirlines, .english): return "Finding current flights"
        case (.checkingAirlines, .uzbek): return "Dolzarb reyslarni qidiryapmiz"
        case (.checkingAirlines, .uzbekCyrillic): return "Долзарб рейсларни қидиряпмиз"
        case (.checkingHotels, .russian): return "Проверяем цены выбранных Primary Hotels"
        case (.checkingHotels, .turkish): return TurkishLocalization.phrase("Checking your selected Primary Hotels")
        case (.checkingHotels, .arabic): return ArabicLocalization.phrase("Checking your selected Primary Hotels")
        case (.checkingHotels, .indonesian), (.checkingHotels, .malay), (.checkingHotels, .english): return "Checking your selected Primary Hotels"
        case (.checkingHotels, .uzbek): return "Tanlangan Primary Hotel narxlarini tekshiryapmiz"
        case (.checkingHotels, .uzbekCyrillic): return "Танланган Primary Hotel нархларини текширяпмиз"
        case (.comparingFares, .russian): return "Сравниваем найденные тарифы"
        case (.comparingFares, .turkish): return TurkishLocalization.phrase("Comparing current fares")
        case (.comparingFares, .arabic): return ArabicLocalization.phrase("Comparing current fares")
        case (.comparingFares, .indonesian), (.comparingFares, .malay), (.comparingFares, .english): return "Comparing current fares"
        case (.comparingFares, .uzbek): return "Topilgan tariflarni solishtiryapmiz"
        case (.comparingFares, .uzbekCyrillic): return "Топилган тарифларни солиштиряпмиз"
        case (.continuing, .russian): return "Продолжаем искать другие варианты"
        case (.continuing, .turkish): return TurkishLocalization.phrase("Searching for more options")
        case (.continuing, .arabic): return ArabicLocalization.phrase("Searching for more options")
        case (.continuing, .indonesian), (.continuing, .malay), (.continuing, .english): return "Searching for more options"
        case (.continuing, .uzbek): return "Yana variantlarni qidiryapmiz"
        case (.continuing, .uzbekCyrillic): return "Яна вариантларни қидиряпмиз"
        }
    }
}

struct FlightSearchProgress {
    let discoveredCandidates: [LiveFlightCandidate]
    let pricedOffers: [FlightOffer]
    let isSearching: Bool
    let status: GeneratorSearchStage?

    init(
        discoveredCandidates: [LiveFlightCandidate],
        pricedOffers: [FlightOffer],
        isSearching: Bool,
        status: GeneratorSearchStage? = nil
    ) {
        self.discoveredCandidates = discoveredCandidates
        self.pricedOffers = pricedOffers
        self.isSearching = isSearching
        self.status = status
    }

    static let emptySearching = FlightSearchProgress(
        discoveredCandidates: [],
        pricedOffers: [],
        isSearching: true,
        status: .starting
    )
}

typealias FlightSearchProgressHandler = @MainActor (FlightSearchProgress) -> Void

enum FlightInventoryProviderError: LocalizedError, Equatable {
    case notConfigured

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Flight data provider is not configured yet."
        }
    }
}

/// Clean boundary for the single external flight source. Ignav implements this
/// protocol through the iumrah backend. No airline-specific server or WebKit
/// discovery belongs above this boundary.
@MainActor
protocol FlightInventoryProviding: AnyObject {
    var sourceName: String { get }

    func searchJourney(
        request: FlightJourneySearchRequest,
        datePairs: [FlightJourneyDatePair],
        onUpdate: @escaping @MainActor ([LiveFlightJourneyCandidate]) -> Void
    ) async throws -> [LiveFlightJourneyCandidate]
}

@MainActor
protocol GeneratorComponentProviding: AnyObject {
    var currentHotelPriceSnapshot: HotelPriceSearchSnapshot? { get }
    func ensureHotelPrices(
        trip: TripDraft,
        makkahHotel: HotelSummary,
        madinahHotel: HotelSummary?,
        makkahRoomId: String?,
        makkahRoomName: String?,
        makkahRoomCapacity: Int?,
        madinahRoomId: String?,
        madinahRoomName: String?,
        madinahRoomCapacity: Int?,
        forceRefresh: Bool
    ) async -> HotelPriceSearchSnapshot
}

extension GeneratorComponentProviding {
    func ensureHotelPrices(trip: TripDraft, makkahHotel: HotelSummary, madinahHotel: HotelSummary?) async -> HotelPriceSearchSnapshot {
        await ensureHotelPrices(
            trip: trip,
            makkahHotel: makkahHotel,
            madinahHotel: madinahHotel,
            makkahRoomId: nil,
            makkahRoomName: nil,
            makkahRoomCapacity: nil,
            madinahRoomId: nil,
            madinahRoomName: nil,
            madinahRoomCapacity: nil,
            forceRefresh: false
        )
    }
}

@MainActor
protocol FlightSearchServicing {
    func searchOutbound(trip: TripDraft, makkahHotel: HotelSummary, madinahHotel: HotelSummary?) async throws -> [FlightOffer]
    func searchReturn(trip: TripDraft, makkahHotel: HotelSummary, madinahHotel: HotelSummary?, outbound: FlightOffer) async throws -> [FlightOffer]

    func searchOutboundProgressive(
        trip: TripDraft,
        makkahHotel: HotelSummary,
        madinahHotel: HotelSummary?,
        onUpdate: @escaping FlightSearchProgressHandler
    ) async throws -> [FlightOffer]

    func searchReturnProgressive(
        trip: TripDraft,
        makkahHotel: HotelSummary,
        madinahHotel: HotelSummary?,
        outbound: FlightOffer,
        onUpdate: @escaping FlightSearchProgressHandler
    ) async throws -> [FlightOffer]

}

extension FlightSearchServicing {

    func searchOutboundProgressive(
        trip: TripDraft,
        makkahHotel: HotelSummary,
        madinahHotel: HotelSummary?,
        onUpdate: @escaping FlightSearchProgressHandler
    ) async throws -> [FlightOffer] {
        onUpdate(.emptySearching)
        let offers = try await searchOutbound(trip: trip, makkahHotel: makkahHotel, madinahHotel: madinahHotel)
        onUpdate(.init(discoveredCandidates: [], pricedOffers: offers, isSearching: false))
        return offers
    }

    func searchReturnProgressive(
        trip: TripDraft,
        makkahHotel: HotelSummary,
        madinahHotel: HotelSummary?,
        outbound: FlightOffer,
        onUpdate: @escaping FlightSearchProgressHandler
    ) async throws -> [FlightOffer] {
        onUpdate(.emptySearching)
        let offers = try await searchReturn(trip: trip, makkahHotel: makkahHotel, madinahHotel: madinahHotel, outbound: outbound)
        onUpdate(.init(discoveredCandidates: [], pricedOffers: offers, isSearching: false))
        return offers
    }
}
