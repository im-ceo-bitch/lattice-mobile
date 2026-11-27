import Foundation

actor IumrahHotelReviewCache {
    static let shared = IumrahHotelReviewCache()
    struct Snapshot {
        var reviews: [NuiteeGuestReview]
        var nextOffset: Int?
        var total: Int?
        var stale: Bool
        var date: Date
    }
    private var cache: [String: Snapshot] = [:]
    private var pending: [String: Task<Snapshot, Error>] = [:]

    func load(hotelID: String, language: String, more: Bool) async throws -> Snapshot {
        let key = hotelID + "|" + language
        if let task = pending[key] { return try await task.value }
        let existing = cache[key]
        if !more, let existing, Date().timeIntervalSince(existing.date) < 1800 { return existing }
        if more, let existing, existing.nextOffset == nil { return existing }
        let offset = more ? (existing?.nextOffset ?? 0) : 0
        let task = Task<Snapshot, Error> {
            let response = try await NuiteeHotelService().reviews(hotelID: hotelID, language: language, offset: offset)
            guard response.ok else { throw APIError.invalidResponse }
            var reviews = offset == 0 ? [] : (existing?.reviews ?? [])
            var ids = Set(reviews.map(\.id))
            reviews += response.reviews.filter { ids.insert($0.id).inserted }
            let next = response.nextOffset.flatMap { $0 > offset ? $0 : nil }
            return Snapshot(reviews: reviews, nextOffset: next, total: response.total ?? existing?.total, stale: response.stale, date: Date())
        }
        pending[key] = task
        do {
            let value = try await task.value
            pending[key] = nil
            if cache.count >= 60, cache[key] == nil { cache.removeAll() }
            cache[key] = value
            return value
        } catch {
            pending[key] = nil
            // On re-entry retain a previously loaded page if refresh fails.
            if !more, var existing { existing.stale = true; return existing }
            throw error
        }
    }
}
