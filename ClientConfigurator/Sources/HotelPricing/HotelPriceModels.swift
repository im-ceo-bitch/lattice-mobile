import Foundation

enum HotelPriceProviderID: String, Codable, Hashable, CaseIterable {
    case booking
    case expedia
}


struct HotelPricingSourceIdentity: Codable, Hashable {
    let provider: HotelPriceProviderID
    let sourceURL: String
    let providerHotelID: String?
    let canonicalURL: String?
}

struct HotelPricingSourcesResponse: Decodable {
    let ok: Bool
    let hotelId: String
    let sources: [HotelPricingSourceIdentity]
}

enum HotelPriceUnit: String, Codable, Hashable {
    case totalStay
    case perRoomStay
    case perRoomNight
}

struct HotelPriceObservation: Identifiable, Codable, Hashable {
    let id: String
    let hotelId: String
    let hotelName: String
    let city: String
    let amount: Decimal
    let currency: String
    let unit: HotelPriceUnit
    let providerId: HotelPriceProviderID
    let providerName: String
    let observedAt: String
    let expiresAt: String?
    let checkInDate: String
    let checkOutDate: String
    let sourceURL: String
    let roomId: String?
    let roomName: String?

    func isUsable(
        for hotel: HotelSummary,
        city expectedCity: String,
        window: TripStayWindow,
        roomId expectedRoomId: String?,
        now: Date = Date()
    ) -> Bool {
        guard amount > 0, hotelId == hotel.id else { return false }
        guard hotelName.trimmingCharacters(in: .whitespacesAndNewlines)
            .caseInsensitiveCompare(hotel.name.trimmingCharacters(in: .whitespacesAndNewlines)) == .orderedSame else { return false }
        guard city.caseInsensitiveCompare(expectedCity) == .orderedSame else { return false }
        guard Self.supportedCurrencies.contains(currency.uppercased()) else { return false }
        guard checkInDate == Self.dayFormatter.string(from: window.checkIn),
              checkOutDate == Self.dayFormatter.string(from: window.checkOut) else { return false }
        guard let observed = Self.parseObservedAt(observedAt) else { return false }
        let age = now.timeIntervalSince(observed)
        let isServerCatalogObservation = id.hasPrefix("catalog-")
        if isServerCatalogObservation {
            // The Hotels Worker owns refresh/retry policy. If a provider refresh
            // fails, the last accepted D1 price remains the generator fallback.
            // Only reject impossible future timestamps here; do not re-expire the
            // same server value a second time on the pilgrim device.
            guard age >= -5 * 60 else { return false }
        } else if let expiresAt {
            guard let expiry = Self.parseObservedAt(expiresAt), expiry > now, age >= -5 * 60, age <= 49 * 60 * 60 else { return false }
        } else {
            // Legacy device observations remain short-lived.
            guard age >= -5 * 60, age <= 20 * 60 else { return false }
        }
        guard let url = URL(string: sourceURL), url.scheme?.lowercased() == "https",
              let host = url.host?.lowercased(), providerId.accepts(host: host) else { return false }
        // selectedRoomId is an internal iumrah selection key. Booking/Expedia
        // search-result prices verify the exact hotel/stay/occupancy, not a stable
        // external room inventory ID, so room matching must not invalidate an
        // otherwise current hotel observation.
        _ = expectedRoomId
        return true
    }

    private static let supportedCurrencies: Set<String> = ["USD", "EUR", "SAR", "AED", "GBP"]
    private static func parseObservedAt(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value)
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}

extension HotelPriceProviderID {
    func accepts(host: String) -> Bool {
        switch self {
        case .booking:
            return host == "booking.com" || host.hasSuffix(".booking.com")
        case .expedia:
            return host == "expedia.com" || host.hasSuffix(".expedia.com")
        }
    }
}

struct HotelPriceSearchSnapshot: Codable, Hashable {
    let makkah: [HotelPriceObservation]
    let madinah: [HotelPriceObservation]

    static let empty = HotelPriceSearchSnapshot(makkah: [], madinah: [])

    var hasLiveRates: Bool { !makkah.isEmpty || !madinah.isEmpty }
}
