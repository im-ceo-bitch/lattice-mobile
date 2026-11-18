import Foundation

struct TripSummaryPublicPrice: Codable, Hashable {
    struct Component: Codable, Hashable, Identifiable {
        var id: String { code }
        let code: String
        let label: String
        let amountUsd: Double
        let cancellationPolicy: String?
    }
    let version: String
    let currency: String
    let components: [Component]
    let servicesSubtotalUsd: Double
    let supportRate: Double
    let supportAmountUsd: Double
    let paymentRate: Double
    let paymentAmountUsd: Double
    let roundingUsd: Double
    let totalUsd: Double
    let perPilgrimUsd: Double
}

struct TripSummaryFinancialReport: Codable, Hashable {
    struct Internal: Codable, Hashable {
        struct Component: Codable, Hashable, Identifiable {
            var id: String { code }
            let code: String
            let label: String
            let supplierCostUsd: Double
            let retailUsd: Double
            let marginUsd: Double
        }
        let components: [Component]
        let supplierCostUsd: Double
        let componentMarginUsd: Double
        let supportAmountUsd: Double
        let paymentAmountUsd: Double
        let roundingUsd: Double
        let estimatedMarginUsd: Double
    }
    let client: TripSummaryPublicPrice
    let `internal`: Internal
}
