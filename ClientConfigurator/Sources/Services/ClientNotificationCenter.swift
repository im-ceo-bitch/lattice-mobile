import Foundation
import Combine

struct ClientSystemNotification: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let body: String
    let targetScope: String
    let destination: String
    let destinationBookingID: String?
    let createdBy: String
    let status: String
    let matchedDevices: Int
    let pushSentCount: Int
    let pushFailedCount: Int
    let createdAt: String
    let sentAt: String?
    let expiresAt: String
    var isRead: Bool
}

private struct ClientNotificationDeviceRegistration: Encodable {
    let installationID: String
    let deviceToken: String?
    let environment: String
    let appBundleID: String
    let locale: String
    let hasTrip: Bool
}

private struct ClientNotificationDeviceResponse: Decodable {
    let ok: Bool
    let ready: Bool?
}

private struct ClientNotificationFeedResponse: Decodable {
    let ok: Bool
    let notifications: [ClientSystemNotification]
}

private struct ClientNotificationReadRequest: Encodable {
    let installationID: String
}

private struct ClientNotificationReadResponse: Decodable {
    let ok: Bool
}

@MainActor
final class ClientNotificationCenter: ObservableObject {
    static let shared = ClientNotificationCenter()

    @Published private(set) var notifications: [ClientSystemNotification] = []
    @Published private var bookingReceipts: [ClientSystemNotification] = []
    private var readReceiptIDs = Set(UserDefaults.standard.stringArray(forKey: "iumrah.booking.receipts.read.v1") ?? [])
    @Published private(set) var latest: ClientSystemNotification?
    @Published private(set) var lastError: String?
    @Published private(set) var dismissedHomeIDs: Set<String> = []
    @Published private(set) var pushProviderReady: Bool?

    private var registrationTask: Task<Void, Never>?
    private var registrationRevision = 0
    private let api = APIClient.shared
    private let installationKey = "iumrah.app.client-notification-installation.v1"
    private let cacheKey = "iumrah.app.client-notification-cache.v1"
    private let dismissedHomeKey = "iumrah.app.client-notification-dismissed-home.v1"
    private(set) lazy var installationID: String = resolvedInstallationID()

    private init() {
        if let data = UserDefaults.standard.data(forKey: cacheKey),
           let cached = try? JSONDecoder().decode([ClientSystemNotification].self, from: data) {
            notifications = cached.sorted(by: notificationSort)
        }
        if let stored = UserDefaults.standard.array(forKey: dismissedHomeKey) as? [String] {
            dismissedHomeIDs = Set(stored)
        }
        latest = homeNotifications.first
    }

    var inboxNotifications: [ClientSystemNotification] {
        (bookingReceipts + notifications).sorted(by: notificationSort)
    }

    func syncBookingReceipts(_ sessions: [StoredBookingSession], language: AppSettingsStore.Language) {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fallback = ISO8601DateFormatter()
        let next = sessions.compactMap { session -> ClientSystemNotification? in
            guard session.hasServerIdentity, !session.accessToken.isEmpty || session.displayPilgrimID != nil else { return nil }
            let id = "local-booking-created:" + session.id
            let raw = session.booking.createdAt
            guard let created = formatter.date(from: raw) ?? fallback.date(from: raw), Date().timeIntervalSince(created) < 30 * 86400 else { return nil }
            let title = IumrahFlightCopy.text(language, "Бронирование создано", "Booking created", "Bron yaratildi", "Брон яратилди") + " " + session.displayBookingNumber
            let body = IumrahFlightCopy.text(language, "Ваше путешествие сохранено. Откройте бронирование, чтобы узнать актуальный статус.", "Your trip is saved. Open your booking for its current status.", "Safaringiz saqlandi. Bron holatini ko‘rish uchun uni oching.", "Сафарингиз сақланди. Брон ҳолатини кўриш учун уни очинг.")
            return ClientSystemNotification(id: id, title: title, body: body, targetScope: "booking", destination: "booking", destinationBookingID: session.id, createdBy: "iumrah", status: "published", matchedDevices: 0, pushSentCount: 0, pushFailedCount: 0, createdAt: raw, sentAt: raw, expiresAt: fallback.string(from: created.addingTimeInterval(30 * 86400)), isRead: readReceiptIDs.contains(id))
        }.sorted(by: notificationSort)
        if bookingReceipts != next { bookingReceipts = next; latest = homeNotifications.first }
    }

    var homeNotifications: [ClientSystemNotification] {
        inboxNotifications.filter { !dismissedHomeIDs.contains($0.id) }
    }

    var unreadCount: Int {
        inboxNotifications.filter { !$0.isRead }.count
    }

    func sync(deviceToken: String?, accountToken: String?, hasTrip: Bool, locale: String) async {
        registrationRevision &+= 1
        let revision = registrationRevision
        let previous = registrationTask
        let task = Task { @MainActor [weak self] in
            await previous?.value
            guard let self, self.registrationRevision == revision else { return }
            await self.performSync(deviceToken: deviceToken, accountToken: accountToken, hasTrip: hasTrip, locale: locale, revision: revision)
        }
        registrationTask = task
        await task.value
        if registrationRevision == revision { registrationTask = nil }
    }

    private func performSync(deviceToken: String?, accountToken: String?, hasTrip: Bool, locale: String, revision: Int) async {
        let headers = authorizationHeaders(accountToken)
        let request = ClientNotificationDeviceRegistration(
            installationID: installationID,
            deviceToken: normalizedToken(deviceToken),
            environment: "production",
            appBundleID: AppIdentity.runtimeBundleID,
            locale: locale,
            hasTrip: hasTrip
        )

        var lastRegistrationError: Error?
        for attempt in 0..<3 {
            guard registrationRevision == revision else { return }
            do {
                let response: ClientNotificationDeviceResponse = try await api.post(
                    "/api/catalog/hotels/client/notifications/devices",
                    body: request,
                    headers: headers
                )
                guard registrationRevision == revision else { return }
                guard response.ok else { throw APIError.invalidResponse }
                pushProviderReady = response.ready
                await refresh(accountToken: accountToken, expectedRevision: revision)
                guard registrationRevision == revision else { return }
                return
            } catch {
                lastRegistrationError = error
                if attempt < 2 {
                    try? await Task.sleep(nanoseconds: UInt64(650_000_000 * (attempt + 1)))
                }
            }
        }

        if registrationRevision == revision { lastError = lastRegistrationError?.localizedDescription }
    }

    func testPush(accountToken: String) async throws -> String {
        struct Body: Encodable { let installationID: String }
        struct Result: Decodable { let ok: Bool; let sent: Int; let errors: [String]? }
        let result: Result = try await api.post("/api/catalog/hotels/client/notifications/test", body: Body(installationID: installationID), headers: authorizationHeaders(accountToken), timeoutInterval: 25)
        return result.sent == 1 ? "APNs accepted · 1" : (result.errors?.joined(separator: ", ") ?? "APNs: 0")
    }

    func refresh(accountToken: String?, expectedRevision: Int? = nil) async {
        do {
            let response: ClientNotificationFeedResponse = try await api.get(
                "/api/catalog/hotels/client/notifications/feed",
                query: [URLQueryItem(name: "installationID", value: installationID)],
                headers: authorizationHeaders(accountToken)
            )
            guard expectedRevision == nil || expectedRevision == registrationRevision else { return }
            let next = response.notifications.sorted(by: notificationSort)
            if notifications != next {
                notifications = next
                let first = homeNotifications.first
                if latest != first { latest = first }
                persistCache()
            }
            if lastError != nil { lastError = nil }
        } catch {
            guard expectedRevision == nil || expectedRevision == registrationRevision else { return }
            lastError = error.localizedDescription
        }
    }

    func markOpened(_ notification: ClientSystemNotification, accountToken: String?) async {
        if notification.id.hasPrefix("local-booking-created:") {
            readReceiptIDs.insert(notification.id)
            UserDefaults.standard.set(Array(readReceiptIDs), forKey: "iumrah.booking.receipts.read.v1")
            if let index = bookingReceipts.firstIndex(where: { $0.id == notification.id }) { bookingReceipts[index].isRead = true }
            latest = homeNotifications.first
            return
        }
        if let index = notifications.firstIndex(where: { $0.id == notification.id }) {
            notifications[index].isRead = true
            notifications.sort(by: notificationSort)
            latest = homeNotifications.first
            persistCache()
        }
        let headers = authorizationHeaders(accountToken)
        let _: ClientNotificationReadResponse? = try? await api.post(
            "/api/catalog/hotels/client/notifications/feed/\(notification.id)/read",
            body: ClientNotificationReadRequest(installationID: installationID),
            headers: headers
        )
    }

    func dismissFromHome(_ notification: ClientSystemNotification) {
        dismissedHomeIDs.insert(notification.id)
        persistDismissedHomeIDs()
        latest = homeNotifications.first
    }

    func restoreToHome(_ notification: ClientSystemNotification) {
        dismissedHomeIDs.remove(notification.id)
        persistDismissedHomeIDs()
        latest = homeNotifications.first
    }

    func isDismissedFromHome(_ notification: ClientSystemNotification) -> Bool {
        dismissedHomeIDs.contains(notification.id)
    }

    func notification(id: String) -> ClientSystemNotification? {
        inboxNotifications.first { $0.id == id }
    }

    private func normalizedToken(_ token: String?) -> String? {
        let value = token?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? nil : value.lowercased()
    }

    private func authorizationHeaders(_ token: String?) -> [String: String] {
        let value = token?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? [:] : ["Authorization": "Bearer \(value)"]
    }

    private func resolvedInstallationID() -> String {
        if let existing = UserDefaults.standard.string(forKey: installationKey), existing.count >= 16 {
            return existing
        }
        let value = UUID().uuidString.lowercased()
        UserDefaults.standard.set(value, forKey: installationKey)
        return value
    }

    private func persistCache() {
        guard let data = try? JSONEncoder().encode(Array(notifications.prefix(20))) else { return }
        UserDefaults.standard.set(data, forKey: cacheKey)
    }

    private func persistDismissedHomeIDs() {
        UserDefaults.standard.set(Array(dismissedHomeIDs), forKey: dismissedHomeKey)
    }

    private func notificationSort(_ lhs: ClientSystemNotification, _ rhs: ClientSystemNotification) -> Bool {
        if lhs.isRead != rhs.isRead { return !lhs.isRead }
        let leftDate = lhs.sentAt ?? lhs.createdAt
        let rightDate = rhs.sentAt ?? rhs.createdAt
        if leftDate != rightDate { return leftDate > rightDate }
        return lhs.id > rhs.id
    }
}
