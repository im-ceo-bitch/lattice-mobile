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
private struct KelvinPair: Decodable { let token: String }
private struct KelvinAck: Decodable { let ok: Bool }
private struct KelvinNotes: Decodable { let notes: [KelvinNote] }

extension APIClient {
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
    func kelvinSend(id: String, text: String) async throws {
        _ = try await kelvinRequest("message", method: "POST", body: ["id": id, "prompt": text], as: KelvinAck.self)
    }
    func kelvinPair() async throws -> String { try await kelvinRequest("pair", method: "POST", as: KelvinPair.self).token }
    func kelvinRevoke() async throws { _ = try await kelvinRequest("revoke", method: "POST", as: KelvinAck.self) }
    func kelvinNotes() async throws -> [KelvinNote] { try await kelvinRequest("memory", as: KelvinNotes.self).notes }
    func kelvinRemember(id: String, text: String) async throws { _ = try await kelvinRequest("remember", method: "POST", body: ["id":id,"content":text], as: KelvinAck.self) }
    func kelvinForget(id: String) async throws { _ = try await kelvinRequest("forget", method: "POST", body: ["id":id], as: KelvinAck.self) }
}
