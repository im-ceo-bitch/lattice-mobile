import Foundation

/// Customer-facing estimate, not the operational deadline or a payment lock.
enum IumrahBookingAvailabilityEstimate {
    static let duration: TimeInterval = 30 * 60

    static func deadline(start: String?, created: String, serverDeadline: String?) -> Date? {
        guard let anchor = start.flatMap(parse) ?? parse(created) else { return nil }
        let estimate = anchor.addingTimeInterval(duration)
        // Respect an earlier server target; never extend the 30-minute estimate.
        return serverDeadline.flatMap(parse).map { min($0, estimate) } ?? estimate
    }

    static func remaining(until deadline: Date, now: Date) -> Int {
        let seconds = deadline.timeIntervalSince(now)
        return Int(max(0, min(duration, seconds)).rounded(.up))
    }

    private static func parse(_ raw: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: raw) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: raw)
    }
}
