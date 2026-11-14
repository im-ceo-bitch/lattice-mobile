import Foundation

@main
struct BusinessSessionMemoryCacheTests {
    static func main() {
        var passed = 0
        func expect(_ condition: @autoclosure () -> Bool, _ label: String) {
            guard condition() else { fatalError(label) }
            passed += 1
        }
        let now = Date(timeIntervalSince1970: 100)
        func at(_ seconds: TimeInterval) -> Date { now.addingTimeInterval(seconds) }
        var cache = BusinessSessionMemoryCache<String>(maxEntries: 2, maxCost: 10, ttl: 10)
        cache.insert("first", for: "a", token: nil, cost: 4, now: now)
        expect(cache.value(for: "a", token: nil, now: now) == nil, "anonymous insert blocked")
        cache.insert("first", for: "a", token: "staff-A", cost: 4, now: now)
        expect(cache.value(for: "a", token: "staff-A", now: at(1)) == "first", "same session hit")
        expect(cache.value(for: "a", token: "staff-B", now: at(2)) == nil, "different session blocked")
        expect(cache.value(for: "a", token: "staff-A", now: at(3)) == nil, "switch clears previous session")
        cache.insert("a", for: "a", token: "staff-A", cost: 4, now: now)
        cache.insert("b", for: "b", token: "staff-A", cost: 4, now: at(1))
        expect(cache.value(for: "a", token: "staff-A", now: at(2)) == "a", "touch updates LRU")
        cache.insert("c", for: "c", token: "staff-A", cost: 4, now: at(3))
        expect(cache.value(for: "b", token: "staff-A", now: at(4)) == nil, "entry cap evicts oldest")
        expect(cache.value(for: "a", token: "staff-A", now: at(4)) == "a", "recent entry survives")
        cache.insert("large", for: "d", token: "staff-A", cost: 9, now: at(5))
        expect(cache.value(for: "a", token: "staff-A", now: at(6)) == nil, "byte budget evicts old entries")
        expect(cache.value(for: "d", token: "staff-A", now: at(6)) == "large", "bounded payload stored")
        cache.insert("oversized", for: "e", token: "staff-A", cost: 11, now: at(6))
        expect(cache.value(for: "e", token: "staff-A", now: at(7)) == nil, "oversized entry rejected")
        expect(cache.value(for: "d", token: "staff-A", now: at(14)) == "large", "TTL not yet expired")
        expect(cache.value(for: "d", token: "staff-A", now: at(15)) == nil, "TTL not extended on reads")
        cache.insert("first", for: "a", token: "staff-A", cost: 9, now: now)
        cache.insert("replacement", for: "a", token: "staff-A", cost: 2, now: at(1))
        cache.insert("other", for: "b", token: "staff-A", cost: 8, now: at(2))
        expect(cache.value(for: "a", token: "staff-A", now: at(3)) == "replacement", "replacement updates byte accounting")
        expect(cache.value(for: "b", token: "staff-A", now: at(3)) == "other", "new entry fits revised budget")
        cache.clear()
        expect(cache.value(for: "a", token: "staff-A", now: at(4)) == nil, "explicit purge")
        cache.insert("a", for: "a", token: "staff-A", cost: 1, now: now)
        expect(cache.value(for: "a", token: "", now: at(1)) == nil, "empty session blocked")
        expect(cache.value(for: "a", token: "staff-A", now: at(2)) == nil, "logout purges old entries")
        print("Business memory cache: \(passed)/\(passed) checks passed")
    }
}
