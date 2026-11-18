import SwiftUI

private struct PackageBusinessThread: Decodable {
    struct Message: Decodable, Identifiable { let id: Int; let revision: Int; let sender: String; let body: String; let createdAt: String }
    struct RoomRequest: Decodable { let revision: Int; let adults: Int; let rooms: Int; let state: String; let note: String }
    let packageID: String; let revision: Int; let messages: [Message]; let roomRequest: RoomRequest?
}
struct PackageSupportBusinessView: View {
    let packageID: String
    @State private var thread: PackageBusinessThread?
    @State private var text = ""
    @State private var note = ""
    @State private var sending = false
    @State private var error: String?
    @State private var requestID = UUID().uuidString
    private var path: String { "/api/admin/offers/\(packageID)" }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Поддержка предложения", systemImage: "bubble.left.and.bubble.right").font(.headline)
            if let r = thread?.roomRequest {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Запрос на размещение").font(.headline)
                    LabeledContent("Взрослые", value: String(r.adults)); LabeledContent("Запрошено номеров", value: String(r.rooms))
                    Text(r.state == "pending" ? "Ожидает проверки отелей" : r.note).font(.caption)
                    if r.state == "pending" {
                        Text("Проверьте вместимость обоих отелей. Нельзя разблокировать размещение без подтверждённого тарифа и актуального расчёта.").font(.caption).foregroundStyle(.secondary)
                        TextField("Решение или альтернативный вариант", text: $note, axis: .vertical).textFieldStyle(.roundedBorder)
                        Button("Согласовать при подтверждённом тарифе") { Task { await decide("approved") } }.buttonStyle(BusinessActionStyle()).disabled(sending || note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        Button("Предложить вариант") { Task { await decide("alternative") } }.buttonStyle(BusinessActionStyle(primary: false)).disabled(sending || note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        Button("Отклонить запрос", role: .destructive) { Task { await decide("declined") } }.disabled(sending || note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }.padding(12).background(Color.yellow.opacity(0.13), in: RoundedRectangle(cornerRadius: 16))
            }
            ForEach(thread?.messages ?? []) { msg in
                VStack(alignment: .leading, spacing: 4) { Text(msg.sender == "staff" ? "Менеджер" : "Клиент").font(.caption.bold()); Text(msg.body).font(.subheadline).textSelection(.enabled); Text(msg.createdAt + " · v\(msg.revision)").font(.caption2).foregroundStyle(.secondary) }.padding(12).frame(maxWidth: .infinity, alignment: .leading).background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 14))
            }
            TextField("Ответ клиенту", text: $text, axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(2...6)
            Button("Отправить ответ") { Task { await send() } }.buttonStyle(BusinessActionStyle()).disabled(sending || thread == nil || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            Button("Обновить") { Task { await load() } }.font(.caption)
        }.padding(16).businessCard(radius: 24).task { await load(); while !Task.isCancelled { do { try await Task.sleep(for: .seconds(12)) } catch { break }; if !sending { await load() } } }
    }
    @MainActor private func load() async { do { thread = try await APIClient.shared.offerRequest(path: path + "/thread"); error = nil } catch { self.error = error.localizedDescription } }
    @MainActor private func send() async { guard let thread else { return }; sending = true; defer { sending = false }; do { self.thread = try await APIClient.shared.offerRequest(path: path + "/thread", method: "POST", payload: ["revision":thread.revision,"body":text,"requestID":requestID]); text = ""; requestID = UUID().uuidString; error = nil } catch { self.error = error.localizedDescription } }
    @MainActor private func decide(_ decision: String) async { guard let thread else { return }; sending = true; defer { sending = false }; do { self.thread = try await APIClient.shared.offerRequest(path: path + "/room-request", method: "POST", payload: ["revision":thread.revision,"decision":decision,"note":note]); note = ""; error = nil } catch { self.error = error.localizedDescription } }
}
