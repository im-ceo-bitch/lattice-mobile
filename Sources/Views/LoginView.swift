import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.businessAdaptiveLayout) private var layout

    @State private var login = ""
    @State private var password = ""
    @State private var working = false

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
                            .padding(20)
                            .frame(maxWidth: 620)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(minHeight: max(0, geometry.size.height - 30), alignment: .center)
            }
        }
    }

    private var compactComposition: some View {
        VStack(alignment: .leading, spacing: 0) {
            topBrandRow

            Spacer(minLength: 48)
            heroCopy
            loginCard
                .padding(.top, 34)
        }
    }

    private var desktopComposition: some View {
        HStack(alignment: .center, spacing: 72) {
            VStack(alignment: .leading, spacing: 0) {
                topBrandRow
                    .padding(.bottom, 72)
                heroCopy
                Spacer(minLength: 30)
                Label("Secure business workspace", systemImage: "lock.shield.fill")
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
            Label("Secure", systemImage: "lock.fill")
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
            Text("Центр\nуправления.")
                .font(.system(size: layout.supportsDenseDashboard ? 62 : 52, weight: .bold))
                .tracking(layout.supportsDenseDashboard ? -3.1 : -2.7)
                .padding(.top, 12)
            Text("Бронирования, чаты и собственная база отелей iumrah — с iPhone, iPad и Mac.")
                .font(.system(size: 16))
                .foregroundStyle(.secondary)
                .padding(.top, 14)
                .frame(maxWidth: 470, alignment: .leading)
        }
    }

    private var loginCard: some View {
        VStack(spacing: 12) {
            TextField("Логин", text: $login)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(.horizontal, 18)
                .frame(height: 58)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            SecureField("Пароль", text: $password)
                .padding(.horizontal, 18)
                .frame(height: 58)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            if let error = auth.errorMessage {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Button {
                working = true
                Task {
                    await auth.login(login: login, password: password)
                    working = false
                }
            } label: {
                HStack {
                    if working { ProgressView().tint(BusinessDesign.onPrimaryControl) }
                    Text(working ? "Входим…" : "Войти")
                }
                .font(.headline)
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .foregroundStyle(BusinessDesign.onPrimaryControl)
                .background(BusinessDesign.primaryControl, in: Capsule())
            }
            .disabled(login.isEmpty || password.isEmpty || working)
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
        .businessCard(radius: 30)
    }
}
