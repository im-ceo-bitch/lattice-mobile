import Foundation

/// Planning limits only; live supplier occupancy and inventory remain authoritative.
enum ConfiguratorRepricingPolicy {
    static func minimumRooms(_ adults: Int) -> Int { max(1, (max(0, adults) + 4) / 5) }

    static func adultsInRoom(_ adults: Int, rooms: Int, index: Int) -> Int {
        guard rooms > 0, index >= 0, index < rooms else { return 0 }
        return adults / rooms + (index < adults % rooms ? 1 : 0)
    }

    static func roomsAfterPartyChange(existing: Int, oldAdults: Int, adults: Int) -> Int {
        let minimum = minimumRooms(adults)
        if existing == minimumRooms(oldAdults) { return minimum }
        return max(minimum, min(existing, adults))
    }

    static func isDavletbek(_ names: [String]) -> Bool {
        let aliases: Set<String> = ["davletbek", "davlatbek", "dawletbek", "dauletbek", "dovlatbek", "давлетбек", "давлатбек", "даулетбек", "довлатбек"]
        return names.contains { name in
            name.lowercased().split(whereSeparator: { !$0.isLetter }).contains { aliases.contains(String($0)) }
        }
    }

    static func replacementVehicle(_ existing: TransferVehicleKind?, travelers: Int) -> TransferVehicleKind? {
        if let existing, existing.passengerCapacity >= travelers { return existing }
        return TransferVehicleKind.carnival.passengerCapacity >= travelers ? .carnival : nil
    }

    static func normalizedRoomName(_ name: String) -> String {
        name.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").lowercased()
    }
}

extension NuiteeRoomRate {
    func sameRoomCategory(as previous: NuiteeRoomRate) -> Bool {
        (!roomId.isEmpty && roomId == previous.roomId) ||
        (!ConfiguratorRepricingPolicy.normalizedRoomName(roomName).isEmpty &&
         ConfiguratorRepricingPolicy.normalizedRoomName(roomName) == ConfiguratorRepricingPolicy.normalizedRoomName(previous.roomName))
    }

    /// Prefer the original category; alternatives must retain board/refund class.
    /// Any changed category is surfaced for explicit acceptance in Trip Summary.
    static func repricedSelection(previous: Self, rates: [Self], allowAlternative: Bool) -> Self? {
        let compatible = rates.filter {
            $0.supplierMeals == previous.supplierMeals && $0.refundable == previous.refundable &&
            $0.cancellationTag == previous.cancellationTag && $0.currency.uppercased() == "USD" &&
            $0.price.isFinite && $0.price > 0 && !$0.offerId.isEmpty
        }
        func cheapest(_ values: [Self]) -> Self? {
            values.min { a, b in a.price == b.price ? a.id < b.id : a.price < b.price }
        }
        let exact = compatible.filter { !$0.roomId.isEmpty && $0.roomId == previous.roomId }
        return cheapest(exact) ?? cheapest(compatible.filter { $0.sameRoomCategory(as: previous) }) ?? (allowAlternative ? cheapest(compatible) : nil)
    }
}
