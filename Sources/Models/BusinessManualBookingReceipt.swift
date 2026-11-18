import Foundation

struct BusinessManualBookingReceipt: Codable, Equatable {
    let bookingID: String
    let bookingNumber: Int?
    let pilgrimID: String?
    let identityReady: Bool
    let shareURL: String
    let emailStatus: String
    let totalUsd: Double
    var packageID: String? = nil
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
    var packageID: String? = nil
    var shareURL: String? = nil
    var tripSummaryReport: TripSummaryFinancialReport? = nil
}

struct BusinessOffer: Codable, Equatable, Identifiable {
    let id: String
    let revision: Int
    let status: String
    let totalUsd: Double
    let travelers: Int
    let startDate: String
    let endDate: String
    let makkah: String
    let lang: String
    let createdAt: String
    let expiresAt: String
    let views: Int
    let sentAt: String?
    let firstViewedAt: String?
    let bookingID: String?
    let convertedAt: String?
    let shareURL: String
    var source: String? = nil
    var isClientSaved: Bool { source == "client" }
    var editable: Bool { !isClientSaved && status != "converted" && status != "revoked" }
    var active: Bool { status != "converted" && status != "revoked" && status != "expired" }
    var statusTitle: String {
        switch status {
        case "saved": return "Сохранено клиентом"
        case "created": return "Создано"
        case "sent": return "Отмечено отправленным"
        case "viewed": return "Просмотрено"
        case "converted": return "Забронировано"
        case "expired": return "Срок истёк"
        case "revoked": return "Отозвано"
        default: return status
        }
    }
}
struct BusinessOfferEvent: Codable, Equatable {
    let kind: String
    let createdAt: String
    var title: String {
        switch kind {
        case "client_saved": return "Клиент сохранил пакет"
        case "client_updated": return "Клиент обновил пакет"
        case "created": return "Пакет создан"
        case "sent": return "Отмечено отправленным"
        case "first_viewed": return "Первый просмотр ссылки"
        case "converted": return "Бронирование создано"
        case "edited": return "Пакет обновлён"
        case "revoked": return "Предложение отозвано"
        default: return kind
        }
    }
}
struct BusinessOfferDetail: Decodable {
    let offer: BusinessOffer
    let editorDraft: String
    let events: [BusinessOfferEvent]
    let tripSummaryReport: TripSummaryFinancialReport?
    private enum CodingKeys: String, CodingKey { case editorDraft, events, tripSummaryReport }
    init(from decoder: Decoder) throws {
        offer = try BusinessOffer(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        editorDraft = try c.decode(String.self, forKey: .editorDraft)
        events = try c.decode([BusinessOfferEvent].self, forKey: .events)
        tripSummaryReport = try c.decodeIfPresent(TripSummaryFinancialReport.self, forKey: .tripSummaryReport)
    }
}
