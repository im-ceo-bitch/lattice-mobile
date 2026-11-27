import Foundation

enum TransferVehicleKind: String, Codable, CaseIterable, Identifiable, Hashable {
    case malibu
    case carnival
    case yukon

    var id: String { rawValue }

    var assetName: String {
        switch self {
        case .malibu: return "ConfiguratorTransferMalibu"
        case .carnival: return "ConfiguratorTransferCarnival"
        case .yukon: return "ConfiguratorTransferYukon"
        }
    }

    var modelName: String {
        switch self {
        case .malibu: return "Chevrolet Malibu"
        case .carnival: return "Kia Carnival"
        case .yukon: return "GMC Yukon"
        }
    }

    var passengerCapacity: Int {
        switch self {
        case .malibu: return 3
        case .carnival: return 7
        case .yukon: return 6
        }
    }

    var luggageCapacity: Int {
        switch self {
        case .malibu: return 2
        case .carnival: return 5
        case .yukon: return 5
        }
    }

    /// Customer-facing upgrade delta. The standard transfer allocation remains in
    /// every package; only the VIP Yukon changes the public package total.
    func publicUpgradeUsd(for scope: JourneyScope) -> Decimal {
        guard self == .yukon, scope == .makkahAndMadinah else { return 0 }
        return Decimal(750)
    }
}

enum HaramainFareClass: String, Codable, CaseIterable, Identifiable, Hashable {
    case economy
    case business

    var id: String { rawValue }

    /// Public package add-on per occupied seat. These are customer-facing package
    /// deltas rather than supplier-cost disclosures.
    var publicSeatPriceUsd: Decimal {
        switch self {
        case .economy: return Decimal(150)
        case .business: return Decimal(200)
        }
    }
}
