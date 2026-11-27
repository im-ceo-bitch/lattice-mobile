import SwiftUI

private extension StoredBookingSession {
    var ziyaratMakkahEnabled: Bool {
        ziyaratMakkahOverride ?? booking.customization?.ziyaratMakkah ?? false
    }

    var ziyaratMadinahEnabled: Bool {
        ziyaratMadinahOverride ?? booking.customization?.ziyaratMadinah ?? false
    }

    var esimEnabled: Bool {
        esimOverride ?? booking.customization?.esim ?? false
    }
}
