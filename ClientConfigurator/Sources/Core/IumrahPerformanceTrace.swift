import Foundation
import os.log

/// Instruments Points of Interest. Static operation names only; no IDs, tokens,
/// prices, routes or other customer data are logged.
enum IumrahPerformanceTrace {
    private static let log = OSLog(subsystem: "com.iumrah.app", category: .pointsOfInterest)
    static func begin(_ name: StaticString) -> OSSignpostID {
        let id = OSSignpostID(log: log)
        os_signpost(.begin, log: log, name: name, signpostID: id)
        return id
    }
    static func end(_ name: StaticString, _ id: OSSignpostID) {
        os_signpost(.end, log: log, name: name, signpostID: id)
    }
    static func event(_ name: StaticString) {
        os_signpost(.event, log: log, name: name)
    }
}
