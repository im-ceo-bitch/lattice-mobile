import Foundation

/// A small, bundled zero-network catalog for the airports that matter most to iumrah.
///
/// The interactive map augments this list with Apple's airport POI results as the user
/// zooms into a region. Keeping the core pilgrimage / Uzbekistan network in the app
/// means the most important airports are visible immediately, even before a POI search
/// completes or when the device has intermittent connectivity.
enum AirportMapBootstrapCatalog {
    static let airports: [Airport] = [
        make("TAS", "UTTT", "Tashkent International Airport", "Tashkent", "Uzbekistan", "UZ", 41.2579, 69.2812, 100),
        make("SKD", "UTSS", "Samarkand International Airport", "Samarkand", "Uzbekistan", "UZ", 39.7005, 66.9838, 96),
        make("BHK", "UTSB", "Bukhara International Airport", "Bukhara", "Uzbekistan", "UZ", 39.7750, 64.4833, 92),
        make("UGC", "UTNU", "Urgench International Airport", "Urgench", "Uzbekistan", "UZ", 41.5843, 60.6417, 92),
        make("NMA", "UTKN", "Namangan International Airport", "Namangan", "Uzbekistan", "UZ", 40.9846, 71.5567, 91),
        make("FEG", "UTKF", "Fergana International Airport", "Fergana", "Uzbekistan", "UZ", 40.3588, 71.7450, 91),
        make("AZN", "UTKA", "Andijan Airport", "Andijan", "Uzbekistan", "UZ", 40.7277, 72.2940, 88),
        make("KSQ", "UTSK", "Karshi Airport", "Karshi", "Uzbekistan", "UZ", 38.8336, 65.9215, 88),
        make("TMJ", "UTST", "Termez International Airport", "Termez", "Uzbekistan", "UZ", 37.2867, 67.3100, 88),
        make("NCU", "UTNN", "Nukus Airport", "Nukus", "Uzbekistan", "UZ", 42.4884, 59.6233, 87),
        make("NAV", "UTSA", "Navoi International Airport", "Navoi", "Uzbekistan", "UZ", 40.1172, 65.1708, 87),

        make("JED", "OEJN", "King Abdulaziz International Airport", "Jeddah", "Saudi Arabia", "SA", 21.6796, 39.1565, 100),
        make("MED", "OEMA", "Prince Mohammad bin Abdulaziz International Airport", "Madinah", "Saudi Arabia", "SA", 24.5534, 39.7051, 100),
        make("RUH", "OERK", "King Khalid International Airport", "Riyadh", "Saudi Arabia", "SA", 24.9576, 46.6988, 96),
        make("DMM", "OEDF", "King Fahd International Airport", "Dammam", "Saudi Arabia", "SA", 26.4712, 49.7979, 91),
        make("TIF", "OETF", "Taif International Airport", "Taif", "Saudi Arabia", "SA", 21.4834, 40.5443, 90),
        make("AHB", "OEAB", "Abha International Airport", "Abha", "Saudi Arabia", "SA", 18.2404, 42.6566, 86),
        make("GIZ", "OEGN", "Jazan Regional Airport", "Jazan", "Saudi Arabia", "SA", 16.9011, 42.5858, 84),

        make("IST", "LTFM", "Istanbul Airport", "Istanbul", "Türkiye", "TR", 41.2753, 28.7519, 99),
        make("SAW", "LTFJ", "Sabiha Gökçen International Airport", "Istanbul", "Türkiye", "TR", 40.8986, 29.3092, 96),
        make("ESB", "LTAC", "Esenboğa Airport", "Ankara", "Türkiye", "TR", 40.1281, 32.9951, 90),
        make("DXB", "OMDB", "Dubai International Airport", "Dubai", "United Arab Emirates", "AE", 25.2532, 55.3657, 99),
        make("DWC", "OMDW", "Al Maktoum International Airport", "Dubai", "United Arab Emirates", "AE", 24.8964, 55.1614, 90),
        make("SHJ", "OMSJ", "Sharjah International Airport", "Sharjah", "United Arab Emirates", "AE", 25.3286, 55.5172, 92),
        make("AUH", "OMAA", "Zayed International Airport", "Abu Dhabi", "United Arab Emirates", "AE", 24.4330, 54.6511, 96),
        make("DOH", "OTHH", "Hamad International Airport", "Doha", "Qatar", "QA", 25.2731, 51.6081, 98),
        make("KWI", "OKKK", "Kuwait International Airport", "Kuwait City", "Kuwait", "KW", 29.2266, 47.9689, 93),
        make("BAH", "OBBI", "Bahrain International Airport", "Manama", "Bahrain", "BH", 26.2708, 50.6336, 92),
        make("MCT", "OOMS", "Muscat International Airport", "Muscat", "Oman", "OM", 23.5933, 58.2844, 93),
        make("AMM", "OJAI", "Queen Alia International Airport", "Amman", "Jordan", "JO", 31.7226, 35.9932, 91),
        make("CAI", "HECA", "Cairo International Airport", "Cairo", "Egypt", "EG", 30.1219, 31.4056, 94),
        make("GYD", "UBBB", "Heydar Aliyev International Airport", "Baku", "Azerbaijan", "AZ", 40.4675, 50.0467, 93),
        make("TBS", "UGTB", "Tbilisi International Airport", "Tbilisi", "Georgia", "GE", 41.6692, 44.9547, 90),
        make("ALA", "UAAA", "Almaty International Airport", "Almaty", "Kazakhstan", "KZ", 43.3521, 77.0405, 94),
        make("NQZ", "UACC", "Nursultan Nazarbayev International Airport", "Astana", "Kazakhstan", "KZ", 51.0222, 71.4669, 91),
        make("FRU", "UCFM", "Manas International Airport", "Bishkek", "Kyrgyzstan", "KG", 43.0613, 74.4776, 91),
        make("OSS", "UCFO", "Osh International Airport", "Osh", "Kyrgyzstan", "KG", 40.6090, 72.7933, 87),
        make("DYU", "UTDD", "Dushanbe International Airport", "Dushanbe", "Tajikistan", "TJ", 38.5433, 68.8250, 91),
        make("IKA", "OIIE", "Imam Khomeini International Airport", "Tehran", "Iran", "IR", 35.4161, 51.1522, 91),
        make("ISB", "OPIS", "Islamabad International Airport", "Islamabad", "Pakistan", "PK", 33.5490, 72.8257, 91),
        make("KHI", "OPKC", "Jinnah International Airport", "Karachi", "Pakistan", "PK", 24.9065, 67.1608, 91),
        make("DEL", "VIDP", "Indira Gandhi International Airport", "Delhi", "India", "IN", 28.5562, 77.1000, 97),
        make("BOM", "VABB", "Chhatrapati Shivaji Maharaj International Airport", "Mumbai", "India", "IN", 19.0896, 72.8656, 96),
        make("DAC", "VGHS", "Hazrat Shahjalal International Airport", "Dhaka", "Bangladesh", "BD", 23.8433, 90.3978, 92),
        make("KUL", "WMKK", "Kuala Lumpur International Airport", "Kuala Lumpur", "Malaysia", "MY", 2.7456, 101.7099, 96),
        make("CGK", "WIII", "Soekarno–Hatta International Airport", "Jakarta", "Indonesia", "ID", -6.1256, 106.6559, 96),
        make("SIN", "WSSS", "Singapore Changi Airport", "Singapore", "Singapore", "SG", 1.3644, 103.9915, 98),
        make("BKK", "VTBS", "Suvarnabhumi Airport", "Bangkok", "Thailand", "TH", 13.6900, 100.7501, 96),
        make("LHR", "EGLL", "Heathrow Airport", "London", "United Kingdom", "GB", 51.4700, -0.4543, 99),
        make("CDG", "LFPG", "Charles de Gaulle Airport", "Paris", "France", "FR", 49.0097, 2.5479, 98),
        make("FRA", "EDDF", "Frankfurt Airport", "Frankfurt", "Germany", "DE", 50.0379, 8.5622, 98),
        make("AMS", "EHAM", "Amsterdam Airport Schiphol", "Amsterdam", "Netherlands", "NL", 52.3105, 4.7683, 98),
        make("JFK", "KJFK", "John F. Kennedy International Airport", "New York", "United States", "US", 40.6413, -73.7781, 98),
        make("LAX", "KLAX", "Los Angeles International Airport", "Los Angeles", "United States", "US", 33.9416, -118.4085, 98)
    ]

    static var points: [AirportMapPoint] {
        // Defensive de-duplication keeps the catalog stable if a route airport is
        // intentionally repeated while the curated list evolves.
        var seen = Set<String>()
        return airports.compactMap { airport in
            let key = airport.iata.uppercased()
            guard seen.insert(key).inserted else { return nil }
            return .bundled(airport)
        }
    }

    static func airport(code: String) -> Airport? {
        let normalized = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return airports.first { $0.iata.uppercased() == normalized }
    }

    private static func make(
        _ iata: String,
        _ icao: String?,
        _ name: String,
        _ city: String,
        _ country: String,
        _ countryCode: String,
        _ lat: Double,
        _ lon: Double,
        _ score: Double
    ) -> Airport {
        Airport(
            iata: iata,
            icao: icao,
            name: name,
            city: city,
            country: country,
            countryCode: countryCode,
            region: "",
            lat: lat,
            lon: lon,
            type: "airport",
            score: score,
            aliases: []
        )
    }
}
