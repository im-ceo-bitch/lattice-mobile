import Foundation

actor APIClient {
    static let shared = APIClient()

    private let session: URLSession
    let decoder: JSONDecoder
    let encoder: JSONEncoder

    init() {
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = HTTPCookieStorage.shared
        configuration.httpShouldSetCookies = true
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: configuration, delegate: BusinessAPIOriginDelegate(), delegateQueue: nil)
        decoder = JSONDecoder()
        encoder = JSONEncoder()
    }

    func login(login: String, password: String) async throws -> SessionUser {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/auth/staff/login"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["login": login, "password": password])
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        let result = try decoder.decode(LoginResponse.self, from: data)
        guard result.ok == true, let resolvedLogin = result.login else { throw APIError.server(result.error ?? "LOGIN_FAILED") }
        BusinessSessionVault.clearSessionToken()
        _ = try await ensureBusinessSession(reauthenticated: true)
        return SessionUser(login: resolvedLogin, role: result.role ?? "superadmin", displayName: "Super Administrator")
    }

    func sessionUser() async throws -> SessionUser {
        let (data, response) = try await perform(from: AppConfig.apiBaseURL.appending(path: "/api/auth/staff/session"))
        try validate(response, data: data)
        let value = try decoder.decode(SessionResponse.self, from: data)
        guard let user = value.user else { throw APIError.unauthorized }
        _ = try await ensureBusinessSession(reauthenticated: false)
        return user
    }

    func logout() async {
        if BusinessSessionVault.sessionToken != nil {
            var sessionRequest = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/security/sessions/current"))
            sessionRequest.httpMethod = "DELETE"
            _ = try? await perform(sessionRequest)
        }
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/auth/staff/logout"))
        request.httpMethod = "POST"
        _ = try? await perform(request)
        BusinessSessionVault.clearSessionToken()
        HTTPCookieStorage.shared.cookies?.forEach { cookie in
            if cookie.domain.contains("iumrah.app") { HTTPCookieStorage.shared.deleteCookie(cookie) }
        }
    }

    func clearLocalBusinessSession() {
        BusinessSessionVault.clearSessionToken()
    }

    func businessSessions() async throws -> BusinessSessionsResponse {
        let url = AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/security/sessions")
        let (data, response) = try await perform(from: url)
        try validate(response, data: data)
        return try decoder.decode(BusinessSessionsResponse.self, from: data)
    }

    func businessSecurityEvents(limit: Int = 8) async throws -> BusinessSecurityEventsResponse {
        var components = URLComponents(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/security/events"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "limit", value: String(max(1, min(limit, 20))))]
        guard let url = components.url else { throw APIError.invalidURL }
        let (data, response) = try await perform(from: url)
        try validate(response, data: data)
        return try decoder.decode(BusinessSecurityEventsResponse.self, from: data)
    }

    func approveBusinessSession(id: String) async throws {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/security/sessions/\(id)/approve"))
        request.httpMethod = "POST"
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        _ = try decoder.decode(BusinessSessionActionResponse.self, from: data)
    }

    func terminateBusinessSession(id: String) async throws -> Bool {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/security/sessions/\(id)"))
        request.httpMethod = "DELETE"
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        let result = try decoder.decode(BusinessSessionActionResponse.self, from: data)
        if result.signedOut == true { BusinessSessionVault.clearSessionToken() }
        return result.signedOut == true
    }

    func terminateOtherBusinessSessions() async throws {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/security/sessions/others"))
        request.httpMethod = "DELETE"
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        _ = try decoder.decode(BusinessSessionActionResponse.self, from: data)
    }

    private func ensureBusinessSession(reauthenticated: Bool) async throws -> BusinessAccountSession {
        let identity = try BusinessSessionVault.installationIdentity()
        let payload = BusinessDeviceDescriptor.registrationPayload(identity: identity)
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/security/sessions/register"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if reauthenticated {
            request.setValue("1", forHTTPHeaderField: "X-Iumrah-Business-Reauthenticated")
        }
        request.httpBody = try encoder.encode(payload)
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        let result = try decoder.decode(BusinessSessionRegistrationResponse.self, from: data)
        if let token = result.sessionToken, !token.isEmpty {
            try BusinessSessionVault.setSessionToken(token)
        } else if BusinessSessionVault.sessionToken == nil {
            throw APIError.server("BUSINESS_SESSION_TOKEN_MISSING")
        }
        return result.currentSession
    }

    func bookings() async throws -> [BookingSummary] {
        let (data, response) = try await perform(from: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/bookings"))
        try validate(response, data: data)
        return try decoder.decode(BookingsResponse.self, from: data).bookings
    }

    func businessProfile() async throws -> BusinessTeamMember {
        let url = AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/me")
        let (data, response) = try await perform(from: url)
        try validate(response, data: data)
        return try decoder.decode(BusinessTeamMemberResponse.self, from: data).member
    }

    func saveBusinessProfile(_ member: BusinessTeamMember) async throws -> BusinessTeamMember {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/me"))
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(BusinessTeamMemberPayload(member))
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(BusinessTeamMemberResponse.self, from: data).member
    }

    func businessTeam() async throws -> [BusinessTeamMember] {
        let url = AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/team")
        let (data, response) = try await perform(from: url)
        try validate(response, data: data)
        return try decoder.decode(BusinessTeamResponse.self, from: data).members
    }

    func createBusinessTeamMember(_ member: BusinessTeamMember) async throws -> BusinessTeamMember {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/team"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(BusinessTeamMemberPayload(member))
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(BusinessTeamMemberResponse.self, from: data).member
    }

    func updateBusinessTeamMember(_ member: BusinessTeamMember) async throws -> BusinessTeamMember {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/team/\(member.id)"))
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(BusinessTeamMemberPayload(member))
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(BusinessTeamMemberResponse.self, from: data).member
    }

    func uploadBusinessTeamPhoto(memberID: String, imageData: Data) async throws -> BusinessTeamMember {
        let optimized = try ImageOptimizer.jpegData(from: imageData, maxDimension: 1200, quality: 0.80, targetBytes: 500_000)
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/team/\(memberID)/photo"))
        request.httpMethod = "POST"
        request.timeoutInterval = 75
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        request.httpBody = optimized
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(BusinessTeamMemberResponse.self, from: data).member
    }

    func deleteBusinessTeamPhoto(memberID: String) async throws -> BusinessTeamMember {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/team/\(memberID)/photo"))
        request.httpMethod = "DELETE"
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(BusinessTeamMemberResponse.self, from: data).member
    }

    func deleteBusinessTeamMember(id: String) async throws {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/team/\(id)"))
        request.httpMethod = "DELETE"
        let (data, response) = try await perform(request)
        try validate(response, data: data)
    }

    func paymentTemplates() async throws -> [BusinessPaymentTemplate] {
        let url = AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/payment-templates")
        let (data, response) = try await perform(from: url)
        try validate(response, data: data)
        return try decoder.decode(BusinessPaymentTemplatesResponse.self, from: data).templates
    }

    func createPaymentTemplate(_ template: BusinessPaymentTemplate) async throws -> BusinessPaymentTemplate {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/payment-templates"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(BusinessPaymentTemplatePayload(template))
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(BusinessPaymentTemplateResponse.self, from: data).template
    }

    func updatePaymentTemplate(_ template: BusinessPaymentTemplate) async throws -> BusinessPaymentTemplate {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/payment-templates/\(template.id)"))
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(BusinessPaymentTemplatePayload(template))
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(BusinessPaymentTemplateResponse.self, from: data).template
    }

    func deletePaymentTemplate(id: String) async throws {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/payment-templates/\(id)"))
        request.httpMethod = "DELETE"
        let (data, response) = try await perform(request)
        try validate(response, data: data)
    }

    func uploadPaymentTemplateQR(templateID: String, data: Data, contentType: String = "image/jpeg") async throws -> BusinessPaymentTemplate {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/payment-templates/\(templateID)/qr"))
        request.httpMethod = "POST"
        request.timeoutInterval = 75
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        let (body, response) = try await perform(request)
        try validate(response, data: body)
        return try decoder.decode(BusinessPaymentTemplateResponse.self, from: body).template
    }

    func deletePaymentTemplateQR(templateID: String) async throws -> BusinessPaymentTemplate {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/payment-templates/\(templateID)/qr"))
        request.httpMethod = "DELETE"
        let (body, response) = try await perform(request)
        try validate(response, data: body)
        return try decoder.decode(BusinessPaymentTemplateResponse.self, from: body).template
    }

    func applyPaymentTemplate(templateID: String, bookingID: String) async throws -> BusinessCheckout {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/bookings/\(bookingID)/payment-template/\(templateID)"))
        request.httpMethod = "POST"
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        struct Envelope: Decodable { let ok: Bool; let checkout: BusinessCheckout }
        return try decoder.decode(Envelope.self, from: data).checkout
    }

    func bookingDetail(id: String) async throws -> BookingDetailResponse {
        let url = AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/bookings/\(id)")
        let (data, response) = try await perform(from: url)
        try validate(response, data: data)
        return try decoder.decode(BookingDetailResponse.self, from: data)
    }

    func bookingItinerary(bookingID: String) async throws -> [BookingItineraryItem] {
        let url = AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/bookings/\(bookingID)/itinerary")
        let (data, response) = try await perform(from: url)
        try validate(response, data: data)
        return try decoder.decode(BookingItineraryResponse.self, from: data).items
    }

    func saveBookingPricing(bookingID: String, components: [BookingPricingComponent], markupRate: Double, paymentFeeRate: Double) async throws -> BookingPricingOverride {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/bookings/\(bookingID)/pricing"))
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(BookingPricingOverrideUpdatePayload(components: components, markupRate: markupRate, paymentFeeRate: paymentFeeRate))
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(BookingPricingOverrideResponse.self, from: data).pricing
    }

    func saveBookingItinerary(bookingID: String, items: [BookingItineraryItem]) async throws -> [BookingItineraryItem] {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/bookings/\(bookingID)/itinerary"))
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(BookingItineraryUpdatePayload(items: items))
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(BookingItineraryResponse.self, from: data).items
    }

    func bookingESIMs(bookingID: String) async throws -> [BookingESIMProfile] {
        let url = AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/bookings/\(bookingID)/esims")
        let (data, response) = try await perform(from: url)
        try validate(response, data: data)
        return try decoder.decode(BookingESIMListResponse.self, from: data).esims
    }

    func saveBookingESIM(bookingID: String, esimID: String?, payload: BookingESIMUpsertPayload) async throws -> BookingESIMProfile {
        let path = esimID.map { "/api/admin/hotels/operations/bookings/\(bookingID)/esims/\($0)" }
            ?? "/api/admin/hotels/operations/bookings/\(bookingID)/esims"
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: path))
        request.httpMethod = esimID == nil ? "POST" : "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(payload)
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(BookingESIMResponse.self, from: data).esim
    }

    func syncBookingESIM(bookingID: String, esimID: String) async throws -> BookingESIMProfile {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/bookings/\(bookingID)/esims/\(esimID)/sync"))
        request.httpMethod = "POST"
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(BookingESIMResponse.self, from: data).esim
    }

    func deleteBookingESIM(bookingID: String, esimID: String) async throws {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/bookings/\(bookingID)/esims/\(esimID)"))
        request.httpMethod = "DELETE"
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        _ = try? decoder.decode(BookingESIMDeleteResponse.self, from: data)
    }

    func updateBookingOperation(id: String, status: TripStatus, paymentStatus: String, confirmationNumber: String, internalNotes: String) async throws -> BookingDetailResponse {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/bookings/\(id)"))
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(BookingOperationUpdatePayload(status: status.rawValue, paymentStatus: paymentStatus, confirmationNumber: confirmationNumber, internalNotes: internalNotes))
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(BookingDetailResponse.self, from: data)
    }

    func savePaymentInstructions(bookingID: String, payload: BusinessPaymentInstructionsPayload) async throws -> BusinessCheckout {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/bookings/\(bookingID)/payment"))
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(payload)
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        struct Envelope: Decodable { let ok: Bool; let checkout: BusinessCheckout }
        return try decoder.decode(Envelope.self, from: data).checkout
    }

    func uploadPaymeQR(bookingID: String, data: Data, contentType: String = "image/jpeg") async throws {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/bookings/\(bookingID)/payment-qr"))
        request.httpMethod = "POST"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        let (body, response) = try await perform(request)
        try validate(response, data: body)
    }

    func uploadTravelDocument(bookingID: String, kind: String, title: String, bookingReference: String, data: Data, contentType: String) async throws {
        var components = URLComponents(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/bookings/\(bookingID)/documents"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "kind", value: kind),
            URLQueryItem(name: "title", value: title),
            URLQueryItem(name: "reference", value: bookingReference)
        ]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        let (body, response) = try await perform(request)
        try validate(response, data: body)
    }

    func privateMedia(path: String) async throws -> Data {
        let url: URL
        if let direct = URL(string: path), direct.scheme != nil {
            url = direct
        } else if let relative = URL(string: path, relativeTo: AppConfig.apiBaseURL)?.absoluteURL {
            // Preserve query strings such as ?v=<updated_at>. URL.appending(path:) would
            // treat the question mark as path text and break protected media URLs.
            url = relative
        } else {
            throw APIError.invalidURL
        }
        let (data, response) = try await perform(from: url)
        try validate(response, data: data)
        return data
    }

    func deleteBooking(id: String) async throws {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/bookings/\(id)"))
        request.httpMethod = "DELETE"
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        _ = try? decoder.decode(BookingDeleteResponse.self, from: data)
    }

    func verifyFlight(number: String, dateLocal: String, force: Bool = false) async throws -> FlightVerificationResponse {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/flight-verify"))
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(FlightVerificationPayload(flightNumber: number, dateLocal: dateLocal, force: force))
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(FlightVerificationResponse.self, from: data)
    }

    func saveVerifiedFlight(bookingID: String, direction: BookingFlightDirection, verificationKey: String, candidateID: String) async throws -> BookingFlight {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/bookings/\(bookingID)/flights/\(direction.rawValue)"))
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(SaveVerifiedFlightPayload(verificationKey: verificationKey, candidateID: candidateID))
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(BookingFlightResponse.self, from: data).flight
    }

    func updateBookingAssignment(bookingID: String, makkahHotelID: String?, madinahHotelID: String?, guideID: String?) async throws -> BookingAssignment {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/bookings/\(bookingID)/assignments"))
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(BookingAssignmentPayload(makkahHotelID: makkahHotelID, madinahHotelID: madinahHotelID, guideID: guideID))
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(BookingAssignmentResponse.self, from: data).assignment
    }

    func pilgrims(archiveOnly: Bool = false, query: String? = nil) async throws -> [PilgrimSummary] {
        var components = URLComponents(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/pilgrims"), resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = []
        if archiveOnly { items.append(URLQueryItem(name: "archive", value: "1")) }
        if let query, !query.isEmpty { items.append(URLQueryItem(name: "q", value: query)) }
        components.queryItems = items.isEmpty ? nil : items
        let (data, response) = try await perform(from: components.url!)
        try validate(response, data: data)
        return try decoder.decode(PilgrimsResponse.self, from: data).pilgrims
    }

    func pilgrimDetail(id: String) async throws -> PilgrimDetailResponse {
        let url = AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/pilgrims/\(id)")
        let (data, response) = try await perform(from: url)
        try validate(response, data: data)
        return try decoder.decode(PilgrimDetailResponse.self, from: data)
    }

    func primaryHotels(city: String? = nil) async throws -> [PrimaryHotelAssignment] {
        var components = URLComponents(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/primary-hotels"), resolvingAgainstBaseURL: false)!
        if let city { components.queryItems = [URLQueryItem(name: "city", value: city)] }
        let (data, response) = try await perform(from: components.url!)
        try validate(response, data: data)
        return try decoder.decode(PrimaryHotelsResponse.self, from: data).assignments
    }

    func savePrimaryHotels(city: String, stars: Int, hotelIDs: [String]) async throws -> [PrimaryHotelAssignment] {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/primary-hotels"))
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(PrimaryHotelsUpdatePayload(city: city, stars: stars, hotelIDs: hotelIDs))
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(PrimaryHotelsResponse.self, from: data).assignments
    }

    func businessChatThreads() async throws -> [BusinessChatThreadSummary] {
        let (data, response) = try await perform(from: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/chats"))
        try validate(response, data: data)
        return try decoder.decode(BusinessChatThreadsResponse.self, from: data).threads
    }

    func businessChatMessages(bookingID: String, after: String, scope: String?) async throws -> BusinessChatMessagesResponse {
        let endpoint = AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/chats/\(bookingID)/messages")
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "after", value: after)] + (scope.map { [URLQueryItem(name: "scope", value: $0)] } ?? [])
        let (data, response) = try await perform(from: components?.url ?? endpoint)
        try validate(response, data: data)
        return try decoder.decode(BusinessChatMessagesResponse.self, from: data)
    }

    func sendBusinessChatMessage(bookingID: String, body: String, clientMessageID: String) async throws -> BusinessChatMessage {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/chats/\(bookingID)/messages"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(SendBusinessChatMessagePayload(body: body, clientMessageID: clientMessageID))
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(BusinessChatMessageResponse.self, from: data).message
    }

    func sendBusinessChatImage(bookingID: String, data: Data) async throws -> BusinessChatMessage {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/chats/\(bookingID)/attachments"))
        request.httpMethod = "POST"
        request.timeoutInterval = 75
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        let (responseData, response) = try await perform(request)
        try validate(response, data: responseData)
        return try decoder.decode(BusinessChatMessageResponse.self, from: responseData).message
    }

    func markBusinessChatRead(bookingID: String) async throws {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/chats/\(bookingID)/read"))
        request.httpMethod = "POST"
        let (data, response) = try await perform(request)
        try validate(response, data: data)
    }

    func registerPushDevice(token: String, environment: String = "production") async throws -> PushDeviceRegistrationResponse {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/push/devices"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(PushDeviceRegistrationPayload(deviceToken: token, environment: environment))
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(PushDeviceRegistrationResponse.self, from: data)
    }

    func pushStatus() async throws -> PushStatusResponse {
        let (data, response) = try await perform(from: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/push/status"))
        try validate(response, data: data)
        return try decoder.decode(PushStatusResponse.self, from: data)
    }

    func hotels() async throws -> [HotelListItem] {
        let (data, response) = try await perform(from: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels"))
        try validate(response, data: data)
        return try decoder.decode(HotelsResponse.self, from: data).hotels
    }

    func hotelDetail(id: String) async throws -> HotelAdminDetail {
        let url = AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/\(id)")
        let (data, response) = try await perform(from: url)
        try validate(response, data: data)
        return try decoder.decode(HotelAdminDetailResponse.self, from: data).hotel
    }

    func updateHotelStars(id: String, stars: Int) async throws -> HotelAdminDetail {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/\(id)"))
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(HotelStarsUpdatePayload(stars: stars))
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(HotelAdminDetailResponse.self, from: data).hotel
    }

    func updateHotelCity(id: String, city: String) async throws -> HotelAdminDetail {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/\(id)"))
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(HotelCityUpdatePayload(city: city))
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(HotelAdminDetailResponse.self, from: data).hotel
    }

    func setManualHotelPrice(id: String, nightlyUSD: Double) async throws -> HotelPriceResponse {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/\(id)/price"))
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(HotelManualPriceUpdatePayload(nightlyUSD: nightlyUSD))
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(HotelPriceResponse.self, from: data)
    }

    func clearManualHotelPrice(id: String) async throws -> HotelPriceResponse {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/\(id)/price"))
        request.httpMethod = "DELETE"
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(HotelPriceResponse.self, from: data)
    }

    // Hotel ChatGPT Sync v5 lives in APIClient+HotelSync.swift.
    // Legacy v2 JSON price-exchange code was removed to avoid compiling
    // obsolete write paths alongside the current server-validated sync flow.

    func hotelCloudHealth() async throws -> HotelCloudHealthResponse {
        let (data, response) = try await perform(from: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/health"))
        try validate(response, data: data)
        return try decoder.decode(HotelCloudHealthResponse.self, from: data)
    }

    func checkHotelSourceDuplicate(_ sourceURL: String) async throws -> HotelDuplicate? {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/dedupe"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(HotelSourceDuplicatePayload(sourceURL: sourceURL))
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(HotelDuplicateResponse.self, from: data).duplicate
    }

    func checkHotelDuplicate(_ hotel: HotelDraft) async throws -> HotelDuplicate? {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/dedupe"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(hotel)
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(HotelDuplicateResponse.self, from: data).duplicate
    }

    func startHotelImport(
        _ hotel: HotelDraft,
        publishWhenComplete: Bool,
        idempotencyKey: String,
        allowPossibleDuplicate: Bool = false
    ) async throws -> HotelImportJob {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/import-jobs"))
        request.httpMethod = "POST"
        request.timeoutInterval = 45
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try encoder.encode(
            HotelImportStartPayload(
                hotel: hotel,
                images: hotel.selectedImages,
                publishWhenComplete: publishWhenComplete,
                idempotencyKey: idempotencyKey,
                allowPossibleDuplicate: allowPossibleDuplicate
            )
        )
        let (data, response) = try await perform(request)
        if let http = response as? HTTPURLResponse, http.statusCode == 409,
           let conflict = try? decoder.decode(HotelImportConflictResponse.self, from: data),
           let duplicate = conflict.duplicate {
            if conflict.error == "POSSIBLE_DUPLICATE" { throw APIError.possibleDuplicate(duplicate) }
            throw APIError.hotelAlreadyExists(duplicate)
        }
        try validate(response, data: data)
        return try decoder.decode(HotelImportJobResponse.self, from: data).job
    }

    func hotelImportJob(id: String) async throws -> HotelImportJob {
        let url = AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/import-jobs/\(id)")
        let (data, response) = try await perform(from: url)
        try validate(response, data: data)
        return try decoder.decode(HotelImportJobResponse.self, from: data).job
    }

    func hotelImportJobs(activeOnly: Bool = false) async throws -> [HotelImportJob] {
        var components = URLComponents(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/import-jobs"), resolvingAgainstBaseURL: false)!
        if activeOnly { components.queryItems = [URLQueryItem(name: "active", value: "1")] }
        let (data, response) = try await perform(from: components.url!)
        try validate(response, data: data)
        return try decoder.decode(HotelImportJobsResponse.self, from: data).jobs
    }

    func activeHotelImportJobs() async throws -> [HotelImportJob] {
        try await hotelImportJobs(activeOnly: true)
    }

    func retryHotelImportJob(id: String) async throws -> HotelImportJob {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/import-jobs/\(id)/retry"))
        request.httpMethod = "POST"
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(HotelImportJobResponse.self, from: data).job
    }

    func cancelHotelImportJob(id: String) async throws -> HotelImportJob {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/import-jobs/\(id)/cancel"))
        request.httpMethod = "POST"
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(HotelImportJobResponse.self, from: data).job
    }

    func deleteHotelImportJob(id: String) async throws {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/import-jobs/\(id)"))
        request.httpMethod = "DELETE"
        let (data, response) = try await perform(request)
        try validate(response, data: data)
    }

    func deleteHotel(id: String) async throws {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/\(id)"))
        request.httpMethod = "DELETE"
        request.timeoutInterval = 45
        let (data, response) = try await perform(request)
        try validate(response, data: data)
    }

    func saveHotel(_ hotel: HotelDraft, allowPossibleDuplicate: Bool = false) async throws -> HotelListItem? {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if allowPossibleDuplicate { request.setValue("1", forHTTPHeaderField: "X-Iumrah-Allow-Possible-Duplicate") }
        request.httpBody = try encoder.encode(hotel)
        let (data, response) = try await perform(request)
        if let http = response as? HTTPURLResponse, http.statusCode == 409,
           let conflict = try? decoder.decode(HotelImportConflictResponse.self, from: data),
           let duplicate = conflict.duplicate {
            if conflict.error == "POSSIBLE_DUPLICATE" { throw APIError.possibleDuplicate(duplicate) }
            throw APIError.hotelAlreadyExists(duplicate)
        }
        try validate(response, data: data)
        return try decoder.decode(HotelSaveResponse.self, from: data).hotel
    }

    func clearHotelImages(hotelID: String) async throws {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/\(hotelID)/images"))
        request.httpMethod = "DELETE"
        let (data, response) = try await perform(request)
        try validate(response, data: data)
    }

    func uploadHotelImage(hotelID: String, candidate: HotelImageCandidate, position: Int) async throws {
        guard let sourceURL = URL(string: candidate.url) else { throw APIError.invalidURL }
        var sourceRequest = URLRequest(url: sourceURL)
        sourceRequest.timeoutInterval = 45
        sourceRequest.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1", forHTTPHeaderField: "User-Agent")
        sourceRequest.setValue("image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8", forHTTPHeaderField: "Accept")
        sourceRequest.setValue("en-US,en;q=0.9", forHTTPHeaderField: "Accept-Language")
        sourceRequest.setValue(candidate.sourcePageURL, forHTTPHeaderField: "Referer")

        let (imageData, sourceResponse) = try await perform(sourceRequest)
        guard let http = sourceResponse as? HTTPURLResponse, (200..<300).contains(http.statusCode), !imageData.isEmpty else {
            throw APIError.server("IMAGE_DOWNLOAD_FAILED")
        }
        let optimized = try ImageOptimizer.jpegData(from: imageData)

        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/\(hotelID)/images"))
        request.httpMethod = "POST"
        request.timeoutInterval = 75
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        request.setValue(candidate.provider, forHTTPHeaderField: "X-Iumrah-Source")
        request.setValue(candidate.kind.rawValue, forHTTPHeaderField: "X-Iumrah-Category")
        request.setValue(candidate.sourcePageURL, forHTTPHeaderField: "X-Iumrah-Source-URL")
        if let label = candidate.label { request.setValue(String(label.prefix(480)), forHTTPHeaderField: "X-Iumrah-Label") }
        if let room = candidate.roomName { request.setValue(String(room.prefix(220)), forHTTPHeaderField: "X-Iumrah-Room") }
        request.setValue(String(position), forHTTPHeaderField: "X-Iumrah-Position")
        request.setValue(candidate.isCover ? "1" : "0", forHTTPHeaderField: "X-Iumrah-Cover")
        request.httpBody = optimized
        let (data, response) = try await perform(request)
        try validate(response, data: data)
    }


    func clientNotificationAudience() async throws -> BusinessNotificationAudienceCounts {
        let url = AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/notifications/audience")
        let (data, response) = try await perform(from: url)
        try validate(response, data: data)
        return try decoder.decode(BusinessNotificationAudienceResponse.self, from: data).audience
    }

    func clientNotifications() async throws -> [BusinessClientNotification] {
        let url = AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/notifications")
        let (data, response) = try await perform(from: url)
        try validate(response, data: data)
        return try decoder.decode(BusinessClientNotificationsResponse.self, from: data).notifications
    }

    func sendClientNotification(_ payload: BusinessClientNotificationPayload) async throws -> BusinessClientNotificationSendResponse {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/operations/notifications"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(payload)
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(BusinessClientNotificationSendResponse.self, from: data)
    }

    func ziyarats(city: String? = nil) async throws -> [BusinessZiyaratRoute] {
        var components = URLComponents(url: AppConfig.apiBaseURL.appending(path: "/api/admin/ziyarats"), resolvingAgainstBaseURL: false)!
        if let city, !city.isEmpty {
            components.queryItems = [URLQueryItem(name: "city", value: city)]
        }
        let (data, response) = try await perform(from: components.url!)
        try validate(response, data: data)
        return try decoder.decode(BusinessZiyaratCatalogResponse.self, from: data).routes
    }

    func createZiyarat(_ payload: BusinessZiyaratPlacePayload) async throws -> BusinessZiyaratPlace {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/ziyarats"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(payload)
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(BusinessZiyaratPlaceResponse.self, from: data).place
    }

    func updateZiyarat(id: String, payload: BusinessZiyaratPlacePayload) async throws -> BusinessZiyaratPlace {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/ziyarats/places/\(id)"))
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(payload)
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(BusinessZiyaratPlaceResponse.self, from: data).place
    }

    func deleteZiyarat(id: String) async throws {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/ziyarats/places/\(id)"))
        request.httpMethod = "DELETE"
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        _ = try? decoder.decode(BusinessZiyaratDeleteResponse.self, from: data)
    }

    func uploadZiyaratImage(placeID: String, imageData: Data, position: Int) async throws {
        let optimized = try ImageOptimizer.ziyaratJPEGData(from: imageData)
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/ziyarats/places/\(placeID)/images"))
        request.httpMethod = "POST"
        request.timeoutInterval = 90
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        request.setValue(String(position), forHTTPHeaderField: "X-Iumrah-Position")
        request.httpBody = optimized
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        _ = try decoder.decode(BusinessZiyaratImageUploadResponse.self, from: data)
    }

    func deleteZiyaratImage(placeID: String, imageID: String) async throws {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/admin/ziyarats/places/\(placeID)/images/\(imageID)"))
        request.httpMethod = "DELETE"
        let (data, response) = try await perform(request)
        try validate(response, data: data)
    }

    func perform(_ original: URLRequest) async throws -> (Data, URLResponse) {
        var request = original
        if let originalURL = request.url, let url = AppConfig.routedAPIURL(originalURL) {
            request.url = url
            let isPlatform = url.host?.lowercased() == AppConfig.apiBaseURL.host?.lowercased()
            let isUnifiedAdmin = url.host?.lowercased() == AppConfig.unifiedBackendURL.host?.lowercased()
                && AppConfig.isUnifiedModulePath(url.path) && url.path.hasPrefix("/api/admin/")
            // Only the exact trusted Worker receives the legacy staff cookie until Core is moved.
            if isUnifiedAdmin {
                let cookies = (HTTPCookieStorage.shared.cookies(for: AppConfig.apiBaseURL) ?? []).filter { cookie in
                    let name = cookie.name.lowercased()
                    return !(name.hasPrefix("_ga") || name.hasPrefix("_gid") || name.hasPrefix("_fbp") || name.hasPrefix("cf_"))
                }
                if !cookies.isEmpty { request.setValue(HTTPCookie.requestHeaderFields(with: cookies)["Cookie"], forHTTPHeaderField: "Cookie") }
            }
            if (isPlatform || isUnifiedAdmin), url.path.hasPrefix("/api/admin/"), let token = BusinessSessionVault.sessionToken {
                request.setValue(token, forHTTPHeaderField: "X-Iumrah-Business-Session")
            }
        }
        return try await session.data(for: request)
    }

    func perform(from url: URL) async throws -> (Data, URLResponse) {
        try await perform(URLRequest(url: url))
    }

    func validate(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        let serverError = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
        if http.statusCode == 401 {
            if serverError == "BUSINESS_SESSION_REQUIRED" || serverError == "SESSION_REAUTH_REQUIRED" {
                BusinessSessionVault.clearSessionToken()
                DispatchQueue.main.async {
                    NotificationCenter.default.post(name: .iumrahBusinessSessionInvalidated, object: nil)
                }
            }
            throw APIError.unauthorized
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.server(serverError ?? "HTTP_\(http.statusCode)")
        }
    }
}

private final class BusinessAPIOriginDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let source = response.url, let target = request.url,
              source.scheme == "https", target.scheme == "https", source.host == target.host,
              source.port == target.port, target.user == nil, target.password == nil else { completionHandler(nil); return }
        completionHandler(request)
    }
}

enum APIError: LocalizedError {
    case unauthorized
    case invalidURL
    case invalidResponse
    case possibleDuplicate(HotelDuplicate)
    case hotelAlreadyExists(HotelDuplicate)
    case server(String)

    var errorDescription: String? {
        switch self {
        case .unauthorized: return "Сессия администратора истекла. Войдите снова."
        case .invalidURL: return "Некорректная ссылка."
        case .invalidResponse: return "Сервер вернул некорректный ответ."
        case .possibleDuplicate(let hotel): return "Возможно, этот отель уже есть в базе: \(hotel.name)."
        case .hotelAlreadyExists(let hotel): return "Этот отель уже есть в базе: \(hotel.name)."
        case .server(let value):
            switch value {
            case "SESSION_REAUTH_REQUIRED": return "Этот сеанс был завершён на другом устройстве. Войдите снова."
            case "PAYMENT_INSTRUCTIONS_REQUIRED": return "Сначала сохраните хотя бы один способ оплаты: Visa, PayMe или Humo."
            case "PAYMENT_TEMPLATE_NOT_FOUND": return "Шаблон реквизитов больше не существует. Обновите список Payments."
            case "PAYMENT_TEMPLATE_QR_NOT_FOUND": return "QR шаблона не найден в хранилище. Откройте Payments и загрузите QR заново."
            case "PAYMENT_TEMPLATE_NAME_REQUIRED": return "Введите название шаблона реквизитов."
            case "PAYMENT_INSTRUCTIONS_LOCKED": return "Реквизиты этой поездки уже нельзя изменять на текущем этапе."
            case "IUMRAH_ACCOUNT_REQUIRED": return "Паломник ещё не активировал свой iumrah ID и пароль."
            case "TRAVELER_DATA_INCOMPLETE": return "Не все анкеты паломников заполнены полностью и с паспортом."
            case "PAYMENT_RECEIPT_REQUIRED": return "Паломник ещё не прикрепил чек оплаты."
            case "TRAVEL_DOCUMENT_REQUIRED": return "Перед статусом «Готово к поездке» загрузите хотя бы один документ поездки."
            case "INVALID_STATUS_TRANSITION": return "Этот переход статуса недоступен из текущего состояния поездки."
            case "PRIMARY_SESSION_REQUIRED": return "Только основное устройство может завершать другие сеансы."
            case "PRIMARY_SESSION_PROTECTED": return "Основной сеанс защищён и не может быть завершён с другого устройства."
            case "DEVICE_BLOCKED": return "Это устройство было отключено с основного устройства."
            case "DEVICE_PROOF_INVALID": return "Не удалось подтвердить защищённую идентичность этого устройства."
            case "BUSINESS_SESSION_TOKEN_MISSING": return "Сервер не выдал защищённый ключ сеанса. Попробуйте войти снова."
            case "ESIM_ACCESS_NOT_CONFIGURED": return "API eSIM Access ещё не подключён к Cloudflare Worker."
            case "ESIM_ACCESS_AUTH_FAILED": return "eSIM Access отклонил API-аутентификацию. Проверьте ESIM_ACCESS_CODE и при необходимости ESIM_ACCESS_SECRET в Cloudflare."
            case "ESIM_ACCESS_BALANCE_INSUFFICIENT": return "Недостаточно средств на балансе eSIM Access. Сначала пополните баланс."
            case "ESIM_ACCESS_PACKAGE_NOT_FOUND": return "Этот тариф больше недоступен. Обновите список тарифов."
            case "ESIM_ACCESS_PRICE_CHANGED": return "Цена тарифа изменилась в eSIM Access. Обновите тарифы и подтвердите покупку заново."
            case "ESIM_ACCESS_PURCHASE_PRIMARY_ONLY": return "Покупать eSIM можно только с основного устройства iumrah Business."
            case "ESIM_ACCESS_PURCHASE_SUPERADMIN_ONLY": return "Покупка eSIM доступна только владельцу / superadmin."
            case "ESIM_ACCESS_PROFILE_NOT_READY": return "eSIM ещё выпускается. Подождите несколько секунд и обновите профиль."
            case "ESIM_ACCESS_PROFILE_ALREADY_ASSIGNED": return "Эта eSIM уже назначена другой поездке."
            case "ESIM_ACCESS_PURCHASE_REQUIRES_REVIEW": return "Предыдущая попытка покупки не получила подтверждение. Проверьте заказ в eSIM Access перед повторной покупкой, чтобы исключить двойное списание."
            case "INVALID_HOTEL_PRICE": return "Введите корректную цену за одну ночь в долларах."
            case "PRIMARY_HOTEL_MANUAL_PRICE_ONLY": return "Primary Hotel использует только ручную цену. Измените её во вкладке Primary Hotels."
            case "HOTEL_PRICE_REFRESH_IN_PROGRESS": return "Цена уже обновляется из источника. Дождитесь завершения и откройте отель повторно."
            case "HOTEL_PRICE_BROWSER_UNAVAILABLE": return "Облачный браузер цен недоступен. Проверьте развёртывание Hotels Cloud."
            case "HOTEL_PRICE_SOURCE_MISSING": return "Для этого отеля не закреплён источник Booking или Expedia."
            case "HOTEL_PRICE_SOURCE_CHALLENGE": return "Источник запросил проверку браузера. Ручная цена сохранится; попробуйте обновить из источника позже."
            case "HOTEL_PRICE_NOT_FOUND_ON_SOURCE": return "Источник открылся, но актуальную цену на странице определить не удалось."
            case "HOTEL_PRICE_SOURCE_FETCH_FAILED": return "Не удалось открыть источник цены. Попробуйте ещё раз позже."
            case "HOTEL_PRICE_SOURCE_HTTP_429": return "Источник временно ограничил запросы. Последняя сохранённая цена остаётся активной; автоматическое обновление повторится позже."
            default: return value
            }
        }
    }
}
