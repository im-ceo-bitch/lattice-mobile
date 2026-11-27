import Foundation

enum APIError: LocalizedError {
    case invalidResponse
    case status(Int)
    case server(Int, String)
    case decoding(Error)
    case missingBookingToken

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Сервер вернул некорректный ответ."
        case .status(let code):
            return "Сервер временно недоступен (\(code))."
        case .server(_, let message):
            return message
        case .decoding(let error):
            let path: [CodingKey]
            switch error {
            case DecodingError.keyNotFound(let key, let context): path = context.codingPath + [key]
            case DecodingError.typeMismatch(_, let context), DecodingError.valueNotFound(_, let context), DecodingError.dataCorrupted(let context): path = context.codingPath
            default: path = []
            }
            let field = path.map(\.stringValue).joined(separator: ".")
            return field.isEmpty ? "Не удалось прочитать данные сервера (API_DECODE_ERROR)." : "Не удалось прочитать данные сервера (API_DECODE_ERROR: \(field))."
        case .missingBookingToken:
            return "Booking access token is missing."
        }
    }
}

private struct APIErrorEnvelope: Decodable {
    let error: String?
    let message: String?
}

actor APIClient {
    static let shared = APIClient()
    // Price searches have no short application deadline. URLSession/platform
    // failures still surface as errors, never as "no availability".
    static let hotelPrices = APIClient(longRunning: true)

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(longRunning: Bool = false) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = longRunning ? 120 : 25
        configuration.timeoutIntervalForResource = longRunning ? 180 : 60
        configuration.waitsForConnectivity = true
        session = URLSession(configuration: configuration, delegate: IumrahAPIOriginDelegate(), delegateQueue: nil)
        decoder = JSONDecoder()
        encoder = JSONEncoder()
    }

    func post<T: Decodable, B: Encodable>(
        _ path: String,
        body: B,
        headers: [String: String] = [:],
        timeoutInterval: TimeInterval? = nil
    ) async throws -> T {
        guard let url = AppConfig.apiURL(path) else { throw APIError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        if let timeoutInterval { request.timeoutInterval = timeoutInterval }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("iumrah-ios-beta/0.25", forHTTPHeaderField: "User-Agent")
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        if ["/api/package/client/account/register/email/confirm", "/api/package/client/account/register/sms/confirm", "/api/package/client/account/activate/email/confirm", "/api/package/client/account/activate/sms/confirm", "/api/package/client/account/apple/sign-in", "/api/package/client/account/google/sign-in"].contains(path) {
            for (key, value) in IumrahReferralLink.headers { request.setValue(value, forHTTPHeaderField: key) }
        }
        request.httpBody = try encoder.encode(body)

        let (data, response) = try await session.data(for: request)
        return try decodeResponse(data: data, response: response)
    }

    func get<T: Decodable>(
        _ path: String,
        query: [URLQueryItem] = [],
        headers: [String: String] = [:],
        timeoutInterval: TimeInterval? = nil
    ) async throws -> T {
        guard let url = AppConfig.apiURL(path, query: query) else { throw APIError.invalidResponse }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        if let timeoutInterval { request.timeoutInterval = timeoutInterval }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("iumrah-ios-beta/0.25", forHTTPHeaderField: "User-Agent")
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }

        let (data, response) = try await session.data(for: request)
        return try decodeResponse(data: data, response: response)
    }

    func put<T: Decodable, B: Encodable>(
        _ path: String,
        body: B,
        headers: [String: String] = [:],
        timeoutInterval: TimeInterval? = nil
    ) async throws -> T {
        guard let url = AppConfig.apiURL(path) else { throw APIError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        if let timeoutInterval { request.timeoutInterval = timeoutInterval }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("iumrah-ios-beta/0.27", forHTTPHeaderField: "User-Agent")
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        request.httpBody = try encoder.encode(body)
        let (data, response) = try await session.data(for: request)
        return try decodeResponse(data: data, response: response)
    }

    func patch<T: Decodable, B: Encodable>(
        _ path: String,
        body: B,
        headers: [String: String] = [:],
        timeoutInterval: TimeInterval? = nil
    ) async throws -> T {
        guard let url = AppConfig.apiURL(path) else { throw APIError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        if let timeoutInterval { request.timeoutInterval = timeoutInterval }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("iumrah-ios-beta/0.25", forHTTPHeaderField: "User-Agent")
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        request.httpBody = try encoder.encode(body)

        let (data, response) = try await session.data(for: request)
        return try decodeResponse(data: data, response: response)
    }

    func upload<T: Decodable>(
        _ path: String,
        data: Data,
        contentType: String,
        headers: [String: String] = [:],
        timeoutInterval: TimeInterval? = nil
    ) async throws -> T {
        guard let url = AppConfig.apiURL(path) else { throw APIError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        if let timeoutInterval { request.timeoutInterval = timeoutInterval }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.setValue("iumrah-ios-beta/0.26", forHTTPHeaderField: "User-Agent")
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        request.httpBody = data
        let (responseData, response) = try await session.data(for: request)
        return try decodeResponse(data: responseData, response: response)
    }

    func fetchData(
        _ path: String,
        headers: [String: String] = [:],
        timeoutInterval: TimeInterval? = nil
    ) async throws -> Data {
        guard let url = AppConfig.apiURL(path) else { throw APIError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        if let timeoutInterval { request.timeoutInterval = timeoutInterval }
        request.setValue("*/*", forHTTPHeaderField: "Accept")
        request.setValue("iumrah-ios-beta/0.26", forHTTPHeaderField: "User-Agent")
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data),
               let message = envelope.error ?? envelope.message,
               !message.isEmpty {
                throw APIError.server(http.statusCode, message)
            }
            throw APIError.status(http.statusCode)
        }
        return data
    }

    func delete<T: Decodable>(
        _ path: String,
        headers: [String: String] = [:],
        timeoutInterval: TimeInterval? = nil
    ) async throws -> T {
        guard let url = AppConfig.apiURL(path) else { throw APIError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        if let timeoutInterval { request.timeoutInterval = timeoutInterval }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("iumrah-ios-beta/0.25", forHTTPHeaderField: "User-Agent")
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }

        let (data, response) = try await session.data(for: request)
        return try decodeResponse(data: data, response: response)
    }

    private func decodeResponse<T: Decodable>(data: Data, response: URLResponse) throws -> T {
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data),
               let message = envelope.error ?? envelope.message,
               !message.isEmpty {
                throw APIError.server(http.statusCode, message)
            }
            throw APIError.status(http.statusCode)
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }
}
