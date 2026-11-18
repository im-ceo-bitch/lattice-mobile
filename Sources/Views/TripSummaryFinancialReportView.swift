import SwiftUI

struct TripSummaryFinancialReportView: View {
    let report: TripSummaryFinancialReport
    @State private var internalMode = false
    private var currency: String { report.client.currency }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Финансовый отчёт").font(.headline)
            Picker("Режим отчёта", selection: $internalMode) {
                Text("Клиентский").tag(false)
                Text("Внутренний").tag(true)
            }.pickerStyle(.segmented)
            if internalMode {
                Text("Конфиденциально · только iumrah Business").font(.caption).foregroundStyle(.secondary)
                amount("Себестоимость", report.internal.supplierCostUsd)
                amount("Маржа компонентов", report.internal.componentMarginUsd)
                amount("Поддержка и комиссия · 9%", report.internal.supportAmountUsd)
                amount("Платёжные расходы · 2%", report.internal.paymentAmountUsd)
                amount("Округление", report.internal.roundingUsd)
                Divider()
                ForEach(report.internal.components) { component in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(component.label).font(.subheadline.weight(.semibold))
                        amount("Закупка", component.supplierCostUsd)
                        amount("Продажа", component.retailUsd)
                        amount("Маржа", component.marginUsd)
                    }.padding(10).background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 12))
                }
                Divider()
                amount("Расчётная маржа", report.internal.estimatedMarginUsd, emphasized: true)
                Text("До налогов и прочих расходов; платёжные расходы оценены по ставке 2%.").font(.caption).foregroundStyle(.secondary)
            } else {
                Text("Розничные цены услуг · клиентский расчёт").font(.caption).foregroundStyle(.secondary)
                ForEach(report.client.components) { component in
                    amount(component.label, component.amountUsd)
                }
                Divider()
                amount("Стоимость услуг", report.client.servicesSubtotalUsd)
                amount("Поддержка и комиссия платформы · 9%", report.client.supportAmountUsd)
                amount("Комиссия оплаты · 2%", report.client.paymentAmountUsd)
                if report.client.roundingUsd != 0 { amount("Округление", report.client.roundingUsd) }
                Divider()
                amount("Итого", report.client.totalUsd, emphasized: true)
                amount("На паломника", report.client.perPilgrimUsd)
            }
        }
    }
    private func amount(_ title: String, _ value: Double, emphasized: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(emphasized ? .headline : .subheadline)
            Spacer(minLength: 10)
            Text(value, format: .currency(code: currency).precision(.fractionLength(0...2)))
                .font(emphasized ? .headline : .subheadline.weight(.medium)).monospacedDigit()
        }
    }
}
