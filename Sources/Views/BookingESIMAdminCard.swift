import Foundation
import SwiftUI
import UIKit

struct BookingESIMAdminCard: View {
    let bookingID: String
    let esims: [BookingESIMProfile]
    let onChanged: () -> Void

    @State private var editor: ESIMEditorTarget?
    @State private var workingID: String?
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Label("eSIM", systemImage: "antenna.radiowaves.left.and.right")
                        .font(.title2.bold())
                    Text("Купите eSIM вручную и привяжите её к поездке по ICCID. Активация, статус и остаток трафика затем синхронизируются автоматически через eSIM Access.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Button {
                    editor = ESIMEditorTarget(profile: nil)
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 15, weight: .bold))
                        .frame(width: 40, height: 40)
                        .businessGlass(in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Добавить eSIM")
            }

            if esims.isEmpty {
                emptyState
            } else {
                ForEach(esims) { esim in
                    esimRow(esim)
                }
            }

            HStack(spacing: 8) {
                Image(systemName: "lock.shield.fill")
                Text("Activation Code и LPA выдаются только авторизованному владельцу брони.")
            }
            .font(.caption2.weight(.medium))
            .foregroundStyle(.secondary)
        }
        .padding(18)
        .businessCard(radius: 28)
        .sheet(item: $editor) { target in
            NavigationStack {
                BookingESIMEditorSheet(bookingID: bookingID, profile: target.profile) {
                    editor = nil
                    onChanged()
                }
            }
        }
        .alert("eSIM", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private var emptyState: some View {
        HStack(spacing: 14) {
            Image(systemName: "simcard")
                .font(.system(size: 24, weight: .semibold))
                .frame(width: 52, height: 52)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 17, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text("Профиль ещё не выдан")
                    .font(.subheadline.weight(.semibold))
                Text("После ручной покупки добавьте ICCID и LPA / SM-DP+ данные.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(14)
        .background(BusinessDesign.tertiarySurface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func esimRow(_ esim: BookingESIMProfile) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                Group {
                    if esim.usageAvailable {
                        ZStack {
                            Circle()
                                .stroke(BusinessDesign.line, lineWidth: 7)
                            Circle()
                                .trim(from: 0, to: esim.usageProgress)
                                .stroke(BusinessDesign.ink, style: StrokeStyle(lineWidth: 7, lineCap: .round))
                                .rotationEffect(.degrees(-90))
                            Image(systemName: "simcard.fill")
                                .font(.system(size: 16, weight: .semibold))
                        }
                    } else {
                        ZStack {
                            Circle().fill(BusinessDesign.tertiarySurface)
                            Image(systemName: "arrow.triangle.2.circlepath")
                                .font(.system(size: 17, weight: .semibold))
                        }
                    }
                }
                .frame(width: 58, height: 58)

                VStack(alignment: .leading, spacing: 3) {
                    Text(esim.planName.isEmpty ? esim.label : esim.planName)
                        .font(.headline)
                    if !esim.iccid.isEmpty {
                        Text("ICCID ••••\(esim.iccid.suffix(6))")
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                    }
                    Text(statusText(esim))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    if esim.usageAvailable {
                        Text(esim.remainingGB, format: .number.precision(.fractionLength(esim.remainingGB < 10 ? 1 : 0)))
                            .font(.title3.bold())
                        Text("GB осталось")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("AUTO")
                            .font(.caption.bold())
                        Text("ожидает sync")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if esim.usageAvailable && esim.totalMB > 0 {
                ProgressView(value: esim.usageProgress)
                    .tint(BusinessDesign.ink)
                HStack {
                    Text("Использовано \(formatGB(esim.usedGB)) GB")
                    Spacer()
                    Text("Всего \(formatGB(esim.totalGB)) GB")
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }

            HStack(spacing: 8) {
                Button {
                    editor = ESIMEditorTarget(profile: esim)
                } label: {
                    Label("Изменить", systemImage: "pencil")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)

                Menu {
                    Button(role: .destructive) {
                        Task { await delete(esim) }
                    } label: {
                        Label("Удалить", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .frame(width: 38, height: 38)
                }
                .buttonStyle(.bordered)
            }
            .font(.caption.weight(.semibold))

            if let sync = esim.lastUsageSyncAt, !sync.isEmpty {
                Text("Автоостаток · eSIM Access · \(shortDate(sync))")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            } else {
                Text("Остаток, статус и срок будут получены автоматически по ICCID.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(15)
        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func delete(_ esim: BookingESIMProfile) async {
        workingID = esim.id
        defer { workingID = nil }
        do {
            try await APIClient.shared.deleteBookingESIM(bookingID: bookingID, esimID: esim.id)
            onChanged()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func statusText(_ esim: BookingESIMProfile) -> String {
        let raw = (esim.providerStatus ?? esim.status).uppercased()
        switch raw {
        case "IN_USE", "IN USE": return "Активна"
        case "USED_UP", "USED UP": return "Трафик закончился"
        case "EXPIRED": return "Истекла"
        case "ONBOARD", "INSTALLATION", "INSTALLED": return "Установлена"
        case "GOT_RESOURCE", "RELEASED", "READY": return "Готова к активации"
        default: return raw.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    private func formatGB(_ value: Double) -> String {
        String(format: value < 10 ? "%.1f" : "%.0f", value)
    }

    private func shortDate(_ value: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: value) else { return value }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

private struct ESIMEditorTarget: Identifiable {
    let id = UUID()
    let profile: BookingESIMProfile?
}

private struct BookingESIMEditorSheet: View {
    let bookingID: String
    let profile: BookingESIMProfile?
    let onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var saving = false
    @State private var errorMessage: String?

    @State private var travelerPosition = ""
    @State private var label = "Saudi Arabia eSIM"
    @State private var provider = "esim_access"
    @State private var providerEsimID = ""
    @State private var iccid = ""
    @State private var planName = ""
    @State private var countryCode = "SA"
    @State private var smdpAddress = ""
    @State private var activationCode = ""
    @State private var lpaString = ""
    @State private var qrCodeURL = ""

    var body: some View {
        Form {
            Section("Профиль") {
                TextField("Название · Saudi Arabia 10 GB", text: $planName)
                TextField("Метка", text: $label)
                TextField("Номер путешественника · необязательно", text: $travelerPosition)
                    .keyboardType(.numberPad)
                TextField("ICCID", text: $iccid)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Provider eSIM ID / esimTranNo", text: $providerEsimID)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Provider · esim_access", text: $provider)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Country code · SA", text: $countryCode)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
            }

            Section("Активация") {
                TextField("LPA:1$...", text: $lpaString, axis: .vertical)
                    .lineLimit(2...4)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("SM-DP+ Address", text: $smdpAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Activation Code", text: $activationCode)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("QR URL · необязательно", text: $qrCodeURL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Text("Можно вставить только полный LPA-код. Сервер автоматически извлечёт SM-DP+ и Activation Code.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Автоматическая синхронизация") {
                Label("Остаток трафика, использованные MB, статус eSIM и срок действия вводить не нужно.", systemImage: "arrow.triangle.2.circlepath")
                    .font(.subheadline)
                Text("После сохранения backend запросит профиль eSIM Access по ICCID. Клиентское приложение также автоматически обновляет эти данные при открытии eSIM и во время просмотра страницы.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle(profile == nil ? "Добавить eSIM" : "Изменить eSIM")
        .navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Отмена") { dismiss() }.foregroundStyle(BusinessDesign.headerInk)
            }
            ToolbarItem(placement: .confirmationAction) {
                if saving { ProgressView().controlSize(.small) }
                else { Button("Сохранить") { Task { await save() } }.fontWeight(.semibold) }
            }
        }
        .onAppear { loadProfile() }
        .alert("Не удалось сохранить eSIM", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK") { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func loadProfile() {
        guard let profile else { return }
        travelerPosition = profile.travelerPosition.map(String.init) ?? ""
        label = profile.label
        provider = profile.provider
        providerEsimID = profile.providerEsimID ?? ""
        iccid = profile.iccid
        planName = profile.planName
        countryCode = profile.countryCode
        smdpAddress = profile.smdpAddress
        activationCode = profile.activationCode
        lpaString = profile.lpaString
        qrCodeURL = profile.qrCodeURL ?? ""
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let payload = BookingESIMUpsertPayload(
            travelerPosition: Int(travelerPosition),
            label: label.trimmingCharacters(in: .whitespacesAndNewlines),
            provider: provider,
            providerEsimID: providerEsimID.nilIfEmpty,
            iccid: iccid.trimmingCharacters(in: .whitespacesAndNewlines),
            planName: planName.trimmingCharacters(in: .whitespacesAndNewlines),
            countryCode: countryCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(),
            smdpAddress: smdpAddress.trimmingCharacters(in: .whitespacesAndNewlines),
            activationCode: activationCode.trimmingCharacters(in: .whitespacesAndNewlines),
            lpaString: lpaString.trimmingCharacters(in: .whitespacesAndNewlines),
            qrCodeURL: qrCodeURL.nilIfEmpty
        )
        do {
            _ = try await APIClient.shared.saveBookingESIM(bookingID: bookingID, esimID: profile?.id, payload: payload)
            onSaved()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

}

private extension String {
    var nilIfEmpty: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}
