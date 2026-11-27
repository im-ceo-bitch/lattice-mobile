import Foundation

struct TripStayBreakdown: Hashable {
    let totalNights: Int
    let totalDays: Int
    let makkahNights: Int
    let madinahNights: Int
}

struct TripStayWindow: Hashable {
    let checkIn: Date
    let checkOut: Date

    var nights: Int {
        let calendar = Calendar(identifier: .gregorian)
        return max(1, calendar.dateComponents([.day], from: calendar.startOfDay(for: checkIn), to: calendar.startOfDay(for: checkOut)).day ?? 1)
    }
}

struct TripStayWindows: Hashable {
    let makkah: TripStayWindow
    let madinah: TripStayWindow?
}

enum TripStayPlanner {
    static func breakdown(for trip: TripDraft, calendar: Calendar = .current) -> TripStayBreakdown {
        let start = calendar.startOfDay(for: trip.hotelStayStartDate)
        let end = calendar.startOfDay(for: trip.returnDate)
        let rawNights = calendar.dateComponents([.day], from: start, to: end).day ?? 1
        let totalNights = max(1, rawNights)
        let totalDays = totalNights + 1

        guard trip.scope == .makkahAndMadinah, totalNights > 1 else {
            return TripStayBreakdown(totalNights: totalNights, totalDays: totalDays, makkahNights: totalNights, madinahNights: 0)
        }

        if trip.hotelFirstStayPolicy == true, totalNights >= 4 {
            // Hotel First keeps Madinah at two nights and gives the remaining stay
            // to Makkah: 4 = 2+2, 5 = 3+2, 7 = 5+2. Other package flows retain
            // their historical 60/40 planner below.
            let madinah = min(2, max(1, totalNights - 2))
            let makkah = max(1, totalNights - madinah)
            return TripStayBreakdown(totalNights: totalNights, totalDays: totalDays, makkahNights: makkah, madinahNights: madinah)
        }

        let makkah = max(1, min(totalNights - 1, Int(ceil(Double(totalNights) * 0.6))))
        let madinah = max(1, totalNights - makkah)
        return TripStayBreakdown(totalNights: totalNights, totalDays: totalDays, makkahNights: makkah, madinahNights: madinah)
    }

    /// Authoritative hotel calendar for both Jeddah-first and Madinah-first trips.
    /// All hotel price searches and booking drafts must use this same planner so a
    /// MED arrival can never price Makkah on the wrong dates.
    static func windows(for trip: TripDraft, calendar: Calendar = .current) -> TripStayWindows {
        let stay = breakdown(for: trip, calendar: calendar)
        let start = calendar.startOfDay(for: trip.hotelStayStartDate)
        let end = calendar.startOfDay(for: trip.returnDate)

        guard trip.scope == .makkahAndMadinah else {
            return TripStayWindows(makkah: TripStayWindow(checkIn: start, checkOut: end), madinah: nil)
        }

        if trip.arrivalAirport == .madinah {
            let madinahEnd = calendar.date(byAdding: .day, value: stay.madinahNights, to: start) ?? start
            return TripStayWindows(
                makkah: TripStayWindow(checkIn: madinahEnd, checkOut: end),
                madinah: TripStayWindow(checkIn: start, checkOut: madinahEnd)
            )
        }

        let makkahEnd = calendar.date(byAdding: .day, value: stay.makkahNights, to: start) ?? start
        return TripStayWindows(
            makkah: TripStayWindow(checkIn: start, checkOut: makkahEnd),
            madinah: TripStayWindow(checkIn: makkahEnd, checkOut: end)
        )
    }
}
