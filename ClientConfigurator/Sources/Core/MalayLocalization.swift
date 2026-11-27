import Foundation

/// Malay copy for the app and language selector. Unknown keys deliberately use
/// the original English text until a reviewed Malay translation is available.
/// This prevents missing symbols and avoids returning Indonesian by mistake.
enum MalayLocalization {
    static func key(_ identifier: String, english: String) -> String {
        byKey[identifier] ?? phrase(english)
    }

    static func phrase(_ english: String) -> String {
        translations[english] ?? english
    }

    private static let byKey: [String: String] = [
        "tab_home": "Laman Utama",
        "tab_hotels": "Hotel",
        "tab_booking": "Tempahan",
        "tab_care": "Bantuan",
        "tab_umrah": "Umrah",
        "profile_placeholder": "Profil anda",
        "profile_subtitle_empty": "Tambahkan nama dan maklumat hubungan anda",
        "profile_subtitle_ready": "Profil jemaah",
        "settings_title": "Tetapan",
        "settings_done": "Selesai",
        "profile_section": "Profil",
        "language_section": "Bahasa",
        "appearance_section": "Penampilan",
        "field_first_name": "Nama pertama",
        "field_last_name": "Nama keluarga",
        "field_telegram": "Telegram",
        "field_whatsapp": "WhatsApp",
        "app_language": "Bahasa aplikasi",
        "theme_label": "Tema",
        "appearance_system": "Ikut tetapan iPhone",
        "appearance_light": "Cerah",
        "appearance_dark": "Gelap",
        "language_russian": "Bahasa Rusia",
        "language_english": "Bahasa Inggeris",
        "language_uzbek": "Bahasa Uzbek",
        "language_uzbek_cyr": "Bahasa Uzbek (Cyrillic)",
        "language_turkish": "Bahasa Turki",
        "city_makkah": "Makkah",
        "city_madinah": "Madinah",
        "onboarding_skip": "Langkau",
        "onboarding_next": "Teruskan",
        "onboarding_start": "Mula",
        "onboarding_chip_flight": "Penerbangan",
        "onboarding_chip_hotel": "Hotel",
        "onboarding_chip_support": "Sokongan",
        "onboarding_chip_status": "Status",
        "hotels_title": "Hotel iumrah",
        "hotels_makkah": "Pilihan hotel di Makkah",
        "hotels_madinah": "Pilihan hotel di Madinah",
        "flight_airline_unknown": "Syarikat penerbangan",
        "hotel_photos": "Foto",
        "hotel_gallery_all": "Semua foto",
        "hotel_gallery_rooms": "Bilik",
        "hotel_gallery_bathroom": "Bilik air",
        "hotel_gallery_restaurant": "Restoran"
    ]

    private static let translations: [String: String] = [
        "Language": "Bahasa",
        "iumrah International Umrah Platform": "iumrah Platform Umrah Antarabangsa",
        "A world united by intention": "Dunia yang disatukan oleh niat",
        "Choose your app language": "Pilih bahasa aplikasi anda",
        "CURRENT": "SEMASA",
        "After confirmation, the iumrah interface switches to the language you selected.":
            "Selepas pengesahan, antara muka iumrah akan bertukar kepada bahasa pilihan anda.",
        "Current language already selected": "Bahasa semasa sudah dipilih"
    ]
}
