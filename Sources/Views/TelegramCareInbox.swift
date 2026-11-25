import SwiftUI
import Foundation

struct TelegramCareThread: Decodable, Identifiable {
    let id: String
    let name: String
    let locale: String
    let mode: String
    let updatedAt: String
    let preview: String
}
struct TelegramCareMessage: Decodable, Identifiable {
    let id: Int
    let role: String
    let body: String
    let createdAt: String
    let delivery: String
}
struct TelegramCareDetail: Decodable {
    let mode: String
    let messages: [TelegramCareMessage]
}
private struct TelegramCareList: Decodable { let threads: [TelegramCareThread] }
private struct TelegramCareReply: Encodable { let body: String; let clientMessageID: String }
private struct TelegramCareMode: Encodable { let mode: String }

extension APIClient {
    private func telegramCareURL(_ suffix: String = "") -> URL {
        AppConfig.apiBaseURL.appending(path: "/api/admin/hotels/telegram-care" + suffix)
    }
    func telegramCareThreads() async throws -> [TelegramCareThread] {
        let (data, response) = try await perform(from: telegramCareURL())
        try validate(response, data: data)
        return try decoder.decode(TelegramCareList.self, from: data).threads
    }
    func telegramCareDetail(_ id: String) async throws -> TelegramCareDetail {
        let (data, response) = try await perform(from: telegramCareURL("/\(id)"))
        try validate(response, data: data)
        return try decoder.decode(TelegramCareDetail.self, from: data)
    }
    func telegramCareReply(_ id: String, body: String, clientID: String) async throws {
        var request = URLRequest(url: telegramCareURL("/\(id)/reply"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(TelegramCareReply(body: body, clientMessageID: clientID))
        let (data, response) = try await perform(request)
        try validate(response, data: data)
    }
    func telegramCareMode(_ id: String, mode: String) async throws {
        var request = URLRequest(url: telegramCareURL("/\(id)/mode"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(TelegramCareMode(mode: mode))
        let (data, response) = try await perform(request)
        try validate(response, data: data)
    }
}

struct TelegramCareInbox: View {
    @State private var threads: [TelegramCareThread] = []
    @State private var error: String?
    @State private var loading = true
    var body: some View {
        List {
            if let error { Text(error).foregroundStyle(.secondary) }
            if threads.isEmpty && !loading && error == nil {
                ContentUnavailableView("Нет диалогов", systemImage: "bubble.left.and.bubble.right", description: Text("Обращения из Telegram появятся здесь."))
            }
            ForEach(threads) { thread in
                NavigationLink { TelegramCareConversation(thread: thread) } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Text(thread.name).font(.headline)
                            Spacer()
                            Text(thread.mode == "human" ? "Оператор" : "Авто").font(.caption).foregroundStyle(.secondary)
                        }
                        Text(thread.preview).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                    }.padding(.vertical, 5)
                }
            }
        }
        .navigationTitle("Telegram Care")
        .overlay { if loading { ProgressView() } }
        .refreshable { await load() }
        .task { await load(); while !Task.isCancelled { try? await Task.sleep(for: .seconds(12)); if !Task.isCancelled { await load() } } }
    }
    @MainActor private func load() async {
        do { threads = try await APIClient.shared.telegramCareThreads(); error = nil }
        catch { if !Task.isCancelled { self.error = "Не удалось загрузить диалоги" } }
        loading = false
    }
}

struct TelegramCareConversation: View {
    let thread: TelegramCareThread
    @State private var detail: TelegramCareDetail?
    @State private var draft = ""
    @State private var busy = false
    @State private var error: String?
    @State private var failedID: String?
    @FocusState private var focused: Bool
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(detail?.mode == "human" ? "Автоответы приостановлены" : "Автоматическая поддержка").font(.caption)
                Spacer()
                Button(detail?.mode == "human" ? "Вернуть авто" : "Взять диалог") { changeMode() }.font(.subheadline.bold()).disabled(busy || detail == nil)
            }.padding(14)
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(detail?.messages ?? []) { message in
                            VStack(alignment: .leading, spacing: 5) {
                                Text(message.role == "staff" ? "Сотрудник" : message.role == "auto" ? "Автоподдержка" : thread.name).font(.caption.bold()).foregroundStyle(.secondary)
                                Text(message.body).textSelection(.enabled)
                                if message.delivery != "sent" { Text("Доставка не подтверждена").font(.caption).foregroundStyle(.orange) }
                            }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
                                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 15)).id(message.id)
                        }
                    }.padding(14)
                }
                .onChange(of: detail?.messages.last?.id) { _, id in if let id { proxy.scrollTo(id, anchor: .bottom) } }
            }
            if let error { Text(error).font(.footnote).foregroundStyle(.secondary).padding(8) }
            HStack {
                TextField("Сообщение", text: $draft, axis: .vertical).focused($focused).lineLimit(1...5).textFieldStyle(.roundedBorder).onChange(of: draft) { _, _ in failedID = nil }
                Button { send() } label: { Image(systemName: "arrow.up.circle.fill").font(.system(size: 30)) }.disabled(busy || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }.padding(12)
        }
        .navigationTitle(thread.name)
        .toolbar { ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Готово") { focused = false } } }
        .scrollDismissesKeyboard(.interactively)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load(); while !Task.isCancelled { try? await Task.sleep(for: .seconds(5)); if !Task.isCancelled && !busy { await load() } } }
    }
    @MainActor private func load() async {
        do { detail = try await APIClient.shared.telegramCareDetail(thread.id) }
        catch { if !Task.isCancelled { self.error = "Не удалось обновить переписку" } }
    }
    private func changeMode() {
        guard !busy, let detail else { return }
        busy = true
        Task { @MainActor in
            defer { busy = false }
            do { try await APIClient.shared.telegramCareMode(thread.id, mode: detail.mode == "human" ? "auto" : "human"); error = nil; await load() }
            catch { self.error = "Не удалось изменить режим" }
        }
    }
    private func send() {
        guard !busy else { return }
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines), id = failedID ?? UUID().uuidString
        guard !body.isEmpty else { return }
        busy = true
        Task { @MainActor in
            defer { busy = false }
            do { try await APIClient.shared.telegramCareReply(thread.id, body: body, clientID: id); draft = ""; failedID = nil; error = nil }
            catch { failedID = id; self.error = "Доставка не подтверждена. Проверьте историю перед повторной отправкой." }
            await load()
        }
    }
}
