import Foundation

struct AirlineReference: Hashable {
    let iata: String
    let name: String
    let websiteDomain: String?

}

struct AirportReference: Hashable {
    let iata: String
    let city: String
    let name: String
    let country: String
    let timeZoneIdentifier: String?
}

enum FlightReferenceCatalog {
    private static let airlines: [String: AirlineReference] = [
        "HY": .init(iata: "HY", name: "Uzbekistan Airways", websiteDomain: "uzairways.com"),
        "HH": .init(iata: "HH", name: "Qanot Sharq", websiteDomain: "qanotsharq.com"),
        "C6": .init(iata: "C6", name: "Centrum Air", websiteDomain: "centrum-air.com"),
        "US": .init(iata: "US", name: "Silk Avia", websiteDomain: "silk-avia.com"),
        "9S": .init(iata: "9S", name: "Air Samarkand", websiteDomain: "airsamarkand.com"),
        "2U": .init(iata: "2U", name: "Fly Khiva", websiteDomain: "flykhiva.uz"),
        "TK": .init(iata: "TK", name: "Turkish Airlines", websiteDomain: "turkishairlines.com"),
        "VF": .init(iata: "VF", name: "AJet", websiteDomain: "ajet.com"),
        "PC": .init(iata: "PC", name: "Pegasus Airlines", websiteDomain: "flypgs.com"),
        "SV": .init(iata: "SV", name: "Saudia", websiteDomain: "saudia.com"),
        "XY": .init(iata: "XY", name: "flynas", websiteDomain: "flynas.com"),
        "FZ": .init(iata: "FZ", name: "flydubai", websiteDomain: "flydubai.com"),
        "G9": .init(iata: "G9", name: "Air Arabia", websiteDomain: "airarabia.com"),
        "J9": .init(iata: "J9", name: "Jazeera Airways", websiteDomain: "jazeeraairways.com"),
        "QR": .init(iata: "QR", name: "Qatar Airways", websiteDomain: "qatarairways.com"),
        "J2": .init(iata: "J2", name: "Azerbaijan Airlines", websiteDomain: "azal.az"),
        "KC": .init(iata: "KC", name: "Air Astana", websiteDomain: "airastana.com"),
        "FS": .init(iata: "FS", name: "FlyArystan", websiteDomain: "flyarystan.com"),
        "SZ": .init(iata: "SZ", name: "Somon Air", websiteDomain: "somonair.com"),
        "W4": .init(iata: "W4", name: "Wizz Air Malta", websiteDomain: "wizzair.com"),
        "EK": .init(iata: "EK", name: "Emirates", websiteDomain: "emirates.com"),
        "EY": .init(iata: "EY", name: "Etihad Airways", websiteDomain: "etihad.com"),
        "WY": .init(iata: "WY", name: "Oman Air", websiteDomain: "omanair.com"),
        "GF": .init(iata: "GF", name: "Gulf Air", websiteDomain: "gulfair.com"),
        "KU": .init(iata: "KU", name: "Kuwait Airways", websiteDomain: "kuwaitairways.com"),
        "MS": .init(iata: "MS", name: "EgyptAir", websiteDomain: "egyptair.com"),
        "W6": .init(iata: "W6", name: "Wizz Air", websiteDomain: "wizzair.com"),
        "5W": .init(iata: "5W", name: "Wizz Air Abu Dhabi", websiteDomain: "wizzair.com"),
        "3L": .init(iata: "3L", name: "Air Arabia Abu Dhabi", websiteDomain: "airarabia.com"),
        "F3": .init(iata: "F3", name: "flyadeal", websiteDomain: "flyadeal.com"),
        "RJ": .init(iata: "RJ", name: "Royal Jordanian", websiteDomain: "rj.com"),
        "OV": .init(iata: "OV", name: "SalamAir", websiteDomain: "salamair.com"),
        "6E": .init(iata: "6E", name: "IndiGo", websiteDomain: "goindigo.in"),
        "PK": .init(iata: "PK", name: "Pakistan International Airlines", websiteDomain: "piac.com.pk")
    ]

    // Small offline enrichment layer for the routes that matter most to iumrah.
    // The app still uses its existing airport API for discovery; this catalog is
    // only a resilient presentation/time-zone fallback for flight results.
    private static let airports: [String: AirportReference] = [
        "TAS": .init(iata: "TAS", city: "Tashkent", name: "Tashkent International Airport", country: "Uzbekistan", timeZoneIdentifier: "Asia/Tashkent"),
        "SKD": .init(iata: "SKD", city: "Samarkand", name: "Samarkand International Airport", country: "Uzbekistan", timeZoneIdentifier: "Asia/Samarkand"),
        "BHK": .init(iata: "BHK", city: "Bukhara", name: "Bukhara International Airport", country: "Uzbekistan", timeZoneIdentifier: "Asia/Samarkand"),
        "UGC": .init(iata: "UGC", city: "Urgench", name: "Urgench International Airport", country: "Uzbekistan", timeZoneIdentifier: "Asia/Samarkand"),
        "NMA": .init(iata: "NMA", city: "Namangan", name: "Namangan International Airport", country: "Uzbekistan", timeZoneIdentifier: "Asia/Tashkent"),
        "FEG": .init(iata: "FEG", city: "Fergana", name: "Fergana International Airport", country: "Uzbekistan", timeZoneIdentifier: "Asia/Tashkent"),
        "NCU": .init(iata: "NCU", city: "Nukus", name: "Nukus Airport", country: "Uzbekistan", timeZoneIdentifier: "Asia/Samarkand"),
        "TMJ": .init(iata: "TMJ", city: "Termez", name: "Termez International Airport", country: "Uzbekistan", timeZoneIdentifier: "Asia/Samarkand"),
        "KSQ": .init(iata: "KSQ", city: "Karshi", name: "Karshi Airport", country: "Uzbekistan", timeZoneIdentifier: "Asia/Samarkand"),
        "AZN": .init(iata: "AZN", city: "Andijan", name: "Andijan Airport", country: "Uzbekistan", timeZoneIdentifier: "Asia/Tashkent"),
        "NAV": .init(iata: "NAV", city: "Navoi", name: "Navoi International Airport", country: "Uzbekistan", timeZoneIdentifier: "Asia/Samarkand"),
        "JED": .init(iata: "JED", city: "Jeddah", name: "King Abdulaziz International Airport", country: "Saudi Arabia", timeZoneIdentifier: "Asia/Riyadh"),
        "MED": .init(iata: "MED", city: "Madinah", name: "Prince Mohammad bin Abdulaziz International Airport", country: "Saudi Arabia", timeZoneIdentifier: "Asia/Riyadh"),
        "RUH": .init(iata: "RUH", city: "Riyadh", name: "King Khalid International Airport", country: "Saudi Arabia", timeZoneIdentifier: "Asia/Riyadh"),
        "IST": .init(iata: "IST", city: "Istanbul", name: "Istanbul Airport", country: "Türkiye", timeZoneIdentifier: "Europe/Istanbul"),
        "SAW": .init(iata: "SAW", city: "Istanbul", name: "Sabiha Gökçen International Airport", country: "Türkiye", timeZoneIdentifier: "Europe/Istanbul"),
        "ESB": .init(iata: "ESB", city: "Ankara", name: "Esenboğa Airport", country: "Türkiye", timeZoneIdentifier: "Europe/Istanbul"),
        "DXB": .init(iata: "DXB", city: "Dubai", name: "Dubai International Airport", country: "United Arab Emirates", timeZoneIdentifier: "Asia/Dubai"),
        "SHJ": .init(iata: "SHJ", city: "Sharjah", name: "Sharjah International Airport", country: "United Arab Emirates", timeZoneIdentifier: "Asia/Dubai"),
        "DOH": .init(iata: "DOH", city: "Doha", name: "Hamad International Airport", country: "Qatar", timeZoneIdentifier: "Asia/Qatar"),
        "KWI": .init(iata: "KWI", city: "Kuwait City", name: "Kuwait International Airport", country: "Kuwait", timeZoneIdentifier: "Asia/Kuwait"),
        "GYD": .init(iata: "GYD", city: "Baku", name: "Heydar Aliyev International Airport", country: "Azerbaijan", timeZoneIdentifier: "Asia/Baku"),
        "ALA": .init(iata: "ALA", city: "Almaty", name: "Almaty International Airport", country: "Kazakhstan", timeZoneIdentifier: "Asia/Almaty"),
        "NQZ": .init(iata: "NQZ", city: "Astana", name: "Nursultan Nazarbayev International Airport", country: "Kazakhstan", timeZoneIdentifier: "Asia/Almaty"),
        "DYU": .init(iata: "DYU", city: "Dushanbe", name: "Dushanbe International Airport", country: "Tajikistan", timeZoneIdentifier: "Asia/Dushanbe"),
        "AUH": .init(iata: "AUH", city: "Abu Dhabi", name: "Zayed International Airport", country: "United Arab Emirates", timeZoneIdentifier: "Asia/Dubai"),
        "MCT": .init(iata: "MCT", city: "Muscat", name: "Muscat International Airport", country: "Oman", timeZoneIdentifier: "Asia/Muscat"),
        "BAH": .init(iata: "BAH", city: "Manama", name: "Bahrain International Airport", country: "Bahrain", timeZoneIdentifier: "Asia/Bahrain"),
        "CAI": .init(iata: "CAI", city: "Cairo", name: "Cairo International Airport", country: "Egypt", timeZoneIdentifier: "Africa/Cairo"),
        "DWC": .init(iata: "DWC", city: "Dubai", name: "Al Maktoum International Airport", country: "United Arab Emirates", timeZoneIdentifier: "Asia/Dubai"),
        "AMM": .init(iata: "AMM", city: "Amman", name: "Queen Alia International Airport", country: "Jordan", timeZoneIdentifier: "Asia/Amman"),
        "TBS": .init(iata: "TBS", city: "Tbilisi", name: "Tbilisi International Airport", country: "Georgia", timeZoneIdentifier: "Asia/Tbilisi"),
        "FRU": .init(iata: "FRU", city: "Bishkek", name: "Manas International Airport", country: "Kyrgyzstan", timeZoneIdentifier: "Asia/Bishkek"),
        "OSS": .init(iata: "OSS", city: "Osh", name: "Osh International Airport", country: "Kyrgyzstan", timeZoneIdentifier: "Asia/Bishkek"),
        "IKA": .init(iata: "IKA", city: "Tehran", name: "Imam Khomeini International Airport", country: "Iran", timeZoneIdentifier: "Asia/Tehran"),
        "ISB": .init(iata: "ISB", city: "Islamabad", name: "Islamabad International Airport", country: "Pakistan", timeZoneIdentifier: "Asia/Karachi"),
        "DEL": .init(iata: "DEL", city: "Delhi", name: "Indira Gandhi International Airport", country: "India", timeZoneIdentifier: "Asia/Kolkata"),
        "BOM": .init(iata: "BOM", city: "Mumbai", name: "Chhatrapati Shivaji Maharaj International Airport", country: "India", timeZoneIdentifier: "Asia/Kolkata"),
        "DMM": .init(iata: "DMM", city: "Dammam", name: "King Fahd International Airport", country: "Saudi Arabia", timeZoneIdentifier: "Asia/Riyadh"),
        "TIF": .init(iata: "TIF", city: "Taif", name: "Taif International Airport", country: "Saudi Arabia", timeZoneIdentifier: "Asia/Riyadh")
    ]

    static var filterAirlines: [AirlineReference] {
        airlines.values.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    static func airline(code: String?) -> AirlineReference? {
        guard let code else { return nil }
        return airlines[code.uppercased()]
    }

    static func airlineName(code: String?, fallback: String) -> String {
        airline(code: code)?.name ?? fallback
    }

    static func airport(_ code: String) -> AirportReference? {
        airports[code.uppercased()]
    }

    static func timeZone(for airportCode: String) -> TimeZone? {
        guard let identifier = airport(airportCode)?.timeZoneIdentifier else { return nil }
        return TimeZone(identifier: identifier)
    }

    static func airportMentions(in text: String) -> [String] {
        let lower = " " + text.lowercased() + " "
        let ambiguousCities: Set<String> = ["istanbul"]
        var matches: [(Int, String)] = []
        for (code, reference) in airports {
            if let range = lower.range(of: " \(code.lowercased()) ") {
                matches.append((lower.distance(from: lower.startIndex, to: range.lowerBound), code))
                continue
            }
            let city = reference.city.lowercased()
            guard !ambiguousCities.contains(city), let range = lower.range(of: city) else { continue }
            matches.append((lower.distance(from: lower.startIndex, to: range.lowerBound), code))
        }
        return matches.sorted { $0.0 < $1.0 }.map(\.1)
    }


    static func airlineCode(fromName name: String) -> String? {
        let normalized = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return airlines.values.first(where: { $0.name.localizedCaseInsensitiveCompare(normalized) == .orderedSame })?.iata
    }

    static func airportCountry(_ code: String) -> String? {
        airport(code)?.country
    }

    static func normalizedVerifiedFlightNumber(_ rawValue: String) -> String? {
        let compact = rawValue
            .uppercased()
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "-", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        // A user-facing flight number must be an actual carrier designator plus
        // one-to-four digits. Internal placeholders (REF-*, provider IDs, dates,
        // prices, etc.) can never satisfy this contract.
        guard compact.range(of: #"^[A-Z0-9]{2}[0-9]{1,4}[A-Z]?$"#, options: .regularExpression) != nil else { return nil }
        let code = String(compact.prefix(2))
        // Ignav is authoritative for the carrier designator. The local catalog is
        // presentation enrichment only and must not reject valid airlines that are
        // not yet curated inside iumrah.
        guard code.range(of: #"^[A-Z0-9]{2}$"#, options: .regularExpression) != nil else { return nil }
        return "\(code) \(compact.dropFirst(2))"
    }

    static func isVerifiedFlightNumber(_ rawValue: String) -> Bool {
        normalizedVerifiedFlightNumber(rawValue) != nil
    }

    static func airlineCode(from flightNumber: String) -> String? {
        guard let normalized = normalizedVerifiedFlightNumber(flightNumber) else { return nil }
        return String(normalized.prefix(2))
    }

    static func aircraftName(from raw: String) -> String? {
        let normalized = raw.uppercased().trimmingCharacters(in: .whitespacesAndNewlines)
        let knownCodes: [String: String] = [
            "7M8": "Boeing 737 MAX 8",
            "7M9": "Boeing 737 MAX 9",
            "738": "Boeing 737-800",
            "739": "Boeing 737-900",
            "737": "Boeing 737",
            "32N": "Airbus A320neo",
            "320": "Airbus A320",
            "321": "Airbus A321",
            "32Q": "Airbus A321neo",
            "319": "Airbus A319",
            "359": "Airbus A350-900",
            "789": "Boeing 787-9",
            "788": "Boeing 787-8",
            "77W": "Boeing 777-300ER",
            "763": "Boeing 767-300",
            "AT7": "ATR 72",
            "ATR72": "ATR 72",
            "E190": "Embraer E190",
            "E195": "Embraer E195"
        ]
        if let value = knownCodes[normalized] { return value }
        if normalized.contains("BOEING") || normalized.contains("AIRBUS") || normalized.contains("ATR") || normalized.contains("EMBRAER") {
            return raw.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return nil
    }
}
