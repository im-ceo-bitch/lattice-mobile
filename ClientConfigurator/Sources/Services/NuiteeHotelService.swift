import Foundation

/// A full-catalogue response from an older Worker is paged in memory for this search.
/// No room selection tokens or final quotes are cached here.
private actor NuiteeLegacyPageCache {
    private var entries: [String: NuiteeHotelListEnvelope] = [:]
    private var order: [String] = []
    func read(_ key: String) -> NuiteeHotelListEnvelope? { entries[key] }
    func remove(_ key: String) { entries[key] = nil; order.removeAll { $0 == key } }
    func write(_ value: NuiteeHotelListEnvelope, key: String) {
        remove(key); entries[key] = value; order.append(key)
        while order.count > 4 { entries[order.removeFirst()] = nil }
    }
}

struct NuiteeHotelService {
    private static let legacyPages = NuiteeLegacyPageCache()
    private let api = APIClient.shared

    static func dateText(_ date: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        // DatePicker produces local calendar days; UTC can shift dates in Uzbekistan.
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    private func listKey(city: String, checkin: Date, checkout: Date, adults: Int, catalogOnly: Bool) -> String {
        catalogOnly ? "catalog-v3-\(city.lowercased())" : "\(city.lowercased())-\(Self.dateText(checkin))-\(Self.dateText(checkout))-\(adults)-rates"
    }

    func cachedHotels(city: String, checkin: Date, checkout: Date, adults: Int, catalogOnly: Bool = false) async -> NuiteeHotelListEnvelope? {
        await NuiteeDailyHotelCache.shared.read(key: listKey(city: city, checkin: checkin, checkout: checkout, adults: adults, catalogOnly: catalogOnly))
    }

    func hotels(city: String, checkin: Date, checkout: Date, adults: Int, catalogOnly: Bool = false, forceRefresh: Bool = false, smartTimeout: Bool = false) async throws -> NuiteeHotelListEnvelope {
        let key = listKey(city: city, checkin: checkin, checkout: checkout, adults: adults, catalogOnly: catalogOnly)
        if !forceRefresh, let cached = await NuiteeDailyHotelCache.shared.read(key: key) { return cached }
        let response: NuiteeHotelListEnvelope = try await APIClient.hotelPrices.get("/api/package/nuitee/hotels", query: [
            URLQueryItem(name: "city", value: city),
            URLQueryItem(name: "checkin", value: Self.dateText(checkin)),
            URLQueryItem(name: "checkout", value: Self.dateText(checkout)),
            URLQueryItem(name: "adults", value: String(adults)),
            URLQueryItem(name: "catalogOnly", value: catalogOnly ? "1" : "0")
         ], timeoutInterval: 120)
        // Cache successful responses while preserving upstream staleness flags.
        // Provider failures are never saved as successful results.
        if response.ok && !response.hotelCatalogStale && (catalogOnly || response.rateError == nil) {
            await NuiteeDailyHotelCache.shared.write(response, key: key)
        }
        return response
    }

    func hotelPage(city: String, checkin: Date, checkout: Date, adults: Int, childrenAges: [Int] = [], stars: Int = 0,
                   offset: Int = 0, pageSize: Int = NuiteeHotelPaging.pageSize, query: String = "", favorites: Set<String>? = nil,
                   catalogOnly: Bool = false, allowCatalogFallback: Bool = true) async throws -> NuiteeHotelListEnvelope {
        var params = [URLQueryItem(name: "city", value: city), URLQueryItem(name: "checkin", value: Self.dateText(checkin)),
                      URLQueryItem(name: "checkout", value: Self.dateText(checkout)), URLQueryItem(name: "adults", value: String(adults)),
                      URLQueryItem(name: "children", value: childrenAges.map(String.init).joined(separator: ",")),
                      URLQueryItem(name: "stars", value: String(stars)), URLQueryItem(name: "offset", value: String(offset)),
                      URLQueryItem(name: "pageSize", value: String(pageSize)), URLQueryItem(name: "query", value: query),
                      URLQueryItem(name: "catalogOnly", value: catalogOnly ? "1" : "0")]
        if let favorites { params.append(URLQueryItem(name: "hotelIds", value: favorites.sorted().joined(separator: ","))) }
        // Keep the exact search (including filters) separate. A new first page always refreshes.
        var cacheKey = URLComponents()
        cacheKey.queryItems = params.filter { $0.name != "offset" && $0.name != "pageSize" }
        let key = cacheKey.percentEncodedQuery ?? ""
        if offset == 0 { await Self.legacyPages.remove(key) }
        if offset > 0, let cached = await Self.legacyPages.read(key) {
            return NuiteeHotelListEnvelope.normalizedPage(cached, stars: stars, offset: offset, pageSize: pageSize, query: query, favorites: favorites)
        }
        do {
            let result: NuiteeHotelListEnvelope = try await APIClient.hotelPrices.get("/api/package/nuitee/hotels", query: params, timeoutInterval: 120)
            guard result.ok else { throw APIError.invalidResponse }
            try Task.checkCancellation()
            if result.total == nil && result.nextOffset == nil { await Self.legacyPages.write(result, key: key) }
            return NuiteeHotelListEnvelope.normalizedPage(result, stars: stars, offset: offset, pageSize: pageSize, query: query, favorites: favorites)
        } catch {
            try Task.checkCancellation()
            guard !catalogOnly, allowCatalogFallback else { throw error }
            // A provider outage must not remove the independently available catalogue.
            let fallback = try await hotelPage(city: city, checkin: checkin, checkout: checkout, adults: adults, childrenAges: childrenAges,
                stars: stars, offset: offset, pageSize: pageSize, query: query, favorites: favorites, catalogOnly: true, allowCatalogFallback: false)
            let rows = fallback.hotels.map { hotel -> NuiteeHotel in
                var row = hotel; row.minimumRate = nil; row.rateStatus = "provider_error"; return row
            }
            return NuiteeHotelListEnvelope(ok: fallback.ok, sandbox: fallback.sandbox, city: fallback.city,
                checkin: fallback.checkin, checkout: fallback.checkout, adults: fallback.adults,
                hotelCatalogStale: fallback.hotelCatalogStale, pricesStale: false, pricesUpdatedAt: nil,
                rateError: "RATES_UNAVAILABLE", hotels: rows, total: fallback.total, nextOffset: fallback.nextOffset)
        }
    }

    struct PriceRow: Decodable, Sendable { let id: String; let minimumRate: NuiteeHotelMinimumRate?; let rateStatus: String? }
    struct PricePage: Decodable { let ok: Bool; let sandbox: Bool; let pricesStale: Bool; let rateError: String?; let hotels: [PriceRow] }
    func pricePage(city: String, checkin: Date, checkout: Date, adults: Int, hotelIDs: [String], childrenAges: [Int] = []) async throws -> PricePage {
        let response: PricePage = try await APIClient.hotelPrices.get("/api/package/nuitee/hotels", query: [
            URLQueryItem(name: "city", value: city), URLQueryItem(name: "checkin", value: Self.dateText(checkin)),
            URLQueryItem(name: "checkout", value: Self.dateText(checkout)), URLQueryItem(name: "adults", value: String(adults)),
            URLQueryItem(name: "hotelIds", value: hotelIDs.sorted().joined(separator: ",")),
            URLQueryItem(name: "children", value: childrenAges.map(String.init).joined(separator: ",")),
            URLQueryItem(name: "pageSize", value: String(max(1, hotelIDs.count))), URLQueryItem(name: "ratesOnly", value: "1")
        ], timeoutInterval: 120)
        guard response.ok else { throw APIError.invalidResponse }
        return response
    }

    struct CatalogRateResult: Sendable {
        let row: PriceRow
        let rateLimited: Bool
    }

    static func isRateLimited(_ error: Error) -> Bool {
        switch error {
        case APIError.status(let code): return code == 429
        case APIError.server(let code, _): return code == 429
        default: return false
        }
    }

    func catalogRate(hotelID: String, checkin: Date, checkout: Date, adults: Int, childrenAges: [Int] = []) async -> CatalogRateResult {
        func result(_ status: String, _ limited: Bool = false, _ minimum: NuiteeHotelMinimumRate? = nil) -> CatalogRateResult {
            .init(row: .init(id: hotelID, minimumRate: minimum, rateStatus: status), rateLimited: limited)
        }
        do {
            var response = try await rates(hotelID: hotelID, checkin: checkin, checkout: checkout, adults: adults, childrenAges: childrenAges)
            try Task.checkCancellation()
            if response.ok && response.rates.isEmpty && response.availabilityConfirmed != true {
                response = try await rates(hotelID: hotelID, checkin: checkin, checkout: checkout, adults: adults, childrenAges: childrenAges, forceRefresh: true)
                try Task.checkCancellation()
            }
            guard response.ok, response.checkin == Self.dateText(checkin), response.checkout == Self.dateText(checkout), response.adults == adults else { return result("provider_error") }
            if let best = response.rates.filter({ $0.currency.uppercased() == "USD" && $0.price.isFinite && $0.price > 0 && !$0.offerId.isEmpty }).min(by: { $0.price < $1.price }) {
                return result("available", false, .init(hotelId: hotelID, price: best.price, currency: best.currency, offerId: best.offerId))
            }
            // Only an explicit, single-property response can mark the dates sold out.
            return result(response.rates.isEmpty && response.availabilityConfirmed == true ? "no_availability" : "not_returned")
        } catch { return result("provider_error", Self.isRateLimited(error)) }
    }

    func detail(hotelID: String, language: String = "en") async throws -> NuiteeHotelDetail {
        let response: NuiteeHotelDetailEnvelope = try await api.get(
            "/api/package/nuitee/hotel", query: [URLQueryItem(name: "hotelId", value: hotelID), URLQueryItem(name: "language", value: language)], timeoutInterval: 35
        )
        return response.hotel
    }

    func reviews(hotelID: String, language: String, offset: Int = 0) async throws -> NuiteeReviewsEnvelope {
        try await api.get("/api/package/nuitee/reviews", query: [
            URLQueryItem(name: "hotelId", value: hotelID),
            URLQueryItem(name: "language", value: language),
            URLQueryItem(name: "offset", value: String(offset))
        ], timeoutInterval: 35)
    }

    func rates(hotelID: String, checkin: Date, checkout: Date, adults: Int, childrenAges: [Int] = [], language: String = "en", smartTimeout: Bool = false, forceRefresh: Bool = false) async throws -> NuiteeRatesEnvelope {
        struct Request: Encodable {
            let hotelId: String
            let checkin: String
            let checkout: String
            let adults: Int
            let children: [Int]
            let language: String
            let forceRefresh: Bool
        }
        let request = Request(hotelId: hotelID, checkin: Self.dateText(checkin), checkout: Self.dateText(checkout), adults: adults, children: childrenAges, language: language, forceRefresh: forceRefresh)
        do {
            return try await APIClient.hotelPrices.post("/api/package/nuitee/rates", body: request, timeoutInterval: 120)
        } catch APIError.decoding(_) where language != "en" {
            // The monetary offer is language independent. A malformed translation must not hide it.
            try Task.checkCancellation()
            return try await APIClient.hotelPrices.post("/api/package/nuitee/rates", body: Request(hotelId: hotelID, checkin: request.checkin, checkout: request.checkout, adults: adults, children: childrenAges, language: "en", forceRefresh: false), timeoutInterval: 120)
        }
    }

    static func deadlineText(_ value: String, locale: String) -> String {
        let parser = DateFormatter(); parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = TimeZone(secondsFromGMT: 0)
        parser.dateFormat = "yyyy-MM-dd HH:mm:ss"
        guard let date = parser.date(from: value) else { return value }
        let display = DateFormatter(); display.locale = Locale(identifier: locale)
        display.timeZone = parser.timeZone; display.dateStyle = .medium; display.timeStyle = .short
        return display.string(from: date)
    }

    static func usd(_ value: Double) -> String {
        value.formatted(.currency(code: "USD").precision(.fractionLength(0...2)))
    }
}

extension AppSettingsStore.Language {
    var hotelContentCode: String {
        switch self {
        case .russian: return "ru"
        case .uzbek: return "uz"
        case .uzbekCyrillic: return "uz-Cyrl"
        default: return String(rawValue.prefix(2)).lowercased()
        }
    }
}
