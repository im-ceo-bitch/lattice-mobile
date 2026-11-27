import SwiftUI

struct BusinessNotificationSoundView: View {
    @AppStorage(IumrahNotificationSound.key) private var mode = "iumrah"
    @AppStorage("iumrah.notification.sound.confirmed.v1") private var confirmedMode = ""
    @State private var busy = false
    @State private var previewFailed = false

    var body: some View {
        List {
            Section("Звук уведомлений") {
                Picker("Звук", selection: $mode) {
                    Text("Фирменный iumrah").tag("iumrah")
                    Text("По умолчанию iPhone").tag("system")
                }.pickerStyle(.inline).disabled(busy)
                Button { Task { @MainActor in
                    previewFailed = !(await IumrahNotificationSound.preview(title: "iumrah Business", body: "Проверка звука уведомлений"))
                } } label: { Label("Проверить звук", systemImage: "play.circle") }
                if previewFailed { Text("Разрешите звуки уведомлений в настройках iOS.").font(.caption).foregroundStyle(.secondary) }
            }
            Section {
                if busy { ProgressView() }
                else if confirmedMode != mode {
                    Text("Звук push обновится после синхронизации устройства.").font(.caption).foregroundStyle(.secondary)
                }
                Button("Синхронизировать звук") { Task { await sync() } }.disabled(busy)
            } footer: { Text("Настройка действует только на этом устройстве. Беззвучный режим и Фокусирование iOS сохраняют приоритет.") }
        }
        .navigationTitle("Звук уведомлений")
        .navigationBarTitleDisplayMode(.inline)
        .businessNavigationSurface()
        .onChange(of: mode) { _, _ in Task { await sync() } }
    }
    @MainActor private func sync() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        await BusinessNotifications.registerCurrentDeviceIfPossible()
    }
}
