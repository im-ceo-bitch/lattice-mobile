import Foundation

/// Creates a new route search, never a cached ticket/proposal deep link.
/// The date portion is taken from the supplier's ISO calendar date (not the
/// device timezone) so trips crossing time zones retain their correct day.
enum AviasalesSearchLinkBuilder {
    static func searchURL(
        origin: String,
        destination: String,
        departureAt: String,
        returnAt: String?,
        adults: Int,
        children: Int,
        infants: Int
    ) -> URL? {
        let from = origin.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let to = destination.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard isIATA(from), isIATA(to), from != to,
              (1...9).contains(adults), (0...9).contains(children), (0...9).contains(infants),
              let outbound = dateToken(departureAt) else { return nil }
        var query = from + outbound.token + to
        if let returnAt {
            guard let inbound = dateToken(returnAt), inbound.day >= outbound.day else { return nil }
            query += inbound.token
        }
        query += String(adults)
        if children != 0 || infants != 0 { query += String(children) }
        if infants != 0 { query += String(infants) }
        var components = URLComponents()
        components.scheme = "https"
        components.host = "www.aviasales.ru"
        components.path = "/search/" + query
        return components.url
    }

    private static func isIATA(_ code: String) -> Bool {
        code.count == 3 && code.unicodeScalars.allSatisfy { (65...90).contains(Int($0.value)) }
    }

    private static func dateToken(_ iso: String) -> (token: String, day: Date)? {
        // '2026-10-12T14:20:00+05:00' → 1210. Ignore the time zone
        // here: the specified calendar date belongs to the departure airport.
        let text = String(iso.prefix(10))
        let components = text.split(separator: "-", omittingEmptySubsequences: false)
        guard components.count == 3,
              components[0].count == 4, components[1].count == 2, components[2].count == 2,
              let y = Int(components[0]), let m = Int(components[1]), let d = Int(components[2]),
              (2000...2100).contains(y) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let parts = DateComponents(timeZone: calendar.timeZone, year: y, month: m, day: d)
        guard let day = calendar.date(from: parts),
              calendar.component(.year, from: day) == y,
              calendar.component(.month, from: day) == m,
              calendar.component(.day, from: day) == d else { return nil }
        return (String(format: "%02d%02d", d, m), day)
    }
}
