import Foundation

struct BusinessManualBookingReceipt: Codable, Equatable {
    let bookingID: String
    let bookingNumber: Int?
    let pilgrimID: String?
    let identityReady: Bool
    let shareURL: String
    let emailStatus: String
    let totalUsd: Double
    var emailDescription: String {
        switch emailStatus {
        case "accepted": return "Принято почтовым сервисом"
        case "failed": return "Не отправлено · повторите"
        case "not_configured": return "Сервис не настроен"
        default: return "Не запрошено"
        }
    }
}


struct BusinessManualBookingInfo: Codable {
    let manual: Bool
    let cost: [String: Double]?
    let emailStatus: String?
}
