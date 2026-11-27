import Foundation

enum FlightDatePlanner {
    static func dates(anchor: Date, flexibility: DateFlexibility, calendar: Calendar = .current) -> [Date] {
        let start = calendar.startOfDay(for: anchor)
        switch flexibility {
        case .exact:
            return [start]
        case .plusMinusOne, .plusMinusTwo:
            // Legacy persisted values are deliberately collapsed to the anchor
            // date. Flexible discovery is now a zero-provider-cost D1 calendar;
            // never fan one customer tap into seven billable flight searches.
            return [start]
        case .weekend:
            // Weekend dates are normalized at TripDraft level to Friday → Monday.
            // Do not fan the flight search out to neighbouring weekends.
            return [start]
        }
    }
}
