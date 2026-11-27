import Foundation

struct ChatService {
    private let api = APIClient.shared

    func loadChat(bookingID: String, after: String, scope: String?, unread: [String], headers: [String: String]) async throws -> ChatListResponse {
        var query = [URLQueryItem(name: "after", value: after)]
        if let scope { query.append(URLQueryItem(name: "scope", value: scope)) }
        query.append(contentsOf: unread.prefix(80).map { URLQueryItem(name: "unread", value: $0) })
        return try await api.get(
            "/api/catalog/hotels/client/chats/\(bookingID)/messages",
            query: query,
            headers: headers
        )
    }

    func send(message: String, bookingID: String, clientMessageID: String, headers: [String: String]) async throws -> ChatMessage {
        let response: ChatMessagePostResponse = try await api.post(
            "/api/catalog/hotels/client/chats/\(bookingID)/messages",
            body: ChatMessageSendRequest(body: message, clientMessageID: clientMessageID),
            headers: headers
        )
        return response.message
    }

    func sendPhoto(data: Data, bookingID: String, headers: [String: String]) async throws -> ChatMessage {
        let response: ChatMessagePostResponse = try await api.upload(
            "/api/catalog/hotels/client/chats/\(bookingID)/attachments",
            data: data,
            contentType: "image/jpeg",
            headers: headers,
            timeoutInterval: 75
        )
        return response.message
    }

    func loadAttachment(path: String, headers: [String: String]) async throws -> Data {
        try await api.fetchData(
            path,
            headers: headers,
            timeoutInterval: 45
        )
    }

    func markRead(bookingID: String, headers: [String: String]) async throws {
        let _: BasicOKResponse = try await api.post(
            "/api/catalog/hotels/client/chats/\(bookingID)/read",
            body: EmptyPayload(),
            headers: headers
        )
    }
}

private struct ChatMessageSendRequest: Encodable {
    let body: String
    let clientMessageID: String
}

private struct EmptyPayload: Encodable {}

private struct BasicOKResponse: Decodable { let ok: Bool }

struct IumrahGuideReview: Decodable, Hashable {
    let id: String
    let author: String
    let text: String
}

struct IumrahPublicProfile: Decodable, Hashable, Identifiable {
    let id: String
    let firstName: String
    let lastName: String
    let displayName: String
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
    let availabilityStatus: String?
    let publicRoles: [String]?

    func localizedBio(_ language: AppSettingsStore.Language) -> String {
        let preferred: String?
        switch language { case .uzbek: preferred = bioUZ; case .uzbekCyrillic: preferred = bioUZCyrl; default: preferred = bioRU }
        return [preferred, bio, bioRU, bioUZ, bioUZCyrl].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.first(where: { !$0.isEmpty }) ?? ""
    }
    let publicSlug: String
    let publicVisible: Bool
    let active: Bool
    let isOwner: Bool
    let photoURL: String?
    let guideAvailable: Bool?
    let experienceYears: Int?
    let languages: [String]?
    let introVideoURL: String?
    let guideReviews: [IumrahGuideReview]?
}

private struct IumrahPublicProfilesResponse: Decodable {
    let ok: Bool
    let members: [IumrahPublicProfile]
}

extension ChatService {
    func loadTeamProfiles() async throws -> [IumrahPublicProfile] {
        let value: IumrahPublicProfilesResponse = try await api.get("/api/catalog/hotels/team")
        return value.members.filter { $0.active && $0.publicVisible }
    }

    func loadCareProfile() async throws -> IumrahPublicProfile? {
        let members = try await loadTeamProfiles()
        return members.first(where: { $0.isOwner }) ?? members.first
    }

    func loadTeamProfile(id: String) async throws -> IumrahPublicProfile? {
        let members = try await loadTeamProfiles()
        return members.first(where: { $0.id == id })
    }
}

/// Civil trip dates use the same local calendar convention as BookingDraftBuilder.
enum IumrahGuideDates {
    static func day(_ date: Date) -> String {
        let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
}

extension ChatService {
    func loadGuideProfiles(start: Date, end: Date, includeTeam: Bool = false) async throws -> [IumrahPublicProfile] {
        let value: IumrahPublicProfilesResponse = try await api.get("/api/catalog/hotels/team", query: [URLQueryItem(name: "guideStart", value: IumrahGuideDates.day(start)), URLQueryItem(name: "guideEnd", value: IumrahGuideDates.day(end)), URLQueryItem(name: "teamDirectory", value: "1")])
        guard value.ok else { throw APIError.invalidResponse }
        return value.members.filter { $0.active && $0.publicVisible && (includeTeam || (!$0.isOwner && $0.roleKind.lowercased() == "guide")) }
    }
}
