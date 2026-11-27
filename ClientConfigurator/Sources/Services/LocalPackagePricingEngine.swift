import Foundation

/// User-facing errors for server-authoritative package pricing. The name is kept
/// for source compatibility with existing views; it no longer represents a local
/// pricing engine.
enum LocalPricingError: LocalizedError {
    case invalidFlightFare
    case missingHotelPrice(String)
    case invalidComponents

    var errorDescription: String? {
        switch self {
        case .invalidFlightFare:
            return "Не удалось получить текущую стоимость выбранного перелёта."
        case .missingHotelPrice(let city):
            return "Цена Primary Hotel в городе \(city) сейчас недоступна или устарела. Выберите другой доступный отель или повторите позже."
        case .invalidComponents:
            return "Компоненты пакета неполные. Повторите расчёт."
        }
    }
}
