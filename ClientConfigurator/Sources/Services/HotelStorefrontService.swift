import Foundation

struct StorefrontServerPackageSnapshot: Codable, Hashable, Identifiable {
    struct Leg: Codable, Hashable {
        let airline: String
        let airlineCode: String
        let flightNumber: String
        let origin: String
        let destination: String
        let departureAt: String
        let arrivalAt: String
        let durationMinutes: Int
        let stops: Int
        let cabinClass: String

        var clientLeg: StorefrontFlightLeg {
            StorefrontFlightLeg(
                airline: airline,
                flightNumber: flightNumber,
                airlineCode: airlineCode,
                origin: origin,
                destination: destination,
                departureAt: departureAt,
                arrivalAt: arrivalAt,
                durationMinutes: durationMinutes,
                stops: stops,
                cabinClass: cabinClass
            )
        }
    }

    let id: String
    let entryMode: String
    let status: String
    let originCode: String
    let originCity: String
    let destinationCode: String
    let tier: PackageTier
    let kind: String
    let startDate: String
    let endDate: String
    let totalDays: Int
    let totalNights: Int
    let makkahNights: Int?
    let madinahNights: Int?
    let hotelFirstVariant: String?
    let hotelFirstVariantIndex: Int?
    let hotelFirstVariantMinDays: Int?
    let hotelFirstVariantMaxDays: Int?
    let hotelFirstAnchorCity: String?
    let hotelFirstAnchorHotelId: String?
    let hotelFirstEngineVersion: Int?
    let outbound: Leg
    let inbound: Leg
    let providerItineraryId: String
    let outboundOfferId: String
    let inboundOfferId: String
    let imageUrl: String
    let hotelImages: [String]
    let hotelName: String
    let hotelSecondaryName: String?
    let hotelCity: String?
    let hotelStars: Int?
    let hotelRating: Double?
    let hotelReviewCount: Int?
    let makkahHotelId: String?
    let madinahHotelId: String?
    let routeSummary: String
    let pricePerPerson: Decimal?
    let totalPackagePrice: Decimal?
    let currency: String
    let isEstimated: Bool
    let configuration: StorefrontPackageSnapshotConfiguration?
}

struct StorefrontServerPackagesPage: Hashable {
    let cacheState: String?
    let refreshRecommended: Bool
    let generatedAt: String?
    let expiresAt: String?
    let itemCount: Int
    let totalItemCount: Int
    let expectedItemCount: Int?
    let complete: Bool
    let failedHotelCount: Int
    let nextRefreshCursor: Int
    let items: [StorefrontServerPackageSnapshot]
}

struct StorefrontServerRefreshState: Hashable {
    let itemCount: Int
    let expectedItemCount: Int?
    let complete: Bool
    let failedHotelCount: Int
    let nextRefreshCursor: Int
}

private struct StorefrontServerPackagesEnvelope: Decodable {
    let ok: Bool
    let cacheState: String?
    let refreshRecommended: Bool?
    let generatedAt: String?
    let expiresAt: String?
    let itemCount: Int?
    let totalItemCount: Int?
    let expectedItemCount: Int?
    let complete: Bool?
    let failedHotelCount: Int?
    let nextRefreshCursor: Int?
    let items: [StorefrontServerPackageSnapshot]
}

private struct StorefrontServerRefreshRequest: Encodable {
    let mode: String
    let origin: String
    let cursor: Int
}

private struct StorefrontServerRefreshEnvelope: Decodable {
    let ok: Bool
    let itemCount: Int?
    let expectedItemCount: Int?
    let complete: Bool?
    let failedHotelCount: Int?
    let nextRefreshCursor: Int?
}

private struct StorefrontServerPackageEnvelope: Decodable {
    let ok: Bool
    let package: StorefrontServerPackageSnapshot
    let generatedAt: String?
    let expiresAt: String?
    let expired: Bool?
}

private struct StorefrontCreateSnapshotRequest: Encodable {
    let package: StorefrontServerPackageSnapshot
    let parentPackageId: String?
}

struct HotelStorefrontService {
    static let hotelFirstEngineVersion = 6

    private let api = APIClient.shared

    /// Reads the canonical server-owned package registry. Hotel First generation is
    /// deliberately not recreated on-device: the app consumes only immutable server
    /// snapshots produced from the published flight inventory and hotel catalogue.
    func serverPackagesPage(mode: String, origin: String) async throws -> StorefrontServerPackagesPage {
        let response: StorefrontServerPackagesEnvelope = try await api.get(
            "/api/storefront/packages",
            query: [
                URLQueryItem(name: "mode", value: mode),
                URLQueryItem(name: "origins", value: origin.uppercased()),
                URLQueryItem(name: "limit", value: mode == "hotel-first" ? "300" : "500")
            ],
            timeoutInterval: 25
        )
        guard response.ok else { throw APIError.invalidResponse }
        let itemCount = response.itemCount ?? response.items.count
        return StorefrontServerPackagesPage(
            cacheState: response.cacheState,
            refreshRecommended: response.refreshRecommended ?? (response.complete == false),
            generatedAt: response.generatedAt,
            expiresAt: response.expiresAt,
            itemCount: itemCount,
            totalItemCount: response.totalItemCount ?? itemCount,
            expectedItemCount: response.expectedItemCount,
            complete: response.complete ?? false,
            failedHotelCount: response.failedHotelCount ?? 0,
            nextRefreshCursor: max(0, response.nextRefreshCursor ?? 0),
            items: response.items
        )
    }

    func serverPackages(mode: String, origin: String) async throws -> [StorefrontServerPackageSnapshot] {
        try await serverPackagesPage(mode: mode, origin: origin).items
    }

    /// Advances one bounded Hotel First server batch. The server owns the package
    /// algorithm and D1 cache; iOS only asks it to continue the same daily build.
    func refreshServerPackages(mode: String, origin: String, cursor: Int) async throws -> StorefrontServerRefreshState {
        let response: StorefrontServerRefreshEnvelope = try await api.post(
            "/api/storefront/packages",
            body: StorefrontServerRefreshRequest(
                mode: mode,
                origin: origin.uppercased(),
                cursor: max(0, cursor)
            ),
            timeoutInterval: 45
        )
        guard response.ok else { throw APIError.invalidResponse }
        return StorefrontServerRefreshState(
            itemCount: response.itemCount ?? 0,
            expectedItemCount: response.expectedItemCount,
            complete: response.complete ?? false,
            failedHotelCount: response.failedHotelCount ?? 0,
            nextRefreshCursor: max(0, response.nextRefreshCursor ?? cursor)
        )
    }

    func packageSnapshot(id: String) async throws -> StorefrontServerPackageSnapshot {
        let response: StorefrontServerPackageEnvelope = try await api.get(
            "/api/storefront/packages/\(id)",
            timeoutInterval: 15
        )
        guard response.ok else { throw APIError.invalidResponse }
        return response.package
    }

    func createPackageSnapshot(
        _ package: StorefrontServerPackageSnapshot,
        parentPackageID: String?
    ) async throws -> StorefrontServerPackageSnapshot {
        let response: StorefrontServerPackageEnvelope = try await api.post(
            "/api/storefront/packages/snapshot",
            body: StorefrontCreateSnapshotRequest(package: package, parentPackageId: parentPackageID),
            timeoutInterval: 15
        )
        guard response.ok else { throw APIError.invalidResponse }
        return response.package
    }

    /// Flight First and the configurator read the same staff-published flight board.
    /// There is intentionally no fare-calendar/synthetic fallback here: a missing
    /// published row must stay missing instead of creating a second client-side truth.
    func flightBoard(origin: String = "TAS", allPublished: Bool = false) async throws -> StorefrontFlightBoardResponse {
        var query = [URLQueryItem(name: "origin", value: origin)]
        if allPublished { query.append(URLQueryItem(name: "all", value: "1")) }
        return try await api.get(
            "/api/package/storefront/flights",
            query: query,
            timeoutInterval: 10
        )
    }

    static func publicHotelToken(_ hotelID: String) -> String {
        Data(hotelID.utf8)
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func decodePublicHotelToken(_ token: String) -> String? {
        var value = token
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = value.count % 4
        if remainder != 0 { value += String(repeating: "=", count: 4 - remainder) }
        guard let data = Data(base64Encoded: value),
              let decoded = String(data: data, encoding: .utf8),
              !decoded.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return decoded
    }
}
