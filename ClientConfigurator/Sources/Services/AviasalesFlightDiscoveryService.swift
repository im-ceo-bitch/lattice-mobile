import Foundation
import Combine

struct FlightDiscoveryOffer: Codable, Hashable, Identifiable {
    let id: String
    let origin: String
    let destination: String
    let originAirport: String
    let destinationAirport: String
    var price: Double
    let airlineCode: String
    let flightNumber: String
    let departureAt: String
    let returnAt: String?
    let returnAirlineCode: String?
    let returnFlightNumber: String?
    let transfers: Int
    let returnTransfers: Int?
    let durationMinutes: Int
    let returnDurationMinutes: Int?
    let bookingUrl: String?
    var arrivalAt: String? = nil
    // Future-compatible segment details. Missing fields are never fabricated.
    var outboundSegments: [FlightDiscoveryVerifiedSegment]? = nil
    var inboundSegments: [FlightDiscoveryVerifiedSegment]? = nil

    var airlineName: String {
        FlightReferenceCatalog.airlineName(code: airlineCode, fallback: airlineCode.isEmpty ? "Airline" : airlineCode)
    }

    var routeTitle: String {
        "\(originAirport.isEmpty ? origin : originAirport) → \(destinationAirport.isEmpty ? destination : destinationAirport)"
    }

    var isRoundTrip: Bool {
        guard let returnAt else { return false }
        return !returnAt.isEmpty
    }

    var isDirect: Bool {
        transfers == 0 && (!isRoundTrip || returnTransfers == 0)
    }

    var monitorKey: String {
        [
            origin.uppercased(),
            destination.uppercased(),
            airlineCode.uppercased(),
            flightNumber.uppercased(),
            String(departureAt.prefix(16)),
            String(returnAt?.prefix(16) ?? "")
        ].joined(separator: "|")
    }
}

struct FlightDiscoveryCalendarDay: Codable, Hashable, Identifiable {
    let date: String
    let id: String
    let origin: String
    let destination: String
    let originAirport: String
    let destinationAirport: String
    let price: Double
    let airlineCode: String
    let flightNumber: String
    let departureAt: String
    let returnAt: String?
    let returnAirlineCode: String?
    let returnFlightNumber: String?
    let transfers: Int
    let returnTransfers: Int?
    let durationMinutes: Int
    let returnDurationMinutes: Int?
    let bookingUrl: String?
    var arrivalAt: String? = nil

    var offer: FlightDiscoveryOffer {
        FlightDiscoveryOffer(
            id: id,
            origin: origin,
            destination: destination,
            originAirport: originAirport,
            destinationAirport: destinationAirport,
            price: price,
            airlineCode: airlineCode,
            flightNumber: flightNumber,
            departureAt: departureAt,
            returnAt: returnAt,
            returnAirlineCode: returnAirlineCode,
            returnFlightNumber: returnFlightNumber,
            transfers: transfers,
            returnTransfers: returnTransfers,
            durationMinutes: durationMinutes,
            returnDurationMinutes: returnDurationMinutes,
            bookingUrl: bookingUrl,
            arrivalAt: arrivalAt
        )
    }
}

private struct FlightDiscoveryOffersEnvelope: Decodable {
    let ok: Bool
    let source: String?
    let sourceFreshness: String?
    let generatedAt: String?
    let currency: String?
    let offers: [FlightDiscoveryOffer]
}

private struct FlightDiscoveryCalendarEnvelope: Decodable {
    let ok: Bool
    let source: String?
    let sourceFreshness: String?
    let generatedAt: String?
    let currency: String?
    let days: [FlightDiscoveryCalendarDay]
}

struct AviasalesFlightDiscoveryService {
    private let api = APIClient.shared

    func offers(
        origin: String,
        destination: String,
        departure: String,
        returnAt: String? = nil,
        direct: Bool = false,
        limit: Int = 50,
        currency: String = "usd",
        forceRefresh: Bool = false
    ) async throws -> (offers: [FlightDiscoveryOffer], currency: String, generatedAt: String?) {
        var query = [
            URLQueryItem(name: "view", value: direct ? "direct" : "offers"),
            URLQueryItem(name: "origin", value: origin.uppercased()),
            URLQueryItem(name: "destination", value: destination.uppercased()),
            URLQueryItem(name: "departure", value: departure),
            URLQueryItem(name: "currency", value: currency.lowercased()),
            URLQueryItem(name: "limit", value: String(max(1, min(limit, 100))))
        ]
        if let returnAt, !returnAt.isEmpty {
            query.append(URLQueryItem(name: "return", value: returnAt))
        }
        // Bypass our edge cache for a user-initiated price recheck. The upstream
        // Travelpayouts Data API remains a recently searched fares cache.
        if forceRefresh {
            query.append(URLQueryItem(name: "fresh", value: "1"))
        }

        let response: FlightDiscoveryOffersEnvelope = try await api.get(
            "/api/package/flights/data",
            query: query,
            timeoutInterval: 45
        )
        guard response.ok else { throw APIError.invalidResponse }
        return (response.offers, response.currency ?? currency, response.generatedAt)
    }

    func calendar(
        origin: String,
        destination: String,
        month: String,
        direct: Bool = false,
        currency: String = "usd",
        forceRefresh: Bool = false
    ) async throws -> (days: [FlightDiscoveryCalendarDay], currency: String, generatedAt: String?) {
        let response: FlightDiscoveryCalendarEnvelope = try await api.get(
            "/api/package/flights/data",
            query: [
                URLQueryItem(name: "view", value: "calendar"),
                URLQueryItem(name: "origin", value: origin.uppercased()),
                URLQueryItem(name: "destination", value: destination.uppercased()),
                URLQueryItem(name: "departure", value: month),
                URLQueryItem(name: "currency", value: currency.lowercased()),
                URLQueryItem(name: "direct", value: direct ? "true" : "false"),
                URLQueryItem(name: "fresh", value: forceRefresh ? "1" : "0")
            ],
            timeoutInterval: 45
        )
        guard response.ok else { throw APIError.invalidResponse }
        return (response.days, response.currency ?? currency, response.generatedAt)
    }
}

@MainActor
final class IumrahFlightDiscoveryStore: ObservableObject {
    @Published private(set) var offers: [FlightDiscoveryOffer] = []
    @Published private(set) var calendarDays: [FlightDiscoveryCalendarDay] = []
    @Published private(set) var currency: String = "usd"
    @Published private(set) var generatedAt: String?
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private let service = AviasalesFlightDiscoveryService()
    private var refreshTask: Task<Void, Never>?

    deinit {
        refreshTask?.cancel()
    }

    func refresh(
        origin: String,
        destination: String,
        departureDate: Date,
        returnDate: Date?,
        directOnly: Bool,
        forceRefresh: Bool = false
    ) {
        refreshTask?.cancel()
        let origin = origin.uppercased()
        let destination = destination.uppercased()
        guard origin.count == 3, destination.count == 3, origin != destination else {
            offers = []
            calendarDays = []
            errorMessage = nil
            return
        }

        let month = Self.monthFormatter.string(from: departureDate)
        let departure = Self.dayFormatter.string(from: departureDate)
        let returnAt = returnDate.map { Self.dayFormatter.string(from: $0) }

        isLoading = true
        errorMessage = nil
        offers = []

        refreshTask = Task { [weak self] in
            guard let self else { return }
            do {
                let calendar = try await service.calendar(
                    origin: origin,
                    destination: destination,
                    month: month,
                    direct: directOnly,
                    forceRefresh: forceRefresh
                )
                guard !Task.isCancelled else { return }
                self.calendarDays = calendar.days
                self.currency = calendar.currency
                self.generatedAt = calendar.generatedAt

                var collected: [FlightDiscoveryOffer] = []

                // 1) Ask for the exact travel day. This is the most relevant cache slice.
                if let exact = try? await service.offers(
                    origin: origin,
                    destination: destination,
                    departure: departure,
                    returnAt: returnAt,
                    direct: directOnly,
                    limit: 100,
                    forceRefresh: forceRefresh
                ) {
                    collected.append(contentsOf: exact.offers)
                    self.currency = exact.currency
                    self.generatedAt = exact.generatedAt ?? calendar.generatedAt
                }

                guard !Task.isCancelled else { return }

                // 2) prices_for_dates can contain several cached fares for the month even
                // when the exact-day request returns only one row. Merge matching rows so
                // the client receives a real ticket list rather than only a price insight.
                if collected.count < 6,
                   let monthly = try? await service.offers(
                    origin: origin,
                    destination: destination,
                    departure: month,
                    returnAt: returnAt,
                    direct: directOnly,
                    limit: 100
                   ) {
                    let matching = monthly.offers.filter {
                        String($0.departureAt.prefix(10)) == departure
                    }
                    collected.append(contentsOf: matching)
                    self.currency = monthly.currency
                    self.generatedAt = monthly.generatedAt ?? self.generatedAt
                }

                guard !Task.isCancelled else { return }

                // 3) grouped_prices always gives us the cheapest cached row for a day when
                // one exists. Use it as a final selected-day fallback so the UI never hides
                // a fare that is already visible in the calendar/price graph.
                if let fallback = calendar.days.first(where: { $0.date == departure && $0.departureAt.count >= 16 })?.offer {
                    collected.append(fallback)
                }

                var seen = Set<String>()
                self.offers = collected
                    .filter { $0.price > 0 && !$0.departureAt.isEmpty }
                    .filter { offer in
                        let signature = [
                            offer.originAirport,
                            offer.destinationAirport,
                            offer.airlineCode,
                            offer.flightNumber,
                            offer.departureAt,
                            String(Int(offer.price.rounded()))
                        ].joined(separator: "|")
                        return seen.insert(signature).inserted
                    }
                    .sorted { lhs, rhs in
                        if lhs.price != rhs.price { return lhs.price < rhs.price }
                        return lhs.departureAt < rhs.departureAt
                    }

                self.errorMessage = nil
                self.isLoading = false
            } catch {
                guard !Task.isCancelled else { return }
                self.calendarDays = []
                self.offers = []
                self.errorMessage = error.localizedDescription
                self.isLoading = false
            }
        }
    }

    func updateVerifiedOffer(_ verified: FlightDiscoveryOffer) {
        // Only the exact itinerary verified by the details view is updated.
        // If the original list row came from the calendar fallback, retain the
        // verified offer as a new row instead of showing the old cached price.
        var found = false
        var updated = offers.map { original -> FlightDiscoveryOffer in
            guard original.monitorKey == verified.monitorKey else { return original }
            found = true
            var copy = original
            copy.price = verified.price
            return copy
        }
        if !found { updated.append(verified) }
        offers = updated.sorted { $0.price < $1.price }
    }

    func clearError() {
        errorMessage = nil
    }

    static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static let monthFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM"
        return formatter
    }()
}
