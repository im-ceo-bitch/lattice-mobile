import SwiftUI

extension AppTab {
    var systemImage: String {
        switch self {
        case .home: return "house"
        case .hotels: return "building.2"
        case .booking: return "suitcase"
        case .care: return "heart.fill"
        case .account: return "person.crop.circle"
        }
    }

    func title(for language: AppSettingsStore.Language) -> String {
        switch self {
        case .home:
            return L10n.text("tab_home", language)
        case .hotels:
            return L10n.text("tab_hotels", language)
        case .booking:
            return L10n.text("tab_booking", language)
        case .care:
            return L10n.text("tab_care", language)
        case .account:
            switch language {
            case .russian: return "Профиль"
            case .english: return "Profile"
            case .turkish, .indonesian, .malay: return "Profil"
            case .arabic: return "الملف الشخصي"
            case .uzbek: return "Profil"
            case .uzbekCyrillic: return "Профиль"
            }
        }
    }
}
