import Foundation

/// Non-sensitive catalogue data only. Never cache final quotes or room-selection tokens here.
actor NuiteeDailyHotelCache {
    static let shared = NuiteeDailyHotelCache()
    private struct Entry: Codable {
        let savedAt: Date
        let response: NuiteeHotelListEnvelope
    }
    private let directory: URL
    private var hot: [String: Entry] = [:]
    private var order: [String] = []
    private var lastCleanup = Date.distantPast
    private func remember(_ entry: Entry, key: String) {
        hot[key] = entry
        order.removeAll { $0 == key }
        order.append(key)
        while order.count > 4 { hot.removeValue(forKey: order.removeFirst()) }
    }
    init(directory: URL? = nil) {
        self.directory = directory ?? (FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory)
            .appendingPathComponent("iumrah-nuitee-daily-v1", isDirectory: true)
    }
    static func isFresh(savedAt: Date, now: Date, calendar: Calendar = .autoupdatingCurrent) -> Bool {
        now >= savedAt && now.timeIntervalSince(savedAt) < 86_400 && calendar.isDate(savedAt, inSameDayAs: now)
    }
    private func file(_ key: String) -> URL {
        // All callers generate keys from normalized city, ISO dates and occupancy.
        let safe = key.map { $0.isLetter || $0.isNumber || $0 == "-" ? $0 : "_" }
        return directory.appendingPathComponent(String(safe) + ".json")
    }
    private func fresh(_ entry: Entry, key: String, now: Date) -> Bool {
        if key.hasPrefix("catalog-v2-") || key.hasPrefix("catalog-v3-") { return now >= entry.savedAt && now.timeIntervalSince(entry.savedAt) < 86_400 }
        if key.hasSuffix("-rates") { return now >= entry.savedAt && now.timeIntervalSince(entry.savedAt) < 900 }
        return Self.isFresh(savedAt: entry.savedAt, now: now)
    }
    func read(key: String, now: Date = Date()) -> NuiteeHotelListEnvelope? {
        if let entry = hot[key], fresh(entry, key: key, now: now) {
            remember(entry, key: key); return entry.response
        }
        hot.removeValue(forKey: key); order.removeAll { $0 == key }
        let url = file(key)
        guard let data = try? Data(contentsOf: url), let entry = try? JSONDecoder().decode(Entry.self, from: data), fresh(entry, key: key, now: now) else {
            try? FileManager.default.removeItem(at: url)
            return nil
        }
        remember(entry, key: key)
        return entry.response
    }
    func write(_ response: NuiteeHotelListEnvelope, key: String, now: Date = Date()) {
        let entry = Entry(savedAt: now, response: response)
        remember(entry, key: key)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(entry)
            try data.write(to: file(key), options: .atomic)
            guard now.timeIntervalSince(lastCleanup) >= 3600 else { return }
            lastCleanup = now
            // Remove yesterday's records even for searches not revisited today.
            for url in (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey])) ?? [] {
                if let date = try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate,
                   (date < now && now.timeIntervalSince(date) >= 86_400) { try? FileManager.default.removeItem(at: url) }
            }
        } catch { /* Cache failures must never prevent search or booking. */ }
    }
}
