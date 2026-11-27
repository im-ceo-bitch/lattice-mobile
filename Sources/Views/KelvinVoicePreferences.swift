import SwiftUI

struct KelvinVoiceOption: Identifiable {
    let id: String
    let detail: String
    static let all: [Self] = [
        .init(id: "Charon", detail: "Информативный"), .init(id: "Orus", detail: "Уверенный"),
        .init(id: "Algenib", detail: "Низкий, хрипловатый"), .init(id: "Alnilam", detail: "Твёрдый"),
        .init(id: "Schedar", detail: "Ровный"), .init(id: "Iapetus", detail: "Чёткий"),
        .init(id: "Kore", detail: "Уверенный"), .init(id: "Sulafat", detail: "Тёплый"),
        .init(id: "Achernar", detail: "Мягкий"), .init(id: "Puck", detail: "Энергичный"),
        .init(id: "Zephyr", detail: "Яркий"), .init(id: "Fenrir", detail: "Выразительный"),
        .init(id: "Leda", detail: "Молодой"), .init(id: "Aoede", detail: "Лёгкий"),
        .init(id: "Callirrhoe", detail: "Непринуждённый"), .init(id: "Autonoe", detail: "Яркий"),
        .init(id: "Enceladus", detail: "Воздушный"), .init(id: "Umbriel", detail: "Спокойный"),
        .init(id: "Algieba", detail: "Плавный"), .init(id: "Despina", detail: "Плавный"),
        .init(id: "Erinome", detail: "Чёткий"), .init(id: "Rasalgethi", detail: "Информативный"),
        .init(id: "Laomedeia", detail: "Энергичный"), .init(id: "Gacrux", detail: "Зрелый"),
        .init(id: "Pulcherrima", detail: "Прямой"), .init(id: "Achird", detail: "Дружелюбный"),
        .init(id: "Zubenelgenubi", detail: "Разговорный"), .init(id: "Vindemiatrix", detail: "Нежный"),
        .init(id: "Sadachbia", detail: "Живой"), .init(id: "Sadaltager", detail: "Знающий")
    ]
}

enum KelvinVoiceLanguage: String, CaseIterable, Identifiable {
    case russian = "ru-RU", english = "en-US", turkish = "tr-TR", uzbek = "uz-UZ"
    var id: String { rawValue }
    var title: String { switch self { case .russian: "Русский"; case .english: "English"; case .turkish: "Türkçe"; case .uzbek: "O‘zbekcha" } }
    var sample: String { switch self {
    case .russian: "Я Kelvin. Я здесь, чтобы помочь тебе разобраться в сложных вопросах и принимать взвешенные решения."
    case .english: "I'm Kelvin. I'm here to help you think clearly and make thoughtful decisions."
    case .turkish: "Ben Kelvin. Net düşünmene ve bilinçli kararlar vermene yardımcı olmak için buradayım."
    case .uzbek: "Men Kelvinman. Aniq fikrlash va puxta qarorlar qabul qilishda yordam beraman."
    } }
}
