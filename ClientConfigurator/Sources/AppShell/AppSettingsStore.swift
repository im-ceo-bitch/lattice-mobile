import SwiftUI

final class AppSettingsStore: ObservableObject {
    enum Appearance: String, CaseIterable, Identifiable {
        case system
        case light
        case dark

        var id: String { rawValue }

        func title(_ language: AppSettingsStore.Language) -> String {
            switch self {
            case .system: return L10n.text("appearance_system", language)
            case .light: return L10n.text("appearance_light", language)
            case .dark: return L10n.text("appearance_dark", language)
            }
        }

        var colorScheme: ColorScheme? {
            switch self {
            case .system: return nil
            case .light: return .light
            case .dark: return .dark
            }
        }
    }

    enum Language: String, CaseIterable, Identifiable {
        case russian = "ru"
        case english = "en"
        case arabic = "ar"
        case turkish = "tr"
        case indonesian = "id"
        case malay = "ms"
        case uzbek = "uz"
        case uzbekCyrillic = "uz-cyrl"

        var id: String { rawValue }
        var isRightToLeft: Bool { self == .arabic }

        var title: String {
            switch self {
            case .russian: return L10n.text("language_russian", self)
            case .arabic: return "العربية"
            case .english: return L10n.text("language_english", self)
            case .turkish: return L10n.text("language_turkish", self)
            case .indonesian: return "Bahasa Indonesia"
            case .malay: return "Bahasa Melayu"
            case .uzbek: return L10n.text("language_uzbek", self)
            case .uzbekCyrillic: return L10n.text("language_uzbek_cyr", self)
            }
        }

        var localeIdentifier: String {
            switch self {
            case .russian: return "ru_RU"
            case .arabic: return "ar_SA"
            case .english: return "en_US"
            case .turkish: return "tr_TR"
            case .indonesian: return "id_ID"
            case .malay: return "ms_MY"
            case .uzbek: return "uz_Latn_UZ"
            case .uzbekCyrillic: return "uz_Cyrl_UZ"
            }
        }
    }

    @AppStorage("iumrah.appearance") private var appearanceRaw = Appearance.system.rawValue
    @AppStorage("iumrah.language") private var languageRaw = Language.uzbek.rawValue
    @AppStorage("iumrah.profile.firstName") var firstName = ""
    @AppStorage("iumrah.profile.lastName") var lastName = ""
    @AppStorage("iumrah.profile.phone") var phone = ""
    @AppStorage("iumrah.profile.email") var email = ""
    @AppStorage("iumrah.profile.dateOfBirth") var dateOfBirth = ""
    @AppStorage("iumrah.profile.gender") var gender = ""
    @AppStorage("iumrah.profile.nationality") var nationality = ""
    @AppStorage("iumrah.profile.emergencyName") var emergencyName = ""
    @AppStorage("iumrah.profile.emergencyPhone") var emergencyPhone = ""
    @AppStorage("iumrah.profile.emergencyRelation") var emergencyRelation = ""
    @AppStorage("iumrah.profile.telegram") var telegram = ""
    @AppStorage("iumrah.profile.whatsapp") var whatsapp = ""

    @Published var appearance: Appearance = .system {
        didSet { appearanceRaw = appearance.rawValue }
    }

    @Published var language: Language = .uzbek {
        didSet { languageRaw = language.rawValue }
    }

    init() {
        appearance = Appearance(rawValue: appearanceRaw) ?? .system
        language = Language(rawValue: languageRaw) ?? .russian
    }

    var displayName: String {
        let joined = [firstName, lastName]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        return joined.isEmpty ? L10n.text("profile_placeholder", language) : joined
    }

    var hasBookingIdentity: Bool {
        let hasName = !firstName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !lastName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let hasContact = !telegram.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            !whatsapp.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return hasName && hasContact
    }
}
