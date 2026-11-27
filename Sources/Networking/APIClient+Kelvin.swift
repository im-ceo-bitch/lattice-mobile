import Foundation

struct KelvinTurn: Codable, Identifiable, Equatable {
    let id: String
    let source: String
    let prompt: String
    let answer: String?
    let status: String
    let createdAt: Int64
    let updatedAt: Int64
}
struct KelvinHistory: Decodable {
    let ok: Bool
    let paired: Bool
    let online: Bool
    let turns: [KelvinTurn]
}
struct KelvinNote: Decodable, Identifiable { let id: String; let content: String }
private struct KelvinTurnResponse: Decodable { let turn: KelvinTurn }
private struct KelvinPair: Decodable { let token: String }
private struct KelvinAck: Decodable { let ok: Bool }
private struct KelvinNotes: Decodable { let notes: [KelvinNote] }

struct KelvinSpeechStatus: Decodable { let configured: Bool; let model: String }

extension APIClient {
    func kelvinSpeechStatus() async throws -> KelvinSpeechStatus { try await kelvinRequest("speech", as: KelvinSpeechStatus.self) }
    func kelvinSpeech(text: String, voice: String) async throws -> Data {
        var request = URLRequest(url: AppConfig.unifiedBackendURL.appending(path: "/api/admin/hotels/kelvin/speech"))
        request.httpMethod = "POST"; request.timeoutInterval = 65
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("audio/wav", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["text": text, "voice": voice, "consent": true])
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        guard let http = response as? HTTPURLResponse, http.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("audio/wav") == true, data.count >= 44, data.count <= 15_000_000 else { throw APIError.invalidResponse }
        return data
    }
    private func kelvinRequest<T: Decodable>(_ path: String, method: String = "GET", body: [String: Any]? = nil, as type: T.Type) async throws -> T {
        var request = URLRequest(url: AppConfig.unifiedBackendURL.appending(path: "/api/admin/hotels/kelvin/\(path)"))
        request.httpMethod = method
        request.timeoutInterval = 25
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await perform(request)
        try validate(response, data: data)
        return try decoder.decode(T.self, from: data)
    }
    func kelvinHistory() async throws -> KelvinHistory { try await kelvinRequest("history", as: KelvinHistory.self) }
    func kelvinSend(id: String, text: String, voice: Bool = false) async throws {
        _ = try await kelvinRequest("message", method: "POST", body: ["id": id, "prompt": text, "voice": voice], as: KelvinAck.self)
    }
    func kelvinTurn(id: String) async throws -> KelvinTurn {
        try await kelvinRequest("turn", method: "POST", body: ["id": id], as: KelvinTurnResponse.self).turn
    }
    func kelvinPair() async throws -> String { try await kelvinRequest("pair", method: "POST", as: KelvinPair.self).token }
    func kelvinRevoke() async throws { _ = try await kelvinRequest("revoke", method: "POST", as: KelvinAck.self) }
    func kelvinNotes() async throws -> [KelvinNote] { try await kelvinRequest("memory", as: KelvinNotes.self).notes }
    func kelvinRemember(id: String, text: String) async throws { _ = try await kelvinRequest("remember", method: "POST", body: ["id":id,"content":text], as: KelvinAck.self) }
    func kelvinForget(id: String) async throws { _ = try await kelvinRequest("forget", method: "POST", body: ["id":id], as: KelvinAck.self) }
}

// Block 02: canonical typed memory; authentication remains the existing owner session.
struct KelvinMemoryRecord: Decodable, Identifiable {
    let id: String
    let kind: String
    let content: String
    let trust: String
    let source: String
    let updated_at: Int64
    let version: Int
}
struct KelvinMemoryPage: Decodable {
    let records: [KelvinMemoryRecord]
    let next: String?
}
extension APIClient {
    func kelvinRecords(after: String = "") async throws -> KelvinMemoryPage {
        try await kelvinRequest("records", method: "POST", body: ["action":"list","after":after], as: KelvinMemoryPage.self)
    }
    func kelvinSaveRecord(id: String, kind: String, content: String) async throws {
        _ = try await kelvinRequest("records", method: "POST", body: ["action":"save","id":id,"kind":kind,"content":content], as: KelvinAck.self)
    }
    func kelvinCorrectRecord(_ record: KelvinMemoryRecord, kind: String, content: String) async throws {
        _ = try await kelvinRequest("records", method: "POST", body: ["action":"correct","id":record.id,"version":record.version,"kind":kind,"content":content], as: KelvinAck.self)
    }
    func kelvinDeleteRecord(_ record: KelvinMemoryRecord) async throws {
        _ = try await kelvinRequest("records", method: "POST", body: ["action":"delete","id":record.id,"version":record.version], as: KelvinAck.self)
    }
    func kelvinConfirmRecord(_ record: KelvinMemoryRecord) async throws {
        _ = try await kelvinRequest("records", method: "POST", body: ["action":"confirm","id":record.id,"version":record.version], as: KelvinAck.self)
    }
}

struct KelvinInsight: Decodable, Identifiable {
    let id: String
    let kind: String
    let text: String
    let createdAt: Int64
}
private struct KelvinInsights: Decodable { let insights: [KelvinInsight] }
extension APIClient {
    func kelvinInsights() async throws -> [KelvinInsight] {
        try await kelvinRequest("insights", as: KelvinInsights.self).insights
    }
}
