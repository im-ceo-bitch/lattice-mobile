import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import UIKit
import QuickLook

struct BookingCheckoutAdminCard: View {
    let bookingID: String
    let status: TripStatus
    let checkout: BusinessCheckout?
    var financesOnly = false
    let onReload: () -> Void

    @State private var visaCard = ""
    @State private var visaHolder = ""
    @State private var humoCard = ""
    @State private var humoHolder = ""
    @State private var instructions = ""
    @State private var paymePhoto: PhotosPickerItem?
    @State private var saving = false
    @State private var error: String?
    @State private var showDocumentImporter = false
    @State private var documentKind = "visa"
    @State private var documentTitle = ""
    @State private var documentReference = ""
    @State private var documentSlots: Set<String> = []
    @State private var replaceDocument: BusinessTravelDocument?
    @State private var stagedDocument: BusinessDocumentPreview?
    @State private var documentPreview: BusinessDocumentPreview?
    @State private var showDocumentHistory = false
    private var canPublish: Bool { [.bookingConfirmed, .readyToTravel, .inTrip].contains(status) }
    @State private var reviewReceipt: BusinessPaymentReceipt?
    @State private var reviewAmount = ""
    @State private var reviewReason = ""
    @State private var reviewDecision = "approved"
    @State private var editingDocument: BusinessTravelDocument?
    @State private var editingSlots: Set<String> = []
    @State private var imagePreview: BusinessImagePreview?
    @State private var previewLoadingID: String?
    @State private var paymentTemplates: [BusinessPaymentTemplate] = []
    @State private var loadingPaymentTemplates = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: financesOnly ? "creditcard.and.123" : "doc.on.doc")
                    .font(.system(size: 20, weight: .semibold))
                    .frame(width: 44, height: 44)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(financesOnly ? "Оплата и чеки" : "Анкеты и документы")
                        .font(.title3.bold())
                    Text(financesOnly ? "Реквизиты и фактические поступления." : "Данные паломников и готовность документов.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }

            if let checkout {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) {
                        readinessPill(title: "Iumrah ID \(checkout.iumrahID)", ready: true, icon: "person.crop.circle.badge.checkmark")
                        readinessPill(title: "Анкеты \(checkout.travelers.filter(\.completed).count)/\(checkout.travelers.count)", ready: checkout.allTravelersComplete, icon: "person.text.rectangle")
                        readinessPill(title: "Оплата", ready: (checkout.paymentReview?.satisfied == true || checkout.paymentReview?.historicalConfirmed == true), icon: "doc.text.image")
                    }
                    VStack(spacing: 8) {
                        HStack(spacing: 8) {
                            readinessPill(title: "Iumrah ID \(checkout.iumrahID)", ready: true, icon: "person.crop.circle.badge.checkmark")
                            readinessPill(title: "Анкеты \(checkout.travelers.filter(\.completed).count)/\(checkout.travelers.count)", ready: checkout.allTravelersComplete, icon: "person.text.rectangle")
                        }
                        readinessPill(title: "Оплата", ready: (checkout.paymentReview?.satisfied == true || checkout.paymentReview?.historicalConfirmed == true), icon: "doc.text.image")
                    }
                }

                if financesOnly {
                if let rewards = checkout.rewards, rewards.totalUsd > 0 {
                    VStack(alignment: .leading, spacing: 8) {
                        LabeledContent("Стоимость пакета", value: String(format: "$%.2f", rewards.totalUsd))
                        if rewards.totalDiscountUsd > 0 {
                            LabeledContent("Бонусы и Gift Cards", value: String(format: "−$%.2f", rewards.totalDiscountUsd))
                        }
                        Divider()
                        LabeledContent("К оплате", value: String(format: "$%.2f", rewards.payableUsd)).font(.headline)
                    }
                    .padding(14)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16))
                }
                if let review = checkout.paymentReview {
                    if review.historicalConfirmed == true {
                        Text("Оплата подтверждена ранее. Сумма не детализирована в новой системе.").font(.caption).foregroundStyle(.secondary)
                    } else {
                    LabeledContent("Подтверждено", value: String(format: "$%.2f", Double(review.paidCents)/100))
                    if let due = review.dueCents {
                        LabeledContent("Остаток к оплате", value: String(format: "$%.2f", Double(max(0, due-review.paidCents))/100))
                    }
                    }
                }

                if status == .availabilityCheck || status == .paymentPending {
                    paymentEditor(checkout)
                } else {
                    paymentSummary(checkout)
                }

                if !checkout.receipts.isEmpty {
                    Divider()
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Чеки оплаты").font(.headline)
                        ForEach(checkout.receipts) { receipt in
                            Button {
                                Task { await openPrivateImage(path: receipt.mediaURL, id: "receipt-\(receipt.id)", title: "Чек · \(paymentMethod(receipt.paymentMethod))") }
                            } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: "doc.text.image.fill")
                                        .frame(width: 38, height: 38)
                                        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 12))
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(paymentMethod(receipt.paymentMethod)).font(.subheadline.bold()).foregroundStyle(.primary)
                                        Text(receipt.reviewStatus == "approved" ? "Проверен" : receipt.reviewStatus == "rejected" ? "Отклонён" : "Ожидает проверки")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if previewLoadingID == "receipt-\(receipt.id)" { ProgressView() }
                                    else { Image(systemName: "arrow.up.right").font(.caption.bold()).foregroundStyle(.tertiary) }
                                }
                                .padding(11)
                                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            }
                            .buttonStyle(.plain)
                            if let amount = receipt.amountUsd, receipt.reviewStatus == "approved" { Text(String(format: "$%.2f · подтверждено", amount)).font(.caption) }
                            if let reason = receipt.reviewReason, !reason.isEmpty { Text(reason).font(.caption).foregroundStyle(.secondary) }
                            if receipt.reviewStatus == "submitted" && status == .paymentPending {
                                Button("Проверить поступление") {
                                    reviewAmount = ""; reviewReason = ""; reviewDecision = "approved"; reviewReceipt = receipt
                                }
                                .buttonStyle(BusinessActionStyle(primary: false))
                                .disabled(saving)
                            }
                        }
                    }
                }

                } else {
                    travelerSummary(checkout)
                    Divider()
                    documentsSection(checkout)
                }
            } else {
                Text("Checkout появится после синхронизации поездки.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }

            if let error {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding(18)
        .businessCard(radius: 28)
        .onAppear { loadDraft() }
        .task { if financesOnly { await loadPaymentTemplates() } }
        .onChange(of: checkout?.payment) { _, _ in loadDraft() }
        .onChange(of: paymePhoto) { _, item in
            guard let item else { return }
            Task { await uploadQR(item) }
        }
        .sheet(item: $imagePreview) { preview in
            NavigationStack {
                ScrollView([.horizontal, .vertical]) {
                    Image(uiImage: preview.image)
                        .resizable()
                        .scaledToFit()
                        .padding(16)
                }
                .background(Color.black.opacity(0.96))
                .navigationTitle(preview.title)
                .navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { imagePreview = nil }.foregroundStyle(BusinessDesign.headerInk) } }
            }
        }
        .sheet(item: $reviewReceipt) { receipt in
            NavigationStack {
                Form {
                    Picker("Решение", selection: $reviewDecision) {
                        Text("Подтвердить поступление").tag("approved")
                        Text("Отклонить чек").tag("rejected")
                    }
                    if reviewDecision == "approved" {
                        TextField("Фактически получено, USD", text: $reviewAmount).keyboardType(.decimalPad)
                        Text("Укажите эквивалент поступления в USD. Не подтверждайте чек, пока деньги не поступили.").font(.caption)
                    }
                    TextField(reviewDecision == "rejected" ? "Причина отклонения" : "Примечание", text: $reviewReason, axis: .vertical)
                    Button(reviewDecision == "approved" ? "Подтвердить оплату" : "Отклонить чек") {
                        Task { await submitReview(receipt) }
                    }.disabled(saving || (reviewDecision == "approved" ? (Double(reviewAmount.replacingOccurrences(of: ",", with: ".")) ?? 0) <= 0 : reviewReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                    if let error { Text(error).foregroundStyle(.red) }
                }
                .navigationTitle("Проверка оплаты").navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Закрыть") { reviewReceipt = nil }.foregroundStyle(BusinessDesign.headerInk) } }
            }
        }
        .sheet(item: $editingDocument) { doc in
            NavigationStack {
                Form {
                    Section("Привязка документа") {
                        ForEach((checkout?.documentRequirements ?? []).filter { $0.kind == doc.documentKind }) { item in
                            Toggle(item.label, isOn: Binding(get: { editingSlots.contains(item.key) }, set: { enabled in if enabled { editingSlots.insert(item.key) } else { editingSlots.remove(item.key) } }))
                        }
                    }
                    Button("Опубликовать с выбранными позициями") { Task { await setPublication(doc, state: "published", slots: Array(editingSlots)) } }.disabled(saving)
                    Button("Отозвать у клиента", role: .destructive) { Task { await setPublication(doc, state: "revoked", slots: Array(editingSlots)) } }.disabled(saving)
                    if let error { Text(error).foregroundStyle(.red) }
                }
                .navigationTitle(doc.title).navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Закрыть") { editingDocument = nil }.foregroundStyle(BusinessDesign.headerInk) } }
            }
        }
        .sheet(item: $documentPreview, onDismiss: { BusinessDocumentPreview.cleanup() }) { file in
            NavigationStack {
                BusinessDocumentQuickLook(url: file.url)
                    .navigationTitle(file.title).navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { documentPreview = nil }.foregroundStyle(BusinessDesign.headerInk) } }
            }
        }
        .sheet(item: $stagedDocument, onDismiss: { BusinessDocumentPreview.cleanup() }) { file in
            NavigationStack {
                VStack(spacing: 12) {
                    BusinessDocumentQuickLook(url: file.url)
                    VStack(alignment: .leading, spacing: 8) {
                        Text(file.title).font(.headline)
                        TextField("Название для клиента", text: $documentTitle).textFieldStyle(.roundedBorder)
                        TextField(documentReferenceTitle, text: $documentReference).textFieldStyle(.roundedBorder)
                        if let items = checkout?.documentRequirements {
                            DisclosureGroup("Позиции файла · \(documentSlots.count)") {
                                ForEach(items.filter { $0.kind == documentKind }) { item in
                                    Toggle(item.label, isOn: Binding(get: { documentSlots.contains(item.key) }, set: { enabled in if enabled { documentSlots.insert(item.key) } else { documentSlots.remove(item.key) } })).font(.caption).disabled((replaceDocument?.slots ?? []).contains(item.key) || saving)
                                }
                            }.font(.subheadline)
                        }
                        Text(replaceDocument == nil ? "После публикации клиент получит этот файл." : "Новый файл заменит прежний. Прежний останется в истории менеджера.").font(.caption).foregroundStyle(.secondary)
                        if let error { Text(error).font(.caption).foregroundStyle(.red) }
                        Button(saving ? "Публикуем…" : replaceDocument == nil ? "Опубликовать документ" : "Опубликовать замену") { Task { await uploadDocument(file.url) } }
                            .buttonStyle(BusinessActionStyle(primary: true)).disabled(saving || ((checkout?.documentRequirements ?? []).contains { $0.kind == documentKind } && documentSlots.isEmpty))
                    }.padding(16)
                }.navigationTitle("Проверка файла").navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
                    .interactiveDismissDisabled(saving)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { stagedDocument = nil }.foregroundStyle(BusinessDesign.headerInk).disabled(saving) } }
            }
        }
        .fileImporter(
            isPresented: $showDocumentImporter,
            allowedContentTypes: [.pdf, .jpeg, .png],
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls): if let url = urls.first { stageDocument(url) }
            case .failure(let failure): error = failure.localizedDescription
            }
        }
    }

    private func travelerSummary(_ checkout: BusinessCheckout) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Паломники")
                .font(.headline)

            ForEach(checkout.travelers) { traveler in
                VStack(alignment: .leading, spacing: 11) {
                    HStack(alignment: .center, spacing: 12) {
                        Image(systemName: traveler.completed ? "checkmark.circle.fill" : "person.crop.circle.badge.exclamationmark")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(traveler.completed ? .green : .secondary)
                            .frame(width: 40, height: 40)
                            .background(BusinessDesign.tertiarySurface, in: RoundedRectangle(cornerRadius: 13, style: .continuous))

                        VStack(alignment: .leading, spacing: 3) {
                            let fullName = [traveler.firstName, traveler.middleName, traveler.lastName]
                                .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
                                .joined(separator: " ")
                            Text(fullName.isEmpty ? "Паломник \(traveler.position)" : fullName)
                                .font(.subheadline.bold())
                                .lineLimit(2)

                            Text("\(relationshipTitle(traveler.relationship, position: traveler.position)) · \(travelerTypeTitle(traveler.travelerType))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Spacer(minLength: 8)

                        if let path = traveler.passportMediaURL {
                            Button {
                                Task {
                                    await openPrivateImage(
                                        path: path,
                                        id: "passport-\(traveler.position)",
                                        title: "Паспорт · \(traveler.position)"
                                    )
                                }
                            } label: {
                                Group {
                                    if previewLoadingID == "passport-\(traveler.position)" {
                                        ProgressView()
                                    } else {
                                        Image(systemName: "passport.fill")
                                            .font(.system(size: 15, weight: .semibold))
                                    }
                                }
                                .frame(width: 40, height: 40)
                                .background(BusinessDesign.tertiarySurface, in: Circle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Открыть паспорт паломника \(traveler.position)")
                        }
                    }

                    HStack(spacing: 6) {
                        Image(systemName: traveler.completed ? "checkmark.seal.fill" : "clock.fill")
                            .foregroundStyle(traveler.completed ? .green : .secondary)
                        Text(traveler.completed ? "Анкета заполнена" : "Ожидает данные и паспорт")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(traveler.completed ? .primary : .secondary)
                    }

                    if traveler.completed {
                        Divider().opacity(0.55)

                        VStack(spacing: 8) {
                            travelerDetailRow("Дата рождения", value: traveler.dateOfBirth)
                            travelerDetailRow("Гражданство", value: traveler.nationality)
                            travelerDetailRow("Паспорт", value: traveler.passportNumber)
                            travelerDetailRow("Действует до", value: traveler.passportExpiryDate)
                            travelerDetailRow("Страна выдачи", value: traveler.passportIssuingCountry)
                        }
                    }
                }
                .padding(13)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
        }
    }

    private func travelerDetailRow(_ title: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer(minLength: 12)
            Text(value.isEmpty ? "—" : value)
                .font(.caption.weight(.semibold))
                .multilineTextAlignment(.trailing)
                .lineLimit(2)
        }
    }

    private func travelerTypeTitle(_ raw: String) -> String {
        switch raw.lowercased() {
        case "child": return "ребёнок"
        case "infant": return "младенец"
        default: return "взрослый"
        }
    }

    private func relationshipTitle(_ raw: String?, position: Int) -> String {
        switch raw?.lowercased() {
        case "self": return "сам клиент"
        case "spouse": return "муж или жена"
        case "mother": return "мама"
        case "father": return "папа"
        case "brother": return "брат"
        case "sister": return "сестра"
        case "child": return "ребёнок"
        case "relative": return "родственник"
        case "friend": return "друг"
        default: return position == 1 ? "сам клиент" : "участник поездки"
        }
    }

    @ViewBuilder
    private func paymentEditor(_ checkout: BusinessCheckout) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Реквизиты для клиента").font(.headline)
            if status == .availabilityCheck {
                Label("Сначала сохраните хотя бы один способ оплаты. После этого можно перевести поездку в «Оплата и данные».", systemImage: "info.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(12)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            }

            if !paymentTemplates.isEmpty {
                Menu {
                    ForEach(paymentTemplates) { template in
                        Button {
                            Task { await applyPaymentTemplate(template) }
                        } label: {
                            Label(template.name, systemImage: template.hasPaymeQR ? "qrcode" : "creditcard")
                        }
                    }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "rectangle.stack.fill")
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Вставить сохранённые реквизиты")
                                .font(.subheadline.bold())
                            Text("Payments · \(paymentTemplates.count) шаблонов")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.down")
                            .font(.caption.bold())
                            .foregroundStyle(.secondary)
                    }
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 14)
                    .frame(height: 56)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(.plain)
            } else if loadingPaymentTemplates {
                HStack(spacing: 9) {
                    ProgressView().controlSize(.small)
                    Text("Загружаем Payments…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            paymentField(title: "Visa · номер карты", text: $visaCard, icon: "creditcard")
            paymentField(title: "Visa · получатель", text: $visaHolder, icon: "person")

            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("PayMe QR").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    PhotosPicker(selection: $paymePhoto, matching: .images) {
                        HStack {
                            Image(systemName: checkout.payment.hasPaymeQR ? "checkmark.circle.fill" : "qrcode.viewfinder")
                            Text(checkout.payment.hasPaymeQR ? "QR загружен · заменить" : "Загрузить QR")
                            Spacer()
                        }
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 14)
                        .frame(height: 48)
                        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }

            paymentField(title: "Humo · номер карты", text: $humoCard, icon: "creditcard")
            paymentField(title: "Humo · получатель", text: $humoHolder, icon: "person")

            VStack(alignment: .leading, spacing: 7) {
                Text("Инструкция паломнику").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                TextField("Например: после оплаты прикрепите чек ниже", text: $instructions, axis: .vertical)
                    .lineLimit(2...5)
                    .padding(13)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }

            Button {
                Task { await savePayment() }
            } label: {
                HStack {
                    if saving { ProgressView().tint(BusinessDesign.onPrimaryControl) }
                    Image(systemName: "checkmark")
                    Text("Сохранить реквизиты")
                    Spacer()
                }
                .font(.headline)
                .foregroundStyle(BusinessDesign.onPrimaryControl)
                .padding(.horizontal, 16)
                .frame(height: 52)
                .background(BusinessDesign.primaryControl, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(saving)
        }
    }

    private func paymentSummary(_ checkout: BusinessCheckout) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Реквизиты").font(.headline)
            compactRow("Visa", checkout.payment.visaCardNumber)
            compactRow("PayMe", checkout.payment.hasPaymeQR ? "QR загружен" : "—")
            compactRow("Humo", checkout.payment.humoCardNumber)
        }
    }

    private func documentsSection(_ checkout: BusinessCheckout) -> some View {
        let items = checkout.documentRequirements ?? []
        let ready = items.filter(\.ready).count
        let published = checkout.documents.filter { $0.publicationStatus != "revoked" }
        let archived = checkout.documents.filter { $0.publicationStatus == "revoked" }
        let selected = items.filter { $0.kind == documentKind }
        return VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                HStack { Label("Центр документов", systemImage: "folder.fill").font(.headline); Spacer(); if !items.isEmpty { Text("\(ready)/\(items.count)").font(.title2.bold().monospacedDigit()) } }
                if !items.isEmpty { ProgressView(value: Double(ready), total: Double(items.count)).tint(BusinessDesign.securityBlue) }
                Text(items.isEmpty ? "Обязательные позиции пока не определены." : ready == items.count ? "Все обязательные документы опубликованы. Остальные условия готовности проверяются отдельно." : "Осталось подготовить: \(items.count-ready). Общий PDF может покрывать несколько позиций.").font(.caption).foregroundStyle(.white.opacity(0.75))
            }.foregroundStyle(.white).padding(16).frame(maxWidth: .infinity, alignment: .leading).background(Color.black, in: RoundedRectangle(cornerRadius: 18))
            requirementGroup("Перелёты", kind: "ticket", icon: "airplane", items: items, documents: published)
            requirementGroup("Отели", kind: "voucher", icon: "building.2", items: items, documents: published)
            requirementGroup("Визы", kind: "visa", icon: "checkmark.seal", items: items, documents: published)
            requirementGroup("Страховки", kind: "insurance", icon: "cross.case", items: items, documents: published)
            let other = published.filter { !["ticket", "voucher", "visa", "insurance"].contains($0.documentKind) }
            if !other.isEmpty { Text("Другие документы").font(.headline); ForEach(other) { document in documentRow(document, requirements: items) } }
            if !archived.isEmpty {
                DisclosureGroup("Отозванные документы · \(archived.count)", isExpanded: $showDocumentHistory) {
                    ForEach(archived) { document in documentRow(document, requirements: items) }
                }.font(.subheadline.weight(.semibold))
            }
            if canPublish {
                Divider()
                HStack {
                    Text(replaceDocument == nil ? "Публикация документа" : "Замена документа").font(.headline)
                    Spacer()
                    if replaceDocument != nil { Button("Отменить замену") { resetDocumentDraft() }.font(.caption) }
                }
                if let replaceDocument { Text("Заменяем: \(replaceDocument.title)").font(.caption).foregroundStyle(.secondary) }
                Picker("Тип документа", selection: Binding(get: { documentKind }, set: { kind in documentKind = kind; documentSlots = []; documentTitle = ""; documentReference = "" })) {
                    Text("Авиабилет").tag("ticket"); Text("Ваучер отеля").tag("voucher"); Text("Виза").tag("visa"); Text("Страховка").tag("insurance"); Text("Другое").tag("other")
                }.pickerStyle(.menu).disabled(replaceDocument != nil || saving)
                if !selected.isEmpty {
                    Text("Позиции, которые покрывает файл").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(selected) { item in
                        Toggle(item.label, isOn: Binding(get: { documentSlots.contains(item.key) }, set: { enabled in if enabled { documentSlots.insert(item.key) } else { documentSlots.remove(item.key) } }))
                            .font(.subheadline).disabled((replaceDocument?.slots ?? []).contains(item.key) || saving)
                    }
                }
                paymentField(title: "Название для клиента", text: $documentTitle, icon: "text.alignleft")
                paymentField(title: documentReferenceTitle, text: $documentReference, icon: "number")
                Button { showDocumentImporter = true } label: {
                    Label("Выбрать и проверить PDF или фото", systemImage: "doc.badge.plus")
                        .font(.headline).foregroundStyle(BusinessDesign.onPrimaryControl).frame(maxWidth: .infinity).frame(minHeight: 52)
                        .background(BusinessDesign.primaryControl, in: RoundedRectangle(cornerRadius: 16))
                }.buttonStyle(.plain).disabled(saving || (!selected.isEmpty && documentSlots.isEmpty))
                if !selected.isEmpty && documentSlots.isEmpty { Text("Сначала выберите хотя бы одну позицию.").font(.caption).foregroundStyle(.secondary) }
            }
        }
    }

    @ViewBuilder private func requirementGroup(_ title: String, kind: String, icon: String, items: [BusinessDocumentRequirement], documents: [BusinessTravelDocument]) -> some View {
        let slots = items.filter { $0.kind == kind }
        let files = documents.filter { $0.documentKind == kind }
        if !slots.isEmpty || !files.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack { Label(title, systemImage: icon).font(.headline); Spacer(); if !slots.isEmpty { Text("\(slots.filter(\.ready).count)/\(slots.count)").font(.caption.monospacedDigit()).foregroundStyle(.secondary) } }
                ForEach(slots) { item in
                    HStack {
                        Image(systemName: item.ready ? "checkmark.circle.fill" : "clock").foregroundStyle(item.ready ? Color.green : Color.secondary)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.label).font(.subheadline)
                            Text(requirementStateTitle(item)).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if !item.ready && canPublish {
                            Menu {
                                Button("Ожидается") { Task { await updateRequirement(item, state: "pending") } }
                                Button("На оформлении") { Task { await updateRequirement(item, state: "preparing") } }
                                Button("Требует исправления") { Task { await updateRequirement(item, state: "needs_correction") } }
                            } label: { Image(systemName: "ellipsis.circle").font(.title3).foregroundStyle(BusinessDesign.ink).frame(width: 44, height: 44) }.disabled(saving)
                            Button { prepareSlot(item); showDocumentImporter = true } label: { Image(systemName: "plus.circle.fill").font(.title2).foregroundStyle(BusinessDesign.ink).frame(width: 44, height: 44) }
                                .buttonStyle(.plain).disabled(saving).accessibilityLabel("Загрузить: \(item.label)")
                        }
                    }
                }
                ForEach(files) { doc in documentRow(doc, requirements: items) }
            }.padding(12).background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16))
        }
    }

    private func documentRow(_ document: BusinessTravelDocument, requirements: [BusinessDocumentRequirement]) -> some View {
        let revoked = document.publicationStatus == "revoked"
        let assigned = requirements.filter { (document.slots ?? []).contains($0.key) }
        return HStack(alignment: .center, spacing: 10) {
            Button { Task { await openTravelDocument(document) } } label: {
                HStack(alignment: .center, spacing: 10) {
                    Image(systemName: document.contentType == "application/pdf" ? "doc.richtext.fill" : "photo.fill").foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(document.title).font(.subheadline.bold()).foregroundStyle(.primary)
                        Text(revoked ? "Отозван" : assigned.isEmpty ? "Опубликован · без привязки" : "Опубликован").font(.caption).foregroundStyle(revoked ? Color.red : Color.secondary)
                        ForEach(assigned) { item in Text(item.label).font(.caption2).foregroundStyle(.secondary) }
                        if let reference = document.bookingReference, !reference.isEmpty { Text(reference).font(.caption.monospaced()).foregroundStyle(.secondary) }
                    }
                    Spacer()
                    if previewLoadingID == document.id { ProgressView() } else { Image(systemName: "arrow.up.right").font(.caption).foregroundStyle(.secondary) }
                }
            }.buttonStyle(.plain).disabled(previewLoadingID != nil || saving)
            if canPublish {
                Menu {
                    Button("Изменить привязку / публикацию") { editingSlots = Set(document.slots ?? []); editingDocument = document }
                    if !revoked { Button("Заменить документ") { prepareReplacement(document); showDocumentImporter = true } }
                } label: { Image(systemName: "ellipsis.circle").font(.title2).foregroundStyle(BusinessDesign.ink).frame(width: 44, height: 44) }.disabled(saving)
            }
        }.padding(10).background(BusinessDesign.tertiarySurface, in: RoundedRectangle(cornerRadius: 12))
    }

    private func requirementStateTitle(_ item: BusinessDocumentRequirement) -> String {
        if item.ready { return "Опубликован" }
        switch item.state { case "preparing": return "На оформлении"; case "needs_correction": return "Требует исправления"; default: return "Ожидается" }
    }
    @MainActor private func updateRequirement(_ item: BusinessDocumentRequirement, state: String) async {
        saving = true; error = nil; defer { saving = false }
        do { try await APIClient.shared.updateDocumentRequirement(bookingID: bookingID, key: item.key, state: state); onReload() }
        catch { self.error = error.localizedDescription }
    }

    private func prepareSlot(_ item: BusinessDocumentRequirement) {
        resetDocumentDraft(); documentKind = item.kind; documentSlots = [item.key]; documentTitle = item.label
    }
    private func prepareReplacement(_ document: BusinessTravelDocument) {
        replaceDocument = document; documentKind = document.documentKind; documentSlots = Set(document.slots ?? []); documentTitle = document.title; documentReference = document.bookingReference ?? ""
    }
    private func resetDocumentDraft() { replaceDocument = nil; documentSlots = []; documentTitle = ""; documentReference = "" }

    private var documentReferenceTitle: String {
        switch documentKind {
        case "ticket": return "PNR / номер бронирования авиабилета"
        case "voucher": return "Номер бронирования отеля"
        case "visa": return "Номер визы (если уже известен)"
        case "insurance": return "Номер полиса"
        default: return "Номер документа (необязательно)"
        }
    }

    private func readinessPill(title: String, ready: Bool, icon: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: ready ? "checkmark.circle.fill" : icon)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(ready ? .green : .secondary)
            Text(title).font(.caption2.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func paymentField(title: String, text: Binding<String>, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            HStack(spacing: 10) {
                Image(systemName: icon).foregroundStyle(.secondary)
                TextField(title, text: text).textInputAutocapitalization(.never)
            }
            .padding(.horizontal, 13).frame(height: 48)
            .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private func compactRow(_ title: String, _ value: String) -> some View {
        HStack { Text(title).foregroundStyle(.secondary); Spacer(); Text(value.isEmpty ? "—" : value).fontWeight(.semibold).textSelection(.enabled) }
            .font(.subheadline)
    }

    private func loadDraft() {
        guard let p = checkout?.payment else { return }
        visaCard = p.visaCardNumber; visaHolder = p.visaHolder
        humoCard = p.humoCardNumber; humoHolder = p.humoHolder
        instructions = p.instructions
    }

    @MainActor private func loadPaymentTemplates() async {
        loadingPaymentTemplates = true
        defer { loadingPaymentTemplates = false }
        do {
            paymentTemplates = try await APIClient.shared.paymentTemplates()
        } catch {
            // Templates are an accelerator, not a blocker for manual booking editing.
        }
    }

    @MainActor private func applyPaymentTemplate(_ template: BusinessPaymentTemplate) async {
        saving = true
        error = nil
        do {
            let updated = try await APIClient.shared.applyPaymentTemplate(templateID: template.id, bookingID: bookingID)
            visaCard = updated.payment.visaCardNumber
            visaHolder = updated.payment.visaHolder
            humoCard = updated.payment.humoCardNumber
            humoHolder = updated.payment.humoHolder
            instructions = updated.payment.instructions
            onReload()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }

    @MainActor private func savePayment() async {
        saving = true; error = nil
        do {
            _ = try await APIClient.shared.savePaymentInstructions(
                bookingID: bookingID,
                payload: BusinessPaymentInstructionsPayload(visaCardNumber: visaCard, visaHolder: visaHolder, humoCardNumber: humoCard, humoHolder: humoHolder, instructions: instructions)
            )
            onReload()
        } catch { self.error = error.localizedDescription }
        saving = false
    }

    @MainActor private func uploadQR(_ item: PhotosPickerItem) async {
        saving = true; error = nil
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { throw URLError(.cannotDecodeContentData) }
            let contentType = item.supportedContentTypes.first?.preferredMIMEType ?? "image/jpeg"
            try await APIClient.shared.uploadPaymeQR(bookingID: bookingID, data: data, contentType: contentType)
            onReload()
        } catch { self.error = error.localizedDescription }
        saving = false
    }

    @MainActor private func stageDocument(_ url: URL) {
        error = nil
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size > 0, size <= 15_000_000 else { throw URLError(.dataLengthExceedsMaximum) }
            let data = try Data(contentsOf: url)
            let ext = url.pathExtension.lowercased()
            guard ["pdf", "png", "jpeg", "jpg"].contains(ext) else { throw URLError(.cannotDecodeContentData) }
            stagedDocument = try BusinessDocumentPreview.make(data: data, ext: ext, title: url.lastPathComponent)
        } catch { self.error = error.localizedDescription }
    }

    @MainActor private func openTravelDocument(_ document: BusinessTravelDocument) async {
        guard previewLoadingID == nil else { return }
        previewLoadingID = document.id; error = nil
        defer { previewLoadingID = nil }
        do {
            let data = try await APIClient.shared.privateMedia(path: document.mediaURL)
            let ext = document.contentType == "application/pdf" ? "pdf" : document.contentType.contains("png") ? "png" : "jpg"
            documentPreview = try BusinessDocumentPreview.make(data: data, ext: ext, title: document.title)
        } catch { self.error = error.localizedDescription }
    }

    @MainActor private func uploadDocument(_ url: URL) async {
        saving = true; error = nil
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            let contentType = url.pathExtension.lowercased() == "pdf" ? "application/pdf" : url.pathExtension.lowercased() == "png" ? "image/png" : "image/jpeg"
            let customTitle = documentTitle.trimmingCharacters(in: .whitespacesAndNewlines)
            let title = customTitle.isEmpty ? documentKindTitle(documentKind) : customTitle
            try await APIClient.shared.uploadTravelDocument(
                bookingID: bookingID,
                kind: documentKind,
                title: title,
                bookingReference: documentReference.trimmingCharacters(in: .whitespacesAndNewlines),
                data: data,
                contentType: contentType,
                slots: Array(documentSlots).sorted(),
                replacing: replaceDocument?.id
            )
            stagedDocument = nil
            resetDocumentDraft()
            onReload()
        } catch { self.error = error.localizedDescription }
        saving = false
    }

    @MainActor private func submitReview(_ receipt: BusinessPaymentReceipt) async {
        saving = true; error = nil
        defer { saving = false }
        do {
            let amount = Double(reviewAmount.replacingOccurrences(of: ",", with: "."))
            try await APIClient.shared.reviewBookingReceipt(bookingID: bookingID, receiptID: receipt.id, decision: reviewDecision, amountUsd: reviewDecision == "approved" ? amount : nil, reason: reviewReason)
            reviewReceipt = nil; onReload()
        } catch { self.error = error.localizedDescription }
    }

    @MainActor private func setPublication(_ doc: BusinessTravelDocument, state: String, slots: [String]) async {
        saving = true; error = nil
        defer { saving = false }
        do {
            try await APIClient.shared.updateDocumentPublication(bookingID: bookingID, documentID: doc.id, publicationStatus: state, slots: slots.sorted())
            editingDocument = nil; onReload()
        } catch { self.error = error.localizedDescription }
    }

    @MainActor private func openPrivateImage(path: String, id: String, title: String) async {
        previewLoadingID = id; error = nil
        defer { previewLoadingID = nil }
        do {
            let data = try await APIClient.shared.privateMedia(path: path)
            guard let image = UIImage(data: data) else { throw URLError(.cannotDecodeContentData) }
            imagePreview = BusinessImagePreview(id: id, title: title, image: image)
        } catch { self.error = error.localizedDescription }
    }

    private func paymentMethod(_ value: String) -> String {
        switch value { case "visa": return "Visa"; case "payme": return "PayMe"; case "humo": return "Humo"; default: return "Оплата" }
    }
    private func documentKindTitle(_ value: String) -> String {
        switch value { case "visa": return "Виза"; case "voucher": return "Ваучер"; case "insurance": return "Страховка"; case "ticket": return "Билет"; default: return "Документ поездки" }
    }
}

private struct BusinessImagePreview: Identifiable {
    let id: String
    let title: String
    let image: UIImage
}


private struct BusinessDocumentPreview: Identifiable {
    let id = UUID()
    let title: String
    let url: URL
    private static var folder: URL { FileManager.default.temporaryDirectory.appendingPathComponent("IumrahBusinessDocumentPreview", isDirectory: true) }
    static func make(data: Data, ext: String, title: String) throws -> Self {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
        let url = folder.appendingPathComponent(UUID().uuidString).appendingPathExtension(ext)
        try data.write(to: url, options: [.atomic, .completeFileProtection]); return Self(title: title, url: url)
    }
    static func cleanup() { try? FileManager.default.removeItem(at: folder) }
}
private struct BusinessDocumentQuickLook: UIViewControllerRepresentable {
    let url: URL
    func makeCoordinator() -> Coordinator { Coordinator(url) }
    func makeUIViewController(context: Context) -> QLPreviewController { let controller = QLPreviewController(); controller.dataSource = context.coordinator; return controller }
    func updateUIViewController(_ controller: QLPreviewController, context: Context) {}
    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL
        init(_ url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
    }
}
