import Foundation
import CryptoKit
import SwiftUI

enum BookingStoreError: LocalizedError {
    case permanentDeleteUnavailable
    case authoritativeQuoteRequired
    case identityPending

    var errorDescription: String? {
        switch self {
        case .permanentDeleteUnavailable:
            return "Permanent booking deletion is not available on the server."
        case .identityPending:
            return "Booking saved. Waiting for server booking number and iumrah ID. Retry without creating another booking."
        case .authoritativeQuoteRequired:
            return "The package price must be confirmed by the secure iumrah PackageEngine before booking."
        }
    }
}
