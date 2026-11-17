import SwiftUI
import UserNotifications
import UIKit

struct BusinessPushDiagnosticsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var status: PushStatusResponse?
    @State private var permission = "Проверка…"
    @State private var tokenReady = false
    @State private var error: String?
    @State private var busy = false
    @State private var testResult: String?
    var body: some View {
        List {
            Section("Устройство") {
                LabeledContent("Разрешение", value: permission)
                LabeledContent("Токен APNs", value: tokenReady ? "Получен" : "Отсутствует")
                if let issue = UserDefaults.standard.string(forKey: "iumrah.push.lastRegistrationError") { Text(issue).foregroundStyle(.red) }
                Button("Повторить регистрацию") { Task { await refresh(register: true) } }.disabled(busy)
                Button("Настройки iOS") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }
            }
            Section("Сервер") {
                LabeledContent("APNs", value: status.map { $0.configured ? "Настроен" : "Не настроен" } ?? "Не проверен")
                LabeledContent("Активные устройства", value: status.map { String($0.devices) } ?? "—")
                if let error { Text(error).foregroundStyle(.red) }
                Button("Отправить тестовый push") { Task { await testPush() } }.disabled(busy)
                if let testResult { Text(testResult).font(.caption) }
                Button("Обновить состояние") { Task { await refresh(register: false) } }.disabled(busy)
                Text("Регистрация и наличие ключа APNs не подтверждают фактическую доставку на iPhone.").font(.caption).foregroundStyle(.secondary)
            }
        }.navigationTitle("Push-уведомления").navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Готово") { dismiss() }.foregroundStyle(BusinessDesign.headerInk) } }
            .task { await refresh(register: false) }
    }
    @MainActor private func testPush() async {
        busy = true; defer { busy = false }; testResult = nil
        do { let result = try await APIClient.shared.testBusinessPush(); testResult = result.ok ? "Apple приняла уведомление. Проверьте баннер на устройстве." : result.diagnostic }
        catch { testResult = error.localizedDescription }
    }
    @MainActor private func refresh(register: Bool) async {
        busy = true; defer { busy = false }; error = nil
        if register { await BusinessNotifications.prepare() }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: permission = "Разрешено"
        case .denied: permission = "Запрещено"
        default: permission = "Не запрошено"
        }
        tokenReady = !(UserDefaults.standard.string(forKey: "iumrah.push.deviceToken") ?? "").isEmpty
        do { status = try await APIClient.shared.pushStatus() } catch { self.error = error.localizedDescription }
    }
}
