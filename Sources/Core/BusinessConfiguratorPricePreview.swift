import Foundation

/// Presentation only: never sends a partial amount to the booking API.
/// Full quote is the existing canonical draft calculation, not a second pricing engine.
struct BusinessConfiguratorPricePreview {
    let amount: Double?
    let isComplete: Bool
    let title: String

    init(draft: UmrahPackageDraft, stage: Int) {
        if draft.firstIncompleteBuilderStage == 5, let total = draft.saleTotal {
            amount = total
            isComplete = true
            title = stage >= 4 ? "Итого за поездку" : "Расчёт пакета"
            return
        }
        isComplete = false
        var amounts: [Double] = []
        // Only explicitly entered, structurally valid lines. No suggested catalog fare.
        if draft.builderIssue(at: 1) == nil, let fare = UmrahPackageDraft.amount(draft.flightPrice), fare > 0 {
            amounts.append(fare * Double(draft.travelers))
        }
        if draft.stayIssue(draft.makkah) == nil, let price = UmrahPackageDraft.amount(draft.makkah.price) { amounts.append(price) }
        if draft.includeMedina, draft.stayIssue(draft.medina) == nil, let price = UmrahPackageDraft.amount(draft.medina.price) { amounts.append(price) }
        if stage >= 3, draft.builderIssue(at: 3) == nil {
            if let transfer = UmrahPackageDraft.amount(draft.transferPrice) { amounts.append(transfer) }
            if draft.ziyaratMakkah || (draft.includeMedina && draft.ziyaratMedina), let visits = UmrahPackageDraft.amount(draft.ziyaratPrice) { amounts.append(visits) }
            for raw in [draft.visaPrice, draft.guidePrice, draft.otherPrice] {
                if let value = UmrahPackageDraft.amount(raw ?? "0") { amounts.append(value) }
            }
        }
        if !amounts.isEmpty, amounts.allSatisfy({ $0.isFinite && $0 <= 250000 }) {
            amount = amounts.map { ($0 * 100).rounded() }.reduce(0, +) / 100
            title = "Учтено · без комиссии и скидки"
        } else {
            amount = nil
            title = "Стоимость не рассчитана"
        }
    }
}
