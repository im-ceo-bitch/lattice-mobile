import Foundation
import SwiftUI

struct BookingPricingEditorSheet: View {
    let bookingID: String
    let report: BookingPricingReport
    let onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var amounts: [String: String]
    @State private var saving = false
    @State private var errorMessage: String?

    init(bookingID: String, report: BookingPricingReport, onSaved: @escaping () -> Void) {
        self.bookingID = bookingID
        self.report = report
        self.onSaved = onSaved
        _amounts = State(initialValue: Dictionary(uniqueKeysWithValues: report.components.map { ($0.code, Self.number($0.supplierCostUsd)) }))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Цена под капотом")
                        .font(.system(size: 31, weight: .bold, design: .rounded))
                    Text("Изменяйте себестоимость каждого компонента в USD. Итог пересчитывается сразу. Наценка и комиссия зафиксированы существующей математикой пакета.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                VStack(alignment: .leading, spacing: 0) {
                    Text("КОМПОНЕНТЫ")
                        .font(.caption2.bold())
                        .tracking(1.2)
                        .foregroundStyle(.secondary)
                        .padding(.bottom, 4)

                    ForEach(Array(report.components.enumerated()), id: \.element.code) { index, component in
                        VStack(alignment: .leading, spacing: 9) {
                            HStack(alignment: .center, spacing: 12) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(russianPricingComponentLabel(code: component.code, fallback: component.label))
                                        .font(.headline)
                                    Text(componentHint(code: component.code))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 10)
                                HStack(spacing: 5) {
                                    Text("$")
                                        .foregroundStyle(.secondary)
                                    TextField("0", text: binding(for: component.code))
                                        .keyboardType(.decimalPad)
                                        .multilineTextAlignment(.trailing)
                                        .frame(width: 105)
                                }
                                .font(.title3.bold().monospacedDigit())
                                .padding(.horizontal, 12)
                                .frame(height: 46)
                                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                            }
                            Text("Себестоимость компонента · USD")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 13)

                        if index < report.components.count - 1 { Divider() }
                    }
                }
                .padding(16)
                .businessCard(radius: 26)

                VStack(alignment: .leading, spacing: 12) {
                    Text("ФИКСИРОВАННЫЕ ПРОЦЕНТЫ")
                        .font(.caption2.bold())
                        .tracking(1.2)
                        .foregroundStyle(.secondary)
                    fixedPercentRow("Наценка", rate: markupRate)
                    Divider()
                    fixedPercentRow("Комиссия оплаты", rate: feeRate)
                    Text("Эти проценты здесь не редактируются. Меняются только денежные компоненты выше.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(16)
                .businessCard(radius: 26)

                VStack(alignment: .leading, spacing: 11) {
                    Text("ПЕРЕСЧЁТ")
                        .font(.caption2.bold())
                        .tracking(1.2)
                        .foregroundStyle(.secondary)
                    totalRow("Себестоимость", supplierTotal)
                    totalRow("Наценка", markupAmount)
                    totalRow("После наценки", subtotalAfterMarkup)
                    totalRow("Комиссия оплаты", paymentFeeAmount)
                    totalRow("Расчёт до округления", calculatedSelling)
                    Divider()
                    totalRow("Итого клиенту", publicTotal, emphasized: true)
                    totalRow("На паломника", publicPerPilgrim, emphasized: true)
                    Text("\(travelerCount) паломник(а) · округление по $5 на человека")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(18)
                .businessCard(radius: 28)

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.red.opacity(0.06), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }

                Button {
                    Task { await save() }
                } label: {
                    HStack {
                        if saving { ProgressView().tint(BusinessDesign.onPrimaryControl) }
                        Text(saving ? "Сохраняю…" : "Сохранить и пересчитать бронирование")
                        Spacer()
                        Image(systemName: "checkmark")
                    }
                    .font(.headline)
                    .foregroundStyle(BusinessDesign.onPrimaryControl)
                    .padding(.horizontal, 16)
                    .frame(height: 56)
                    .background(BusinessDesign.primaryControl, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(saving || parsedComponents == nil)
            }
            .padding(18)
            .padding(.bottom, 24)
        }
        .background(BusinessDesign.background)
        .navigationTitle("Редактор цены")
        .navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { Button("Закрыть") { dismiss() } }
        }
    }

    private var travelerCount: Int {
        max(1, report.context.travelers.adults + report.context.travelers.children + report.context.travelers.infants)
    }

    // These rates come from the original package pricing snapshot and are intentionally
    // immutable in Business. The server independently enforces the same rule.
    private var markupRate: Double { max(0, report.totals.markupRate) }
    private var feeRate: Double { min(0.49, max(0, report.totals.paymentFeeRate)) }

    private var supplierTotal: Double { parsedComponents?.reduce(0) { $0 + $1.supplierCostUsd } ?? 0 }
    private var markupAmount: Double { supplierTotal * markupRate }
    private var subtotalAfterMarkup: Double { supplierTotal + markupAmount }
    private var calculatedSelling: Double { subtotalAfterMarkup / max(0.51, 1 - feeRate) }
    private var paymentFeeAmount: Double { calculatedSelling - subtotalAfterMarkup }
    private var publicPerPilgrim: Double { max(5, (calculatedSelling / Double(travelerCount) / 5).rounded() * 5) }
    private var publicTotal: Double { publicPerPilgrim * Double(travelerCount) }

    private var parsedComponents: [BookingPricingComponent]? {
        var output: [BookingPricingComponent] = []
        for component in report.components {
            let raw = (amounts[component.code] ?? "")
                .replacingOccurrences(of: " ", with: "")
                .replacingOccurrences(of: ",", with: ".")
            guard let value = Double(raw), value >= 0, value <= 1_000_000 else { return nil }
            output.append(.init(code: component.code, label: component.label, supplierCostUsd: value))
        }
        return output
    }

    private func binding(for code: String) -> Binding<String> {
        Binding(get: { amounts[code] ?? "" }, set: { amounts[code] = $0 })
    }

    private func fixedPercentRow(_ title: String, rate: Double) -> some View {
        HStack {
            Text(title).font(.subheadline.weight(.semibold))
            Spacer()
            Text("\(Int((rate * 100).rounded()))%")
                .font(.headline.monospacedDigit())
            Image(systemName: "lock.fill")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func totalRow(_ title: String, _ value: Double, emphasized: Bool = false) -> some View {
        HStack {
            Text(title).font(emphasized ? .headline : .subheadline)
            Spacer()
            Text(value, format: .currency(code: report.currency).precision(.fractionLength(0...2)))
                .font(emphasized ? .headline : .subheadline)
                .fontWeight(.bold)
                .monospacedDigit()
        }
    }

    private func russianPricingComponentLabel(code: String, fallback: String) -> String {
        let value = code.lowercased()
        if value.hasPrefix("flight_") || value.contains("airfare") || value == "journey_fare" { return "Авиабилет" }
        if value == "makkah_hotel" { return "Отель в Мекке" }
        if value == "madinah_hotel" { return "Отель в Медине" }
        if value == "hotel" || value.contains("hotel") { return "Отель" }
        if value.contains("transfer") || value.contains("transport") { return "Трансфер" }
        if value.contains("accompaniment") || value.contains("guide") { return "Гид" }
        if value.contains("visa") { return "Виза" }
        if value.contains("meal") || value.contains("food") { return "Питание" }
        if value.contains("haramain") || value.contains("train") { return "Поезд Haramain" }
        if value == "ziyarat_makkah" { return "Зиярат в Мекке" }
        if value == "ziyarat_madinah" { return "Зиярат в Медине" }
        if value.contains("ziyarat") { return "Зиярат" }
        if value.contains("care") || value.contains("support") { return "iumrah Care" }
        if value.contains("esim") || value == "sim" { return "eSIM" }
        return fallback.isEmpty ? "Компонент" : fallback
    }

    private func componentHint(code: String) -> String {
        let value = code.lowercased()
        if value.hasPrefix("flight_") || value.contains("airfare") || value == "journey_fare" { return "Цена авиабилета для этой брони" }
        if value == "makkah_hotel" { return "Стоимость проживания в Мекке" }
        if value == "madinah_hotel" { return "Стоимость проживания в Медине" }
        if value.contains("visa") { return "Визовая себестоимость" }
        if value.contains("meal") || value.contains("food") { return "Питание для поездки" }
        if value.contains("transfer") || value.contains("transport") { return "Наземный трансфер" }
        if value.contains("haramain") || value.contains("train") { return "Междугородний поезд" }
        if value.contains("accompaniment") || value.contains("guide") { return "Работа гида / сопровождение" }
        if value.contains("ziyarat") { return "Зиярат по маршруту" }
        if value.contains("care") || value.contains("support") { return "Сервис поддержки iumrah" }
        return "Себестоимость этого компонента"
    }

    @MainActor
    private func save() async {
        guard let components = parsedComponents else { return }
        saving = true
        defer { saving = false }
        do {
            _ = try await APIClient.shared.saveBookingPricing(
                bookingID: bookingID,
                components: components,
                markupRate: markupRate,
                paymentFeeRate: feeRate
            )
            errorMessage = nil
            onSaved()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private static func number(_ value: Double) -> String {
        if value.rounded() == value { return String(Int(value)) }
        return String(format: "%.2f", value)
    }
}
