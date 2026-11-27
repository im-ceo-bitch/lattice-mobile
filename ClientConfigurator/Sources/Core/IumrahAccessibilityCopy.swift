import Foundation

/// Short VoiceOver-only labels that must follow the in-app language setting.
/// Explicit values avoid English fallbacks for tr/id and preserve all six languages.
enum IumrahAccessibilityCopy {
    static func text(
        _ language: AppSettingsStore.Language,
        ru: String, en: String, uz: String, cy: String, tr: String, id: String
    ) -> String {
        switch language {
        case .russian: return ru
        case .arabic: return ArabicLocalization.phrase(en)
        case .english: return en
        case .malay: return en
        case .uzbek: return uz
        case .uzbekCyrillic: return cy
        case .turkish: return tr
        case .indonesian: return id
        }
    }
}
