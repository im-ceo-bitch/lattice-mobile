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
            BusinessStaffAuthPersistence.persistFirstRestoredLoginIfNeeded()
            state = .signedIn
            await BusinessNotifications.registerCurrentDeviceIfPossible()
        } catch {
            // A temporary network outage must not destroy a valid stored login.
            if let apiError = error as? APIError, case .unauthorized = apiError {
                BusinessStaffAuthPersistence.clear()
            } else {
                errorMessage = "Не удалось проверить сеанс. Проверьте интернет и повторите попытку."
            }
            state = .signedOut
        }
    }

    func login(login: String, password: String) async {
        errorMessage = nil
        do {
            user = try await APIClient.shared.login(login: login, password: password)
            BusinessStaffAuthPersistence.persistSuccessfulPasswordLogin()
            passwordLoginSerial += 1
            state = .signedIn
            await BusinessNotifications.registerCurrentDeviceIfPossible()
        } catch {
            errorMessage = error.localizedDescription
            state = .signedOut
        }
    }

    func logout() async {
        await APIClient.shared.logout()
        BusinessStaffAuthPersistence.clear()
        user = nil
        state = .signedOut
    }

    func expireWeeklySessionIfNeeded() async {
        guard state == .signedIn, BusinessStaffAuthPersistence.needsPasswordLogin else { return }
        await APIClient.shared.logout()
        BusinessStaffAuthPersistence.clear()
        user = nil
        state = .signedOut
    }

    func handleSessionInvalidated() {
        BusinessSessionVault.clearSessionToken()
        BusinessStaffAuthPersistence.clear()
        user = nil
        errorMessage = nil
        state = .signedOut
    }
}
