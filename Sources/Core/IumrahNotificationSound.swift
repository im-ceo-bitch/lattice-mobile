import Foundation
import UserNotifications

/// A preference belongs to this app installation, not to the user's account.
enum IumrahNotificationSound {
    static let key = "iumrah.notification.sound.v1"
    static let filename = "iumrah-notification.wav"
    static var mode: String {
        UserDefaults.standard.string(forKey: key) == "system" ? "system" : "iumrah"
    }
    static var sound: UNNotificationSound {
        mode == "iumrah" && Bundle.main.url(forResource: "iumrah-notification", withExtension: "wav") != nil
            ? UNNotificationSound(named: UNNotificationSoundName(rawValue: filename)) : .default
    }

    /// Preview via the real notification system, respecting Focus and sound permission.
    static func preview(title: String, body: String) async -> Bool {
        let center = UNUserNotificationCenter.current()
        var permission = await center.notificationSettings()
        if permission.authorizationStatus == .notDetermined {
            _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
            permission = await center.notificationSettings()
        }
        guard permission.authorizationStatus == .authorized || permission.authorizationStatus == .provisional || permission.authorizationStatus == .ephemeral,
              permission.soundSetting == .enabled else { return false }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = sound
        content.userInfo = ["type": "notification_sound_preview"]
        do {
            try await center.add(UNNotificationRequest(identifier: "iumrah.sound.preview", content: content,
                trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)))
            return true
        } catch { return false }
    }

    /// Update scheduled calendar alerts in place; never enable muted reminders.
    static func refreshPendingCalendarSounds() async {
        let center = UNUserNotificationCenter.current()
        for request in await center.pendingNotificationRequests() {
            guard request.identifier.hasPrefix("iumrah.prayer.") || request.identifier.hasPrefix("iumrah.planned-trip.") else { continue }
            guard let trigger = request.trigger as? UNCalendarNotificationTrigger,
                  let next = trigger.nextTriggerDate(), next.timeIntervalSinceNow > 2,
                  request.content.sound != nil,
                  let content = request.content.mutableCopy() as? UNMutableNotificationContent else { continue }
            content.sound = sound
            try? await center.add(UNNotificationRequest(identifier: request.identifier, content: content, trigger: trigger))
        }
    }
}
