import Foundation

enum APIError: Error { case unauthorized, invalidResponse }
enum BusinessSessionVault { static var sessionToken: String? = "staff-session" }
extension Notification.Name { static let iumrahBusinessChatRead = Notification.Name("test.chat.read") }

actor APIClient {
    static let shared = APIClient()
    struct Call: Equatable { let cursor: String; let scope: String? }
    struct Stats { let requests: [Call]; let acknowledged: [Call]; let saves: [BusinessChatHistorySnapshot] }
    private var snapshot: BusinessChatHistorySnapshot?
    private var pages: [BusinessChatMessagesResponse] = []
    private var requests: [Call] = []
    private var acknowledged: [Call] = []
    private var saves: [BusinessChatHistorySnapshot] = []
    private var delay: UInt64 = 0
    func configure(snapshot: BusinessChatHistorySnapshot?, pages: [BusinessChatMessagesResponse], delay: UInt64 = 0) {
        self.snapshot = snapshot; self.pages = pages; self.delay = delay
        requests = []; acknowledged = []; saves = []
    }
    func cachedChatHistory(conversationID: String) -> BusinessChatHistorySnapshot? { snapshot }
    func businessChatMessages(bookingID: String, after: String, scope: String?) async throws -> BusinessChatMessagesResponse {
        requests.append(Call(cursor: after, scope: scope))
        if delay > 0 { try await Task.sleep(nanoseconds: delay) }
        guard !pages.isEmpty else { throw APIError.invalidResponse }
        return pages.removeFirst()
    }
    func saveChatHistory(_ snapshot: BusinessChatHistorySnapshot, conversationID: String, sessionToken: String) { saves.append(snapshot) }
    func markBusinessChatRead(bookingID: String, through: String, scope: String) async throws {
        acknowledged.append(Call(cursor: through, scope: scope))
    }
    func stats() -> Stats { Stats(requests: requests, acknowledged: acknowledged, saves: saves) }
}

@MainActor
final class ChatHarness {
    let conversationID = "care-pilgrim:test"
    var messages: [BusinessChatMessage] = []
    var cursor = "0"
    var scopeVersion: String?
    var syncing = false
    var pendingSync = false
    var attemptedHistoryCache = false
    var acknowledgedCursor: String?
    var acknowledgedScope: String?
    var loading = true
    var errorMessage: String?
    func run() async { await reload() }
    // INSERT_PRODUCTION_SYNC_METHODS
}

@main
struct ChatCacheTests {
    @MainActor static func main() async {
        var passed = 0
        func expect(_ condition: @autoclosure () -> Bool, _ label: String) {
            guard condition() else { fatalError(label) }
            passed += 1
        }
        func message(_ id: String) -> BusinessChatMessage {
            BusinessChatMessage(id: id, bookingID: "booking", senderType: "client", senderName: nil, body: id,
                                messageType: "text", attachmentID: nil, attachmentURL: nil, createdAt: "2026-11-14T00:00:00Z", readByStaff: false)
        }
        func page(_ messages: [BusinessChatMessage], _ cursor: String, _ scope: String, reset: Bool = false, more: Bool = false) -> BusinessChatMessagesResponse {
            BusinessChatMessagesResponse(ok: true, bookingID: "care-pilgrim:test", messages: messages, nextCursor: cursor, hasMore: more, scopeVersion: scope, reset: reset)
        }
        let old = BusinessChatHistorySnapshot(messages: [message("a"), message("b")], cursor: "20", scope: "scope-A")
        let api = APIClient.shared
        await api.configure(snapshot: old, pages: [page([message("b"), message("c")], "22", "scope-A")])
        let resumed = ChatHarness(); await resumed.run()
        var stats = await api.stats()
        expect(stats.requests == [.init(cursor: "20", scope: "scope-A")], "cached cursor used")
        expect(resumed.messages.map(\.id) == ["a", "b", "c"], "merge and deduplicate")
        expect(stats.acknowledged == [.init(cursor: "22", scope: "scope-A")], "acknowledge only fetched cursor")
        expect(stats.saves.first?.cursor == "22", "save updated prefix")

        await api.configure(snapshot: old, pages: [page([], "20", "scope-A")])
        let unchanged = ChatHarness(); await unchanged.run(); stats = await api.stats()
        expect(unchanged.messages.count == 2, "unchanged history restored after API check")
        expect(stats.saves.isEmpty, "empty delta does not reencode cache")

        await api.configure(snapshot: old, pages: [page([message("new")], "30", "scope-B", reset: true)])
        let reset = ChatHarness(); await reset.run(); stats = await api.stats()
        expect(reset.messages.map(\.id) == ["new"], "server reset removes previous scope")
        expect(stats.saves.first?.scope == "scope-B", "save new scope")

        await api.configure(snapshot: old, pages: [page([message("wrong")], "25", "scope-B"), page([message("new")], "30", "scope-B")])
        let mismatch = ChatHarness(); await mismatch.run(); stats = await api.stats()
        expect(stats.requests.map(\.cursor) == ["20", "0"], "unexpected scope change restarts from zero")
        expect(mismatch.messages.map(\.id) == ["new"], "unexpected scope cannot leak old history")

        await api.configure(snapshot: old, pages: [])
        let failed = ChatHarness(); await failed.run(); stats = await api.stats()
        expect(failed.messages.isEmpty && failed.errorMessage != nil, "offline or unauthorized opening never shows unvalidated cache")
        expect(stats.acknowledged.isEmpty, "failed fetch not acknowledged")

        await api.configure(snapshot: nil, pages: [page([message("a")], "1", "scope-A", more: true), page([message("b")], "2", "scope-A")])
        let paginated = ChatHarness(); await paginated.run(); stats = await api.stats()
        expect(stats.requests.map(\.cursor) == ["0", "1"], "pages resume from last cursor")
        expect(paginated.messages.map(\.id) == ["a", "b"], "full prefix retained")
        expect(stats.saves.count == 1, "only one snapshot encoded per sync")

        await api.configure(snapshot: old, pages: [page([], "20", "scope-A"), page([message("c")], "21", "scope-A")], delay: 60_000_000)
        let concurrent = ChatHarness()
        let first = Task { await concurrent.run() }
        // Wait until the first fetch has reached the mock server.
        for _ in 0..<200 {
            if !(await api.stats()).requests.isEmpty { break }
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
        let reachedServer = !(await api.stats()).requests.isEmpty
        guard reachedServer else { fatalError("mock request did not start") }
        await concurrent.run()
        await first.value; stats = await api.stats()
        expect(stats.requests.map(\.cursor) == ["20", "20"], "push during request causes follow-up")
        expect(concurrent.messages.map(\.id) == ["a", "b", "c"], "queued push retrieves incoming message")

        await api.configure(snapshot: old, pages: [page([message("c")], "21", "scope-A")], delay: 60_000_000)
        let expired = ChatHarness()
        let request = Task { await expired.run() }
        for _ in 0..<200 {
            if !(await api.stats()).requests.isEmpty { break }
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
        let reachedServerBeforeExpiry = !(await api.stats()).requests.isEmpty
        guard reachedServerBeforeExpiry else { fatalError("mock expiry request did not start") }
        BusinessSessionVault.sessionToken = nil
        await request.value; stats = await api.stats()
        expect(expired.messages.isEmpty, "session change during network request cannot display history")
        expect(stats.saves.isEmpty && stats.acknowledged.isEmpty, "expired session cannot save or acknowledge")
        print("Business chat cache: \(passed)/\(passed) checks passed")
    }
}
