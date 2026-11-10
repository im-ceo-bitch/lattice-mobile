import SwiftUI

struct BusinessSecuritySettingsView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var appLock: BusinessAppLockStore
    @State private var editPIN = false
    @State private var removePIN = false
    @State private var changingBiometrics = false

    var body: some View {
        Form {
            Section {
                HStack(spacing: 14) {
                    Image(systemName: "lock.shield.fill")
                        .font(.system(size: 25, weight: .medium))
                        .frame(width: 54, height: 54)
                        .foregroundStyle(BusinessDesign.ink)
                        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 17))
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Защита iumrah Business").font(.headline)
                        Text("PIN и биометрия защищают приложение, не заменяя вход в аккаунт.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 6)
            }

            Section("PIN-код") {
                Button {
                    editPIN = true
                } label: {
                    Label(appLock.hasPIN ? "Изменить PIN-код" : "Создать PIN-код", systemImage: "number.square")
                }
                if appLock.hasPIN {
                    Button(role: .destructive) { removePIN = true } label: {
                        Label("Удалить PIN-код", systemImage: "lock.open")
                    }
                }
                Text("Шестизначный PIN хранится только на этом устройстве в защищённом Keychain.")
                    .font(.footnote).foregroundStyle(.secondary)
            }

            Section("Биометрия") {
                Toggle(isOn: Binding(
                    get: { appLock.biometricsEnabled },
                    set: { enabled in
                        changingBiometrics = true
                        Task {
                            _ = await appLock.setBiometricsEnabled(enabled)
                            changingBiometrics = false
                        }
                    }
                )) {
                    Label("Использовать \(appLock.biometryName)", systemImage: "faceid")
                }
                .disabled(!appLock.hasPIN || !appLock.canUseBiometrics || changingBiometrics)
                Text("При недоступности Face ID или Touch ID можно разблокировать приложение PIN-кодом.")
                    .font(.footnote).foregroundStyle(.secondary)
            }

            Section("Автоблокировка") {
                Picker("Блокировать приложение", selection: Binding(
                    get: { appLock.interval },
                    set: { appLock.setInterval($0) }
                )) {
                    ForEach(BusinessAppLockInterval.allCases) { value in
                        Text(value.title).tag(value)
                    }
                }
                .disabled(!appLock.hasPIN)
                Text("Таймер отсчитывается после ухода приложения в фон. После полного перезапуска PIN требуется всегда. Содержимое скрывается в переключателе приложений.")
                    .font(.footnote).foregroundStyle(.secondary)
            }

            Section("Вход в аккаунт") {
                LabeledContent("Локальное правило", value: "Раз в 7 дней")
                Text("Сервер может запросить пароль раньше, если срок его сессии истёк или доступ был отозван. PIN не продлевает серверную авторизацию.")
                    .font(.footnote).foregroundStyle(.secondary)
            }

            if let error = appLock.errorMessage {
                Section {
                    Text(error).foregroundStyle(.red).font(.footnote)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(BusinessDesign.background)
        .navigationTitle("Безопасность")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $editPIN) {
            NavigationStack {
                BusinessPINEditView(account: auth.user?.login ?? "", replacing: appLock.hasPIN)
                    .environmentObject(appLock)
            }
        }
        .sheet(isPresented: $removePIN) {
            NavigationStack {
                BusinessPINRemoveView().environmentObject(appLock)
            }
        }
    }
}

private struct BusinessPINEditView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appLock: BusinessAppLockStore
    let account: String
    let replacing: Bool
    @State private var oldPIN = ""
    @State private var newPIN = ""
    @State private var confirmation = ""
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                if replacing {
                    SecureField("Текущий PIN", text: $oldPIN)
                        .keyboardType(.numberPad)
                        .onChange(of: oldPIN) { _, value in oldPIN = limitedPIN(value) }
                }
                SecureField("Новый PIN · 6 цифр", text: $newPIN)
                    .keyboardType(.numberPad)
                    .onChange(of: newPIN) { _, value in newPIN = limitedPIN(value) }
                SecureField("Повторите новый PIN", text: $confirmation)
                    .keyboardType(.numberPad)
                    .onChange(of: confirmation) { _, value in confirmation = limitedPIN(value) }
            } footer: {
                Text("Выберите код, который не совпадает с датой рождения или простыми комбинациями.")
            }
            if let error { Section { Text(error).foregroundStyle(.red) } }
        }
        .navigationTitle(replacing ? "Изменить PIN" : "Создать PIN")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Сохранить") {
                    do {
                        try appLock.setPIN(newPIN, confirmation: confirmation, account: account, oldPIN: replacing ? oldPIN : nil)
                        dismiss()
                    } catch { self.error = error.localizedDescription }
                }
                .disabled(newPIN.count != 6 || confirmation.count != 6 || (replacing && oldPIN.count != 6))
            }
        }
    }
}

private struct BusinessPINRemoveView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appLock: BusinessAppLockStore
    @State private var currentPIN = ""
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                SecureField("Введите текущий PIN", text: $currentPIN)
                    .keyboardType(.numberPad)
                    .onChange(of: currentPIN) { _, value in currentPIN = limitedPIN(value) }
            } footer: {
                Text("Удаление PIN отключит также Face ID и автоблокировку.")
            }
            if let error { Section { Text(error).foregroundStyle(.red) } }
        }
        .navigationTitle("Удалить PIN")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Удалить", role: .destructive) {
                    if appLock.removePIN(currentPIN: currentPIN) { dismiss() }
                    else { error = appLock.errorMessage ?? "Неверный PIN-код." }
                }
                .disabled(currentPIN.count != 6)
            }
        }
    }
}

private func limitedPIN(_ raw: String) -> String {
    String(raw.filter { $0 >= "0" && $0 <= "9" }.prefix(6))
}
