import Foundation

private struct StaffRecoveryResponse: Decodable {
    let ok: Bool?
    let challengeID: String?
    let error: String?
}

private struct StaffRecoveryError: LocalizedError {
    let code: String
    var errorDescription: String? {
        switch code {
        case "STAFF_RECOVERY_NOT_CONFIGURED": return "Восстановление доступа ещё не настроено владельцем в Cloudflare."
        case "STAFF_RECOVERY_INVALID_CONTACT": return "Укажите подтверждённую почту владельца iumrah Business."
        case "STAFF_RECOVERY_RATE_LIMIT": return "Слишком много запросов. Повторите попытку позже."
        case "STAFF_RECOVERY_EMAIL_FAILED": return "Не удалось отправить письмо. Проверьте настройки Resend или повторите позже."
        case "STAFF_RECOVERY_INVALID_CODE": return "Неверный или просроченный код. При необходимости запросите новый."
        case "STAFF_RECOVERY_PASSWORD_POLICY": return "Новый пароль должен содержать от 12 до 128 символов."
        default: return "Не удалось восстановить доступ. Повторите попытку."
        }
    }
}

extension APIClient {
    private func staffRecoveryRequest(path: String, body: [String: String]) async throws -> StaffRecoveryResponse {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await perform(request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        let result = try? decoder.decode(StaffRecoveryResponse.self, from: data)
        guard (200..<300).contains(http.statusCode), let result, result.ok == true else {
            throw StaffRecoveryError(code: result?.error ?? "RECOVERY_FAILED")
        }
        return result
    }

    func startStaffRecovery(email: String) async throws -> String {
        let result = try await staffRecoveryRequest(path: "/api/auth/staff/recovery/start", body: ["email": email])
        guard let id = result.challengeID, !id.isEmpty else { throw APIError.invalidResponse }
        return id
    }

    func resetStaffPassword(email: String, challengeID: String, code: String, password: String) async throws {
        _ = try await staffRecoveryRequest(path: "/api/auth/staff/recovery/confirm", body: ["email": email, "challengeID": challengeID, "code": code, "password": password])
        // Any previously stored staff cookie was invalidated by the server.
        clearLocalBusinessSession()
        BusinessStaffAuthPersistence.clear()
    }
}
