import Foundation

enum TripStatus: String, Codable, CaseIterable, Identifiable {
    case availabilityCheck = "availability_check"
    case paymentPending = "payment_pending"
    case bookingConfirmed = "booking_confirmed"
    case readyToTravel = "ready_to_travel"
    case inTrip = "in_trip"
    case completed
    case cancelled

    var id: String { rawValue }

    var title: String {
        switch self {
        case .availabilityCheck: return "Новый пакет создан · Проверка наличия"
        case .paymentPending: return "Наличие подтверждено · Оплата и данные паломников"
        case .bookingConfirmed: return "Подготовка поездки · Оплата подтверждена"
        case .readyToTravel: return "Документы готовы · Готово к поездке"
        case .inTrip: return "Паломник в поездке"
        case .completed: return "Поездка завершена"
        case .cancelled: return "Отменено"
        }
    }

    var shortTitle: String {
        switch self {
        case .availabilityCheck: return "Проверка наличия"
        case .paymentPending: return "Оплата и данные"
        case .bookingConfirmed: return "Подготовка поездки"
        case .readyToTravel: return "Готово к поездке"
        case .inTrip: return "В поездке"
        case .completed: return "Завершена"
        case .cancelled: return "Отменено"
        }
    }

    var isCompleted: Bool { self == .completed || self == .cancelled }

    var allowedTargets: [TripStatus] {
        switch self {
        case .availabilityCheck: return [.availabilityCheck, .paymentPending, .cancelled]
        case .paymentPending: return [.paymentPending, .availabilityCheck, .bookingConfirmed, .cancelled]
        case .bookingConfirmed: return [.bookingConfirmed, .paymentPending, .readyToTravel, .cancelled]
        case .readyToTravel: return [.readyToTravel, .bookingConfirmed, .inTrip, .cancelled]
        case .inTrip: return [.inTrip, .completed, .cancelled]
        case .completed: return [.completed]
        case .cancelled: return [.cancelled]
        }
    }
}


struct BusinessTeamMember: Codable, Identifiable, Hashable {
    let id: String
    var staffLogin: String?
    var firstName: String
    var lastName: String
    var displayName: String
    var roleKind: String
    var roleTitle: String
    var phoneUZ: String
    var phoneSA: String
    var telegram: String
    var whatsapp: String
    var instagram: String
    var bio: String
    var bioRU: String? = nil
    var bioUZ: String? = nil
    var bioUZCyrl: String? = nil
    var isHeadGuide: Bool? = nil
    var guideAvailability: String? = nil
    var publicRoles: [String]? = nil
    var publicSlug: String
    var publicVisible: Bool
    var active: Bool
    var isOwner: Bool
    var photoURL: String?
    var experienceYears: Int? = nil
    var languages: [String]? = nil
    var introVideoURL: String? = nil

    static var emptyGuide: BusinessTeamMember {
        BusinessTeamMember(
            id: "new", staffLogin: nil, firstName: "", lastName: "", displayName: "",
            roleKind: "guide", roleTitle: "Гид iumrah", phoneUZ: "", phoneSA: "",
            telegram: "", whatsapp: "", instagram: "", bio: "", publicSlug: "",
            publicVisible: true, active: true, isOwner: false, photoURL: nil
        )
    }
}

struct BusinessTeamMemberPayload: Encodable {
    let firstName: String
    let lastName: String
    let roleKind: String
    let roleTitle: String
    let phoneUZ: String
    let phoneSA: String
    let telegram: String
    let whatsapp: String
    let instagram: String
    let bio: String
    let bioRU: String?
    let bioUZ: String?
    let bioUZCyrl: String?
    let isHeadGuide: Bool?
    let guideAvailability: String?
    let publicRoles: [String]?
    let publicSlug: String
    let publicVisible: Bool
    let active: Bool
    let experienceYears: Int
    let languages: [String]
    let introVideoURL: String

    init(_ member: BusinessTeamMember) {
        firstName = member.firstName
        lastName = member.lastName
        roleKind = member.roleKind
        roleTitle = member.roleTitle
        phoneUZ = member.phoneUZ
        phoneSA = member.phoneSA
        telegram = member.telegram
        whatsapp = member.whatsapp
        instagram = member.instagram
        bio = member.bio
        bioRU = member.bioRU
        bioUZ = member.bioUZ
        bioUZCyrl = member.bioUZCyrl
        isHeadGuide = member.isHeadGuide
        guideAvailability = member.guideAvailability
        publicRoles = member.publicRoles
        publicSlug = member.publicSlug
        publicVisible = member.publicVisible
        active = member.active
        experienceYears = member.experienceYears ?? 0
        languages = member.languages ?? []
        introVideoURL = member.introVideoURL ?? ""
    }
}

struct BusinessTeamMemberResponse: Codable { let ok: Bool; let member: BusinessTeamMember }
struct BusinessTeamResponse: Codable { let ok: Bool; let members: [BusinessTeamMember] }

struct BusinessPaymentTemplate: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var visaCardNumber: String
    var visaHolder: String
    var hasPaymeQR: Bool
    var paymeQRURL: String?
    var humoCardNumber: String
    var humoHolder: String
    var instructions: String
    var createdAt: String
    var updatedAt: String

    static var empty: BusinessPaymentTemplate {
        BusinessPaymentTemplate(
            id: "new", name: "", visaCardNumber: "", visaHolder: "",
            hasPaymeQR: false, paymeQRURL: nil, humoCardNumber: "", humoHolder: "",
            instructions: "", createdAt: "", updatedAt: ""
        )
    }
}

struct BusinessPaymentTemplatePayload: Encodable {
    let name: String
    let visaCardNumber: String
    let visaHolder: String
    let humoCardNumber: String
    let humoHolder: String
    let instructions: String

    init(_ template: BusinessPaymentTemplate) {
        name = template.name
        visaCardNumber = template.visaCardNumber
        visaHolder = template.visaHolder
        humoCardNumber = template.humoCardNumber
        humoHolder = template.humoHolder
        instructions = template.instructions
    }
}

struct BusinessPaymentTemplatesResponse: Codable { let ok: Bool; let templates: [BusinessPaymentTemplate] }
struct BusinessPaymentTemplateResponse: Codable { let ok: Bool; let template: BusinessPaymentTemplate }

struct BookingOperation: Codable, Hashable {
    let tripID: String
    let bookingID: String
    let bookingNumber: Int?
    let bookingDisplayNumber: String?
    let pilgrimID: String
    let status: String
    let paymentStatus: String
    let confirmationNumber: String
    let internalNotes: String
    let startDate: String?
    let endDate: String?
    let createdAt: String
    let updatedAt: String
    let completedAt: String?
    let availabilityStartedAt: String?
    let availabilityDeadlineAt: String?
    let priceLockStartedAt: String?
    let priceLockExpiresAt: String?
    let paymentReceivedAt: String?
    let paymentConfirmationDeadlineAt: String?
    let documentsStartedAt: String?
    let documentsDeadlineAt: String?

    var tripStatus: TripStatus { TripStatus(rawValue: status) ?? .availabilityCheck }
}

struct BookingPricingLine: Codable, Identifiable, Hashable {
    let id: String
    let label: String
    let group: String
    let amount: Double
    let currency: String
}

struct BookingPricingReport: Codable, Hashable {
    let quoteId: String
    let pricingVersion: String
    let currency: String
    let context: BookingPricingContext
    let selectedPricingInputs: BookingPricingInputs
    let components: [BookingPricingComponent]
    let totals: BookingPricingTotals
    let selection: BookingGeneratorSelection?
    var tripSummaryReport: TripSummaryFinancialReport? = nil
}

struct BookingPricingContext: Codable, Hashable {
    let tier: String
    let tripType: String?
    let includeMadinah: Bool
    let totalDays: Int
    let travelers: BookingPricingTravelers
    let roomCount: Int
    let vehicleCount: Int
}

struct BookingPricingTravelers: Codable, Hashable {
    let adults: Int
    let children: Int
    let infants: Int
    let rooms: Int
}

struct BookingPricingInputs: Codable, Hashable {
    let journeyFare: BookingPricingFare?
    let outbound: BookingPricingFare?
    let inbound: BookingPricingFare?
    let makkahHotel: BookingPricingHotelInput
    let madinahHotel: BookingPricingHotelInput?
}

struct BookingPricingFare: Codable, Hashable {
    let candidateId: String
    let amount: Double
    let currency: String
    let fareScope: String
    let providerId: String
    let observedAt: String
    let travelDate: String
    let normalizedGroupUsd: Double
}

struct BookingPricingHotelInput: Codable, Hashable {
    let amountUsd: Double
    let unit: String
    let nights: Int
    let hotelId: String?
    let roomId: String?
    let pricingMode: String?
}

struct BookingPricingComponent: Codable, Identifiable, Hashable {
    var id: String { code }
    let code: String
    let label: String
    let supplierCostUsd: Double
}

struct BookingPricingTotals: Codable, Hashable {
    let supplierCostUsd: Double
    let markupRate: Double
    let markupAmountUsd: Double
    let subtotalAfterMarkupUsd: Double
    let paymentFeeRate: Double
    let paymentFeeAmountUsd: Double
    let calculatedSellingPriceUsd: Double
    let publicPricePerPilgrimUsd: Double
    let publicTotalUsd: Double
    let roundingDifferenceUsd: Double
    let estimatedProfitUsd: Double
}

struct BookingPricingOverride: Codable, Hashable {
    let bookingID: String
    let currency: String
    let components: [BookingPricingComponent]
    let markupRate: Double
    let paymentFeeRate: Double
    let travelerCount: Int
    let totals: BookingPricingTotals
    let updatedBy: String?
    let updatedAt: String
}

struct BookingPricingOverrideUpdatePayload: Encodable {
    let components: [BookingPricingComponent]
    let markupRate: Double
    let paymentFeeRate: Double
}

struct BookingPricingOverrideResponse: Decodable {
    let ok: Bool
    let pricing: BookingPricingOverride
}

struct IgnavUsageResponse: Decodable {
    let ok: Bool
    let usage: IgnavUsageSnapshot
}

struct IgnavUsageSnapshot: Codable, Hashable {
    let period: String
    let monthlyBudget: Int
    let successfulRequests: Int
    let remainingRequests: Int
    let usedFraction: Double
    let firstSuccessAt: String?
    let lastSuccessAt: String?
    let trackingNote: String
}

struct BookingGeneratorSelection: Codable, Hashable {
    let quoteId: String?
    let outbound: BookingGeneratorFlightSelection?
    let inbound: BookingGeneratorFlightSelection?
    let makkahHotel: BookingGeneratorHotelSelection?
    let madinahHotel: BookingGeneratorHotelSelection?
}

struct BookingGeneratorFlightSelection: Codable, Hashable {
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
    let segments: [BookingGeneratorFlightSegmentSelection]?
    let connectionAirports: [String]?
}

struct BookingGeneratorFlightSegmentSelection: Codable, Hashable {
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

struct BookingGeneratorHotelSelection: Codable, Hashable {
    let hotelId: String
    let hotelName: String
    let city: String
    let roomId: String?
    let roomName: String?
    let roomCategory: String?
}

struct BookingRequestField: Codable, Identifiable, Hashable {
    let id: String
    let label: String
    let group: String
    let value: String
}

struct BookingStatusHistoryItem: Codable, Hashable {
    let oldStatus: String?
    let newStatus: String
    let changedBy: String?
    let createdAt: String
}

struct PilgrimSummary: Codable, Identifiable, Hashable {
    let id: String
    let displayName: String
    let firstName: String
    let lastName: String
    let phone: String
    let email: String
    let totalTrips: Int
    let completedTrips: Int?
    let lastTripAt: String?
}

struct BusinessCheckoutTraveler: Codable, Identifiable, Hashable {
    var id: Int { position }
    let position: Int
    let travelerType: String
    let relationship: String?
    let firstName: String
    let middleName: String
    let lastName: String
    let gender: String
    let dateOfBirth: String
    let placeOfBirth: String
    let nationality: String
    let residenceCountry: String
    let passportNumber: String
    let passportIssueDate: String
    let passportExpiryDate: String
    let passportIssuingCountry: String
    let phone: String
    let email: String
    let emergencyName: String
    let emergencyPhone: String
    let emergencyRelation: String
    let hasPassport: Bool
    let completed: Bool
    let passportMediaURL: String?
}

struct BusinessPaymentInstructions: Codable, Hashable {
    let visaCardNumber: String
    let visaHolder: String
    let hasPaymeQR: Bool
    let humoCardNumber: String
    let humoHolder: String
    let instructions: String
}

struct BusinessPaymentReceipt: Codable, Identifiable, Hashable {
    let id: String
    let paymentMethod: String
    let note: String
    let reviewStatus: String
    let createdAt: String
    let contentType: String?
    let mediaURL: String
    var amountUsd: Double? = nil
    var reviewReason: String? = nil
}

struct BusinessTravelDocument: Codable, Identifiable, Hashable {
    let id: String
    let documentKind: String
    let title: String
    let contentType: String
    let createdAt: String
    let mediaURL: String
    let bookingReference: String?
    var slots: [String]? = nil
    var publicationStatus: String? = nil
}

struct BookingESIMProfile: Codable, Identifiable, Hashable {
    let id: String
    let bookingID: String
    let travelerPosition: Int?
    let label: String
    let provider: String
    let providerEsimID: String?
    let iccid: String
    let planName: String
    let countryCode: String
    let totalMB: Double
    let usedMB: Double
    let remainingMB: Double
    let validityDays: Int?
    let status: String
    let providerStatus: String?
    let providerSmdpStatus: String?
    let smdpAddress: String
    let activationCode: String
    let lpaString: String
    let qrCodeURL: String?
    let activatedAt: String?
    let expiresAt: String?
    let lastUsageSyncAt: String?
    let usageSource: String
    let createdAt: String
    let updatedAt: String

    var totalGB: Double { totalMB / 1024 }
    var usedGB: Double { usedMB / 1024 }
    var remainingGB: Double { remainingMB / 1024 }
    var usageAvailable: Bool { usageSource == "provider" || lastUsageSyncAt != nil }
    var usageProgress: Double { usageAvailable && totalMB > 0 ? min(max(remainingMB / totalMB, 0), 1) : 0 }
}

struct BookingESIMListResponse: Codable {
    let ok: Bool
    let bookingID: String
    let esims: [BookingESIMProfile]
}

struct BookingESIMResponse: Codable {
    let ok: Bool
    let esim: BookingESIMProfile
}

struct BookingESIMDeleteResponse: Codable {
    let ok: Bool
    let deletedEsimID: String
}

struct BookingESIMUpsertPayload: Encodable {
    let travelerPosition: Int?
    let label: String
    let provider: String
    let providerEsimID: String?
    let iccid: String
    let planName: String
    let countryCode: String
    let smdpAddress: String
    let activationCode: String
    let lpaString: String
    let qrCodeURL: String?
}

struct BusinessBookingRewards: Codable, Hashable {
    let totalUsd: Double
    let giftDiscountUsd: Double
    let creditAppliedUsd: Double
    let totalDiscountUsd: Double
    let payableUsd: Double
}

struct BusinessCheckout: Codable, Hashable {
    var rewards: BusinessBookingRewards? = nil
    let iumrahID: String
    let accountActive: Bool
    let activatedAt: String?
    let allTravelersComplete: Bool
    let travelers: [BusinessCheckoutTraveler]
    let payment: BusinessPaymentInstructions
    let receipts: [BusinessPaymentReceipt]
    let documents: [BusinessTravelDocument]
    var paymentReview: BusinessPaymentReview? = nil
    var documentRequirements: [BusinessDocumentRequirement]? = nil
}

struct BusinessPaymentInstructionsPayload: Encodable {
    let visaCardNumber: String
    let visaHolder: String
    let humoCardNumber: String
    let humoHolder: String
    let instructions: String
}

struct BusinessSecuritySubmission: Codable, Hashable {
    let bookingID: String
    let pilgrimID: String?
    let status: String
    let firstName: String
    let lastName: String
    let passportNumber: String
    let passportLast4: String
    let hasPassportPhoto: Bool
    let passportMediaURL: String?
    let submittedAt: String?
    let reviewedAt: String?
    let reviewedBy: String?
    let reviewNote: String
    let duplicateBookingID: String?

    var isPendingReview: Bool { ["submitted", "under_review"].contains(status) }
    var isConfirmed: Bool { status == "confirmed" }
    var needsCorrection: Bool { ["rejected", "needs_resubmission"].contains(status) }
}

struct BusinessSecurityReviewPayload: Encodable {
    let action: String
    let note: String
}

struct BusinessSecurityReviewResponse: Decodable {
    let ok: Bool
    let security: BusinessSecuritySubmission
}

struct BookingDetailResponse: Codable {
    let ok: Bool
    let booking: BookingSummary
    let operation: BookingOperation?
    let pilgrim: PilgrimSummary?
    let pricingLines: [BookingPricingLine]
    let pricingReport: BookingPricingReport?
    let pricingOverride: BookingPricingOverride?
    let requestFields: [BookingRequestField]
    let statusHistory: [BookingStatusHistoryItem]
    let flights: [BookingFlight]?
    let assignment: BookingAssignment?
    let esims: [BookingESIMProfile]?
    let checkout: BusinessCheckout?
    let security: BusinessSecuritySubmission?
    var operationsCenter: BookingOperationsCenter? = nil
}

struct BookingItineraryItem: Codable, Identifiable, Hashable {
    let id: String
    let bookingID: String
    var dateLocal: String
    var sortOrder: Int
    var title: String
    var subtitle: String
    var icon: String
    var location: String
    var notes: String
    let createdAt: String
    let updatedAt: String
    var executionState: String? = nil
    var timeLocal: String? = nil
    var endTimeLocal: String? = nil
}

struct BookingItineraryResponse: Codable {
    let ok: Bool
    let bookingID: String
    let items: [BookingItineraryItem]
}

struct BookingItineraryUpdatePayload: Encodable {
    let items: [BookingItineraryItem]
}

struct BookingOperationUpdatePayload: Encodable {
    let status: String
    let paymentStatus: String
    let confirmationNumber: String
    let internalNotes: String
    var cancellationReason: String? = nil
}

struct PilgrimsResponse: Codable { let ok: Bool; let pilgrims: [PilgrimSummary] }
struct PilgrimDetailResponse: Codable { let ok: Bool; let pilgrim: PilgrimSummary; let trips: [BookingOperation] }

struct PrimaryHotelAssignment: Codable, Identifiable {
    var id: String { "\(city)-\(stars)-\(position)" }
    let city: String
    let stars: Int
    let position: Int
    let hotel: HotelListItem
}

struct PrimaryHotelsResponse: Codable { let ok: Bool; let assignments: [PrimaryHotelAssignment] }
struct PrimaryHotelsUpdatePayload: Encodable { let city: String; let stars: Int; let hotelIDs: [String] }

enum BookingFlightDirection: String, Codable, CaseIterable, Identifiable {
    case outbound
    case `return`

    var id: String { rawValue }
    var title: String { self == .outbound ? "Рейс туда" : "Рейс обратно" }
}

struct BookingFlight: Codable, Identifiable, Hashable {
    var id: String { direction }
    let direction: String
    let flightNumber: String
    let callSign: String
    let airlineName: String
    let airlineIATA: String
    let airlineICAO: String
    let departureAirportIATA: String
    let departureAirportICAO: String
    let departureAirportName: String
    let arrivalAirportIATA: String
    let arrivalAirportICAO: String
    let arrivalAirportName: String
    let scheduledDepartureLocal: String
    let scheduledDepartureUTC: String
    let scheduledArrivalLocal: String
    let scheduledArrivalUTC: String
    let departureTerminal: String
    let arrivalTerminal: String
    let departureGate: String
    let arrivalGate: String
    let status: String
    let verificationProvider: String
    let verifiedAt: String?
    let lastCheckedAt: String?
}

struct FlightVerificationCandidate: Codable, Identifiable, Hashable {
    let id: String
    let flightNumber: String
    let callSign: String
    let airlineName: String
    let airlineIATA: String
    let airlineICAO: String
    let departureAirportIATA: String
    let departureAirportICAO: String
    let departureAirportName: String
    let arrivalAirportIATA: String
    let arrivalAirportICAO: String
    let arrivalAirportName: String
    let scheduledDepartureLocal: String
    let scheduledDepartureUTC: String
    let scheduledArrivalLocal: String
    let scheduledArrivalUTC: String
    let departureTerminal: String
    let arrivalTerminal: String
    let departureGate: String
    let arrivalGate: String
    let status: String
    let lastUpdatedUTC: String
}

struct FlightVerificationResponse: Codable {
    let ok: Bool
    let provider: String
    let verificationKey: String
    let cached: Bool
    let checkedAt: String
    let candidates: [FlightVerificationCandidate]
}

struct FlightVerificationPayload: Encodable {
    let flightNumber: String
    let dateLocal: String
    let force: Bool
}

struct SaveVerifiedFlightPayload: Encodable {
    let verificationKey: String
    let candidateID: String
}

struct BookingFlightResponse: Codable {
    let ok: Bool
    let flight: BookingFlight
}

struct BookingAssignment: Codable {
    var preferredGuideID: String? = nil
    var preferredGuideName: String? = nil
    let makkahHotelID: String?
    let madinahHotelID: String?
    let guideID: String?
    let makkahHotel: HotelListItem?
    let madinahHotel: HotelListItem?
    let guide: BusinessTeamMember?
    let guideIsPrimary: Bool
}

struct BookingAssignmentPayload: Encodable {
    let makkahHotelID: String?
    let madinahHotelID: String?
    let guideID: String?
}

struct BookingAssignmentResponse: Codable {
    let ok: Bool
    let assignment: BookingAssignment
}

struct BookingDeleteResponse: Codable {
    let ok: Bool
    let deletedBookingID: String
}


struct BusinessPaymentReview: Codable, Hashable {
    let dueCents: Int?
    let paidCents: Int
    let satisfied: Bool
    var historicalConfirmed: Bool? = nil
    var reconciliationRequired: Bool? = nil
    var reconciled: Bool? = nil
}
struct BusinessDocumentRequirement: Codable, Hashable, Identifiable {
    var id: String { key }
    let key: String
    let kind: String
    let label: String
    let travelerPosition: Int?
    let ready: Bool
    var state: String? = nil
}

struct BusinessUmrahCertificate: Codable, Hashable, Identifiable { let position: Int; let id: String; let name: String; let issuedAt: String }
struct BusinessTravelFeedback: Codable, Hashable { let rating: Int; let comment: String; let createdAt: String }
struct BookingFinancialClose: Codable, Hashable { let paidCents: Int; let refundedCents: Int; let expenseCents: Int; let retainedCents: Int; let netCents: Int; let reason: String; let actor: String; let createdAt: String }
struct BusinessCertificateHistory: Codable, Hashable, Identifiable { let id: String; let position: Int; let name: String; let action: String; let reason: String; let changedAt: String; let replacementID: String? }
struct BusinessHistoricalPayment: Codable, Hashable { let addedCents: Int; let reference: String; let reason: String; let actor: String; let createdAt: String }
struct BookingOperationsCenter: Codable, Hashable {
    var certificateHistory: [BusinessCertificateHistory]? = nil
    var historicalPayment: BusinessHistoricalPayment? = nil
    var certificates: [BusinessUmrahCertificate]? = nil
    var feedback: BusinessTravelFeedback? = nil
    var financialClose: BookingFinancialClose? = nil
    let services: [BookingServiceOperation]
    let manager: BookingResponsibleManager?
    let cancellationRequestedAt: String?
    let cancellation: BookingCancellationRecord?
    let audit: [BookingOperationAudit]
}
struct BookingServiceOperation: Codable, Hashable, Identifiable {
    var id: String { key }
    let key: String
    let label: String
    let availability: String
    let execution: String
    let reference: String
    let note: String
    let updatedAt: String?
    let updatedBy: String?
    var availabilityTitle: String { ["pending":"Ожидается", "confirmed":"Подтверждено", "unavailable":"Недоступно"][availability] ?? availability }
    var executionTitle: String { Self.executionTitle(execution) }
    static func executionTitle(_ value: String) -> String { ["planned":"Запланировано", "in_progress":"Выполняется", "completed":"Выполнено", "delayed":"Задерживается", "rescheduled":"Перенесено"][value] ?? value }
}
struct BookingResponsibleManager: Codable, Hashable { let id: String; let name: String; let active: Bool }
struct BookingCancellationRecord: Codable, Hashable {
    let reason: String; let actor: String; let createdAt: String
    let paidCents: Int; let historicalUnverified: Bool; let refundedCents: Int; let refunds: [BookingRefundRecord]
}
struct BookingRefundRecord: Codable, Hashable, Identifiable { let id: String; let amountCents: Int; let reference: String; let actor: String; let createdAt: String }
struct BookingOperationAudit: Codable, Hashable, Identifiable { let id: String; let action: String; let target: String; let actor: String; let createdAt: String }
struct BookingOperationTask: Codable, Hashable, Identifiable {
    var id: String { key }; let key: String; let priority: Int; let dueAt: String?
    var title: String { ["availability":"Проверить наличие", "receipt":"Проверить чек", "payment":"Ожидается оплата", "documents":"Подготовить документы", "ticket_purchase":"Проверить и купить билеты", "departure":"Вылет", "trip":"Сопровождение", "unassigned":"Назначить менеджера", "cancellation":"Запрос отмены", "refund":"Сверить возврат", "finance_close":"Закрыть финансы"][key] ?? key }
}
