import Foundation

/// Rendering quality only: never changes trip data, pricing or network semantics.
enum IumrahPerformanceProfile: String, Equatable {
    case efficiency, balanced, performance

    static func resolve(machine: String, memoryBytes: UInt64, lowPower: Bool, thermalLimited: Bool) -> Self {
        if lowPower || thermalLimited { return .efficiency }
        // iPhone12,x is A13 (iPhone 11/SE 2); iPhone11,x is A12.
        if machine.hasPrefix("iPhone"), let generation = Int(machine.dropFirst(6).split(separator: ",").first ?? "") {
            if generation <= 12 { return .efficiency }
            if generation <= 15 { return .balanced }
        }
        if memoryBytes <= 4 * 1024 * 1024 * 1024 { return .efficiency }
        if memoryBytes <= 6 * 1024 * 1024 * 1024 { return .balanced }
        return .performance
    }

    var decorativeFPS: Double {
        switch self { case .efficiency: return 15; case .balanced: return 24; case .performance: return 30 }
    }
    var staticBackgrounds: Bool { self == .efficiency }
    var imageMemoryLimit: Int { (self == .efficiency ? 24 : 48) * 1024 * 1024 }
}
