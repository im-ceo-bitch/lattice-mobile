import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.businessAdaptiveLayout) private var layout

    @State private var login = ""
    @State private var password = ""
    @State private var working = false
    @State private var recovering = false
    @State private var recoveryEmail = ""
    @State private var recoveryChallenge: String?
    @State private var recoveryCode = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var recoveryError: String?
    @State private var recoveryNotice: String?
    private enum Field: Hashable { case login, password, recoveryEmail, recoveryCode, newPassword, confirmPassword }
    @FocusState private var focusedField: Field?
    @ScaledMetric(relativeTo: .largeTitle) private var compactTitleSize: CGFloat = 36
    @ScaledMetric(relativeTo: .largeTitle) private var desktopTitleSize: CGFloat = 54

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                Group {
                    if layout.supportsDenseDashboard {
                        desktopComposition
                            .frame(maxWidth: 1120)
                            .padding(.horizontal, 48)
                            .padding(.vertical, 34)
                    } else {
                        compactComposition
                            .padding(.horizontal, 20)
                            .padding(.vertical, 16)
                            .frame(maxWidth: 620)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(minHeight: layout.supportsDenseDashboard ? max(0, geometry.size.height - 30) : 0,
                       alignment: layout.supportsDenseDashboard ? .center : .top)
            }
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(.top)
        }
        .background(BusinessDesign.background)
    }

    private var compactComposition: some View {
        VStack(alignment: .leading, spacing: 0) {
            topBrandRow

            if focusedField == nil && !recovering {
                BusinessOrbit(diameter: 250, pinnedSymbol: recovering ? "envelope.fill" : nil, isActive: !working)
                    .accessibilityIdentifier("business.orbit.login")
                    .padding(.top, 8)
                heroCopy.padding(.top, 8)
            }
            loginCard
                .padding(.top, focusedField == nil && !recovering ? 24 : 12)
        }
    }

    private var desktopComposition: some View {
        HStack(alignment: .center, spacing: 72) {
            VStack(alignment: .leading, spacing: 0) {
                topBrandRow
                    .padding(.bottom, 12)
                BusinessOrbit(diameter: 300, pinnedSymbol: recovering ? "envelope.fill" : nil, isActive: focusedField == nil && !working)
                    .accessibilityIdentifier("business.orbit.login")
                heroCopy
                Spacer(minLength: 30)
                Label("Защищённое рабочее пространство", systemImage: "lock.shield.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            loginCard
                .frame(width: 420)
        }
    }

    private var topBrandRow: some View {
        HStack {
            Image("Logo")
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .frame(width: 150, height: 44)
                .foregroundStyle(BusinessDesign.ink)
            Spacer()
            Label("Защищено", systemImage: "lock.fill")
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 13)
                .frame(height: 42)
                .background(BusinessDesign.card, in: Capsule())
        }
    }

    private var heroCopy: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("IUMRAH BUSINESS")
                .font(.caption2.weight(.bold))
                .tracking(2.6)
                .foregroundStyle(.secondary)
            Text("Центр управления")
                .font(.system(size: layout.supportsDenseDashboard ? desktopTitleSize : compactTitleSize, weight: .bold))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 12)
            Text("Бронирования, чаты и собственная база отелей iumrah — с iPhone, iPad и Mac.")
                .font(.system(size: 16))
                .foregroundStyle(.secondary)
                .padding(.top, 14)
                .frame(maxWidth: 470, alignment: .leading)
        }
    }

    private var loginCard: some View {
        Group {
            if recovering { recoveryCard } else { passwordCard }
        }
    }

    private var passwordCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Логин").font(.subheadline.weight(.semibold))
            TextField("Введите логин или Email", text: $login)
                .textContentType(.username)
                .focused($focusedField, equals: .login)
                .submitLabel(.next)
                .onSubmit { focusedField = .password }
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(.horizontal, 18)
                .frame(minHeight: 52)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            Text("Пароль").font(.subheadline.weight(.semibold))
                .padding(.top, 4)
            SecureField("Введите пароль", text: $password)
                .textContentType(.password)
                .focused($focusedField, equals: .password)
                .submitLabel(.go)
                .onSubmit { submitLogin() }
                .padding(.horizontal, 18)
                .frame(minHeight: 52)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            if let notice = recoveryNotice {
                Text(notice).font(.footnote).foregroundStyle(.secondary)
            }
            if let error = auth.errorMessage {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Button(action: submitLogin) {
                HStack {
                    if working { ProgressView().tint(BusinessDesign.onPrimaryControl) }
                    Text(working ? "Входим…" : "Войти")
                }
                .font(.headline)
                .frame(maxWidth: .infinity)
                .frame(minHeight: 52)
                .foregroundStyle(BusinessDesign.onPrimaryControl)
                .background(BusinessDesign.primaryControl, in: Capsule())
            }
            .disabled(login.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty || working)
            .opacity(working || login.isEmpty || password.isEmpty ? 0.55 : 1)
            Button("Забыли пароль?") {
                guard !working else { return }
                auth.errorMessage = nil
                recoveryNotice = nil
                recoveryEmail = login.contains("@") ? login : ""
                password = ""
                recovering = true
                focusedField = .recoveryEmail
            }
            .font(.subheadline.weight(.semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .disabled(working)
            if BusinessStaffAuthPersistence.hasSavedLogin && !working {
                Button("Повторить проверку сохранённого сеанса") {
                    working = true
                    Task {
                        await auth.restore()
                        working = false
                    }
                }
                .font(.subheadline.weight(.medium))
                .padding(.top, 8)
            }
        }
        .padding(18)
        .businessCard(radius: 24)
    }

    private var recoveryCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Восстановление доступа").font(.title2.bold())
            Text(recoveryChallenge == nil ? "Введите подтверждённую почту владельца iumrah Business." : "Введите код из письма и задайте новый пароль. Старые сеансы будут недействительны.")
                .font(.subheadline).foregroundStyle(.secondary)
            recoveryFields
            if let error = recoveryError {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            recoveryActions
        }
        .padding(18)
        .businessCard(radius: 24)
    }

    @ViewBuilder
    private var recoveryFields: some View {
            if recoveryChallenge == nil {
                TextField("Email владельца", text: $recoveryEmail)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focusedField, equals: .recoveryEmail)
                    .submitLabel(.go)
                    .onSubmit { requestRecoveryCode() }
                    .onChange(of: recoveryEmail) { _, _ in recoveryError = nil }
                    .padding(.horizontal, 18).frame(minHeight: 52)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 20))
                    .disabled(working)
            } else {
                Text("Запрос принят почтовым сервисом. Проверьте входящие и спам: \(recoveryEmail)").font(.footnote).foregroundStyle(.secondary)
                TextField("Шестизначный код", text: $recoveryCode)
                    .keyboardType(.numberPad).textContentType(.oneTimeCode)
                    .focused($focusedField, equals: .recoveryCode)
                    .disabled(working)
                    .padding(.horizontal, 18).frame(minHeight: 52)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 20))
                SecureField("Новый пароль (от 12 символов)", text: $newPassword)
                    .textContentType(.newPassword)
                    .focused($focusedField, equals: .newPassword)
                    .disabled(working)
                    .padding(.horizontal, 18).frame(minHeight: 52)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 20))
                SecureField("Повторите пароль", text: $confirmPassword)
                    .textContentType(.newPassword)
                    .focused($focusedField, equals: .confirmPassword)
                    .disabled(working)
                    .padding(.horizontal, 18).frame(minHeight: 52)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 20))
                Button("Отправить код повторно", action: requestRecoveryCode)
                    .font(.subheadline.weight(.medium)).disabled(working)
            }
    }

    private var recoveryActions: some View {
        VStack(spacing: 12) {
            Button {
                if recoveryChallenge == nil { requestRecoveryCode() } else { confirmRecovery() }
            } label: {
                HStack {
                    if working { ProgressView().tint(BusinessDesign.onPrimaryControl) }
                    Text(working ? "Подождите…" : (recoveryChallenge == nil ? "Получить код" : "Изменить пароль и войти"))
                }
                .font(.headline).frame(maxWidth: .infinity).frame(minHeight: 52)
                .foregroundStyle(BusinessDesign.onPrimaryControl)
                .background(BusinessDesign.primaryControl, in: Capsule())
            }
            .disabled(working)
            .opacity(working ? 0.55 : 1)
            .accessibilityIdentifier("business.recovery.submit")
            Button("Вернуться ко входу") {
                clearRecovery()
                recovering = false
                focusedField = nil
            }
            .font(.subheadline.weight(.medium)).frame(maxWidth: .infinity).padding(.vertical, 8)
            .disabled(working)
        }
    }

    private var recoveryInputValid: Bool {
        recoveryCode.utf8.count == 6 && recoveryCode.utf8.allSatisfy { (48...57).contains($0) } &&
        (12...128).contains(newPassword.utf16.count) && newPassword == confirmPassword &&
        !newPassword.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func requestRecoveryCode() {
        guard !working else { return }
        let email = recoveryEmail.trimmingCharacters(in: .whitespacesAndNewlines)
        guard StaffRecoveryInput.isValidEmail(email) else {
            recoveryError = "Введите корректный адрес электронной почты владельца."
            focusedField = .recoveryEmail
            return
        }
        working = true
        recoveryError = nil
        focusedField = nil
        Task {
            defer { working = false }
            do {
                recoveryChallenge = try await APIClient.shared.startStaffRecovery(email: email)
                recoveryEmail = email
                recoveryCode = ""
                focusedField = .recoveryCode
            } catch { recoveryError = error.localizedDescription }
        }
    }

    private func confirmRecovery() {
        guard !working, let challenge = recoveryChallenge else { return }
        guard recoveryInputValid else {
            recoveryError = "Введите 6 цифр кода и два одинаковых пароля длиной 12–128 символов."
            return
        }
        let email = recoveryEmail
        let chosenPassword = newPassword
        let code = recoveryCode
        working = true
        recoveryError = nil
        focusedField = nil
        Task {
            defer { working = false }
            do {
                try await APIClient.shared.resetStaffPassword(email: email, challengeID: challenge, code: code, password: chosenPassword)
                clearRecovery()
                recovering = false
                login = email
                recoveryNotice = "Пароль изменён. Войдите с новым паролем, если автоматический вход не выполнен."
                await auth.login(login: email, password: chosenPassword)
            } catch { recoveryError = error.localizedDescription }
        }
    }

    private func clearRecovery() {
        recoveryEmail = ""
        recoveryChallenge = nil
        recoveryCode = ""
        newPassword = ""
        confirmPassword = ""
        recoveryError = nil
    }

    private func submitLogin() {
        let username = login.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !username.isEmpty, !password.isEmpty, !working else { return }
        focusedField = nil
        working = true
        Task {
            await auth.login(login: username, password: password)
            password = ""
            working = false
        }
    }
}
