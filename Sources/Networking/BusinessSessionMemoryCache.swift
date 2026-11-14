import Foundation

/// Session-isolated, bounded, memory-only cache. No staff data is written to disk.
struct BusinessSessionMemoryCache<Value> {
    private struct Entry {
        let value: Value
        let cost: Int
        let expiresAt: Date
        var touchedAt: Date
    }
    private let maxEntries: Int
    private let maxCost: Int
    private let ttl: TimeInterval
    private var session: String?
    private var entries: [String: Entry] = [:]
    private var cost = 0

    init(maxEntries: Int, maxCost: Int, ttl: TimeInterval) {
        self.maxEntries = maxEntries
        self.maxCost = maxCost
        self.ttl = ttl
    }

    mutating func clear() {
        entries.removeAll()
        cost = 0
        session = nil
    }

    private mutating func prepare(_ token: String?, now: Date) -> Bool {
        if session != token { clear(); session = token }
        guard let token, !token.isEmpty else { clear(); return false }
        for key in entries.filter({ $0.value.expiresAt <= now }).map(\.key) { remove(key) }
        return true
    }

    private mutating func remove(_ key: String) {
        if let old = entries.removeValue(forKey: key) { cost -= old.cost }
    }

    mutating func value(for key: String, token: String?, now: Date = Date()) -> Value? {
        guard prepare(token, now: now), var entry = entries[key] else { return nil }
        entry.touchedAt = now
        entries[key] = entry
        return entry.value
    }

    mutating func insert(_ value: Value, for key: String, token: String?, cost itemCost: Int, now: Date = Date()) {
        guard prepare(token, now: now) else { return }
        remove(key)
        guard itemCost >= 0, itemCost <= maxCost, maxEntries > 0, ttl > 0 else { return }
        while entries.count >= maxEntries || cost > maxCost - itemCost {
            guard let oldest = entries.min(by: { $0.value.touchedAt < $1.value.touchedAt })?.key else { return }
            remove(oldest)
        }
        entries[key] = Entry(value: value, cost: itemCost, expiresAt: now.addingTimeInterval(ttl), touchedAt: now)
        cost += itemCost
    }
}
