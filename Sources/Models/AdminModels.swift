import Foundation

struct SessionUser: Codable {
    let login: String
    let role: String
    let displayName: String
}

struct SessionResponse: Codable {
    let authenticated: Bool
    let user: SessionUser?
}

struct LoginResponse: Codable {
    let ok: Bool?
    let role: String?
    let login: String?
    let error: String?
}

enum BookingStatus: String, Hashable, Codable {
    case availabilityCheck = "AVAILABILITY_CHECK"
    case paymentPending = "PAYMENT_PENDING"
    case bookingConfirmed = "BOOKING_CONFIRMED"
    case readyToTravel = "READY_TO_TRAVEL"
    case inTrip = "IN_TRIP"
    case completed = "COMPLETED"
    case cancelled = "CANCELLED"

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = (try? container.decode(String.self))?.uppercased() ?? "AVAILABILITY_CHECK"
        switch raw {
        case "NEW", "AVAILABILITY_CHECK": self = .availabilityCheck
        case "PAYMENT_PENDING": self = .paymentPending
        case "PAID", "BOOKING_CONFIRMED": self = .bookingConfirmed
        case "DOCUMENTS_READY", "READY_TO_TRAVEL": self = .readyToTravel
        case "IN_TRIP": self = .inTrip
        case "COMPLETED": self = .completed
        case "CANCELLED": self = .cancelled
        default: self = .availabilityCheck
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    var shortLabel: String {
        switch self {
        case .availabilityCheck: return "Проверка наличия"
        case .paymentPending: return "Оплата и данные"
        case .bookingConfirmed: return "Подтверждено"
        case .readyToTravel: return "Готово к поездке"
        case .inTrip: return "В поездке"
        case .completed: return "Завершена"
        case .cancelled: return "Отменено"
        }
    }
}

struct BookingSummary: Codable, Identifiable, Hashable {
    let id: String
    let status: BookingStatus
    let createdAt: String
    let updatedAt: String
    let lang: String
    let planId: String
    let totalUsd: Double
    let perPilgrimUsd: Double
    let travelerCount: Int
    let rooms: Int
    let originCode: String
    let outboundDestination: String
    let returnOrigin: String
    let startDate: String
    let endDate: String
    let flightName: String
    let makkahHotel: String
    let madinahHotel: String
    let clientName: String?
    let pilgrimID: String?
    let bookingNumber: Int?
    let bookingDisplayNumber: String?
    let tripID: String?
    let operationStatus: String?
}

struct BookingsResponse: Codable { let bookings: [BookingSummary] }

struct ChatThread: Codable, Identifiable {
    var id: String { conversationID }
    let conversationID: String
    let booking: BookingSummary?
    let pilgrimID: String?
    let pilgrimName: String?
    let tripCount: Int
    let relatedBookings: [BookingSummary]
    let lastMessageAt: String
    let lastMessagePreview: String
    let lastSenderType: String?
    let unreadForStaff: Bool
}

struct ChatsResponse: Codable { let threads: [ChatThread] }

struct BusinessChatThreadSummary: Codable, Identifiable, Hashable {
    var id: String { conversationID ?? bookingID }
    let bookingID: String
    let conversationID: String?
    let pilgrimID: String?
    let pilgrimName: String?
    let tripCount: Int?
    let lastMessageAt: String
    let lastMessagePreview: String
    let lastSenderType: String?
    let unreadForStaff: Bool
}

struct BusinessChatThreadsResponse: Codable {
    let ok: Bool
    let threads: [BusinessChatThreadSummary]
}

struct BusinessChatMessage: Codable, Identifiable, Hashable {
    let id: String
    let bookingID: String
    let senderType: String
    let senderName: String?
    let body: String
    let messageType: String?
    let attachmentID: String?
    let attachmentURL: String?
    let createdAt: String
    let readByStaff: Bool

    var isStaff: Bool { senderType == "staff" }
    var isImage: Bool { messageType == "image" && attachmentURL != nil }
}

struct BusinessChatMessagesResponse: Codable {
    let ok: Bool
    let bookingID: String
    let messages: [BusinessChatMessage]
    let nextCursor: String?
    let hasMore: Bool?
    let scopeVersion: String?
    let reset: Bool?
}

struct BusinessChatMessageResponse: Codable {
    let ok: Bool
    let message: BusinessChatMessage
}

struct SendBusinessChatMessagePayload: Encodable {
    let body: String
    let clientMessageID: String
}

struct PushDeviceRegistrationPayload: Encodable {
    let deviceToken: String
    let environment: String
}

struct PushDeviceRegistrationResponse: Codable {
    let ok: Bool
    let ready: Bool?
}

struct PushStatusResponse: Codable {
    let ok: Bool
    let configured: Bool
    let devices: Int
}
