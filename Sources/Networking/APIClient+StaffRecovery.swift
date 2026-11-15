import Foundation

// Keep validation independent of SwiftUI so the same rules can be tested on CI.
enum StaffRecoveryInput {
    static func isValidEmail(_ raw: String) -> Bool {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.utf8.count <= 254 && value.range(of: #"^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$"#, options: .regularExpression) != nil
    }
}

private struct StaffRecoveryResponse: Decodable {
    let ok: Bool?
    let challengeID: String?
    let error: String?
}

struct StaffRecoveryError: LocalizedError {
    let code: String
    var errorDescription: String? {
        switch code {
        case "STAFF_RECOVERY_NOT_CONFIGURED", "STAFF_RECOVERY_OWNER_MISSING": return "В Cloudflare не настроена почта владельца (IUMRAH_ADMIN_RECOVERY_EMAIL)."
        case "STAFF_RECOVERY_MAIL_KEY_MISSING": return "На сервере отсутствует RESEND_API_KEY."
        case "STAFF_RECOVERY_SECURITY_MISSING": return "Не настроен ключ безопасности сервера."
        case "STAFF_RECOVERY_DB_UNAVAILABLE": return "Хранилище восстановления недоступно. Проверьте деплой бэкенда."
        case "STAFF_RECOVERY_SENDER_INVALID": return "Некорректный адрес отправителя писем на сервере."
        case "STAFF_RECOVERY_MAIL_AUTH": return "Resend отклонил запрос: проверьте API-ключ и подтверждение домена отправителя."
        case "STAFF_RECOVERY_MAIL_RATE_LIMIT": return "Почтовый сервис временно ограничил отправку. Повторите позже."
        case "STAFF_RECOVERY_MAIL_REJECTED": return "Resend отклонил письмо. Проверьте настройки отправителя и Logs в Resend."
        case "STAFF_RECOVERY_MAIL_UNCONFIRMED": return "Почтовый сервис не подтвердил приём письма. Повторите позже."
        case "CORE_CUTOVER_PENDING": return "Сервер ещё не активирован. Проверьте деплой."
        case "RECOVERY_ROUTE_MISSING": return "На сервере нет API восстановления. Разверните обновление Business."
        case "RECOVERY_NETWORK": return "Нет связи с сервером. Проверьте интернет и повторите попытку."
        case "RECOVERY_RESPONSE_INVALID": return "Сервер вернул непонятный ответ. Проверьте версию бэкенда."
        case "CORE_REQUEST_FAILED": return "Ошибка сервера восстановления. Проверьте журнал Worker."
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
        request.timeoutInterval = 25
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let data: Data
        let response: URLResponse
        do { (data, response) = try await perform(request) }
        catch is URLError { throw StaffRecoveryError(code: "RECOVERY_NETWORK") }
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 404 || http.statusCode == 405 { throw StaffRecoveryError(code: "RECOVERY_ROUTE_MISSING") }
        let result = try? decoder.decode(StaffRecoveryResponse.self, from: data)
        guard (200..<300).contains(http.statusCode), let result, result.ok == true else {
            throw StaffRecoveryError(code: result?.error ?? "RECOVERY_RESPONSE_INVALID")
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
