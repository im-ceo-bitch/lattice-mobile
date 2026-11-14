import Foundation
import SwiftUI

@MainActor
final class AuthStore: ObservableObject {
    enum State: Equatable { case checking, signedOut, signedIn }

    @Published var state: State = .checking
    @Published var user: SessionUser?
    @Published var errorMessage: String?
    @Published private(set) var passwordLoginSerial = 0

    init() {
        Task { await restore() }
    }

    func restore() async {
        errorMessage = nil
        guard BusinessStaffAuthPersistence.restoreIfAllowed() else {
            BusinessSessionVault.clearSessionToken()
            user = nil
            state = .signedOut
            return
        }
        do {
            user = try await APIClient.shared.sessionUser()
            try BusinessStaffAuthPersistence.persistRestoredLogin()
            state = .signedIn
            await BusinessNotifications.registerCurrentDeviceIfPossible()
        } catch {
            // A temporary network outage must not destroy a valid stored login.
            if let apiError = error as? APIError {
                switch apiError {
                case .unauthorized, .server("SESSION_REAUTH_REQUIRED"), .server("BUSINESS_SESSION_REQUIRED"):
                    BusinessStaffAuthPersistence.clear()
                    BusinessSessionVault.clearSessionToken()
                    errorMessage = apiError.localizedDescription
                default:
                    errorMessage = apiError.localizedDescription
                }
            } else {
                errorMessage = "Не удалось проверить сеанс. Проверьте интернет и повторите попытку."
            }
            user = nil
            state = .signedOut
        }
    }

    func login(login: String, password: String) async {
        errorMessage = nil
        do {
            user = try await APIClient.shared.login(login: login, password: password)
            do {
                try BusinessStaffAuthPersistence.persistSuccessfulPasswordLogin()
            } catch {
                await APIClient.shared.logout()
                BusinessStaffAuthPersistence.clear()
                throw error
            }
            passwordLoginSerial += 1
            state = .signedIn
            await BusinessNotifications.registerCurrentDeviceIfPossible()
        } catch {
            errorMessage = error.localizedDescription
            user = nil
            state = .signedOut
        }
    }

    func logout() async {
        guard state == .signedIn else { return }
        state = .checking
        user = nil
        await APIClient.shared.logout()
        BusinessStaffAuthPersistence.clear()
        errorMessage = nil
        state = .signedOut
    }

    func expireWeeklySessionIfNeeded() async {
        guard state == .signedIn, BusinessStaffAuthPersistence.needsPasswordLogin else { return }
        await logout()
        errorMessage = "Срок недельного сеанса истёк. Войдите с паролем."
    }

    func handleSessionInvalidated(token: String?) {
        guard state == .signedIn, let token, token == BusinessSessionVault.sessionToken else { return }
        BusinessSessionVault.clearSessionToken()
        BusinessStaffAuthPersistence.clear()
        user = nil
        errorMessage = "Сеанс больше не активен. Войдите снова с паролем."
        state = .signedOut
    }
}
