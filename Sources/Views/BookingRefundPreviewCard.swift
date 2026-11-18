import SwiftUI
struct BusinessRefundEstimateCard: View {
    let bookingID:String
    private struct Estimate:Decodable {
        struct Item:Decodable,Identifiable {let code:String;let label:String;let amountCents:Int;let refundCents:Int?;var id:String{code}}
        let available:Bool;let items:[Item];let estimateCents:Int?;let supportCents:Int?
    }
    @State private var estimate:Estimate?;@State private var error:String?
    private func money(_ value:Int)->String{(Double(value)/100).formatted(.currency(code:"USD"))}
    var body:some View{DisclosureGroup("Предварительный расчёт возврата") {
        if let estimate {
            if estimate.available { ForEach(estimate.items){item in LabeledContent(item.label,value:item.refundCents.map(money) ?? "Уточнить")}; if let fee=estimate.supportCents{LabeledContent("9% · предварительно",value:money(fee))};if let total=estimate.estimateCents{LabeledContent("Предварительно",value:money(total))};Text("Не является распоряжением на выплату. Проверьте тарифы, комиссию оплаты и историю возвратов.").font(.caption).foregroundStyle(.secondary) } else { Text("Требуется ручной расчёт.") }
        }else if let error{Text(error).font(.caption)}else{ProgressView()}
        Button("Обновить расчёт"){Task{await load()}}
    }.task{await load()}}
    @MainActor private func load()async{do{estimate=try await APIClient.shared.offerRequest(path:"/api/admin/hotels/operations/bookings/\(bookingID)/refund-preview");error=nil}catch{self.error=error.localizedDescription}}
}
