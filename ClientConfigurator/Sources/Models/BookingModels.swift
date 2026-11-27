import Foundation


struct BookingGeneratorTrace: Codable, Hashable {
    var nuiteeRooms: [BookingNuiteeRoomSelection]? = nil
    let quoteId: String?
    let outbound: BookingGeneratorFlightSnapshot
    let inbound: BookingGeneratorFlightSnapshot?
    let makkahHotel: BookingGeneratorHotelSnapshot
    let madinahHotel: BookingGeneratorHotelSnapshot?
}

struct BookingGeneratorFlightSnapshot: Codable, Hashable {
    let candidateId: String?
    let airline: String
    let flightNumbers: String
    let origin: String
    let destination: String
    let departureAt: String
    let arrivalAt: String
    let source: String
    let stops: Int?
    let durationMinutes: Int?
    let segments: [BookingGeneratorFlightSegmentSnapshot]?
    let connectionAirports: [String]?
}

struct BookingGeneratorFlightSegmentSnapshot: Codable, Hashable {
    let airline: String
    let airlineCode: String?
    let flightNumber: String
    let origin: String
    let destination: String
    let departureAt: String
    let arrivalAt: String
    let originTerminal: String?
    let destinationTerminal: String?
    let aircraft: String?
    let operatingCarrier: String?
    let cabin: String?
}

struct BookingGeneratorHotelSnapshot: Codable, Hashable {
    let hotelId: String
    let hotelName: String
    let city: String
    let roomId: String?
    let roomName: String?
    let roomCategory: String?
}

struct BookingPilgrimProfile: Codable, Hashable {
    let firstName: String
    let lastName: String
    let telegram: String
    let whatsapp: String

    var displayName: String {
        [firstName, lastName]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }
}

struct BookingTravelers: Codable, Hashable {
    let adults: Int
    let children: Int
    let infants: Int
    let rooms: Int

    var totalPeople: Int { adults + children + infants }
}

struct BookingRoute: Codable, Hashable {
    let originCode: String
    let outboundDestination: String
    let returnOrigin: String
}

struct BookingStay: Codable, Hashable {
    let totalDays: Int
    let totalNights: Int
    let makkahCheckIn: String
    let makkahCheckOut: String
    let makkahNights: Int
    let madinahCheckIn: String?
    let madinahCheckOut: String?
    let madinahNights: Int?
}

struct BookingCustomization: Codable, Hashable {
    let accompaniment: Bool
    let guideMeetingPoint: String
    let ziyaratMakkah: Bool
    let ziyaratMadinah: Bool
    let meals: Bool
    let esim: Bool
    var preferredGuideID: String? = nil
}

struct BookingHotelNames: Codable, Hashable {
    let makkah: String
    let madinah: String
}

struct RemoteBooking: Codable, Identifiable, Hashable {
    let id: String
    let status: String
    let planId: String
    let totalUsd: Double
    let perPilgrimUsd: Double
    let input: BookingInputRecord
    let route: BookingRoute
    let stay: BookingStay
    let hotelNames: BookingHotelNames
    let flight: String
    let createdAt: String
    let updatedAt: String
    let pilgrimProfile: BookingPilgrimProfile?
    let hotelSelection: BookingHotelSelectionSnapshot?
    let madinahHotelSelection: BookingHotelSelectionSnapshot?
    let customization: BookingCustomization?
    let includedServices: [String]?
    let generatorTrace: BookingGeneratorTrace?
    // Native Business offers return this identifier; older bookings omit it.
    var offerPackageID: String? = nil
}

struct BookingInputRecord: Codable, Hashable {
    let startDate: String
    let endDate: String
    let from: String
    let originCode: String
    let arrivalAirportCode: String
    let includeMadinah: Bool
    let travelers: BookingTravelers
}

struct ChatListResponse: Decodable {
    let ok: Bool?
    let bookingID: String?
    let messages: [ChatMessage]
    let nextCursor: String?
    let hasMore: Bool?
    let staffReadMessageIDs: [String]?
    let scopeVersion: String?
    let reset: Bool?
}

struct ChatMessagePostResponse: Decodable {
    let ok: Bool?
    let message: ChatMessage
}

struct ChatMessage: Codable, Identifiable, Hashable {
    let id: String
    let bookingID: String
    let senderType: String
    let senderName: String?
    let body: String
    let messageType: String?
    let attachmentID: String?
    let attachmentURL: String?
    let createdAt: String
    var readByStaff: Bool?
}

struct BookingStatusHistoryEntry: Codable, Hashable {
    let oldStatus: String?
    let newStatus: String
    let createdAt: String
}

struct BookingGuideSnapshot: Codable, Hashable {
    let id: String
    let displayName: String
    let roleTitle: String
    let phoneUZ: String
    let phoneSA: String
    let telegram: String
    let whatsapp: String
    let bio: String
}

struct ClientTripSnapshot: Decodable, Hashable {
    let tripID: String
    let bookingID: String
    let bookingNumber: Int?
    let bookingDisplayNumber: String?
    let pilgrimID: String?
    let status: String
    let paymentStatus: String?
    let confirmationNumber: String?
    let startDate: String?
    let endDate: String?
    let createdAt: String?
    let updatedAt: String?
    let completedAt: String?
    let availabilityStartedAt: String?
    let availabilityDeadlineAt: String?
    let priceLockStartedAt: String?
    let priceLockExpiresAt: String?
    let paymentReceivedAt: String?
    let paymentConfirmationDeadlineAt: String?
    let documentsStartedAt: String?
    let documentsDeadlineAt: String?
}

struct StoredBookingSession: Codable, Identifiable, Hashable {
    let id: String
    let accessToken: String
    var booking: RemoteBooking
    var travelerName: String?
    var telegram: String?
    var whatsapp: String?
    var outboundFlight: FlightOffer?
    var inboundFlight: FlightOffer?
    var hotelSelection: BookingHotelSelectionSnapshot?
    var madinahHotelSelection: BookingHotelSelectionSnapshot? = nil
    var guide: BookingGuideSnapshot? = nil
    var transferVehicle: TransferVehicleKind? = nil
    var ziyaratMakkahOverride: Bool? = nil
    var ziyaratMadinahOverride: Bool? = nil
    var esimOverride: Bool? = nil
    var pendingChangeConfirmation: Bool? = nil
    var operationStatus: String? = nil
    var pilgrimID: String? = nil
    var bookingNumber: Int? = nil
    var bookingDisplayNumber: String? = nil
    var availabilityStartedAt: String? = nil
    var availabilityDeadlineAt: String? = nil
    var priceLockStartedAt: String? = nil
    var priceLockExpiresAt: String? = nil
    var paymentReceivedAt: String? = nil
    var paymentConfirmationDeadlineAt: String? = nil
    var documentsStartedAt: String? = nil
    var documentsDeadlineAt: String? = nil
    var statusHistory: [BookingStatusHistoryEntry]? = nil
    /// Opaque encrypted server quote retained only until the Business pricing report
    /// has been committed. It contains no client-readable supplier pricing.
    var pendingGeneratorQuoteProof: String? = nil
    // Verified notification contact, persisted only in the existing Keychain booking vault.
    var verifiedBookingEmail: String? = nil
    var verifiedBookingPhone: String? = nil

    mutating func mergeOperationalTrip(_ trip: ClientTripSnapshot, statusHistory: [BookingStatusHistoryEntry]? = nil) {
        operationStatus = trip.status
        pilgrimID = trip.pilgrimID ?? pilgrimID
        bookingNumber = trip.bookingNumber ?? bookingNumber
        bookingDisplayNumber = trip.bookingDisplayNumber ?? bookingDisplayNumber
        availabilityStartedAt = trip.availabilityStartedAt
        availabilityDeadlineAt = trip.availabilityDeadlineAt
        priceLockStartedAt = trip.priceLockStartedAt
        priceLockExpiresAt = trip.priceLockExpiresAt
        paymentReceivedAt = trip.paymentReceivedAt
        paymentConfirmationDeadlineAt = trip.paymentConfirmationDeadlineAt
        documentsStartedAt = trip.documentsStartedAt
        documentsDeadlineAt = trip.documentsDeadlineAt
        if let statusHistory { self.statusHistory = statusHistory }
    }

    var orderedStatusHistory: [BookingStatusHistoryEntry] {
        (statusHistory ?? []).sorted { $0.createdAt < $1.createdAt }
    }

    func latestStatusTimestamp(matching statuses: Set<String>) -> String? {
        let normalizedStatuses = Set(
            statuses.map {
                $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            }
        )
        return orderedStatusHistory
            .filter {
                normalizedStatuses.contains(
                    $0.newStatus.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                )
            }
            .last?
            .createdAt
    }

    var displayPilgrimID: String? {
        guard let raw = pilgrimID?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        let digits = raw.filter(\.isNumber)
        guard !digits.isEmpty, digits.count <= 8 else { return nil }
        return String(repeating: "0", count: 8 - digits.count) + digits
    }

    var hasServerIdentity: Bool {
        guard let pilgrimID, let bookingNumber, bookingNumber > 0,
              let number = Int(pilgrimID), number > 0, pilgrimID.count <= 8 else { return false }
        return pilgrimID.allSatisfy(\.isNumber)
    }

    var displayBookingNumber: String {
        if let value = bookingDisplayNumber?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty { return value }
        if let bookingNumber, bookingNumber > 0 { return "#" + String(format: "%04d", bookingNumber) }
        return "#----"
    }

    var effectiveStatus: String {
        guard let operationStatus, !operationStatus.isEmpty else { return booking.status }
        switch operationStatus.lowercased() {
        case "new", "availability_check": return "AVAILABILITY_CHECK"
        case "payment_pending": return "PAYMENT_PENDING"
        case "paid", "booking_confirmed": return "BOOKING_CONFIRMED"
        case "documents_ready", "ready_to_travel": return "READY_TO_TRAVEL"
        case "in_trip": return "IN_TRIP"
        case "completed": return "COMPLETED"
        case "cancelled": return "CANCELLED"
        default:
            switch booking.status.uppercased() {
            case "NEW", "AVAILABILITY_CHECK": return "AVAILABILITY_CHECK"
            case "PAID", "BOOKING_CONFIRMED": return "BOOKING_CONFIRMED"
            case "DOCUMENTS_READY", "READY_TO_TRAVEL": return "READY_TO_TRAVEL"
            default: return booking.status
            }
        }
    }
}


/// Exact supplier room identities travel with the canonical booking, not a Care request.
struct BookingNuiteeRoomSelection: Codable, Hashable {
    let id: String
    let city: String
    let hotelId: String
    let offerId: String
    let roomId: String
    let checkin: String
    let checkout: String
    let adults: Int
    let children: [Int]
    var meals: HotelMealChoices? = nil
    // Keep newer configurator payloads intact when merging chat/identity updates.
    var mealBundleRequested: BookingMealBundlePayload? = nil
}

extension BookingNuiteeRoomSelection {
    // The configurator may use a Bool or a structured Codable meal selection.
    // Do not discard or stringify either: preserve its original JSON wire value.
    init<Bundle: Encodable>(id: String, city: String, hotelId: String, offerId: String,
                            roomId: String, checkin: String, checkout: String,
                            adults: Int, children: [Int], meals: HotelMealChoices? = nil,
                            mealBundleRequested: Bundle?) {
        self.init(id: id, city: city, hotelId: hotelId, offerId: offerId, roomId: roomId,
                  checkin: checkin, checkout: checkout, adults: adults, children: children,
                  meals: meals, mealBundleRequested: mealBundleRequested.map { BookingMealBundlePayload(value: $0) })
    }
}

/// Lossless JSON-compatible representation of a meal bundle request. The wrapper
/// encodes its value directly, not as a nested object or JSON string.
indirect enum BookingMealBundlePayload: Codable, Hashable {
    case null
    case boolean(Bool)
    case integer(Int64)
    case number(Decimal)
    case string(String)
    case array([BookingMealBundlePayload])
    case object([String: BookingMealBundlePayload])
    case invalid

    init<T: Encodable>(value: T) {
        do {
            let data = try JSONEncoder().encode(value)
            self = try JSONDecoder().decode(Self.self, from: data)
        } catch {
            // Fail when the request is encoded rather than silently dropping a selection.
            self = .invalid
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .boolean(value) }
        else if let value = try? container.decode(Int64.self) { self = .integer(value) }
        else if let value = try? container.decode(Decimal.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([Self].self) { self = .array(value) }
        else { self = .object(try container.decode([String: Self].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .boolean(let value): try container.encode(value)
        case .integer(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .invalid:
            throw EncodingError.invalidValue(self, .init(codingPath: encoder.codingPath,
                debugDescription: "Invalid meal bundle request"))
        }
    }
}

extension StoredBookingSession {
    var availabilityEstimateDeadline: Date? {
        IumrahBookingAvailabilityEstimate.deadline(
            start: availabilityStartedAt ?? latestStatusTimestamp(matching: ["availability_check", "new"]),
            created: booking.createdAt, serverDeadline: availabilityDeadlineAt
        )
    }

    var isCheckingAvailability: Bool {
        ["NEW", "AVAILABILITY_CHECK"].contains(effectiveStatus.uppercased())
    }
}
