import SwiftUI

struct BusinessAppUnlockView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var appLock: BusinessAppLockStore
    @State private var pin = ""
    @State private var showRecovery = false
    @FocusState private var pinFocused: Bool

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                BusinessDesign.background.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 22) {
                        BusinessBrandLogo(height: 48)
                            .frame(maxWidth: 200)
                            .padding(.bottom, 18)
                        Image(systemName: "lock.shield.fill")
                            .font(.system(size: 34, weight: .medium))
                            .foregroundStyle(BusinessDesign.ink)
                            .frame(width: 88, height: 88)
                            .background(BusinessDesign.secondarySurface, in: Circle())
                        VStack(spacing: 7) {
                            Text("iumrah Business заблокирован")
                                .font(.title2.bold())
                                .multilineTextAlignment(.center)
                            Text("Введите шестизначный PIN-код")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        SecureField("PIN-код", text: $pin)
                            .keyboardType(.numberPad)
                            .focused($pinFocused)
                            .multilineTextAlignment(.center)
                            .font(.title2.monospacedDigit())
                            .padding(.horizontal, 18)
                            .frame(height: 62)
                            .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 20))
                            .onChange(of: pin) { _, entered in
                                pin = String(entered.filter { $0 >= "0" && $0 <= "9" }.prefix(6))
                                if pin.count == 6 { submit() }
                            }
                            .frame(maxWidth: 320)
                        if let message = appLock.errorMessage {
                            Text(message).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
                        }
                        Button("Разблокировать") { submit() }
                            .font(.headline)
                            .frame(maxWidth: 320)
                            .frame(height: 54)
                            .foregroundStyle(BusinessDesign.onPrimaryControl)
                            .background(BusinessDesign.primaryControl, in: Capsule())
                            .disabled(pin.count != 6)
                        if appLock.biometricsEnabled && appLock.canUseBiometrics {
                            Button {
                                Task { _ = await appLock.unlockWithBiometrics() }
                            } label: {
                                Label("Разблокировать через \(appLock.biometryName)", systemImage: "faceid")
                                    .font(.subheadline.weight(.semibold))
                            }
                            .buttonStyle(.plain)
                            .padding(.top, 2)
                        }
                        Button("Забыли PIN-код?") { showRecovery = true }
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .padding(.top, 12)
                    }
                    .padding(26)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: geometry.size.height, alignment: .center)
                }
            }
        }
        .task {
            if appLock.biometricsEnabled && appLock.canUseBiometrics {
                _ = await appLock.unlockWithBiometrics()
            }
        }
        .confirmationDialog(
            "Сбросить PIN-код?",
            isPresented: $showRecovery,
            titleVisibility: .visible
        ) {
            Button("Выйти и войти по паролю", role: .destructive) {
                Task {
                    await auth.logout()
                    appLock.clearPIN()
                }
            }
            Button("Отмена", role: .cancel) { }
        } message: {
            Text("Чтобы восстановить доступ, потребуется логин и пароль аккаунта. Старый PIN будет удалён только с этого устройства.")
        }
    }

    private func submit() {
        guard pin.count == 6 else { return }
        let success = appLock.verifyPIN(pin)
        pin = ""
        if !success { pinFocused = true }
    }
}

struct BusinessAppPrivacyShield: View {
    var body: some View {
        ZStack {
            BusinessDesign.background.ignoresSafeArea()
            VStack(spacing: 16) {
                BusinessBrandLogo(height: 54).frame(maxWidth: 220)
                Image(systemName: "lock.shield.fill")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityHidden(true)
    }
}
