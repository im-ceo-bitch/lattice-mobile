import Foundation

struct KelvinTurn: Codable, Identifiable, Equatable {
    let id: String
    let threadId: String?
    let source: String
    let prompt: String
    let answer: String?
    let status: String
    let createdAt: Int64
    let updatedAt: Int64
}
struct KelvinThread: Decodable, Identifiable, Equatable { let id: String; let title: String; let updatedAt: Int64 }
struct KelvinHistory: Decodable {
    let ok: Bool
    let paired: Bool
    let online: Bool
    let turns: [KelvinTurn]
    let threads: [KelvinThread]?
    let threadId: String?
    let lastSeen: Int64?
}
struct KelvinNote: Decodable, Identifiable { let id: String; let content: String }
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
    private func kelvinRequest<T: Decodable>(_ path: String, method: String = "GET", body: [String: Any]? = nil, as type: T.Type, thread: String? = nil) async throws -> T {
        let base = AppConfig.unifiedBackendURL.appending(path: "/api/admin/hotels/kelvin/\(path)")
        guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else { throw APIError.invalidResponse }
        if let thread { components.queryItems = [URLQueryItem(name: "thread", value: thread)] }
        guard let url = components.url else { throw APIError.invalidResponse }
        var request = URLRequest(url: url)
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
    func kelvinHistory(thread: String = "legacy") async throws -> KelvinHistory { try await kelvinRequest("history", as: KelvinHistory.self, thread: thread) }
    func kelvinSend(id: String, text: String, voice: Bool = false, thread: String = "legacy") async throws {
        _ = try await kelvinRequest("message", method: "POST", body: ["id": id, "prompt": text, "voice": voice, "threadId": thread], as: KelvinAck.self)
    }
    func kelvinCancel(id: String) async throws { _ = try await kelvinRequest("cancel", method: "POST", body: ["id": id], as: KelvinAck.self) }
    func kelvinPair() async throws -> String { try await kelvinRequest("pair", method: "POST", as: KelvinPair.self).token }
    func kelvinRevoke() async throws { _ = try await kelvinRequest("revoke", method: "POST", as: KelvinAck.self) }
    func kelvinNotes() async throws -> [KelvinNote] { try await kelvinRequest("memory", as: KelvinNotes.self).notes }
    func kelvinRemember(id: String, text: String) async throws { _ = try await kelvinRequest("remember", method: "POST", body: ["id":id,"content":text], as: KelvinAck.self) }
    func kelvinForget(id: String) async throws { _ = try await kelvinRequest("forget", method: "POST", body: ["id":id], as: KelvinAck.self) }
}
