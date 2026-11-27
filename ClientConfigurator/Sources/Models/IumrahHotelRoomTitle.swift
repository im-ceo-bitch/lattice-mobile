import Foundation

/// Provider text can contain a list of facilities in place of a room name.
/// Preserve real category names; use a neutral title when no category is known.
enum IumrahHotelRoomTitle {
    static func clean(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let value = raw.replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        let parts = value.components(separatedBy: CharacterSet(charactersIn: ",;|•·\n"))
        let roomPattern = #"(?i)\b(room|suite|studio|apartment|villa|bungalow|double|twin|triple|quadruple|single|king|queen|deluxe|superior|standard|executive|family)\b|номер|люкс|апартамент|двухместн|тр[её]хместн|xona|хона|غرفة|جناح"#
        let amenityPattern = #"(?i)\b(wi[- ]?fi|internet|air conditioning|bathroom|toiletries|hairdryer|television|flat.screen|minibar|safe|coffee|tea maker|shower|towels|slippers|room service|room amenities|room facilities|room features|room size|desk|refrigerator|non.smoking|free parking|breakfast included)\b|кондиционер|телевизор|фен|душ|полотенц|холодильник|сейф|бесплатн"#
        for part in parts {
            let text = part.trimmingCharacters(in: .whitespacesAndNewlines)
            guard text.count <= 120, text.range(of: roomPattern, options: .regularExpression) != nil else { continue }
            if let amenity = text.range(of: amenityPattern, options: .regularExpression) {
                let prefix = String(text[..<amenity.lowerBound]).trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "-–—:([")))
                if prefix.range(of: roomPattern, options: .regularExpression) != nil { return prefix }
                continue
            }
            return text
        }
        // A short named category (e.g. Presidential) may lack the word room.
        if parts.count == 1, value.count <= 55, value.range(of: amenityPattern, options: .regularExpression) == nil,
           value.range(of: #"(?i)^(presidential|royal|premium|classic|comfort|economy|luxury|junior|signature|grand)(\s+\w+){0,2}$"#, options: .regularExpression) != nil { return value }
        return nil
    }

    static func display(rate: String?, room: String? = nil, fallback: String = "Room") -> String {
        let detail = clean(room)
        let offer = clean(rate)
        if let detail, ["room", "номер", "xona", "хона"].contains(detail.lowercased()), let offer { return offer }
        return detail ?? offer ?? fallback
    }
}
