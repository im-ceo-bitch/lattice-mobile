import Foundation

extension APIClient {
    func offerRequest<T: Decodable>(path: String, method: String = "GET", payload: [String: Any]? = nil) async throws -> T {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: path))
        request.httpMethod = method; request.timeoutInterval = 40
        if let payload {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        }
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(T.self, from: data)
    }
    func listOffers() async throws -> [BusinessOffer] {
        struct Result: Decodable { let offers: [BusinessOffer] }
        let result: Result = try await offerRequest(path: "/api/admin/offers")
        return result.offers
    }
    func offerDetail(id: String) async throws -> BusinessOfferDetail { try await offerRequest(path: "/api/admin/offers/\(id)") }
    func createOffer(_ draft: UmrahPackageDraft) async throws -> BusinessOffer {
        var payload = try manualPackagePayload(draft); payload["mode"] = "offer"
        return try await offerRequest(path: "/api/admin/offers", method: "POST", payload: payload)
    }
    func editOffer(_ offer: BusinessOffer, draft: UmrahPackageDraft) async throws -> BusinessOffer {
        var payload = try manualPackagePayload(draft); payload["action"] = "edit"; payload["revision"] = offer.revision
        return try await offerRequest(path: "/api/admin/offers/\(offer.id)", method: "PATCH", payload: payload)
    }
    func changeOffer(_ offer: BusinessOffer, action: String) async throws -> BusinessOffer {
        try await offerRequest(path: "/api/admin/offers/\(offer.id)", method: "PATCH", payload: ["action":action,"revision":offer.revision])
    }
    func acceptOffer(_ offer: BusinessOffer, firstName: String, lastName: String, phone: String, email: String, sendEmail: Bool) async throws -> BusinessManualBookingReceipt {
        try await offerRequest(path: "/api/admin/offers/\(offer.id)/accept", method: "POST", payload: ["revision":offer.revision,"contact":["firstName":firstName,"lastName":lastName,"phone":phone],"email":email,"sendEmail":sendEmail])
    }
}

struct ConciergeCareRequest: Decodable, Identifiable {
    let id: String
    let status: String
    let source: String
    let contact_name: String
    let contact_phone: String
    let contact_telegram: String?
    let origin_code: String
    let exact_start_date: String?
    let exact_end_date: String?
    let preferred_month: String?
    let adults: Int
    let children: Int
    let infants: Int
    let rooms: Int
    let notes: String?
    let created_at: String
    var statusTitle: String {
        switch status {
        case "CARE_REQUEST": return "Новая заявка"
        case "IN_REVIEW": return "В работе"
        case "QUOTING": return "Расчёт"
        case "READY": return "Предложение готово"
        case "CONTACTED": return "Связались"
        case "COMPLETED": return "Закрыта"
        case "CANCELLED": return "Отменена"
        default: return status
        }
    }
}
extension APIClient {
    func conciergeRequests() async throws -> [ConciergeCareRequest] {
        struct Result: Decodable { let requests: [ConciergeCareRequest] }
        let result: Result = try await offerRequest(path: "/api/admin/package/care-requests")
        return result.requests
    }
    func changeConciergeRequest(id: String, status: String) async throws {
        struct Result: Decodable { let ok: Bool }
        let _: Result = try await offerRequest(path: "/api/admin/package/care-requests/\(id)", method: "PATCH", payload: ["status": status])
    }
}
