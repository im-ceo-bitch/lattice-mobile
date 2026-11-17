import Foundation
import Combine
import CryptoKit

/// A proposal only: creating a draft never purchases inventory or notifies a pilgrim.
struct UmrahPackageDraft: Codable, Equatable {
    static var stayCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Riyadh")!
        return calendar
    }
    struct Flight: Codable, Equatable {
        var id: String
        var source: String
        var legs: [BusinessFlightCurationItinerary.Leg]
        var verificationKey: String? = nil
    }
    struct Stay: Codable, Equatable {
        var id = ""
        var name = ""
        var imageURL: String? = nil
        var stars: Int? = nil
        var checkIn = UmrahPackageDraft.stayCalendar.startOfDay(for: Date())
        var checkOut = UmrahPackageDraft.stayCalendar.startOfDay(for: Date())
        var rooms = 1
        var room = ""
        var meals = "Без питания"
        // Explicit package amounts; catalog cache prices are never treated as a quote.
        var price = ""
        var nights: Int { UmrahPackageDraft.stayCalendar.dateComponents([.day], from: checkIn, to: checkOut).day ?? 0 }
    }
    var travelers = 2
    var comfort = "Standard"
    var outbound: Flight? = nil
    var inbound: Flight? = nil
    var flightPrice = ""
    var makkah = Stay()
    var includeMedina = true
    var medina = Stay(meals: "Завтрак и ужин")
    var vehicle = "Kia Carnival"
    var transferPrice = "300"
    var pickup = Date()
    var ziyaratMakkah = false
    var ziyaratMedina = false
    var ziyaratPrice = "0"
    var clientName = ""
    var phone = ""
    var telegram = ""
    var notes = ""
    // Optional for backwards-compatible decoding of existing protected drafts.
    var email: String? = nil
    var lastName: String? = nil
    var language: String? = nil
    var sendEmail: Bool? = nil
    var commission: String? = nil
    var visaPrice: String? = nil
    var guidePrice: String? = nil
    var otherPrice: String? = nil
    var requestSecret: String? = nil
    var receipt: BusinessManualBookingReceipt? = nil
    var submissionMode: String? = nil
    var offerHours: Int? = nil
    var offerReceipt: BusinessOffer? = nil
    // Optional UI state keeps old drafts and saved offers decodable.
    var builderStage: Int? = nil
    var builderFlightPhase: Int? = nil
    var builderHotelPhase: Int? = nil
    var builderOrigin: String? = nil
    var builderFinishAsOffer: Bool? = nil
    var discount: String? = nil
    var flightFares: [String: Double]? = nil
    var selectedFareKeys: [String: String]? = nil
    var selectedFareKinds: [String: String]? = nil
    var costSubtotal: Double? {
        guard let base = total,
              let visa = Self.amount(visaPrice ?? "0"), let guide = Self.amount(guidePrice ?? "0"), let other = Self.amount(otherPrice ?? "0") else { return nil }
        // Match server rounding: each cost line is rounded to cents independently.
        guard [visa, guide, other].allSatisfy({ $0 <= 250000 }) else { return nil }
        return (base * 100 + [visa, guide, other].map { ($0 * 100).rounded() }.reduce(0, +)).rounded() / 100
    }
    var commissionAmount: Double? {
        guard let subtotal = costSubtotal, let rate = Self.amount(commission ?? "0"), rate <= 100 else { return nil }
        return (subtotal * 100 * rate / 100).rounded() / 100
    }
    var saleTotal: Double? {
        guard let subtotal = costSubtotal, let fee = commissionAmount,
              let discount = Self.amount(discount ?? "0") else { return nil }
        let result = (subtotal * 100).rounded() + (fee * 100).rounded() - (discount * 100).rounded()
        guard discount <= 250000, result > 0, result <= 25_000_000 else { return nil }
        return result / 100
    }
    var suggestedFlightPrice: Double? {
        guard let out = flightFares?["out"], let back = flightFares?["back"],
              let outKey = selectedFareKeys?["out"], let backKey = selectedFareKeys?["back"],
              out > 0, back > 0 else { return nil }
        if outKey == backKey, selectedFareKinds?["out"] == "round_trip", selectedFareKinds?["back"] == "round_trip" { return out }
        if outKey != backKey, selectedFareKinds?["out"] == "one_way", selectedFareKinds?["back"] == "one_way" { return out + back }
        return nil
    }
    var parameterIssue: String? { (1...6).contains(travelers) ? nil : "Укажите от 1 до 6 паломников." }
    func stayIssue(_ stay: Stay) -> String? {
        guard !stay.id.isEmpty, !stay.room.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              (1...6).contains(stay.rooms), stay.nights > 0 else { return "Выберите отель, номер и даты проживания." }
        guard (Self.amount(stay.price) ?? 0) > 0 else { return "Укажите стоимость всех номеров за весь срок." }
        guard let arrival, let departure, stay.checkIn >= Self.stayCalendar.startOfDay(for: arrival), stay.checkOut <= Self.stayCalendar.startOfDay(for: departure) else { return "Даты проживания должны быть в пределах поездки." }
        return nil
    }
    var bookingIssue: String? {
        if clientName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (lastName ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Укажите имя и фамилию." }
        if phone.range(of: #"^\+[1-9][0-9]{7,14}$"#, options: .regularExpression) == nil { return "Укажите телефон в международном формате, например +998901234567." }
        if sendEmail == true && (email ?? "").range(of: #"^\S+@\S+\.\S+$"#, options: .regularExpression) == nil { return "Укажите корректный email или отключите отправку." }
        if saleTotal == nil { return "Проверьте себестоимость и комиссию (0–100%)." }
        return nil
    }


    static func amount(_ text: String) -> Double? {
        let normalized = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        guard let value = Double(normalized), value.isFinite, value >= 0 else { return nil }
        return value
    }
    var total: Double? {
        guard let flight = Self.amount(flightPrice), flight > 0,
              let hotel = Self.amount(makkah.price), hotel > 0,
              let transfer = Self.amount(transferPrice) else { return nil }
        let includeVisits = ziyaratMakkah || (includeMedina && ziyaratMedina)
        let visits: Double
        if includeVisits {
            guard let price = Self.amount(ziyaratPrice) else { return nil }
            visits = price
        } else { visits = 0 }
        let medinaPrice: Double
        if includeMedina {
            guard let price = Self.amount(medina.price), price > 0 else { return nil }
            medinaPrice = price
        } else { medinaPrice = 0 }
        guard [flight * Double(travelers), hotel, medinaPrice, transfer, visits].allSatisfy({ $0 <= 250000 }) else { return nil }
        return [flight * Double(travelers), hotel, medinaPrice, transfer, visits].map { ($0 * 100).rounded() }.reduce(0, +) / 100
    }
    var arrival: Date? { Self.date(outbound?.legs.last?.arrivalAt) }
    var departure: Date? { Self.date(inbound?.legs.first?.departureAt) }
    static func date(_ raw: String?) -> Date? {
        guard let raw else { return nil }
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: raw) { return date }
        formatter.formatOptions.insert(.withFractionalSeconds)
        return formatter.date(from: raw)
    }
    func builderIssue(at stage: Int) -> String? {
        switch stage {
        case 0: return parameterIssue
        case 1: return issue(at: 0)
        case 2: return issue(at: 1)
        case 3: return issue(at: 2)
        case 4: return saleTotal == nil ? "Проверьте стоимость, комиссию и скидку." : nil
        default: return nil
        }
    }
    var firstIncompleteBuilderStage: Int { (0..<5).first { builderIssue(at: $0) != nil } ?? 5 }
    func issue(at step: Int) -> String? {
        if step == 0 {
            guard (1...6).contains(travelers) else { return "Укажите от 1 до 6 паломников." }
            guard let outbound, let inbound, !outbound.legs.isEmpty, !inbound.legs.isEmpty else { return "Выберите рейсы туда и обратно." }
            for flight in [outbound, inbound] {
                for (index, leg) in flight.legs.enumerated() {
                    guard let departure = Self.date(leg.departureAt), let arrival = Self.date(leg.arrivalAt), arrival > departure else { return "Проверьте время вылета и прилёта каждого сегмента." }
                    if index > 0 {
                        let previous = flight.legs[index - 1]
                        guard previous.destination == leg.origin, let previousArrival = Self.date(previous.arrivalAt), departure >= previousArrival else { return "Проверьте аэропорты и время пересадок." }
                    }
                }
            }
            guard let outboundDate = Self.date(outbound.legs.first?.departureAt), outboundDate > Date() else { return "Выберите будущий рейс туда." }
            guard let arrival, let departure, departure > arrival else { return "Проверьте даты: обратный рейс должен быть после прилёта." }
            let saudi = ["JED", "MED"]
            guard saudi.contains(outbound.legs.last!.destination), saudi.contains(inbound.legs.first!.origin),
                  outbound.legs.first!.origin == inbound.legs.last!.destination else { return "Маршрут должен вести в JED или MED и обратно в город вылета." }
            guard let price = Self.amount(flightPrice), price > 0 else { return "Укажите стоимость перелёта туда и обратно на человека в USD." }
        }
        if step == 1 {
            let stays = includeMedina ? [makkah, medina] : [makkah]
            guard stays.allSatisfy({ (1...6).contains($0.rooms) }) else { return "Проверьте количество номеров." }
            guard stays.allSatisfy({ !$0.id.isEmpty && !$0.room.trimmingCharacters(in: .whitespaces).isEmpty && $0.nights > 0 }) else { return "Выберите отель, категорию номера и даты проживания для каждого города." }
            guard stays.allSatisfy({ (Self.amount($0.price) ?? 0) > 0 }) else { return "Введите подтверждённую стоимость проживания за все номера и ночи." }
            guard let arrival, let departure else { return "Сначала выберите рейсы." }
            let calendar = Self.stayCalendar
            let start = calendar.startOfDay(for: arrival), end = calendar.startOfDay(for: departure)
            guard stays.allSatisfy({ $0.checkIn >= start && $0.checkOut <= end }) else { return "Даты отелей должны находиться между прилётом и обратным вылетом." }
            let sorted = stays.sorted { $0.checkIn < $1.checkIn }
            guard sorted.first?.checkIn == start, sorted.last?.checkOut == end else { return "Проживание должно покрывать все ночи поездки." }
            if includeMedina && sorted[0].checkOut != sorted[1].checkIn { return "Между отелями не должно быть пропусков или пересекающихся ночей." }
        }
        if step == 2 {
            guard [visaPrice, guidePrice, otherPrice].allSatisfy({ Self.amount($0 ?? "0") != nil }) else { return "Проверьте стоимость виз, гида и дополнительных услуг." }
            guard Self.amount(transferPrice) != nil, (!(ziyaratMakkah || (includeMedina && ziyaratMedina)) || Self.amount(ziyaratPrice) != nil) else { return "Проверьте стоимость трансфера и зияратов." }
            if vehicle == "Chevrolet Malibu" && travelers > 3 { return "Для Malibu максимум 3 паломника. Выберите другое авто." }
            if travelers > 6 { return "Для более 6 паломников требуется несколько автомобилей. Уменьшите группу или согласуйте отдельный трансфер." }
            guard let arrival, pickup >= arrival, pickup.timeIntervalSince(arrival) < 86400 else { return "Укажите встречу в аэропорту в течение суток после прилёта." }
        }
        return nil
    }
    var route: [String] {
        let airportIn = outbound?.legs.last?.destination ?? "Аэропорт прилёта"
        let airportOut = inbound?.legs.first?.origin ?? "Аэропорт вылета"
        let stays = (includeMedina ? [makkah, medina] : [makkah]).sorted { $0.checkIn < $1.checkIn }
        return [airportIn] + stays.map { $0.name.isEmpty ? "Отель" : $0.name } + [airportOut]
    }
}

@MainActor
final class UmrahDraftStore: ObservableObject {
    @Published var draft = UmrahPackageDraft()
    @Published var storageError: String?
    private let ownerKey: String
    private var file: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("UmrahBusinessDraft-\(ownerKey).json")
    }
    init(owner: String, initial: UmrahPackageDraft? = nil) {
        if let initial { draft = initial }
        ownerKey = SHA256.hash(data: Data(owner.utf8)).map { String(format: "%02x", $0) }.joined()
        do {
            if FileManager.default.fileExists(atPath: file.path) {
                draft = try JSONDecoder().decode(UmrahPackageDraft.self, from: Data(contentsOf: file))
            }
        } catch { storageError = "Не удалось прочитать черновик: \(error.localizedDescription)" }
    }
    func save() {
        do {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(draft).write(to: file, options: [.atomic, .completeFileProtection])
            var attributes = URLResourceValues()
            attributes.isExcludedFromBackup = true
            var url = file
            try url.setResourceValues(attributes)
            storageError = nil
        } catch { storageError = "Черновик не сохранён: \(error.localizedDescription)" }
    }
}
