import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import UIKit

struct PaymentsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.businessUsesPersistentSidebar) private var usesPersistentSidebar
    @Environment(\.businessAdaptiveLayout) private var layout
    @State private var templates: [BusinessPaymentTemplate] = []
    @State private var loading = true
    @State private var errorMessage: String?
    @State private var showAdd = false

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Payments")
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .tracking(-1)
                    Text("Сохранённые реквизиты iumrah Business. Выберите шаблон в бронировании — Visa, Humo, PayMe QR и инструкция вставятся в платёжку клиента.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.bottom, 4)

                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                }

                if loading {
                    HStack { Spacer(); ProgressView(); Spacer() }
                        .padding(.vertical, 30)
                } else if templates.isEmpty {
                    ContentUnavailableView(
                        "Реквизитов пока нет",
                        systemImage: "creditcard.and.123",
                        description: Text("Добавьте первый шаблон. После этого его можно будет вставлять в любую новую бронь одним нажатием.")
                    )
                    .padding(.vertical, 34)
                } else if layout.supportsDenseDashboard {
                    LazyVGrid(columns: layout.cardGridColumns, spacing: 14) {
                        ForEach(templates) { template in
                            templateLink(template)
                        }
                    }
                } else {
                    ForEach(templates) { template in
                        templateLink(template)
                    }
                }
            }
            .businessAdaptiveReadableWidth()
            .padding(.horizontal, 18)
            .padding(.vertical, 18)
        }
        .scrollIndicators(.hidden)
        .background(BusinessDesign.background)
        .navigationTitle("Платежи")
        .navigationBarTitleDisplayMode(.inline)
        .businessNavigationSurface()
        .toolbar {
            if !usesPersistentSidebar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Закрыть") { dismiss() }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showAdd = true } label: { Image(systemName: "plus") }
            }
        }
        .sheet(isPresented: $showAdd) {
            NavigationStack {
                PaymentTemplateEditorView(template: .empty, creating: true) { created in
                    templates.append(created)
                    showAdd = false
                }
            }
        }
        .task { await load() }
        .refreshable { await load() }
    }


    private func templateLink(_ template: BusinessPaymentTemplate) -> some View {
        NavigationLink {
            PaymentTemplateEditorView(template: template) { updated in
                if let index = templates.firstIndex(where: { $0.id == updated.id }) {
                    templates[index] = updated
                }
            }
        } label: {
            templateCard(template)
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Удалить", role: .destructive) {
                Task { await delete(template) }
            }
        }
    }

    private func templateCard(_ template: BusinessPaymentTemplate) -> some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(BusinessDesign.primaryControl)
                    .frame(width: 58, height: 58)
                Image(systemName: template.hasPaymeQR ? "qrcode" : "creditcard.fill")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(BusinessDesign.onPrimaryControl)
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(template.name)
                    .font(.headline)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Text(methodSummary(template))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right")
                .font(.caption.bold())
                .foregroundStyle(.tertiary)
        }
        .padding(15)
        .businessCard(radius: 24)
    }

    private func methodSummary(_ template: BusinessPaymentTemplate) -> String {
        var values: [String] = []
        if !template.visaCardNumber.isEmpty { values.append("Visa") }
        if template.hasPaymeQR { values.append("PayMe QR") }
        if !template.humoCardNumber.isEmpty { values.append("Humo") }
        if values.isEmpty && !template.instructions.isEmpty { values.append("Инструкция") }
        return values.isEmpty ? "Пустой шаблон" : values.joined(separator: " · ")
    }

    @MainActor private func load() async {
        loading = true
        do {
            templates = try await APIClient.shared.paymentTemplates()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }

    @MainActor private func delete(_ template: BusinessPaymentTemplate) async {
        do {
            try await APIClient.shared.deletePaymentTemplate(id: template.id)
            templates.removeAll { $0.id == template.id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct PaymentTemplateEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @State var template: BusinessPaymentTemplate
    var creating = false
    let onSaved: (BusinessPaymentTemplate) -> Void

    @State private var selectedQR: PhotosPickerItem?
    @State private var pendingQRData: Data?
    @State private var saving = false
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                section("Шаблон", icon: "bookmark.fill") {
                    field("Название", text: $template.name, icon: "textformat")
                    Text("Например: Основная карта · UZ или PayMe Aziz")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                section("Visa", icon: "creditcard") {
                    field("Номер карты", text: $template.visaCardNumber, icon: "creditcard")
                    field("Получатель", text: $template.visaHolder, icon: "person")
                }

                section("PayMe QR", icon: "qrcode") {
                    if let pendingQRData, let image = UIImage(data: pendingQRData) {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: .infinity)
                            .frame(height: 190)
                            .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    } else if template.hasPaymeQR, let path = template.paymeQRURL {
                        BusinessPrivateImage(path: path, contentMode: .fit) {
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(BusinessDesign.secondarySurface)
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 190)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }

                    PhotosPicker(selection: $selectedQR, matching: .images) {
                        Label(template.hasPaymeQR || pendingQRData != nil ? "Заменить QR" : "Добавить QR", systemImage: "photo")
                            .font(.subheadline.bold())
                            .frame(maxWidth: .infinity)
                            .frame(height: 48)
                            .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    .buttonStyle(.plain)

                    if template.hasPaymeQR && !creating && pendingQRData == nil {
                        Button(role: .destructive) {
                            Task { await removeQR() }
                        } label: {
                            Label("Удалить QR", systemImage: "trash")
                                .font(.subheadline.bold())
                        }
                    }
                }

                section("Humo", icon: "creditcard.fill") {
                    field("Номер карты", text: $template.humoCardNumber, icon: "creditcard")
                    field("Получатель", text: $template.humoHolder, icon: "person")
                }

                section("Инструкция паломнику", icon: "text.alignleft") {
                    TextField("Например: после оплаты прикрепите чек в приложении", text: $template.instructions, axis: .vertical)
                        .lineLimit(3...7)
                        .padding(14)
                        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }

                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.red)
                }

                Button { Task { await save() } } label: {
                    HStack(spacing: 9) {
                        if saving { ProgressView().tint(BusinessDesign.onPrimaryControl) }
                        Image(systemName: "checkmark")
                        Text(saving ? "Сохраняем…" : "Сохранить шаблон")
                    }
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                }
                .buttonStyle(.plain)
                .foregroundStyle(BusinessDesign.onPrimaryControl)
                .background(BusinessDesign.primaryControl, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .disabled(saving)
            }
            .businessAdaptiveFormWidth()
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
        }
        .scrollIndicators(.hidden)
        .background(BusinessDesign.background)
        .navigationTitle(creating ? "Новые реквизиты" : "Реквизиты")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if creating {
                ToolbarItem(placement: .topBarLeading) { Button("Отмена") { dismiss() } }
            }
        }
        .onChange(of: selectedQR) { _, item in
            guard let item else { return }
            Task { await prepareQR(item) }
        }
    }

    private func section<Content: View>(_ title: String, icon: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: icon)
                .font(.title3.bold())
            content()
        }
        .padding(16)
        .businessCard(radius: 26)
    }

    private func field(_ title: String, text: Binding<String>, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            HStack(spacing: 10) {
                Image(systemName: icon).foregroundStyle(.secondary)
                TextField(title, text: text)
                    .textInputAutocapitalization(.never)
            }
            .padding(.horizontal, 13)
            .frame(height: 48)
            .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    @MainActor private func prepareQR(_ item: PhotosPickerItem) async {
        do {
            pendingQRData = try await item.loadTransferable(type: Data.self)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor private func save() async {
        let name = template.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { errorMessage = "Введите название шаблона."; return }
        let hasDetails = !template.visaCardNumber.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !template.humoCardNumber.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !template.instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || template.hasPaymeQR || pendingQRData != nil
        guard hasDetails else { errorMessage = "Добавьте хотя бы один способ оплаты или инструкцию."; return }

        saving = true
        errorMessage = nil
        do {
            template.name = name
            var saved: BusinessPaymentTemplate
            if template.id == "new" {
                saved = try await APIClient.shared.createPaymentTemplate(template)
                // Keep the newly-created ID even if the following QR upload fails, so a
                // retry updates this template instead of creating duplicates.
                template = saved
            } else {
                saved = try await APIClient.shared.updatePaymentTemplate(template)
                template = saved
            }
            if let pendingQRData {
                saved = try await APIClient.shared.uploadPaymentTemplateQR(templateID: saved.id, data: pendingQRData)
                self.pendingQRData = nil
                template = saved
            }
            onSaved(saved)
            if creating { dismiss() }
        } catch {
            errorMessage = error.localizedDescription
        }
        saving = false
    }

    @MainActor private func removeQR() async {
        guard !creating else { pendingQRData = nil; return }
        saving = true
        do {
            template = try await APIClient.shared.deletePaymentTemplateQR(templateID: template.id)
            onSaved(template)
        } catch {
            errorMessage = error.localizedDescription
        }
        saving = false
    }
}
