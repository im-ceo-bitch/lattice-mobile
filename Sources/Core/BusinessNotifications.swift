import Foundation
import UIKit
import UserNotifications

// Shared event names used by APIClient, RootView, and push-notification handling.
// Keep these in an existing iOS target source file so XcodeGen includes them.
extension Notification.Name {
    static let iumrahBusinessSessionInvalidated = Notification.Name("iumrah.business.sessionInvalidated")
    static let iumrahBusinessSecurityNewSession = Notification.Name("iumrah.business.securityNewSession")
    static let iumrahBusinessChatChanged = Notification.Name("iumrah.business.chatChanged")
    static let iumrahBusinessChatRead = Notification.Name("iumrah.business.chatRead")
    static let iumrahBusinessOfferChanged = Notification.Name("iumrah.business.offerChanged")
    static let iumrahBusinessOfferOpen = Notification.Name("iumrah.business.offerOpen")
    static let iumrahBusinessBookingChanged = Notification.Name("iumrah.business.bookingOperationsChanged")
    static let iumrahBusinessBookingOpen = Notification.Name("iumrah.business.bookingOpen")
    static let iumrahBusinessChatOpen = Notification.Name("iumrah.business.chatOpen")
    static let iumrahBusinessFlightPriceOpen = Notification.Name("iumrah.business.flightPriceOpen")
}

@MainActor
enum BusinessNotificationRoute {
    // In-memory only: never persist private booking identifiers outside the locked session.
    static var pendingOffer: String?
    static var pendingBooking: String?
    static var pendingChat: String?
}

@MainActor
final class BusinessAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func applicationDidReceiveMemoryWarning(_ application: UIApplication) {
        Task { await APIClient.shared.discardPerformanceCaches() }
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(token, forKey: "iumrah.push.deviceToken")
        UserDefaults.standard.removeObject(forKey: "iumrah.push.lastRegistrationError")
        Task {
            await BusinessNotifications.registerCurrentDeviceIfPossible()
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        UserDefaults.standard.set(error.localizedDescription, forKey: "iumrah.push.lastRegistrationError")
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        handleSecurityNotification(notification.request.content.userInfo)
        handleOperationalNotification(notification.request.content.userInfo, opened: false)
        completionHandler([.banner, .sound, .badge, .list])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        handleSecurityNotification(response.notification.request.content.userInfo)
        handleFlightPriceNotification(response.notification.request.content.userInfo)
        handleOperationalNotification(response.notification.request.content.userInfo, opened: true)
        completionHandler()
    }

    private func handleOperationalNotification(_ userInfo: [AnyHashable: Any], opened: Bool) {
        guard BusinessSessionVault.sessionToken != nil, let type = userInfo["type"] as? String else { return }
        if type == "offer_viewed", let id = userInfo["offerID"] as? String, id.hasPrefix("PKG-"), id.count <= 180 {
            NotificationCenter.default.post(name: .iumrahBusinessOfferChanged, object: id)
            if opened { BusinessNotificationRoute.pendingOffer = id; NotificationCenter.default.post(name: .iumrahBusinessOfferOpen, object: id) }
            return
        }
        guard let key = userInfo["bookingID"] as? String, !key.isEmpty, key.count <= 180 else { return }
        switch type {
        case "chat_message", "chat_image":
            NotificationCenter.default.post(name: .iumrahBusinessChatChanged, object: key)
            if opened { BusinessNotificationRoute.pendingChat = key; NotificationCenter.default.post(name: .iumrahBusinessChatOpen, object: key) }
        case "payment_receipt", "booking_created", "booking_status_changed":
            NotificationCenter.default.post(name: .iumrahBusinessBookingChanged, object: key)
            if opened { BusinessNotificationRoute.pendingBooking = key; NotificationCenter.default.post(name: .iumrahBusinessBookingOpen, object: key) }
        default: break
        }
    }

    private func handleFlightPriceNotification(_ userInfo: [AnyHashable: Any]) {
        guard (userInfo["type"] as? String) == "flight_price_changed",
              let key = userInfo["flightKey"] as? String, key.count < 180 else { return }
        UserDefaults.standard.set(key, forKey: "iumrah.price.pendingFlightKey")
        NotificationCenter.default.post(name: .iumrahBusinessFlightPriceOpen, object: key)
    }

    private func handleSecurityNotification(_ userInfo: [AnyHashable: Any]) {
        guard (userInfo["type"] as? String) == "security_new_session" else { return }
        NotificationCenter.default.post(name: .iumrahBusinessSecurityNewSession, object: nil)
    }
}

enum BusinessNotifications {
    private static let trackedJobsKey = "iumrah.notifications.trackedHotelImportJobs.v1"
    private static let notifiedJobsKey = "iumrah.notifications.notifiedHotelImportJobs.v1"

    static func prepare() async {
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])) ?? false
        guard granted else { return }
        await MainActor.run {
            UIApplication.shared.registerForRemoteNotifications()
        }
        await registerCurrentDeviceIfPossible()
    }

    static func registerCurrentDeviceIfPossible() async {
        guard BusinessSessionVault.sessionToken != nil,
              let token = UserDefaults.standard.string(forKey: "iumrah.push.deviceToken"), !token.isEmpty else { return }
        do {
            let registration = try await APIClient.shared.registerPushDevice(token: token, environment: "production")
            if registration.ok && registration.ready != false {
                UserDefaults.standard.removeObject(forKey: "iumrah.push.lastRegistrationError")
            } else {
                UserDefaults.standard.set("Устройство не готово к получению push. Проверьте настройки APNs на сервере.", forKey: "iumrah.push.lastRegistrationError")
            }
        } catch {
            UserDefaults.standard.set("Не удалось зарегистрировать устройство для push. Повторите вход или откройте приложение снова.", forKey: "iumrah.push.lastRegistrationError")
        }
    }

    static func hotelImportStarted(_ job: HotelImportJob) async {
        var tracked = storedIDs(forKey: trackedJobsKey)
        tracked.insert(job.id)
        saveIDs(tracked, forKey: trackedJobsKey)
    }

    static func trackActiveHotelImports(_ jobs: [HotelImportJob]) async {
        var tracked = storedIDs(forKey: trackedJobsKey)
        for job in jobs where job.isActive { tracked.insert(job.id) }
        saveIDs(tracked, forKey: trackedJobsKey)
    }

    /// Server-side imports keep running independently. This local reconciliation is
    /// retained as a safe fallback until APNs credentials + entitlement are active.
    static func notifyUnseenTerminalJobs(_ jobs: [HotelImportJob]) async {
        var tracked = storedIDs(forKey: trackedJobsKey)
        var notified = storedIDs(forKey: notifiedJobsKey)
        var changed = false
        for job in jobs where !job.isActive {
            guard tracked.contains(job.id), !notified.contains(job.id) else { continue }
            await deliver(job)
            notified.insert(job.id)
            tracked.remove(job.id)
            changed = true
        }
        if changed {
            saveIDs(tracked, forKey: trackedJobsKey)
            saveIDs(notified, forKey: notifiedJobsKey)
        }
    }

    static func hotelImportFinished(_ job: HotelImportJob) async {
        await deliver(job)
        var notified = storedIDs(forKey: notifiedJobsKey)
        notified.insert(job.id)
        saveIDs(notified, forKey: notifiedJobsKey)
        var tracked = storedIDs(forKey: trackedJobsKey)
        tracked.remove(job.id)
        saveIDs(tracked, forKey: trackedJobsKey)
    }

    private static func deliver(_ job: HotelImportJob) async {
        let content = UNMutableNotificationContent()
        content.title = job.isCompleted ? "Импорт отеля завершён" : "Импорт отеля требует внимания"
        if job.isCompleted {
            content.body = "\(job.hotelName) · \(job.storedImages) фото сохранено в iumrah Hotels."
        } else {
            content.body = job.error ?? "\(job.hotelName) сохранён как черновик. Проверьте импорт."
        }
        content.sound = .default
        let request = UNNotificationRequest(identifier: "iumrah.hotel.\(job.id)", content: content, trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
    }

    private static func storedIDs(forKey key: String) -> Set<String> {
        Set(UserDefaults.standard.stringArray(forKey: key) ?? [])
    }

    private static func saveIDs(_ values: Set<String>, forKey key: String) {
        UserDefaults.standard.set(Array(values.suffix(250)), forKey: key)
    }
}
