import Foundation
import SwiftUI
import UIKit

struct BookingDetailView: View {
    let bookingID: String

    @Environment(\.dismiss) private var dismiss
    @State private var deleteConfirmation = false
    @State private var deletingBooking = false
    @State private var deleteError: String?
    @State private var detail: BookingDetailResponse?
    @State private var loading = true
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var status: TripStatus = .availabilityCheck
    @State private var paymentStatus = ""
    @State private var confirmationNumber = ""
    @State private var internalNotes = ""
    @State private var showPricing = false
    @State private var showPricingEditor = false
    @State private var editingFlight: BookingFlightDirection?
    @State private var editingHotelCity: String?
    @State private var showGuidePicker = false
    @State private var restartingPriceLock = false
    @State private var loadGeneration = UUID()
    @State private var workspace = 0
    @State private var showAdvanced = false
    @State private var manualInfo: BusinessManualBookingInfo?
    @State private var shareURL: URL?
    @State private var shareError: String?
    @State private var rotateShare = false
    @State private var sharing = false
    @State private var sendingAvailabilityDelay = false
    @State private var availabilityDelayResult: String?
    @State private var cancellationReason = ""
    @State private var cancellationDialog = false
    @State private var dismissCancellationDialog = false
    @State private var dismissCancellationReason = ""
    @State private var transitionDialog = false
    @State private var editingService: BookingServiceOperation?
    @State private var managerPicker = false
    @State private var refundSheet = false
    @State private var financeCloseSheet = false
    @State private var historicalPaymentSheet = false
    @State private var correctingCertificate: BusinessUmrahCertificate?
    @State private var certificatePosition: Int?
    @State private var certificateError: String?
    @State private var certificateSaving = false

    private var shareCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Ссылка на поездку").font(.headline)
            if let packageID = manualInfo?.packageID { Text(packageID).font(.caption.monospaced()).textSelection(.enabled) }
            if let shareURL { ShareLink(item: shareURL) { Label("Поделиться", systemImage: "square.and.arrow.up") }; Link("Открыть", destination: shareURL) }
            Button(sharing ? "Создание…" : "Создать новую ссылку") { rotateShare = true }.disabled(sharing)
            Text("Новая ссылка отменит предыдущую. Старый email или SMS больше не откроет пакет.").font(.caption).foregroundStyle(.secondary)
            if let shareError { Text(shareError).font(.caption).foregroundStyle(.red) }
        }.padding(18).frame(maxWidth: .infinity,alignment: .leading).businessCard(radius: 22)
            .confirmationDialog("Отменить предыдущую ссылку и создать новую?", isPresented: $rotateShare, titleVisibility: .visible) {
                Button("Создать новую", role: .destructive) { Task { await renewShare() } }
            }
    }
    @MainActor private func renewShare() async {
        sharing = true; defer { sharing = false }; shareError = nil
        do { shareURL = URL(string: try await APIClient.shared.rotateManualShare(id: bookingID)) }
        catch { shareError = error.localizedDescription }
    }
    private func manualCostCard(_ costs: [String: Double]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Себестоимость менеджера").font(.headline)
            ForEach(["flight","makkah","madinah","transfer","ziyarat","visa","guide","other","commission","discount"], id: \.self) { key in
                HStack { Text(["flight":"Перелёт","makkah":"Мекка","madinah":"Медина","transfer":"Трансфер","ziyarat":"Зияраты","visa":"Визы","guide":"Гид","other":"Прочее","commission":"Комиссия, %","discount":"Скидка, USD"][key] ?? key); Spacer(); Text((costs[key] ?? 0).formatted(.number.precision(.fractionLength(0...2)))) }
            }
            Text("Внутренние данные · USD. Не показываются в ссылке клиента.").font(.caption).foregroundStyle(.secondary)
        }.padding(18).businessCard(radius: 22)
    }

    private var hasUnsavedOperations: Bool {
        guard let operation = detail?.operation else { return false }
        return status != operation.tripStatus || paymentStatus != operation.paymentStatus || confirmationNumber != operation.confirmationNumber || internalNotes != operation.internalNotes
    }

    var body: some View {
        ScrollView {
            if let detail {
                VStack(alignment: .leading, spacing: 16) {
                    hero(detail)
                    workspacePicker
                    if hasUnsavedOperations && workspace != 0 {
                        Button { workspace = 0; showAdvanced = true } label: {
                            Label("Есть несохранённые изменения · Вернуться к управлению", systemImage: "exclamationmark.circle")
                        }.buttonStyle(BusinessActionStyle(primary: false))
                    }
                    switch workspace {
                    case 1:
                        BusinessBookingItineraryEditor(bookingID: bookingID, startDate: detail.booking.startDate, endDate: detail.booking.endDate, executionEnabled: detail.operation?.tripStatus == .inTrip)
                        sectionTitle("Перелёты", subtitle: "Рейс можно заменить только после проверки AeroDataBox.")
                        flightCard(.outbound, detail: detail)
                        flightCard(.return, detail: detail)
                        sectionTitle("Размещение", subtitle: "Операционные изменения применяются только к этой поездке.")
                        hotelCard(city: "Makkah", detail: detail)
                        if !detail.booking.madinahHotel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || detail.assignment?.madinahHotel != nil { hotelCard(city: "Madinah", detail: detail) }
                        guideCard(detail)
                        BookingESIMAdminCard(bookingID: bookingID, esims: detail.esims ?? []) { Task { await load() } }
                    case 2:
                        sectionTitle("Паломники и документы", subtitle: "Проверка личности, готовность и публикация файлов.")
                        BookingSecurityAdminCard(bookingID: bookingID, security: detail.security) { Task { await load() } }
                        BookingCheckoutAdminCard(bookingID: bookingID, status: detail.operation?.tripStatus ?? .availabilityCheck, checkout: detail.checkout) { Task { await load() } }
                    case 3:
                        sectionTitle("Финансы поездки", subtitle: "Реквизиты, поступления, возвраты и внутренние расчёты.")
                        BookingCheckoutAdminCard(bookingID: bookingID, status: detail.operation?.tripStatus ?? .availabilityCheck, checkout: detail.checkout, financesOnly: true) { Task { await load() } }
                        if let center = detail.operationsCenter, let review = detail.checkout?.paymentReview { historicalPaymentCard(center, review: review) }
                        if let cancellation = detail.operationsCenter?.cancellation { cancellationCard(cancellation) }
                        if let center = detail.operationsCenter, let state = detail.operation?.tripStatus, state == .completed || state == .cancelled { financialCloseCard(center, detail: detail) }
                        pricingCard(detail)
                        if let report = manualInfo?.tripSummaryReport {
                            TripSummaryFinancialReportView(report: report).padding(18).businessCard(radius: 24)
                        } else if let cost = manualInfo?.cost { manualCostCard(cost) }
                    default:
                        if let center = detail.operationsCenter { operationsCenterCard(center, detail: detail) }
                        if let operation = detail.operation, !operation.tripStatus.isCompleted {
                            VStack(alignment: .leading, spacing: 10) {
                                Label("Срок текущего этапа", systemImage: "clock").font(BusinessDesign.TypeStyle.title)
                                lifecycleTimerCard(operation)
                                if operation.tripStatus == .availabilityCheck { availabilityExpectation(operation) }
                            }.padding(BusinessDesign.Space.md).businessCard()
                        }
                        if let feedback = detail.operationsCenter?.feedback { travelFeedbackCard(feedback) }
                        if detail.operation?.tripStatus == .completed, let center = detail.operationsCenter { certificatesCard(center, detail: detail) }
                        NavigationLink { ChatConversationView(booking: detail.booking) } label: {
                            Label("Чат с паломником", systemImage: "message").font(.headline).frame(maxWidth: .infinity, alignment: .leading).padding(18).businessCard(radius: 22)
                        }.buttonStyle(.plain)
                        if manualInfo?.manual == true { shareCard }
                        tripCard(detail.booking)
                        if let operation = detail.operation, operation.tripStatus == .availabilityCheck,
                           operation.paymentReceivedAt == nil, operation.confirmationNumber.isEmpty,
                           ["", "unpaid", "pending", "not_paid"].contains(operation.paymentStatus.lowercased()) {
                            Button { deleteConfirmation = true } label: {
                                Label(deletingBooking ? "Удаляем…" : "Удалить бронирование", systemImage: "trash")
                                    .font(.headline).frame(maxWidth: .infinity).padding(14)
                                    .foregroundStyle(.red).background(.red.opacity(0.07), in: Capsule())
                            }.buttonStyle(.plain).disabled(deletingBooking)
                            if let deleteError { Text(deleteError).font(.footnote).foregroundStyle(.red) }
                        }
                        DisclosureGroup(isExpanded: $showAdvanced) {
                            operationsCard(detail)
                        } label: {
                            HStack {
                                                    if hasUnsavedOperations { Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.orange).accessibilityLabel("Есть несохранённые изменения") }
                            }.frame(minHeight: BusinessDesign.Size.tap, alignment: .leading)
                        }.tint(BusinessDesign.ink).padding(BusinessDesign.Space.sm).businessCard()
                    }
                }
                .businessAdaptiveDetailWidth()
                .padding(.horizontal, 18)
                .padding(.bottom, 34)
            } else if loading {
                ProgressView().padding(.top, 70)
            } else {
                ContentUnavailableView("Бронь недоступна", systemImage: "suitcase.rolling", description: Text(errorMessage ?? "Не удалось загрузить данные."))
                    .padding(.top, 60)
            }
        }
        .background(BusinessDesign.background)
        .navigationTitle("Бронирование")
        .navigationBarTitleDisplayMode(.inline)
        .businessNavigationSurface()
        .task {
            await load(showLoading: true)
            manualInfo = try? await APIClient.shared.manualBookingInfo(id: bookingID)
            if let url = manualInfo?.shareURL { shareURL = URL(string: url) }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled else { break }
                await load(showLoading: false)
            }
        }
        .confirmationDialog("Удалить неоплаченное бронирование?", isPresented: $deleteConfirmation, titleVisibility: .visible) {
            Button("Удалить бронирование", role: .destructive) { Task { await eraseBooking() } }
            Button("Оставить бронирование", role: .cancel) {}
        } message: { Text("Заявка и связанные данные будут удалены. Подтверждённые и оплаченные поездки не удаляются.") }
        .refreshable { await load(showLoading: false) }
        .sheet(item: $editingFlight) { direction in
            if let detail {
                FlightEditorSheet(
                    bookingID: bookingID,
                    direction: direction,
                    current: savedFlight(direction, detail: detail),
                    fallbackDate: direction == .outbound ? detail.booking.startDate : detail.booking.endDate
                ) { _ in
                    editingFlight = nil
                    Task { await load() }
                }
            }
        }
        .sheet(isPresented: Binding(
            get: { editingHotelCity != nil },
            set: { if !$0 { editingHotelCity = nil } }
        )) {
            if let detail, let city = editingHotelCity {
                HotelAssignmentPicker(bookingID: bookingID, city: city, assignment: detail.assignment) {
                    editingHotelCity = nil
                    Task { await load() }
                }
            }
        }
        .sheet(isPresented: $showGuidePicker) {
            if let detail {
                NavigationStack {
                    GuideAssignmentPicker(bookingID: bookingID, assignment: detail.assignment) {
                        showGuidePicker = false
                        Task { await load() }
                    }
                }
            }
        }
        .sheet(isPresented: $showPricingEditor) {
            if let report = detail?.pricingReport {
                NavigationStack {
                    BookingPricingEditorSheet(bookingID: bookingID, report: report) {
                        Task { await load() }
                    }
                }
            }
        }
        .sheet(item: $editingService) { service in
            NavigationStack { ServiceOperationEditor(bookingID: bookingID, service: service, inTrip: detail?.operation?.tripStatus == .inTrip) { Task { await load(); notifyOperationsChanged() } } }
        }
        .sheet(isPresented: $managerPicker) {
            NavigationStack { OperationsManagerPicker(bookingID: bookingID) { Task { await load(); notifyOperationsChanged() } } }
        }
        .sheet(isPresented: $historicalPaymentSheet) {
            if let review = detail?.checkout?.paymentReview {
                NavigationStack { HistoricalPaymentEditor(bookingID: bookingID, dueCents: review.dueCents ?? 0, paidCents: review.paidCents, cancelled: detail?.operation?.tripStatus == .cancelled) { Task { await load(); notifyOperationsChanged() } } }
            }
        }
        .sheet(item: $correctingCertificate) { certificate in
            NavigationStack { CertificateCorrectionEditor(bookingID: bookingID, certificate: certificate) { Task { await load(); notifyOperationsChanged() } } }
        }
        .sheet(isPresented: $financeCloseSheet) {
            if let detail, let center = detail.operationsCenter, let review = detail.checkout?.paymentReview {
                NavigationStack { TravelFinanceCloseEditor(bookingID: bookingID, paidCents: review.paidCents, refundedCents: center.cancellation?.refundedCents ?? 0) { Task { await load(); notifyOperationsChanged() } } }
            }
        }
        .sheet(isPresented: $refundSheet) {
            if let cancellation = detail?.operationsCenter?.cancellation { NavigationStack { OperationsRefundEditor(bookingID: bookingID, availableCents: max(0, cancellation.paidCents - cancellation.refundedCents)) { Task { await load(); notifyOperationsChanged() } } } }
        }
        .alert("Отменить бронирование?", isPresented: $cancellationDialog) {
            TextField("Причина отмены", text: $cancellationReason)
            Button("Назад", role: .cancel) {}
            Button("Подтвердить отмену", role: .destructive) { status = .cancelled; Task { await save() } }.disabled(cancellationReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        } message: { Text("История и документы сохранятся. Возврат денег оформляется отдельно.") }
        .alert("Закрыть запрос без отмены?", isPresented: $dismissCancellationDialog) {
            TextField("Причина", text: $dismissCancellationReason)
            Button("Назад", role: .cancel) {}
            Button("Закрыть запрос") { Task { await dismissCancellationRequest() } }.disabled(dismissCancellationReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        } message: { Text("Сначала согласуйте решение с клиентом в чате.") }
        .confirmationDialog("Подтвердить следующий этап?", isPresented: $transitionDialog, titleVisibility: .visible) {
            Button("Подтвердить") { if let next = suggestedNextStatus { status = next; Task { await save() } } }
        } message: { Text("Сервер проверит обязательные условия и отправит уведомление клиенту.") }
        .alert("Не удалось выполнить действие", isPresented: Binding(get: { errorMessage != nil && detail != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK") { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private var workspacePicker: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: BusinessDesign.Space.xs) {
                ForEach(0..<4, id: \.self) { workspaceButton($0) }
            }.fixedSize(horizontal: true, vertical: false).frame(maxWidth: .infinity)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: BusinessDesign.Space.xs) {
                ForEach(0..<4, id: \.self) { workspaceButton($0) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Разделы бронирования")
    }

    private func workspaceButton(_ index: Int) -> some View {
        let titles = ["Обзор", "Поездка", "Документы", "Финансы"]
        let symbols = ["list.bullet.rectangle", "airplane", "doc.text", "creditcard"]
        return Button { workspace = index } label: {
            VStack(spacing: 6) {
                Image(systemName: symbols[index]).font(.body.weight(.semibold))
                Text(titles[index]).font(.caption.weight(.semibold)).fixedSize(horizontal: true, vertical: false)
            }
            .frame(maxWidth: .infinity, minHeight: 52)
            .padding(.horizontal, 8)
            .foregroundStyle(workspace == index ? BusinessDesign.onAccent : BusinessDesign.ink)
            .background(workspace == index ? BusinessDesign.accent : BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: BusinessDesign.Radius.control))
        }.buttonStyle(.plain).accessibilityAddTraits(workspace == index ? .isSelected : [])
    }

    private func sectionTitle(_ title: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.title2.bold())
            Text(subtitle).font(.caption).foregroundStyle(.secondary)
        }
        .padding(.top, 4)
    }

    private func hero(_ detail: BookingDetailResponse) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 10) {
                VStack(alignment: .leading, spacing: 5) {
                    Text((detail.booking.clientName?.isEmpty == false ? detail.booking.clientName : detail.pilgrim?.displayName) ?? "Имя не синхронизировано")
                        .font(.system(size: 30, weight: .bold, design: .rounded)).tracking(-1)
                    VStack(alignment: .leading, spacing: 6) {
                        if let pilgrimID = detail.pilgrim?.id ?? detail.booking.pilgrimID {
                            Label("Iumrah ID \(pilgrimID)", systemImage: "person.text.rectangle")
                                .contextMenu {
                                    Button { UIPasteboard.general.string = pilgrimID } label: { Label("Копировать Iumrah ID", systemImage: "doc.on.doc") }
                                }
                        }
                        if let bookingNumber = detail.operation?.bookingDisplayNumber ?? detail.booking.bookingDisplayNumber {
                            Label("Бронь \(bookingNumber)", systemImage: "number")
                                .contextMenu {
                                    Button { UIPasteboard.general.string = bookingNumber } label: { Label("Копировать номер брони", systemImage: "doc.on.doc") }
                                }
                        }
                    }
                    .font(.caption.monospaced().weight(.semibold))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                }
                Text(detail.booking.totalUsd, format: .currency(code: "USD").precision(.fractionLength(0)))
                    .font(BusinessDesign.TypeStyle.hero).monospacedDigit()
            }
            if let actual = detail.operation?.tripStatus {
                statusBadge(actual)
                    .font(.subheadline.weight(.semibold))
                BusinessBookingProgress(status: actual)
            } else {
                Label("Операционный статус недоступен", systemImage: "info.circle").font(.caption).foregroundStyle(.secondary)
            }
            Label("\(detail.booking.startDate) — \(detail.booking.endDate)", systemImage: "calendar")
                .font(.subheadline).foregroundStyle(.secondary)
            HStack(spacing: 12) {
                Label("\(detail.booking.travelerCount) чел.", systemImage: "person.2.fill")
                Label("\(detail.booking.rooms) ном.", systemImage: "bed.double.fill")
            }.font(.caption.weight(.semibold)).foregroundStyle(.secondary)
        }
        .padding(18).businessCard(radius: 28)
    }

    private var currentStatusTargets: [TripStatus] {
        let base = detail?.operation?.tripStatus ?? status
        return base.allowedTargets.filter { $0 != .cancelled }
    }

    @MainActor private func eraseBooking() async {
        guard !deletingBooking else { return }
        deletingBooking = true; deleteError = nil
        defer { deletingBooking = false }
        do { try await APIClient.shared.deleteBooking(id: bookingID); detail = nil; notifyOperationsChanged(); dismiss() }
        catch { deleteError = "Не удалось удалить заявку. Проверьте её статус и платежи. " + error.localizedDescription }
    }
    private func notifyOperationsChanged() { NotificationCenter.default.post(name: Notification.Name("iumrah.business.bookingOperationsChanged"), object: bookingID) }

    private func certificatesCard(_ center: BookingOperationsCenter, detail: BookingDetailResponse) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Памятные сертификаты", systemImage: "rosette").font(.headline)
            Text("Выдавайте только после подтверждения фактического совершения умры конкретным паломником.").font(.caption).foregroundStyle(.secondary)
            ForEach(detail.checkout?.travelers ?? []) { traveler in
                HStack {
                    Text([traveler.firstName, traveler.lastName].filter { !$0.isEmpty }.joined(separator: " ")).font(.subheadline)
                    Spacer()
                    if let certificate = (center.certificates ?? []).first(where: { $0.position == traveler.position }) {
                        Button { correctingCertificate = certificate } label: { Label("Выдан", systemImage: "checkmark.circle").font(.caption) }
                    }
                    else { Button("Выдать") { certificatePosition = traveler.position }.disabled(!traveler.completed || certificateSaving) }
                }
            }
            if let history = center.certificateHistory, !history.isEmpty {
                DisclosureGroup("История исправлений и отзывов") {
                    ForEach(history) { entry in
                        VStack(alignment: .leading, spacing: 3) { Text(entry.name).font(.subheadline); Text(entry.action == "correct" ? "Заменён" : "Отозван").font(.caption.bold()); Text(entry.reason).font(.caption); Text(entry.changedAt).font(.caption2).foregroundStyle(.secondary) }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 5)
                    }
                }
            }
            if let certificateError { Text(certificateError).font(.caption).foregroundStyle(.red) }
        }.padding(18).frame(maxWidth: .infinity, alignment: .leading).businessCard(radius: 22)
        .confirmationDialog("Подтверждаете, что этот паломник совершил умру?", isPresented: Binding(get: { certificatePosition != nil }, set: { if !$0 { certificatePosition = nil } }), titleVisibility: .visible) {
            Button("Подтвердить и выдать") { if let position = certificatePosition { certificatePosition = nil; Task { await issueCertificate(position) } } }
            Button("Отмена", role: .cancel) { certificatePosition = nil }
        }
    }
    @MainActor private func issueCertificate(_ position: Int) async {
        guard !certificateSaving else { return }; certificateSaving = true; certificateError = nil; defer { certificateSaving = false }
        do { _ = try await APIClient.shared.issueTravelCertificate(bookingID: bookingID, position: position); await load() }
        catch { certificateError = error.localizedDescription }
    }
    private func travelFeedbackCard(_ feedback: BusinessTravelFeedback) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Отзыв паломника", systemImage: "star").font(.headline)
            HStack { ForEach(1...5, id: \.self) { value in Image(systemName: value <= feedback.rating ? "star.fill" : "star").foregroundStyle(BusinessDesign.ink) }; Spacer(); Text("\(feedback.rating)/5").font(.title2.bold()) }
            if !feedback.comment.isEmpty { Text(feedback.comment).font(.subheadline).textSelection(.enabled) }
            Text(feedback.createdAt).font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(18).businessCard(radius: 22)
    }
    @ViewBuilder private func historicalPaymentCard(_ center: BookingOperationsCenter, review: BusinessPaymentReview) -> some View {
        if let entry = center.historicalPayment {
            VStack(alignment: .leading, spacing: 8) {
                Label("Исторические платежи сверены", systemImage: "checkmark.seal").font(.headline)
                LabeledContent("Дополнительно учтено", value: (Double(entry.addedCents)/100).formatted(.currency(code: "USD")))
                Text(entry.reference).font(.caption); Text(entry.reason).font(.caption).foregroundStyle(.secondary); Text(entry.createdAt).font(.caption2)
            }.padding(18).frame(maxWidth: .infinity, alignment: .leading).businessCard(radius: 22)
        } else if review.reconciliationRequired == true || review.historicalConfirmed == true || center.cancellation?.historicalUnverified == true {
            VStack(alignment: .leading, spacing: 10) {
                Label("Требуется финансовая сверка", systemImage: "exclamationmark.triangle").font(.headline)
                Text("Старые подтверждения не содержат проверенных сумм. Суперадминистратор должен сверить выписки и указать только ещё не учтённые поступления.").font(.caption).foregroundStyle(.secondary)
                Button("Сверить исторические платежи") { historicalPaymentSheet = true }.buttonStyle(BusinessActionStyle(primary: true)).disabled(review.dueCents == nil || center.financialClose != nil)
            }.padding(18).frame(maxWidth: .infinity, alignment: .leading).businessCard(radius: 22)
        }
    }
    private func financialCloseCard(_ center: BookingOperationsCenter, detail: BookingDetailResponse) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Финансовое закрытие", systemImage: "checkmark.seal").font(.headline)
            if let record = center.financialClose {
                LabeledContent("Получено", value: (Double(record.paidCents)/100).formatted(.currency(code: "USD")))
                LabeledContent("Возвращено", value: (Double(record.refundedCents)/100).formatted(.currency(code: "USD")))
                LabeledContent("Фактические расходы", value: (Double(record.expenseCents)/100).formatted(.currency(code: "USD")))
                LabeledContent("Осталось у компании", value: (Double(record.retainedCents)/100).formatted(.currency(code: "USD")))
                LabeledContent("Финансовый результат", value: (Double(record.netCents)/100).formatted(.currency(code: "USD")))
                Text(record.reason).font(.caption); Text(record.createdAt).font(.caption2).foregroundStyle(.secondary)
            } else if let review = detail.checkout?.paymentReview {
                if review.historicalConfirmed == true || review.reconciliationRequired == true || center.cancellation?.historicalUnverified == true || review.dueCents == nil {
                    Text("Сначала требуется сверка исторических платежей. Не закрывайте финансы без подтверждения поступлений.").font(.subheadline).foregroundStyle(.secondary)
                } else {
                    LabeledContent("Подтверждённые поступления", value: (Double(review.paidCents)/100).formatted(.currency(code: "USD")))
                    Text("Зафиксируйте фактические расходы и остаток после возвратов. Запись не переводит деньги и не заменяет бухгалтерские документы.").font(.caption).foregroundStyle(.secondary)
                    Button("Закрыть финансы") { financeCloseSheet = true }.buttonStyle(BusinessActionStyle(primary: true))
                }
            } else { Text("Платёжные данные пока недоступны.").font(.caption).foregroundStyle(.secondary) }
        }.padding(18).frame(maxWidth: .infinity, alignment: .leading).businessCard(radius: 22)
    }
    private func operationsCenterCard(_ center: BookingOperationsCenter, detail: BookingDetailResponse) -> some View {
        let actual = detail.operation?.tripStatus ?? .availabilityCheck
        let confirmed = center.services.filter { $0.availability == "confirmed" }.count
        let missing = center.services.count - confirmed
        let documents = detail.checkout?.documentRequirements ?? []
        let docsReady = detail.checkout != nil && documents.allSatisfy { $0.ready }
        let paid = detail.checkout?.paymentReview?.satisfied == true
        let travelers = detail.checkout?.allTravelersComplete == true
        let instructions = detail.checkout.map { !$0.payment.visaCardNumber.isEmpty || !$0.payment.humoCardNumber.isEmpty || $0.payment.hasPaymeQR } ?? false
        let executable = center.services.allSatisfy { $0.execution == "completed" }
        let guideRequired = center.services.contains { $0.key == "accompaniment" }
        let guideAssigned = detail.assignment.map { $0.guideID != nil && !$0.guideIsPrimary } ?? false
        return VStack(alignment: .leading, spacing: 14) {
            Label("Операционный центр", systemImage: "checklist").font(.title2.bold())
            if center.cancellationRequestedAt != nil && !actual.isCompleted {
                Label("Клиент запросил отмену", systemImage: "exclamationmark.circle.fill").foregroundStyle(.orange).font(.subheadline.bold())
                Button("Рассмотреть отмену", role: .destructive) { cancellationReason = ""; cancellationDialog = true }
                Button("Закрыть запрос без отмены") { dismissCancellationReason = ""; dismissCancellationDialog = true }.font(.caption)
            }
            HStack {
                VStack(alignment: .leading) { Text("Ответственный менеджер").font(.caption).foregroundStyle(.secondary); Text(center.manager?.active == true ? (center.manager?.name ?? "Не назначен") : "Не назначен").font(.subheadline.bold()) }
                Spacer()
                if !actual.isCompleted { Button("Назначить") { managerPicker = true }.font(.subheadline.bold()) }
            }
            if !actual.isCompleted {
                Text(actual == .inTrip ? "Исполнение услуг" : "Проверка компонентов").font(.headline)
                ProgressView(value: Double(actual == .inTrip ? center.services.filter { $0.execution == "completed" }.count : confirmed), total: Double(max(1,center.services.count))).tint(BusinessDesign.securityBlue)
                ForEach(center.services) { service in
                    Button { editingService = service } label: {
                        HStack(alignment: .center) {
                            Image(systemName: (actual == .inTrip ? service.execution == "completed" : service.availability == "confirmed") ? "checkmark.circle.fill" : "circle.dashed").foregroundStyle((actual == .inTrip ? service.execution == "completed" : service.availability == "confirmed") ? BusinessDesign.securityBlue : BusinessDesign.muted)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(service.label).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                                Text(actual == .inTrip ? service.executionTitle : service.availabilityTitle).font(.caption).foregroundStyle(.secondary)
                                if !service.reference.isEmpty { Text(service.reference).font(.caption.monospaced()).foregroundStyle(.secondary) }
                                if !service.note.isEmpty { Text(service.note).font(.caption).foregroundStyle(.secondary) }
                            }
                            Spacer(); Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                        }.padding(.vertical, 5)
                    }.buttonStyle(.plain)
                }
                let title: String = { switch actual {
                    case .availabilityCheck: return missing > 0 ? "Проверить все компоненты" : !instructions ? "Настроить реквизиты" : "Подтвердить наличие"
                    case .paymentPending: return !paid ? "Проверить оплату" : !travelers ? "Проверить анкеты" : "Подтвердить оплату и бронь"
                    case .bookingConfirmed: return !docsReady ? "Подготовить документы" : guideRequired && !guideAssigned ? "Назначить гида" : missing > 0 ? "Проверить компоненты" : "Подтвердить готовность"
                    case .readyToTravel: return !docsReady ? "Проверить документы" : guideRequired && !guideAssigned ? "Назначить гида" : missing > 0 ? "Проверить компоненты" : "Подтвердить начало поездки"
                    case .inTrip: return executable ? "Завершить поездку" : "Подтвердить исполнение услуг"
                    default: return ""
                } }()
                Button {
                    if actual == .availabilityCheck && missing > 0 { return }
                    if actual == .availabilityCheck && !instructions { workspace = 3; return }
                    if actual == .paymentPending && !paid { workspace = 3; return }
                    if actual == .paymentPending && !travelers { workspace = 2; return }
                    if (actual == .bookingConfirmed || actual == .readyToTravel) && !docsReady { workspace = 2; return }
                    if (actual == .bookingConfirmed || actual == .readyToTravel) && guideRequired && !guideAssigned { showGuidePicker = true; return }
                    if ((actual == .bookingConfirmed || actual == .readyToTravel) && missing > 0) || (actual == .inTrip && !executable) { return }
                    transitionDialog = true
                } label: { Label(title, systemImage: "arrow.right.circle.fill") }.buttonStyle(BusinessActionStyle(primary: true))
                    .disabled(saving || hasUnsavedOperations || (actual == .availabilityCheck && missing > 0) || ((actual == .bookingConfirmed || actual == .readyToTravel) && docsReady && missing > 0 && (!guideRequired || guideAssigned)) || (actual == .inTrip && !executable))
            }
            if let cancellation = center.cancellation { cancellationCard(cancellation) }
            if !center.audit.isEmpty {
                DisclosureGroup("Журнал операций") {
                    ForEach(center.audit) { event in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(auditLabel(event.action)).font(.caption.weight(.semibold))
                            Text("\(event.target) · \(event.actor) · \(shortDate(event.createdAt))").font(.caption2).foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 4)
                    }
                }
            }
        }.padding(18).businessCard(radius: 28)
    }

    @MainActor private func dismissCancellationRequest() async {
        do { _ = try await APIClient.shared.dismissCancellationRequest(bookingID: bookingID, reason: dismissCancellationReason); await load(); notifyOperationsChanged() }
        catch { errorMessage = error.localizedDescription }
    }
    private func cancellationCard(_ cancellation: BookingCancellationRecord) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Отмена и возвраты").font(.headline)
            Text(cancellation.reason).font(.subheadline)
            LabeledContent("Подтверждённые платежи", value: (Double(cancellation.paidCents)/100).formatted(.currency(code: "USD")))
            LabeledContent("Возвращено", value: (Double(cancellation.refundedCents)/100).formatted(.currency(code: "USD")))
            LabeledContent("Не распределено", value: (Double(max(0,cancellation.paidCents-cancellation.refundedCents))/100).formatted(.currency(code: "USD")))
            if cancellation.historicalUnverified { Text("Есть исторические платежи без подтверждённой суммы. Требуется финансовая сверка.").font(.caption).foregroundStyle(.orange) }
            ForEach(cancellation.refunds) { refund in
                LabeledContent(refund.reference, value: (Double(refund.amountCents)/100).formatted(.currency(code: "USD"))).font(.caption)
            }
            if detail?.operationsCenter?.financialClose == nil && !cancellation.historicalUnverified && cancellation.paidCents > cancellation.refundedCents { Button("Зафиксировать выполненный возврат") { refundSheet = true }.buttonStyle(BusinessActionStyle(primary: false)) }
            Text("Запись не отправляет деньги автоматически. Условия возврата определяются отдельно.").font(.caption).foregroundStyle(.secondary)
        }.padding(14).businessCard(radius: 18)
    }
    private func auditLabel(_ action: String) -> String {
        ["service_updated":"Обновлена услуга","manager_assigned":"Назначен менеджер","booking_cancelled":"Отмена поездки","refund_recorded":"Зафиксирован возврат","itinerary_saved":"Изменено расписание","finance_closed":"Финансы закрыты","certificate_issued":"Выдан сертификат","certificate_corrected":"Исправлен сертификат","certificate_revoked":"Отозван сертификат","historical_payment_reconciled":"Сверены исторические платежи","document_replaced":"Заменён документ","document_published":"Опубликован документ","document_revoked":"Отозван документ"][action] ?? action
    }

    private func operationsCard(_ detail: BookingDetailResponse) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Дополнительное управление", systemImage: "slider.horizontal.3").font(.headline)
            VStack(alignment: .leading, spacing: 7) {
                Text("Статус поездки")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Menu {
                    ForEach(currentStatusTargets) { item in
                        Button { status = item } label: {
                            if item == status { Label(item.title, systemImage: "checkmark") }
                            else { Text(item.title) }
                        }
                    }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "circle.hexagongrid.fill")
                            .foregroundStyle(.secondary)
                        Text(status.title)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 10)
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.caption.bold())
                            .foregroundStyle(.tertiary)
                    }
                    .padding(.horizontal, 13)
                    .frame(minHeight: 52)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 17, style: .continuous))
                }
                .buttonStyle(.plain)
            }

            Label(statusGuidance, systemImage: "lightbulb.fill")
                .font(.subheadline)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.yellow.opacity(0.13), in: RoundedRectangle(cornerRadius: 17, style: .continuous))

            LabeledContent("Статус оплаты", value: (detail.checkout?.paymentReview?.satisfied == true || detail.checkout?.paymentReview?.historicalConfirmed == true) ? "Подтверждена" : "Проверяется в разделе финансов")
            labeledField("Номер бронирования / подтверждения", text: $confirmationNumber, placeholder: "Confirmation number")

            VStack(alignment: .leading, spacing: 7) {
                Text("Внутренняя заметка").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                TextField("Только для iumrah Business", text: $internalNotes, axis: .vertical)
                    .lineLimit(3...6)
                    .padding(12)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }

            if !detail.statusHistory.isEmpty {
                DisclosureGroup("История статусов") {
                    VStack(spacing: 9) {
                        ForEach(Array(detail.statusHistory.enumerated()), id: \.offset) { _, item in
                            HStack(alignment: .top) {
                                Text(TripStatus(rawValue: item.newStatus)?.title ?? item.newStatus).font(.caption.weight(.semibold))
                                Spacer()
                                Text(shortDate(item.createdAt)).font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding(.top, 8)
                }
                .font(.subheadline.weight(.semibold))
            }

            Button {
                Task { await save() }
            } label: {
                HStack(spacing: 10) {
                    if saving {
                        ProgressView().tint(BusinessDesign.onPrimaryControl)
                    } else {
                        Image(systemName: "checkmark.circle.fill")
                    }
                    Text(saving ? "Сохраняем изменения…" : "Сохранить статус и данные")
                }
                .font(.headline)
                .foregroundStyle(BusinessDesign.onPrimaryControl)
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .background(BusinessDesign.primaryControl, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(saving || detail.operation == nil || !hasUnsavedOperations)
            if detail.operation?.tripStatus.isCompleted == false {
                Button("Отменить бронирование", role: .destructive) { cancellationReason = ""; cancellationDialog = true }
                    .disabled(saving || hasUnsavedOperations)
            }
        }
        .padding(18).businessCard(radius: 28)
    }

    private var suggestedNextStatus: TripStatus? {
        guard let actual = detail?.operation?.tripStatus, status == actual else { return nil }
        let target: TripStatus?
        switch actual {
        case .availabilityCheck: target = .paymentPending
        case .paymentPending: target = .bookingConfirmed
        case .bookingConfirmed: target = .readyToTravel
        case .readyToTravel: target = .inTrip
        case .inTrip: target = .completed
        case .completed, .cancelled: target = nil
        }
        return target.flatMap { currentStatusTargets.contains($0) ? $0 : nil }
    }
    private var statusGuidance: String {
        switch status {
        case .availabilityCheck:
            return "Сейчас проверьте наличие отеля и авиабилетов. Клиент уже может заполнить данные всех паломников."
        case .paymentPending:
            return "Проверьте анкеты и чек оплаты. После подтверждения переведите бронь в следующий статус — клиент увидит это сразу."
        case .bookingConfirmed:
            return "Добавьте авиабилет, PNR, ваучер отеля и остальные документы по отдельности."
        case .readyToTravel:
            return "Убедитесь, что все обязательные документы выданы клиенту и номера бронирования указаны."
        case .inTrip:
            return "Поездка началась. Контролируйте изменения рейса, размещение и обращения клиента."
        case .completed:
            return "Поездка завершена. Проверьте, что история статусов и документы сохранены."
        case .cancelled:
            return "Бронь отменена. Укажите итоговый статус оплаты и внутреннюю причину для команды."
        }
    }

    private func availabilityExpectation(_ operation: BookingOperation) -> some View {
        TimelineView(.periodic(from: .now, by: 15)) { context in
            if let started = lifecycleDate(operation.availabilityStartedAt ?? operation.createdAt) {
                let elapsed = max(0, context.date.timeIntervalSince(started))
                VStack(alignment: .leading, spacing: 8) {
                    Label(elapsed >= 1800 ? "Клиент ожидает дольше 30 минут" : "Ориентир клиента · 30 минут", systemImage: elapsed >= 1500 ? "exclamationmark.clock" : "clock")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(elapsed >= 1500 ? Color.orange : Color.primary)
                    Text(elapsed >= 1800 ? "Проверка продолжается. Сообщите клиенту о задержке." : "Осталось до ориентира: " + lifecycleCountdown(max(0, 1800 - elapsed)))
                        .font(.caption).foregroundStyle(.secondary)
                    if elapsed >= 1800 {
                        Button { Task { await sendAvailabilityDelay() } } label: {
                            Label(sendingAvailabilityDelay ? "Отправляем…" : "Сообщить о задержке (push)", systemImage: "bell.badge")
                        }.buttonStyle(BusinessActionStyle(primary: false)).disabled(sendingAvailabilityDelay)
                    }
                    if let availabilityDelayResult { Text(availabilityDelayResult).font(.caption).foregroundStyle(.secondary) }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(12).background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16))
            }
        }
    }

    @MainActor private func sendAvailabilityDelay() async {
        guard !sendingAvailabilityDelay else { return }
        sendingAvailabilityDelay = true; defer { sendingAvailabilityDelay = false }
        do {
            let sent = try await APIClient.shared.notifyAvailabilityDelay(bookingID: bookingID)
            availabilityDelayResult = sent > 0 ? "APNs принял уведомление для устройств: \(sent)." : "Push не отправлен. Свяжитесь с клиентом через чат или по телефону."
        } catch { availabilityDelayResult = error.localizedDescription }
    }

    @ViewBuilder
    private func lifecycleTimerCard(_ operation: BookingOperation?) -> some View {
        if let operation, let info = lifecycleTimerInfo(operation) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    Image(systemName: info.icon)
                        .font(.system(size: 18, weight: .semibold))
                        .frame(width: 38, height: 38)
                        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 13, style: .continuous))

                    VStack(alignment: .leading, spacing: 3) {
                        Text(info.title)
                            .font(.subheadline.weight(.semibold))
                        Text(info.subtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                if let deadlineRaw = info.deadlineRaw, let deadline = lifecycleDate(deadlineRaw) {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        let remaining = max(0, deadline.timeIntervalSince(context.date))
                        let expired = remaining <= 0
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(expired ? lifecycleExpiredLabel(status: info.status, paymentReceived: info.paymentReceived) : "Осталось")
                                    .font(.caption)
                                    .foregroundStyle(expired ? Color.orange : Color(uiColor: .secondaryLabel))
                                Text(lifecycleCountdown(remaining))
                                    .font(.system(size: 28, weight: .bold, design: .rounded))
                                    .monospacedDigit()
                                    .contentTransition(.numericText())
                            }
                            Spacer(minLength: 10)
                            if info.isPriceLock && expired {
                                Button { Task { await restartPriceLock() } } label: {
                                    if restartingPriceLock {
                                        ProgressView().controlSize(.small)
                                    } else {
                                        Text("Зафиксировать ещё на 30 мин")
                                            .font(.caption.weight(.semibold))
                                    }
                                }
                                .buttonStyle(.bordered)
                                .disabled(restartingPriceLock)
                            }
                        }
                    }
                } else {
                    Text("Срок синхронизируется с сервером")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(14)
            .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
    }

    private func lifecycleTimerInfo(_ operation: BookingOperation) -> (status: TripStatus, paymentReceived: Bool, title: String, subtitle: String, deadlineRaw: String?, icon: String, isPriceLock: Bool)? {
        let status = operation.tripStatus
        let paymentReceived = operation.paymentStatus == "receipt_submitted" || (operation.paymentStatus.isEmpty && operation.paymentReceivedAt != nil)
        switch status {
        case .availabilityCheck:
            return (status, paymentReceived, "Проверка наличия", "Операционный срок — до 6 часов. Клиенту показывается ориентир 30 минут.", operation.availabilityDeadlineAt, "clock.badge.checkmark", false)
        case .paymentPending where operation.paymentStatus == "paid":
            return nil
        case .paymentPending where paymentReceived:
            return (status, paymentReceived, "Подтверждение оплаты", "Чек отправлен. Проверьте фактическое поступление средств. Ориентир проверки — 10 минут.", operation.paymentConfirmationDeadlineAt, "creditcard.and.123", false)
        case .paymentPending:
            return (status, paymentReceived, "Фиксация цены", "Цена удерживается 30 минут. После окончания периода авиабилеты и другие динамические компоненты могут потребовать повторной проверки.", operation.priceLockExpiresAt, "lock.clock", true)
        case .bookingConfirmed:
            return (status, paymentReceived, "Подготовка документов", "Обычно доступные документы готовятся в течение 24 часов. Срок визы может зависеть от доступности официальных визовых систем Саудовской Аравии и внешних ограничений.", operation.documentsDeadlineAt, "doc.badge.clock", false)
        default:
            return nil
        }
    }

    private func flightCard(_ direction: BookingFlightDirection, detail: BookingDetailResponse) -> some View {
        let flight = savedFlight(direction, detail: detail)
        let generated = direction == .outbound ? detail.pricingReport?.selection?.outbound : detail.pricingReport?.selection?.inbound
        let savedNumber = BusinessFlightReference.normalizedFlightNumber(flight?.flightNumber)
        let generatedNumbers = exactGeneratedFlightNumbers(generated)
        let summaryNumber = flightNumberFromSummary(detail.booking.flightName, direction: direction)
        let displayNumber = savedNumber ?? generatedNumbers ?? summaryNumber
        let generatedCode = generated?.segments?.compactMap(\.airlineCode).first
        let airlineCode = normalizedAirlineCode(flight?.airlineIATA) ?? normalizedAirlineCode(generatedCode) ?? BusinessFlightReference.airlineCode(fromFlightNumber: displayNumber?.components(separatedBy: " · ").first)
        let displayAirline = BusinessFlightReference.airlineName(code: airlineCode, fallback: flight?.airlineName.nonEmpty ?? generated?.airline.nonEmpty)
        let origin = direction == .outbound ? detail.booking.originCode : detail.booking.returnOrigin
        let destination = direction == .outbound ? detail.booking.outboundDestination : detail.booking.originCode
        let fallbackDate = direction == .outbound ? detail.booking.startDate : detail.booking.endDate
        let departureDate = displayFlightDate(flight?.scheduledDepartureLocal ?? generated?.departureAt, fallback: fallbackDate)
        let terminal = flight?.departureTerminal.nonEmpty ?? generated?.segments?.first?.originTerminal?.nonEmpty ?? "—"

        return VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                BusinessAirlineLogoView(airlineIATA: airlineCode, size: 44)
                VStack(alignment: .leading, spacing: 4) {
                    Text(direction.title).font(.title2.bold())
                    Text(displayAirline)
                        .font(.subheadline).foregroundStyle(.secondary)
                    if let displayNumber {
                        Text("Рейс \(displayNumber)")
                            .font(.caption.monospaced().weight(.bold))
                            .foregroundStyle(.primary)
                    } else {
                        Text("Номер рейса не подтверждён")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.orange)
                    }
                }
                Spacer()
                Button("Изменить") { editingFlight = direction }
                    .font(.subheadline.bold())
                    .padding(.horizontal, 14).frame(height: 38)
                    .background(BusinessDesign.secondarySurface, in: Capsule())
            }

            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(flight?.departureAirportIATA.nonEmpty ?? generated?.origin.nonEmpty ?? origin).font(.system(size: 26, weight: .bold, design: .rounded))
                    Text(flight?.departureAirportName.nonEmpty ?? "Отправление").font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
                Spacer()
                Image(systemName: "airplane").font(.title3).foregroundStyle(.secondary)
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text(flight?.arrivalAirportIATA.nonEmpty ?? generated?.destination.nonEmpty ?? destination).font(.system(size: 26, weight: .bold, design: .rounded))
                    Text(flight?.arrivalAirportName.nonEmpty ?? "Прибытие").font(.caption).foregroundStyle(.secondary).lineLimit(2).multilineTextAlignment(.trailing)
                }
            }

            Divider()

            HStack(alignment: .top, spacing: 12) {
                flightMetric("Рейс", displayNumber ?? "—")
                flightMetric("Дата", departureDate)
                flightMetric("Терминал", terminal)
            }

            if flight == nil, let segments = exactGeneratedSegments(generated), !segments.isEmpty {
                VStack(spacing: 10) {
                    ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                        generatedFlightSegmentRow(segment)
                    }
                }
                .padding(13)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }

            if let flight {
                HStack(spacing: 7) {
                    Image(systemName: "checkmark.seal.fill").foregroundStyle(.green)
                    Text("Проверено AeroDataBox")
                    if !flight.status.isEmpty { Text("· \(flight.status)") }
                }
                .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            } else if displayNumber != nil {
                HStack(spacing: 7) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                    Text("Точные номера и сегменты сохранены генератором iumrah")
                }
                .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            } else {
                HStack(spacing: 7) {
                    Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.orange)
                    Text("Введите точный номер рейса и дату — система проверит рейс через AeroDataBox перед сохранением.")
                }
                .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(18).businessCard(radius: 28)
    }

    private func exactGeneratedFlightNumbers(_ generated: BookingGeneratorFlightSelection?) -> String? {
        if let segments = generated?.segments {
            let values = segments.compactMap { BusinessFlightReference.normalizedFlightNumber($0.flightNumber) }
            if !values.isEmpty { return deduplicateFlightNumbers(values).joined(separator: " · ") }
        }
        guard let raw = generated?.flightNumbers else { return nil }
        let parts = raw.components(separatedBy: CharacterSet(charactersIn: "·,/+|"))
        let values = parts.compactMap { BusinessFlightReference.normalizedFlightNumber($0) }
        return values.isEmpty ? nil : values.joined(separator: " · ")
    }

    private func exactGeneratedSegments(_ generated: BookingGeneratorFlightSelection?) -> [BookingGeneratorFlightSegmentSelection]? {
        guard let segments = generated?.segments, !segments.isEmpty else { return nil }
        let valid = segments.filter { segment in
            BusinessFlightReference.normalizedFlightNumber(segment.flightNumber) != nil &&
            !segment.origin.isEmpty && !segment.destination.isEmpty &&
            !segment.departureAt.isEmpty && !segment.arrivalAt.isEmpty
        }
        return valid.count == segments.count ? valid : nil
    }

    private func generatedFlightSegmentRow(_ segment: BookingGeneratorFlightSegmentSelection) -> some View {
        let number = BusinessFlightReference.normalizedFlightNumber(segment.flightNumber) ?? segment.flightNumber
        let code = normalizedAirlineCode(segment.airlineCode) ?? BusinessFlightReference.airlineCode(fromFlightNumber: number)
        let airline = BusinessFlightReference.airlineName(code: code, fallback: segment.airline)
        return VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text("\(airline) · \(number)").font(.subheadline.bold())
                Spacer()
                if let aircraft = segment.aircraft?.nonEmpty { Text(aircraft).font(.caption).foregroundStyle(.secondary) }
            }
            HStack {
                Text("\(segment.origin) → \(segment.destination)").font(.subheadline.weight(.semibold))
                Spacer()
                Text(compactFlightDateTime(segment.departureAt)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            if let terminal = segment.originTerminal?.nonEmpty {
                Text("Терминал вылета: \(terminal)").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func normalizedAirlineCode(_ value: String?) -> String? {
        guard let value else { return nil }
        let code = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard code.range(of: "^[A-Z0-9]{2}$", options: .regularExpression) != nil else { return nil }
        return code
    }

    private func flightNumberFromSummary(_ value: String, direction: BookingFlightDirection) -> String? {
        guard let regex = try? NSRegularExpression(pattern: #"\b[A-Z0-9]{2}[\s-]?\d{1,4}\b"#) else { return nil }
        let source = value.uppercased()
        let range = NSRange(source.startIndex..<source.endIndex, in: source)
        let values = regex.matches(in: source, range: range).compactMap { match -> String? in
            guard let swiftRange = Range(match.range, in: source) else { return nil }
            return BusinessFlightReference.normalizedFlightNumber(String(source[swiftRange]))
        }
        guard !values.isEmpty else { return nil }
        if direction == .outbound { return values.first }
        return values.count > 1 ? values.last : values.first
    }

    private func deduplicateFlightNumbers(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.filter { seen.insert($0).inserted }
    }

    private func compactFlightDateTime(_ value: String) -> String {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = withFraction.date(from: value) ?? ISO8601DateFormatter().date(from: value)
        return date?.formatted(.dateTime.day().month(.abbreviated).hour().minute()) ?? String(value.prefix(16))
    }

    private func flightMetric(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased()).font(.caption2.bold()).tracking(1).foregroundStyle(.secondary)
            Text(value).font(.subheadline.bold()).lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func hotelCard(city: String, detail: BookingDetailResponse) -> some View {
        let assigned = city == "Makkah" ? detail.assignment?.makkahHotel : detail.assignment?.madinahHotel
        let fallback = city == "Makkah" ? detail.booking.makkahHotel : detail.booking.madinahHotel
        return HStack(spacing: 14) {
            if let assigned, let url = AppConfig.absoluteURL(assigned.coverImageURL) {
                AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { BusinessDesign.secondarySurface }
                    .frame(width: 82, height: 82).clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            } else {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(BusinessDesign.secondarySurface)
                    .frame(width: 82, height: 82)
                    .overlay(Image(systemName: "building.2.fill").font(.title2).foregroundStyle(.secondary))
            }
            VStack(alignment: .leading, spacing: 5) {
                Text("Отель · \(city)").font(.caption.bold()).foregroundStyle(.secondary)
                Text(assigned?.name ?? (fallback.isEmpty ? "Не выбран" : fallback)).font(.headline).lineLimit(2)
                if let assigned {
                    Text("\(assigned.stars ?? 0)★ · \(assigned.roomCount) типов номеров").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Button("Изменить") { editingHotelCity = city }
                .font(.caption.bold()).padding(.horizontal, 12).frame(height: 36)
                .background(BusinessDesign.secondarySurface, in: Capsule())
        }
        .padding(18).businessCard(radius: 28)
    }

    private func guideCard(_ detail: BookingDetailResponse) -> some View {
        let guide = detail.assignment?.guide
        return HStack(spacing: 14) {
            Circle().fill(BusinessDesign.secondarySurface).frame(width: 70, height: 70)
                .overlay(Text(guideInitials(guide)).font(.title3.bold()))
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    Text("Гид").font(.caption.bold()).foregroundStyle(.secondary)
                    if detail.assignment?.guideIsPrimary == true {
                        Text("Рекомендует iumrah").font(.caption2.bold()).padding(.horizontal, 8).frame(height: 23).background(BusinessDesign.primaryControl, in: Capsule()).foregroundStyle(BusinessDesign.onPrimaryControl)
                    }
                }
                Text(guide?.displayName ?? "Гид не назначен").font(.headline)
                if let preferred = detail.assignment?.preferredGuideID {
                    Text("Выбор клиента: " + (detail.assignment?.preferredGuideName ?? "Профиль недоступен"))
                        .font(.caption.weight(.semibold))
                    if detail.assignment?.guideIsPrimary == true || guide?.id != preferred {
                        Text("Требуется подтверждение назначения").font(.caption2).foregroundStyle(.secondary)
                    }
                }
                if let title = guide?.roleTitle, !title.isEmpty { Text(title).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer()
            Button("Изменить") { showGuidePicker = true }
                .font(.caption.bold()).padding(.horizontal, 12).frame(height: 36)
                .background(BusinessDesign.secondarySurface, in: Capsule())
        }
        .padding(18).businessCard(radius: 28)
    }

    private func tripCard(_ booking: BookingSummary) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Поездка", systemImage: "map.fill").font(.title2.bold())
            detailRow("Маршрут", "\(booking.originCode) → \(booking.outboundDestination) → \(booking.originCode)")
            detailRow("Даты", "\(booking.startDate) – \(booking.endDate)")
            detailRow("Паломников", "\(booking.travelerCount)")
            detailRow("Комнат", "\(booking.rooms)")
            detailRow("Тариф", booking.planId)
            detailRow("На человека", booking.perPilgrimUsd.formatted(.currency(code: "USD")))
        }
        .padding(18).businessCard(radius: 28)
    }

    private func pricingCard(_ detail: BookingDetailResponse) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.snappy(duration: 0.3)) { showPricing.toggle() }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "eye.slash.fill").frame(width: 38, height: 38).background(BusinessDesign.secondarySurface, in: Circle())
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Финансовый отчёт").font(.title2.bold()).foregroundStyle(.primary)
                        Text("Клиентские и внутренние цены").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: showPricing ? "chevron.up" : "chevron.down").font(.caption.bold()).foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)

            if showPricing {
                Divider().padding(.vertical, 14)
                if let report = detail.pricingReport {
                    Button {
                        showPricingEditor = true
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "slider.horizontal.3")
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Изменить стоимости компонентов")
                                    .font(.subheadline.weight(.semibold))
                                Text("Проценты фиксированы · итог пересчитается автоматически")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.caption.bold())
                                .foregroundStyle(.secondary)
                        }
                        .foregroundStyle(.primary)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 56)
                        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .padding(.bottom, 14)
                    if let summary = report.tripSummaryReport {
                        TripSummaryFinancialReportView(report: summary)
                    } else {
                        pricingReportView(report)
                    }
                } else if detail.pricingLines.isEmpty {
                    detailRow("Итого клиенту", detail.booking.totalUsd.formatted(.currency(code: "USD")))
                    detailRow("На паломника", detail.booking.perPilgrimUsd.formatted(.currency(code: "USD")))
                    Text("Для этого старого бронирования генератор ещё не передал детальный pricingSnapshot. Для новых пакетов здесь сохраняется полный отчёт Package Engine: себестоимость, наценка, комиссия и итог по каждому компоненту.")
                        .font(.caption).foregroundStyle(.secondary).padding(.top, 10)
                } else {
                    let groups = groupedPricing(detail.pricingLines)
                    ForEach(Array(groups.enumerated()), id: \.offset) { index, entry in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(entry.0.uppercased()).font(.caption2.bold()).tracking(1.2).foregroundStyle(.secondary)
                            ForEach(entry.1) { line in
                                HStack(alignment: .firstTextBaseline) {
                                    Text(line.label).font(.subheadline)
                                    Spacer(minLength: 12)
                                    Text(line.amount, format: .currency(code: line.currency).precision(.fractionLength(0...2)))
                                        .font(.subheadline.bold()).monospacedDigit()
                                }
                            }
                        }
                        if index < groups.count - 1 { Divider().padding(.vertical, 8) }
                    }
                }
            }
        }
        .padding(18).businessCard(radius: 28)
    }

    @ViewBuilder
    private func pricingReportView(_ report: BookingPricingReport) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if let selection = report.selection {
                Text("ЧТО ВЫБРАЛ ГЕНЕРАТОР").font(.caption2.bold()).tracking(1.2).foregroundStyle(.secondary)
                if let flight = selection.outbound { pricingSelectionRow(icon: "airplane.departure", title: "Перелёт туда", name: pricingFlightDisplayName(flight), subtitle: "\(flight.origin) → \(flight.destination)") }
                if let flight = selection.inbound { pricingSelectionRow(icon: "airplane.arrival", title: "Перелёт обратно", name: pricingFlightDisplayName(flight), subtitle: "\(flight.origin) → \(flight.destination)") }
                if let hotel = selection.makkahHotel { pricingSelectionRow(icon: "building.2.fill", title: "Отель Мекки", name: hotel.hotelName, subtitle: [hotel.roomName, hotel.roomCategory].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")) }
                if let hotel = selection.madinahHotel { pricingSelectionRow(icon: "moon.stars.fill", title: "Отель Медины", name: hotel.hotelName, subtitle: [hotel.roomName, hotel.roomCategory].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")) }
                Divider()
            }

            Text("ИСТОЧНИКИ ЦЕНЫ").font(.caption2.bold()).tracking(1.2).foregroundStyle(.secondary)
            if let journeyFare = report.selectedPricingInputs.journeyFare {
                fareAuditRow(report.context.tripType == "oneWay" ? "Авиабилет в одну сторону" : "Полный билет туда и обратно", journeyFare, currency: report.currency)
            } else {
                if let outbound = report.selectedPricingInputs.outbound { fareAuditRow("Перелёт туда", outbound, currency: report.currency) }
                if let inbound = report.selectedPricingInputs.inbound { fareAuditRow("Перелёт обратно", inbound, currency: report.currency) }
            }
            hotelAuditRow("Отель Мекки", report.selectedPricingInputs.makkahHotel, currency: report.currency)
            if let madinah = report.selectedPricingInputs.madinahHotel { hotelAuditRow("Отель Медины", madinah, currency: report.currency) }

            Divider()
            Text("СЕБЕСТОИМОСТЬ КОМПОНЕНТОВ").font(.caption2.bold()).tracking(1.2).foregroundStyle(.secondary)
            ForEach(report.components) { component in
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(russianPricingComponentLabel(code: component.code, fallback: component.label)).font(.subheadline)
                    Spacer(minLength: 10)
                    Text(component.supplierCostUsd, format: .currency(code: report.currency).precision(.fractionLength(0...2))).font(.subheadline.bold()).monospacedDigit()
                }
            }

            Divider()
            pricingTotalRow("Себестоимость", report.totals.supplierCostUsd, currency: report.currency)
            pricingTotalRow("Наценка \(Int((report.totals.markupRate * 100).rounded()))%", report.totals.markupAmountUsd, currency: report.currency)
            pricingTotalRow("После наценки", report.totals.subtotalAfterMarkupUsd, currency: report.currency)
            pricingTotalRow("Комиссия \(Int((report.totals.paymentFeeRate * 100).rounded()))%", report.totals.paymentFeeAmountUsd, currency: report.currency)
            pricingTotalRow("Расчёт до округления", report.totals.calculatedSellingPriceUsd, currency: report.currency)
            if abs(report.totals.roundingDifferenceUsd) > 0.001 { pricingTotalRow("Округление", report.totals.roundingDifferenceUsd, currency: report.currency) }
            pricingTotalRow("ИТОГО КЛИЕНТУ", report.totals.publicTotalUsd, currency: report.currency, emphasized: true)
            pricingTotalRow("На паломника", report.totals.publicPricePerPilgrimUsd, currency: report.currency, emphasized: true)

            HStack {
                Text("Quote \(report.quoteId.prefix(8)) · \(report.pricingVersion)").font(.caption2.monospaced()).foregroundStyle(.tertiary)
                Spacer()
                Text("Маржа ≈ \(report.totals.estimatedProfitUsd, format: .currency(code: report.currency).precision(.fractionLength(0...2)))").font(.caption.bold()).foregroundStyle(.secondary)
            }
        }
    }

    private func pricingFlightDisplayName(_ flight: BookingGeneratorFlightSelection) -> String {
        let numbers = exactGeneratedFlightNumbers(flight)
        let code = flight.segments?.compactMap(\.airlineCode).compactMap(normalizedAirlineCode).first
            ?? BusinessFlightReference.airlineCode(fromFlightNumber: numbers?.components(separatedBy: " · ").first)
        let airline = BusinessFlightReference.airlineName(code: code, fallback: flight.airline)
        return numbers.map { "\(airline) · \($0)" } ?? "\(airline) · номер не подтверждён"
    }

    private func fareAuditRow(_ title: String, _ fare: BookingPricingFare, currency: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(title).font(.subheadline.weight(.semibold))
                Spacer(minLength: 8)
                Text(fare.normalizedGroupUsd, format: .currency(code: currency).precision(.fractionLength(0...2)))
                    .font(.subheadline.bold()).monospacedDigit()
            }
            Text("Провайдер: \(fare.providerId) · исходная цена \(fare.amount, format: .number.precision(.fractionLength(0...2))) \(fare.currency) · \(fare.fareScope)")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Text("Кандидат: \(fare.candidateId) · дата \(fare.travelDate)")
                .font(.caption2.monospaced()).foregroundStyle(.tertiary).lineLimit(2)
        }
        .padding(12)
        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func hotelAuditRow(_ title: String, _ hotel: BookingPricingHotelInput, currency: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(title).font(.subheadline.weight(.semibold))
                Spacer(minLength: 8)
                Text(hotel.amountUsd, format: .currency(code: currency).precision(.fractionLength(0...2)))
                    .font(.subheadline.bold()).monospacedDigit()
            }
            Text("Ставка: \(hotel.unit) · ночей: \(hotel.nights) · режим: \(hotel.pricingMode ?? "—")")
                .font(.caption).foregroundStyle(.secondary)
            if let hotelId = hotel.hotelId {
                Text("hotel \(hotelId)" + (hotel.roomId.map { " · room \($0)" } ?? ""))
                    .font(.caption2.monospaced()).foregroundStyle(.tertiary).lineLimit(2)
            }
        }
        .padding(12)
        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func russianPricingComponentLabel(code: String, fallback: String) -> String {
        let value = code.lowercased()
        if value.hasPrefix("flight_") || value.contains("airfare") { return "Авиабилет" }
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

    private func pricingSelectionRow(icon: String, title: String, name: String, subtitle: String) -> some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: icon).font(.system(size: 15, weight: .semibold)).frame(width: 34, height: 34).background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.caption.bold()).foregroundStyle(.secondary)
                Text(name).font(.subheadline.bold()).fixedSize(horizontal: false, vertical: true)
                if !subtitle.isEmpty { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 0)
        }
    }

    private func pricingTotalRow(_ title: String, _ amount: Double, currency: String, emphasized: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(title).font(emphasized ? .headline : .subheadline).fontWeight(emphasized ? .bold : .regular)
            Spacer(minLength: 10)
            Text(amount, format: .currency(code: currency).precision(.fractionLength(0...2))).font(emphasized ? .headline : .subheadline).fontWeight(.bold).monospacedDigit()
        }
    }

    private func technicalCard(_ detail: BookingDetailResponse) -> some View {
        DisclosureGroup {
            VStack(spacing: 9) {
                ForEach(detail.requestFields.prefix(80)) { field in
                    HStack(alignment: .top, spacing: 12) {
                        Text(field.label).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                        Text(field.value).multilineTextAlignment(.trailing).frame(maxWidth: .infinity, alignment: .trailing).textSelection(.enabled)
                    }
                    .font(.caption)
                }
            }
            .padding(.top, 12)
        } label: {
            Label("Технические данные бронирования", systemImage: "doc.text.magnifyingglass").font(.headline)
        }
        .padding(18).businessCard(radius: 28)
    }

    private func savedFlight(_ direction: BookingFlightDirection, detail: BookingDetailResponse) -> BookingFlight? {
        detail.flights?.first { $0.direction == direction.rawValue }
    }

    private func displayFlightDate(_ value: String?, fallback: String) -> String {
        guard let value, !value.isEmpty else { return fallback }
        let prefix = String(value.prefix(10))
        return prefix.isEmpty ? fallback : prefix
    }

    private func guideInitials(_ member: BusinessTeamMember?) -> String {
        guard let member else { return "i" }
        let values = [member.firstName, member.lastName].filter { !$0.isEmpty }
        let initials = values.prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
        return initials.isEmpty ? "i" : initials
    }

    private func groupedPricing(_ lines: [BookingPricingLine]) -> [(String, [BookingPricingLine])] {
        Dictionary(grouping: lines, by: \.group).sorted { $0.key < $1.key }
    }

    private func labeledField(_ title: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            TextField(placeholder, text: text)
                .padding(.horizontal, 12).frame(height: 46)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        }
    }

    private func detailRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(title).foregroundStyle(.secondary)
            Spacer()
            Text(value.isEmpty ? "—" : value).multilineTextAlignment(.trailing).fontWeight(.semibold)
        }
        .font(.subheadline)
    }

    private func statusBadge(_ status: TripStatus) -> some View {
        Text(status.title).padding(.horizontal, 10).padding(.vertical, 6).background(BusinessDesign.secondarySurface, in: Capsule())
    }

    private func lifecycleDate(_ value: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFraction.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    private func lifecycleCountdown(_ interval: TimeInterval) -> String {
        let total = max(0, Int(interval.rounded(.down)))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60
        return String(format: "%02d:%02d:%02d", hours, minutes, seconds)
    }

    private func lifecycleExpiredLabel(status: TripStatus, paymentReceived: Bool) -> String {
        switch status {
        case .availabilityCheck: return "SLA истёк · требуется внимание"
        case .paymentPending: return paymentReceived ? "Проверка занимает дольше обычного" : "Срок фиксации завершён"
        case .bookingConfirmed: return "Подготовка занимает дольше обычного"
        default: return "Срок завершён"
        }
    }

    private func shortDate(_ value: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
        return date?.formatted(.dateTime.day().month(.abbreviated).hour().minute()) ?? value
    }

    @MainActor private func load(showLoading: Bool = false) async {
        guard !saving, !restartingPriceLock else { return }
        let generation = UUID()
        loadGeneration = generation
        if showLoading && detail == nil { loading = true }
        defer { if loadGeneration == generation { loading = false } }

        do {
            let value = try await APIClient.shared.bookingDetail(id: bookingID)
            guard !Task.isCancelled, loadGeneration == generation, !saving, !restartingPriceLock else { return }
            // Do not replace local edits (or their comparison baseline) with a background poll.
            guard !hasUnsavedOperations else { return }
            detail = value
            if let operation = value.operation {
                status = operation.tripStatus
                paymentStatus = operation.paymentStatus
                confirmationNumber = operation.confirmationNumber
                internalNotes = operation.internalNotes
            }
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch let error as URLError where error.code == .cancelled {
            return
        } catch {
            guard !Task.isCancelled, loadGeneration == generation else { return }
            errorMessage = error.localizedDescription
        }
    }

    @MainActor private func restartPriceLock() async {
        guard !restartingPriceLock, !saving else { return }
        guard !hasUnsavedOperations else { errorMessage = "Сначала сохраните изменения бронирования."; return }
        loadGeneration = UUID()
        loading = false
        restartingPriceLock = true
        defer { restartingPriceLock = false }
        do {
            let updated = try await APIClient.shared.restartBookingPriceLock(id: bookingID)
            detail = updated
            if let operation = updated.operation {
                status = operation.tripStatus
                paymentStatus = operation.paymentStatus
                confirmationNumber = operation.confirmationNumber
                internalNotes = operation.internalNotes
            }
            NotificationCenter.default.post(name: Notification.Name("iumrah.business.bookingOperationsChanged"), object: bookingID)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor private func save() async {
        guard !saving, !restartingPriceLock else { return }
        loadGeneration = UUID()
        loading = false
        saving = true
        do {
            let updated = try await APIClient.shared.updateBookingOperation(id: bookingID, status: status, paymentStatus: paymentStatus, confirmationNumber: confirmationNumber, internalNotes: internalNotes, cancellationReason: status == .cancelled ? cancellationReason : nil)
            detail = updated
            if let operation = updated.operation {
                status = operation.tripStatus
                paymentStatus = operation.paymentStatus
                confirmationNumber = operation.confirmationNumber
                internalNotes = operation.internalNotes
            }
            NotificationCenter.default.post(name: Notification.Name("iumrah.business.bookingOperationsChanged"), object: bookingID)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
            status = detail?.operation?.tripStatus ?? .availabilityCheck
        }
        saving = false
    }
}

private struct FlightEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    let bookingID: String
    let direction: BookingFlightDirection
    let current: BookingFlight?
    let fallbackDate: String
    let onSaved: (BookingFlight) -> Void

    @State private var flightNumber = ""
    @State private var date = Date()
    @State private var verification: FlightVerificationResponse?
    @State private var selectedCandidateID: String?
    @State private var verifying = false
    @State private var saving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(direction.title).font(.largeTitle.bold())
                        Text("Введите номер и дату. Изменение нельзя подтвердить, пока AeroDataBox не найдёт этот рейс.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("НОМЕР РЕЙСА").font(.caption2.bold()).tracking(1.4).foregroundStyle(.secondary)
                        TextField("Например HY 721", text: $flightNumber)
                            .textInputAutocapitalization(.characters).autocorrectionDisabled()
                            .font(.title3.bold()).padding(.horizontal, 14).frame(height: 54)
                            .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 17, style: .continuous))

                        DatePicker("Дата вылета", selection: $date, displayedComponents: .date)
                            .datePickerStyle(.compact).fontWeight(.semibold)
                    }
                    .padding(18).businessCard(radius: 26)

                    Button {
                        Task { await verify() }
                    } label: {
                        HStack { if verifying { ProgressView().tint(.white) }; Text(verifying ? "Проверяем…" : "Проверить рейс") }
                            .font(.headline).frame(maxWidth: .infinity).frame(height: 56).background(BusinessDesign.primaryControl, in: Capsule()).foregroundStyle(BusinessDesign.onPrimaryControl)
                    }
                    .buttonStyle(.plain).disabled(verifying || flightNumber.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    if let verification {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Label("Рейс найден", systemImage: "checkmark.seal.fill").foregroundStyle(.green).font(.headline)
                                Spacer()
                                Text(verification.cached ? "Кэш" : "AeroDataBox").font(.caption.bold()).foregroundStyle(.secondary)
                            }
                            ForEach(verification.candidates) { candidate in
                                Button { selectedCandidateID = candidate.id } label: {
                                    candidateCard(candidate, selected: selectedCandidateID == candidate.id)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    if let errorMessage {
                        Text(errorMessage).font(.footnote).foregroundStyle(.red).padding(14).frame(maxWidth: .infinity, alignment: .leading).background(Color.red.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
                    }

                    if let verification, selectedCandidateID != nil {
                        Button {
                            Task { await save(verification) }
                        } label: {
                            HStack { if saving { ProgressView().tint(.white) }; Text(saving ? "Сохраняю…" : "Подтвердить изменение") }
                                .font(.headline).frame(maxWidth: .infinity).frame(height: 58).background(Color.green, in: Capsule()).foregroundStyle(.white)
                        }
                        .buttonStyle(.plain).disabled(saving)
                    }
                }
                .padding(18)
            }
            .background(BusinessDesign.background)
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Закрыть") { dismiss() }.foregroundStyle(BusinessDesign.headerInk) }
            }
            .onAppear { prepare() }
        }
    }

    private func candidateCard(_ candidate: FlightVerificationCandidate, selected: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(candidate.flightNumber).font(.title3.bold()).foregroundStyle(.primary)
                    Text(candidate.airlineName.isEmpty ? "Авиакомпания" : candidate.airlineName).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: selected ? "checkmark.circle.fill" : "circle").font(.title2).foregroundStyle(selected ? .green : .secondary)
            }
            HStack {
                Text(candidate.departureAirportIATA.nonEmpty ?? candidate.departureAirportICAO).font(.title2.bold())
                Spacer(); Image(systemName: "airplane").foregroundStyle(.secondary); Spacer()
                Text(candidate.arrivalAirportIATA.nonEmpty ?? candidate.arrivalAirportICAO).font(.title2.bold())
            }
            HStack {
                Text(String(candidate.scheduledDepartureLocal.prefix(16))).font(.caption).foregroundStyle(.secondary)
                Spacer()
                if !candidate.status.isEmpty { Text(candidate.status).font(.caption.bold()).foregroundStyle(.secondary) }
            }
        }
        .padding(16)
        .background(selected ? Color.green.opacity(0.07) : BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(selected ? Color.green.opacity(0.45) : Color.clear, lineWidth: 1))
    }

    private func prepare() {
        if flightNumber.isEmpty { flightNumber = current?.flightNumber ?? "" }
        let source = current?.scheduledDepartureLocal.nonEmpty ?? fallbackDate
        if let parsed = parseDate(source) { date = parsed }
    }

    private func parseDate(_ value: String) -> Date? {
        let raw = String(value.prefix(10))
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: raw)
    }

    @MainActor private func verify() async {
        verifying = true; errorMessage = nil; verification = nil; selectedCandidateID = nil
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"
        do {
            let value = try await APIClient.shared.verifyFlight(number: flightNumber, dateLocal: formatter.string(from: date))
            verification = value
            if value.candidates.count == 1 { selectedCandidateID = value.candidates[0].id }
        } catch { errorMessage = friendlyFlightError(error) }
        verifying = false
    }

    @MainActor private func save(_ verification: FlightVerificationResponse) async {
        guard let selectedCandidateID else { return }
        saving = true; errorMessage = nil
        do {
            let value = try await APIClient.shared.saveVerifiedFlight(bookingID: bookingID, direction: direction, verificationKey: verification.verificationKey, candidateID: selectedCandidateID)
            onSaved(value); dismiss()
        } catch { errorMessage = friendlyFlightError(error) }
        saving = false
    }

    private func friendlyFlightError(_ error: Error) -> String {
        let text = error.localizedDescription
        if text.contains("FLIGHT_NOT_FOUND") { return "Рейс с таким номером в выбранную дату не найден." }
        if text.contains("AERODATABOX_QUOTA_EXCEEDED") { return "Лимит AeroDataBox на этот месяц исчерпан." }
        if text.contains("AERODATABOX_NOT_CONFIGURED") || text.contains("AERODATABOX_AUTH_FAILED") { return "AeroDataBox ещё не подключён к Cloudflare Worker." }
        return text
    }
}

private struct HotelAssignmentPicker: View {
    @Environment(\.dismiss) private var dismiss
    let bookingID: String
    let city: String
    let assignment: BookingAssignment?
    let onSaved: () -> Void
    @State private var hotels: [HotelListItem] = []
    @State private var loading = true
    @State private var savingID: String?
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
                ForEach(hotels.filter { $0.city.caseInsensitiveCompare(city) == .orderedSame && $0.status == "published" }) { hotel in
                    Button { Task { await select(hotel) } } label: {
                        HStack(spacing: 12) {
                            if let url = AppConfig.absoluteURL(hotel.coverImageURL) {
                                AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { BusinessDesign.secondarySurface }
                                    .frame(width: 62, height: 62).clipShape(RoundedRectangle(cornerRadius: 16))
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                Text(hotel.name).font(.headline).foregroundStyle(.primary)
                                Text("\(hotel.stars ?? 0)★ · \(hotel.roomCount) типов номеров").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if savingID == hotel.id { ProgressView() }
                            else if (city == "Makkah" ? assignment?.makkahHotelID : assignment?.madinahHotelID) == hotel.id { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green) }
                        }
                    }.buttonStyle(.plain)
                }
            }
            .listStyle(.plain).navigationTitle("Отель · \(city)").navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Закрыть") { dismiss() }.foregroundStyle(BusinessDesign.headerInk) } }
            .overlay { if loading { ProgressView() } }
            .task { await load() }
        }
    }

    @MainActor private func load() async {
        loading = true
        do { hotels = try await APIClient.shared.hotels() } catch { errorMessage = error.localizedDescription }
        loading = false
    }

    @MainActor private func select(_ hotel: HotelListItem) async {
        savingID = hotel.id
        do {
            _ = try await APIClient.shared.updateBookingAssignment(
                bookingID: bookingID,
                makkahHotelID: city == "Makkah" ? hotel.id : assignment?.makkahHotelID,
                madinahHotelID: city == "Madinah" ? hotel.id : assignment?.madinahHotelID,
                guideID: assignment?.guideIsPrimary == true ? nil : assignment?.guideID
            )
            onSaved(); dismiss()
        } catch { errorMessage = error.localizedDescription }
        savingID = nil
    }
}

private struct GuideAssignmentPicker: View {
    @Environment(\.dismiss) private var dismiss
    let bookingID: String
    let assignment: BookingAssignment?
    let onSaved: () -> Void
    @State private var guides: [BusinessTeamMember] = []
    @State private var loading = true
    @State private var savingID: String?
    @State private var errorMessage: String?

    var body: some View {
        List {
            if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            ForEach(guides.filter { $0.roleKind == "guide" && $0.active }) { guide in
                Button { Task { await select(guide) } } label: {
                    HStack(spacing: 12) {
                        Circle().fill(BusinessDesign.secondarySurface).frame(width: 56, height: 56)
                            .overlay(Text(initials(guide)).font(.headline))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(guide.displayName).font(.headline).foregroundStyle(.primary)
                            Text(guide.roleTitle.isEmpty ? "Гид iumrah" : guide.roleTitle).font(.caption).foregroundStyle(.secondary)
                            if assignment?.preferredGuideID == guide.id { Text("Выбор клиента").font(.caption.weight(.semibold)).foregroundStyle(.primary) }
                        }
                        Spacer()
                        if savingID == guide.id { ProgressView() }
                        else if assignment?.guideID == guide.id && assignment?.guideIsPrimary == false { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green) }
                    }
                }.buttonStyle(.plain).disabled(savingID != nil)
            }
        }
        .listStyle(.plain).navigationTitle("Выбрать гида").navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
        .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Закрыть") { dismiss() }.foregroundStyle(BusinessDesign.headerInk) } }
        .overlay { if loading { ProgressView() } }
        .task { await load() }
    }

    @MainActor private func load() async {
        loading = true
        do { guides = try await APIClient.shared.businessTeam() } catch { errorMessage = error.localizedDescription }
        loading = false
    }

    @MainActor private func select(_ guide: BusinessTeamMember) async {
        savingID = guide.id
        do {
            _ = try await APIClient.shared.updateBookingAssignment(bookingID: bookingID, makkahHotelID: assignment?.makkahHotelID, madinahHotelID: assignment?.madinahHotelID, guideID: guide.id)
            onSaved(); dismiss()
        } catch {
            let message = error.localizedDescription
            errorMessage = message.contains("GUIDE_BUSY_ON_DATES") ? "Гид уже назначен другой семье на пересекающиеся даты. Выберите другого гида." : message
        }
        savingID = nil
    }

    private func initials(_ guide: BusinessTeamMember) -> String {
        let pieces = [guide.firstName, guide.lastName].filter { !$0.isEmpty }
        let result = pieces.prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
        return result.isEmpty ? "i" : result
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}

private struct ServiceOperationEditor: View {
    @Environment(\.dismiss) private var dismiss
    let bookingID: String; let service: BookingServiceOperation; let inTrip: Bool; let onSaved: () -> Void
    @State private var availability = "pending"
    @State private var execution = "planned"
    @State private var reference = ""
    @State private var note = ""
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        Form {
            Section("Наличие") { Picker("Состояние", selection: $availability) { Text("Ожидается").tag("pending"); Text("Подтверждено").tag("confirmed"); Text("Недоступно").tag("unavailable") } }
            if inTrip { Section("Исполнение") { Picker("Состояние", selection: $execution) { ForEach(["planned","in_progress","completed","delayed","rescheduled"], id: \.self) { Text(BookingServiceOperation.executionTitle($0)).tag($0) } } } }
            Section("Подтверждение поставщика") { TextField("PNR / номер ваучера / контакт", text: $reference); TextField("Причина / внутренняя заметка", text: $note, axis: .vertical) }
            if let error { Text(error).foregroundStyle(.red) }
            Button(busy ? "Сохраняем…" : "Сохранить") { Task { await save() } }.disabled(busy)
        }.navigationTitle(service.label).navigationBarTitleDisplayMode(.inline).businessNavigationSurface().onAppear { availability = service.availability; execution = service.execution; reference = service.reference; note = service.note }
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Закрыть") { dismiss() }.foregroundStyle(BusinessDesign.headerInk).disabled(busy) } }
    }
    @MainActor private func save() async {
        busy = true; defer { busy = false }
        do { _ = try await APIClient.shared.saveServiceOperation(bookingID: bookingID, key: service.key, availability: availability, execution: execution, reference: reference, note: note); onSaved(); dismiss() }
        catch { self.error = error.localizedDescription }
    }
}
private struct OperationsManagerPicker: View {
    @Environment(\.dismiss) private var dismiss
    let bookingID: String; let onSaved: () -> Void
    @State private var members: [BusinessTeamMember] = []
    @State private var error: String?
    @State private var busy = false
    var body: some View {
        List {
            if let error { Text(error).foregroundStyle(.red) }
            ForEach(members.filter { $0.active && ["owner","manager","operations"].contains($0.roleKind) }) { member in
                Button(member.displayName) { Task { await select(member.id) } }.disabled(busy)
            }
        }.navigationTitle("Ответственный менеджер").navigationBarTitleDisplayMode(.inline).businessNavigationSurface().task {
            do { members = try await APIClient.shared.businessTeam() } catch { self.error = error.localizedDescription }
        }.toolbar { ToolbarItem(placement: .cancellationAction) { Button("Закрыть") { dismiss() }.foregroundStyle(BusinessDesign.headerInk).disabled(busy) } }
    }
    @MainActor private func select(_ id: String) async {
        busy = true; defer { busy = false }
        do { _ = try await APIClient.shared.assignBookingManager(bookingID: bookingID, memberID: id); onSaved(); dismiss() }
        catch { self.error = error.localizedDescription }
    }
}
private struct OperationsRefundEditor: View {
    @Environment(\.dismiss) private var dismiss
    let bookingID: String; let availableCents: Int; let onSaved: () -> Void
    @State private var amount = ""
    @State private var reference = ""
    @State private var confirmed = false
    @State private var busy = false
    @State private var error: String?
    private var value: Double? { Double(amount.replacingOccurrences(of: ",", with: ".")) }
    var body: some View {
        Form {
            Text("Доступно к учёту: \((Double(availableCents)/100).formatted(.currency(code: "USD")))")
            TextField("Сумма USD", text: $amount).keyboardType(.decimalPad)
            TextField("Номер операции банка", text: $reference)
            Toggle("Подтверждаю фактическое перечисление средств", isOn: $confirmed)
            if let error { Text(error).foregroundStyle(.red) }
            Button("Зафиксировать возврат") { Task { await save() } }.disabled(busy || !confirmed || reference.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (value ?? 0) <= 0 || (value ?? 0) > Double(availableCents)/100)
        }.navigationTitle("Возврат").navigationBarTitleDisplayMode(.inline).businessNavigationSurface().toolbar { ToolbarItem(placement: .cancellationAction) { Button("Закрыть") { dismiss() }.foregroundStyle(BusinessDesign.headerInk).disabled(busy) } }
    }
    @MainActor private func save() async {
        guard let value else { return }; busy = true; defer { busy = false }
        do { _ = try await APIClient.shared.recordBookingRefund(bookingID: bookingID, amountUsd: value, reference: reference); onSaved(); dismiss() }
        catch { self.error = error.localizedDescription }
    }
}

private struct TravelFinanceCloseEditor: View {
    @Environment(\.dismiss) private var dismiss
    let bookingID: String; let paidCents: Int; let refundedCents: Int; let onSaved: () -> Void
    @State private var expense = ""
    @State private var reason = ""
    @State private var confirmed = false
    @State private var saving = false
    @State private var failure: String?
    private var retained: Int { max(0, paidCents - refundedCents) }
    private var expenseValue: Double? { Double(expense.replacingOccurrences(of: ",", with: ".")) }
    var body: some View {
        Form {
            Section("Итог (USD)") {
                LabeledContent("Поступления", value: (Double(paidCents)/100).formatted(.currency(code: "USD")))
                LabeledContent("Возвраты", value: (Double(refundedCents)/100).formatted(.currency(code: "USD")))
                LabeledContent("Остаток у компании", value: (Double(retained)/100).formatted(.currency(code: "USD")))
                TextField("Фактические расходы, USD", text: $expense).keyboardType(.decimalPad)
                TextField("Основание закрытия / удержания", text: $reason, axis: .vertical)
                Toggle("Поступления, расходы и возвраты сверены", isOn: $confirmed)
                Text("Убедитесь, что удержание соответствует договору и возвраты выполнены. Запись нельзя изменить обычным способом.").font(.caption).foregroundStyle(.secondary)
            }
            if let failure { Text(failure).foregroundStyle(.red) }
            Button(saving ? "Сохранение…" : "Подтвердить закрытие") { Task { await save() } }.disabled(saving || !confirmed || reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || expenseValue == nil || (expenseValue ?? -1) < 0)
        }.navigationTitle("Закрытие финансов").navigationBarTitleDisplayMode(.inline).businessNavigationSurface().toolbar { ToolbarItem(placement: .cancellationAction) { Button("Закрыть") { dismiss() }.foregroundStyle(BusinessDesign.headerInk).disabled(saving) } }
    }
    @MainActor private func save() async {
        guard let expenseValue, !saving, confirmed else { return }; saving = true; failure = nil; defer { saving = false }
        do { _ = try await APIClient.shared.closeTravelFinance(bookingID: bookingID, expenseUsd: expenseValue, retainedUsd: Double(retained)/100, reason: reason); onSaved(); dismiss() }
        catch { failure = error.localizedDescription }
    }
}


private struct HistoricalPaymentEditor: View {
    @Environment(\.dismiss) private var dismiss
    let bookingID: String; let dueCents: Int; let paidCents: Int; let cancelled: Bool; let onSaved: () -> Void
    @State private var amount = ""; @State private var reference = ""; @State private var reason = ""
    @State private var confirmed = false; @State private var busy = false; @State private var failure: String?
    private var value: Double? { Double(amount.replacingOccurrences(of: ",", with: ".")) }
    private var maximum: Double { Double(max(0, dueCents-paidCents))/100 }
    var body: some View {
        Form {
            Section("Финансовая сверка · USD") {
                LabeledContent("Уже подтверждено", value: (Double(paidCents)/100).formatted(.currency(code: "USD")))
                LabeledContent("Не учтено по стоимости", value: maximum.formatted(.currency(code: "USD")))
                TextField("Фактически получено дополнительно, USD", text: $amount).keyboardType(.decimalPad)
                TextField("Номер выписки / операции", text: $reference)
                TextField("Основание сверки", text: $reason, axis: .vertical)
                Toggle("Проверил фактические поступления; двойного учёта нет", isOn: $confirmed)
                Text("Это одноразовая запись сверки, а не новый платёж. Для завершённой поездки поступления должны соответствовать стоимости. Для отменённой поездки укажите фактически полученную сумму. Не вводите предположительные данные.").font(.caption).foregroundStyle(.secondary)
            }
            if let failure { Text(failure).foregroundStyle(.red) }
            Button("Зафиксировать сверку") { Task { await save() } }.disabled(busy || !confirmed || reference.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || value == nil || (value ?? -1) < 0 || (value ?? 0) > maximum || (!cancelled && abs((value ?? -1)-maximum) > 0.001))
        }.navigationTitle("Сверка платежей").navigationBarTitleDisplayMode(.inline).businessNavigationSurface().toolbar { ToolbarItem(placement: .cancellationAction) { Button("Закрыть") { dismiss() }.foregroundStyle(BusinessDesign.headerInk).disabled(busy) } }
    }
    @MainActor private func save() async {
        guard let value else { return }; busy = true; defer { busy = false }
        do { _ = try await APIClient.shared.reconcileHistoricalPayment(bookingID: bookingID, addedUsd: value, reference: reference, reason: reason); onSaved(); dismiss() } catch { failure = error.localizedDescription }
    }
}
private struct CertificateCorrectionEditor: View {
    @Environment(\.dismiss) private var dismiss
    let bookingID: String; let certificate: BusinessUmrahCertificate; let onSaved: () -> Void
    @State private var action = "correct"; @State private var name = ""; @State private var reason = ""
    @State private var confirmed = false; @State private var busy = false; @State private var failure: String?
    var body: some View {
        Form {
            Section("Действующий сертификат") { Text(certificate.name); Text(certificate.id).font(.caption.monospaced()).textSelection(.enabled) }
            Section {
                Picker("Действие", selection: $action) { Text("Исправить имя").tag("correct"); Text("Отозвать").tag("revoke") }.pickerStyle(.segmented)
                if action == "correct" { TextField("Исправленные имя и фамилия", text: $name) }
                TextField("Причина", text: $reason, axis: .vertical)
                Toggle("Проверил данные и подтверждаю действие", isOn: $confirmed)
                Text("Старая версия исчезнет из приложения. Уже сохранённые или отправленные PDF удалённо отозвать невозможно. История сохранится.").font(.caption).foregroundStyle(.secondary)
            }
            if let failure { Text(failure).foregroundStyle(.red) }
            Button(action == "revoke" ? "Отозвать сертификат" : "Заменить сертификат", role: action == "revoke" ? .destructive : nil) { Task { await save() } }.disabled(busy || !confirmed || reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (action == "correct" && name.split(whereSeparator: { $0.isWhitespace }).count < 2))
        }.navigationTitle("Управление сертификатом").navigationBarTitleDisplayMode(.inline).businessNavigationSurface().onAppear { name = certificate.name }.toolbar { ToolbarItem(placement: .cancellationAction) { Button("Закрыть") { dismiss() }.foregroundStyle(BusinessDesign.headerInk).disabled(busy) } }
    }
    @MainActor private func save() async {
        busy = true; defer { busy = false }
        do { _ = try await APIClient.shared.correctTravelCertificate(bookingID: bookingID, certificateID: certificate.id, action: action, correctedName: name, reason: reason); onSaved(); dismiss() } catch { failure = error.localizedDescription }
    }
}
