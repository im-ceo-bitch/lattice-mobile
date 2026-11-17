import SwiftUI
import UIKit

struct BusinessOffersView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var offers: [BusinessOffer] = []
    @State private var loading = true
    @State private var error: String?
    @State private var filter = "all"
    @State private var selected: BusinessOffer?
    @State private var hasLoaded = false
    @State private var showConcierge = false
    @State private var generation = UUID()
    let search: String
    private var filtered: [BusinessOffer] {
        offers.filter { offer in
            let matches = filter == "all" || (filter == "active" ? offer.active : offer.status == filter)
            return matches && (search.isEmpty || [offer.id, offer.makkah, offer.bookingID ?? ""].contains { $0.localizedCaseInsensitiveContains(search) })
        }
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                BusinessPageHeading(title: "Предложения", subtitle: "Персональные пакеты и продажи")
                Button { showConcierge = true } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "bubble.left.and.bubble.right.fill").foregroundStyle(BusinessDesign.ink).font(.title2).frame(width: 44, height: 44).background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 15))
                        VStack(alignment: .leading, spacing: 4) { Text("iumrah Concierge").font(.headline); Text("Входящие заявки на индивидуальный расчёт").font(.caption).foregroundStyle(.secondary) }
                        Spacer(); Image(systemName: "chevron.right").foregroundStyle(.secondary)
                    }.padding(16).frame(maxWidth: .infinity, alignment: .leading).businessCard(radius: 20)
                }.buttonStyle(.plain)
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    metric("Активные", String(offers.filter(\.active).count))
                    metric("Просмотренные", String(offers.filter { $0.firstViewedAt != nil }.count))
                    metric("Забронированные", String(offers.filter { $0.status == "converted" }.count))
                    metric("Потенциальные продажи", offers.filter(\.active).reduce(0) { $0 + $1.totalUsd }.formatted(.currency(code: "USD").precision(.fractionLength(0))))
                }
                Text(hasLoaded ? "По последним \(offers.count) предложениям" : "Данные ещё не загружены").font(.caption).foregroundStyle(.secondary)
                Picker("Статус", selection: $filter) {
                    Text("Все").tag("all"); Text("Активные").tag("active"); Text("Брони").tag("converted"); Text("Истекли").tag("expired"); Text("Отозваны").tag("revoked")
                }.pickerStyle(.menu)
                if let error { Label(error, systemImage: "exclamationmark.circle").foregroundStyle(.red); Button("Повторить") { Task { await load() } } }
                if loading && offers.isEmpty { ProgressView().frame(maxWidth: .infinity).padding() }
                else if filtered.isEmpty { ContentUnavailableView("Нет предложений", systemImage: "doc.text", description: Text("Создайте пакет или измените фильтр.")) }
                ForEach(filtered) { offer in
                    Button { selected = offer } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack { Text("ID · " + String(offer.id.suffix(8))).font(.caption.monospaced()); Spacer(); Text(offer.statusTitle).font(.caption.weight(.semibold)).foregroundStyle(offer.active ? BusinessDesign.ink : BusinessDesign.muted) }
                            Text(offer.makkah).font(.headline)
                            Text("\(offer.startDate) — \(offer.endDate) · \(offer.travelers) чел.").font(.caption).foregroundStyle(.secondary)
                            HStack { Text(offer.totalUsd, format: .currency(code: "USD")).font(.title3.bold()); Spacer(); Label("\(offer.views)", systemImage: "eye").font(.caption); Image(systemName: "chevron.right").font(.caption) }
                        }.padding(16).frame(maxWidth: .infinity, alignment: .leading).businessCard(radius: 20)
                    }.buttonStyle(.plain)
                }
            }.businessAdaptiveReadableWidth().padding(20)
        }
        .refreshable { await load() }
        .task { await load(); openPending() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await load(); openPending() } } }
        .onReceive(NotificationCenter.default.publisher(for: .iumrahBusinessOfferChanged)) { _ in Task { await load(); openPending() } }
        .onReceive(NotificationCenter.default.publisher(for: .iumrahBusinessOfferOpen)) { _ in Task { await load(); openPending() } }
        .sheet(isPresented: $showConcierge) { NavigationStack { ConciergeRequestsView() } }
        .sheet(item: $selected, onDismiss: { Task { await load() } }) { offer in
            NavigationStack { BusinessOfferDetailView(id: offer.id, modal: true) }
        }
    }
    private func metric(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(hasLoaded ? value : "—").font(.title2.bold()).lineLimit(1).minimumScaleFactor(0.55)
            Text(title).font(.caption).foregroundStyle(.secondary)
        }.padding(14).frame(maxWidth: .infinity, alignment: .leading).businessCard(radius: 16)
    }
    @MainActor private func load() async {
        let token = UUID(); generation = token; loading = true
        defer { if generation == token { loading = false } }
        do { let result = try await APIClient.shared.listOffers(); if generation == token { offers = result; error = nil; hasLoaded = true } }
        catch { if generation == token { self.error = error.localizedDescription } }
    }
    private func openPending() {
        guard let id = BusinessNotificationRoute.pendingOffer, let offer = offers.first(where: { $0.id == id }) else { return }
        BusinessNotificationRoute.pendingOffer = nil; selected = offer
    }
}

struct BusinessOfferDetailView: View {
    let id: String
    var modal = false
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    @State private var detail: BusinessOfferDetail?
    @State private var loading = true
    @State private var working = false
    @State private var error: String?
    @State private var edit = false
    @State private var accept = false
    @State private var revoke = false
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var phone = ""
    @State private var email = ""
    @State private var sendEmail = false
    @State private var receipt: BusinessManualBookingReceipt?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let detail {
                    let offer = detail.offer
                    VStack(alignment: .leading, spacing: 10) {
                        Text("PACKAGE ID").font(.caption.weight(.semibold)).tracking(2).foregroundStyle(.secondary)
                        Text(offer.id).font(.caption.monospaced()).textSelection(.enabled)
                        Text("Индивидуальная умра").font(BusinessDesign.TypeStyle.hero)
                        Text(offer.statusTitle).font(.subheadline.weight(.semibold)).foregroundStyle(offer.active ? BusinessDesign.ink : BusinessDesign.muted)
                        Text("\(offer.startDate) — \(offer.endDate) · \(offer.travelers) чел.").foregroundStyle(.secondary)
                        Text(offer.totalUsd, format: .currency(code: "USD")).font(.largeTitle.bold())
                        Text("\(offer.views) открытий ссылки · до \(dateLabel(offer.expiresAt))").font(.caption).foregroundStyle(.secondary)
                    }.padding(18).frame(maxWidth: .infinity, alignment: .leading).businessCard(radius: 24)
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Действия").font(BusinessDesign.TypeStyle.section)
                        if let bookingID = offer.bookingID {
                            NavigationLink { BookingDetailView(bookingID: bookingID) } label: { Label("Открыть бронирование", systemImage: "suitcase.rolling") }.buttonStyle(BusinessActionStyle())
                            if let receipt { Text("Email: \(receipt.emailDescription)").font(.caption) }
                            Button("Проверить отправку и ID") { Task { await convert(offer) } }.buttonStyle(BusinessActionStyle(primary: false)).disabled(working)
                        } else if offer.active {
                            Button { accept = true } label: { Label("Оформить за клиента", systemImage: "suitcase.rolling") }.buttonStyle(BusinessActionStyle(primary: false)).disabled(working)
                        }
                        if offer.status != "revoked", let url = URL(string: offer.shareURL) {
                            ShareLink(item: url) { Label("Поделиться ссылкой", systemImage: "square.and.arrow.up") }.buttonStyle(BusinessActionStyle(primary: offer.active || offer.bookingID == nil))
                            if let preview = previewURL(url) { Link(destination: preview) { Label("Предпросмотр без учёта просмотра", systemImage: "eye") }.buttonStyle(BusinessActionStyle(primary: false)) }
                        }
                        if offer.active && offer.sentAt == nil {
                            Button("Отметить отправленным") { Task { await action(offer, "sent") } }.buttonStyle(BusinessActionStyle(primary: false)).disabled(working)
                            Text("Отметка не отправляет сообщение автоматически.").font(.caption).foregroundStyle(.secondary)
                        }
                        if offer.editable {
                            Button { edit = true } label: { Label("Изменить пакет и срок", systemImage: "pencil") }.buttonStyle(BusinessActionStyle(primary: false)).disabled(working || detail.editorDraft.isEmpty)
                            Button("Отозвать предложение", role: .destructive) { revoke = true }.font(.subheadline.weight(.medium)).frame(minHeight: 44).disabled(working)
                        }
                    }.padding(16).businessCard(radius: BusinessDesign.Radius.card)
                    Text("История событий").font(BusinessDesign.TypeStyle.section)
                    ForEach(Array(detail.events.enumerated()), id: \.offset) { _, event in
                        HStack { Image(systemName: "clock").foregroundStyle(.secondary); VStack(alignment: .leading) { Text(event.title); Text(dateLabel(event.createdAt)).font(.caption).foregroundStyle(.secondary) }; Spacer() }.padding(.vertical, 5)
                    }
                }
                if let error { Text(error).foregroundStyle(.red); Button("Обновить") { Task { await load() } } }
                if loading { ProgressView().frame(maxWidth: .infinity) }
            }.businessAdaptiveReadableWidth().padding(20)
        }
        .background(BusinessDesign.background)
        .navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
        .toolbar {
            ToolbarItem(placement: .principal) { BusinessBrandLogo(width: 150, foreground: .white).frame(height: 36) }
            if modal { ToolbarItem(placement: .topBarLeading) { Button("Закрыть") { dismiss() }.foregroundStyle(.white) } }
        }
        .task { await load() }.refreshable { await load() }
        .sheet(isPresented: $edit, onDismiss: { Task { await load() } }) {
            if let detail, let draft = try? JSONDecoder().decode(UmrahPackageDraft.self, from: Data(detail.editorDraft.utf8)) {
                NavigationStack { UmrahBuilderView(owner: auth.user?.login ?? "", editingOffer: detail.offer, initial: draft) }
            } else { ContentUnavailableView("Черновик недоступен", systemImage: "exclamationmark.circle") }
        }
        .sheet(isPresented: $accept) {
            NavigationStack {
                Form {
                    Section("Контакт паломника") {
                        TextField("Имя как в паспорте", text: $firstName).textContentType(.givenName)
                        TextField("Фамилия как в паспорте", text: $lastName).textContentType(.familyName)
                        TextField("Телефон +998…", text: $phone).keyboardType(.phonePad)
                        TextField("Email", text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                        Toggle("Отправить подтверждение на email", isOn: $sendEmail)
                    }
                    Section { Text("Будет создана заявка на проверку наличия. Оплата пока не требуется.").font(.caption); Button("Создать бронирование") { if let offer = detail?.offer { Task { await convert(offer) } } }.disabled(working || firstName.trimmingCharacters(in: .whitespaces).isEmpty || lastName.trimmingCharacters(in: .whitespaces).isEmpty || phone.range(of: #"^\+[1-9][0-9]{7,14}$"#, options: .regularExpression) == nil) }
                    if let error { Text(error).foregroundStyle(.red) }
                }.navigationTitle("Бронирование").navigationBarTitleDisplayMode(.inline).businessNavigationSurface().toolbar { ToolbarItem(placement: .cancellationAction) { Button("Закрыть") { accept = false }.foregroundStyle(BusinessDesign.headerInk) } }
            }
        }
        .confirmationDialog("Отозвать предложение?", isPresented: $revoke, titleVisibility: .visible) { Button("Отозвать", role: .destructive) { if let offer = detail?.offer { Task { await action(offer, "revoke") } } } } message: { Text("Ссылка перестанет открываться. Это действие не отменяет уже созданные бронирования.") }
    }
    private func previewURL(_ url: URL) -> URL? { var c = URLComponents(url: url, resolvingAgainstBaseURL: false); c?.queryItems = [URLQueryItem(name: "preview", value: "1")]; return c?.url }
    private func dateLabel(_ value: String) -> String { if let date = UmrahPackageDraft.date(value) { return date.formatted(date: .abbreviated, time: .shortened) }; return value }
    @MainActor private func load() async { loading = true; defer { loading = false }; do { detail = try await APIClient.shared.offerDetail(id: id); error = nil } catch { self.error = error.localizedDescription } }
    @MainActor private func action(_ offer: BusinessOffer, _ action: String) async { guard !working else { return }; working = true; defer { working = false }; do { _ = try await APIClient.shared.changeOffer(offer, action: action); await load(); NotificationCenter.default.post(name: .iumrahBusinessOfferChanged, object: id) } catch { self.error = error.localizedDescription } }
    @MainActor private func convert(_ offer: BusinessOffer) async { guard !working else { return }; working = true; defer { working = false }; do { let result = try await APIClient.shared.acceptOffer(offer, firstName: firstName, lastName: lastName, phone: phone, email: email, sendEmail: sendEmail); receipt = result; accept = false; await load(); NotificationCenter.default.post(name: .iumrahBusinessOfferChanged, object: id); NotificationCenter.default.post(name: .iumrahBusinessBookingChanged, object: result.bookingID) } catch { self.error = error.localizedDescription } }
}


struct ConciergeRequestsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var auth: AuthStore
    @State private var requests: [ConciergeCareRequest] = []
    @State private var loading = true
    @State private var hasLoaded = false
    @State private var error: String?
    @State private var working: String?
    @State private var filter = "active"
    @State private var search = ""
    @State private var selectedID: String?
    @State private var confirmStatus: String?
    @State private var showConfirm = false
    @State private var showBuilder = false
    @State private var generation = UUID()
    private let states = [("IN_REVIEW", "Взять в работу"), ("QUOTING", "Начать расчёт"), ("READY", "Предложение готово"), ("CONTACTED", "Связались"), ("COMPLETED", "Закрыть заявку"), ("CANCELLED", "Отменить заявку")]
    private let filters = [("active", "Активные"), ("CARE_REQUEST", "Новые"), ("READY", "Готовые"), ("closed", "Закрытые"), ("all", "Все")]
    private func closed(_ item: ConciergeCareRequest) -> Bool { ["COMPLETED", "CANCELLED"].contains(item.status) }
    private var selected: ConciergeCareRequest? { requests.first { $0.id == selectedID } }
    private var visible: [ConciergeCareRequest] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return requests.filter { item in
            let matches = filter == "all" || (filter == "active" && !closed(item)) || (filter == "closed" && closed(item)) || item.status == filter
            return matches && (query.isEmpty || [item.id, item.contact_name, item.contact_phone, item.contact_telegram ?? "", item.origin_code].contains { $0.localizedCaseInsensitiveContains(query) })
        }.sorted { a, b in
            if (a.status == "CARE_REQUEST") != (b.status == "CARE_REQUEST") { return a.status == "CARE_REQUEST" }
            return a.created_at > b.created_at
        }
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BusinessDesign.Space.md) {
                BusinessPageHeading(title: "Concierge", subtitle: "Входящие заявки на индивидуальный расчёт")
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    metric("Новые", count: requests.filter { $0.status == "CARE_REQUEST" }.count, filter: "CARE_REQUEST")
                    metric("Активные", count: requests.filter { !closed($0) }.count, filter: "active")
                    metric("Готовые", count: requests.filter { $0.status == "READY" }.count, filter: "READY")
                    metric("Закрытые", count: requests.filter { closed($0) }.count, filter: "closed")
                }
                Text("По последним \(requests.count) загруженным заявкам. Заявка не является бронированием.")
                    .font(.caption).foregroundStyle(BusinessDesign.muted)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(filters.indices, id: \.self) { index in
                            Button { filter = filters[index].0 } label: {
                                Text(filters[index].1).font(.subheadline.weight(.semibold)).padding(.horizontal, 14).frame(minHeight: BusinessDesign.Size.tap)
                                    .foregroundStyle(filter == filters[index].0 ? BusinessDesign.onAccent : BusinessDesign.ink)
                                    .background(filter == filters[index].0 ? BusinessDesign.accent : BusinessDesign.secondarySurface, in: Capsule())
                            }.buttonStyle(.plain).accessibilityAddTraits(filter == filters[index].0 ? .isSelected : [])
                        }
                    }
                }
                if let error { errorPanel(error) }
                if loading && !hasLoaded { ProgressView().frame(maxWidth: .infinity).padding() }
                else if hasLoaded && visible.isEmpty { ContentUnavailableView("Нет заявок", systemImage: "bubble.left.and.bubble.right", description: Text("Измените фильтр или запрос поиска.")) }
                ForEach(visible) { item in
                    Button { selectedID = item.id } label: { requestRow(item) }.buttonStyle(.plain)
                }
            }.businessAdaptiveReadableWidth().padding(BusinessDesign.Space.page)
        }
        .background(BusinessDesign.background)
        .navigationTitle("Заявки Concierge").navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Готово") { dismiss() }.foregroundStyle(BusinessDesign.headerInk) } }
        .searchable(text: $search, prompt: "Имя, телефон, ID, город")
        .task { await load() }.refreshable { await load() }
        .sheet(isPresented: Binding(get: { selectedID != nil }, set: { if !$0 { selectedID = nil } })) {
            NavigationStack {
                Group {
                    if let item = selected { requestDetail(item) }
                    else { ContentUnavailableView("Заявка недоступна", systemImage: "doc.text") }
                }
                .navigationTitle("Заявка Concierge").navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Готово") { selectedID = nil }.foregroundStyle(BusinessDesign.headerInk) } }
                .confirmationDialog("Подтвердить действие?", isPresented: $showConfirm, titleVisibility: .visible) {
                    Button("Подтвердить", role: confirmStatus == "CANCELLED" ? .destructive : nil) {
                        if let item = selected, let state = confirmStatus { Task { await update(item, state) } }
                    }
                    Button("Назад", role: .cancel) { confirmStatus = nil }
                } message: { Text("Состояние заявки будет изменено. Бронирование автоматически не создаётся.") }
                .sheet(isPresented: $showBuilder, onDismiss: { Task { await load() } }) {
                    if let item = selected {
                        NavigationStack { UmrahBuilderView(owner: (auth.user?.login ?? "") + ":concierge:" + item.id, initial: draft(for: item), preferOffer: true) }
                    }
                }
            }
        }
    }
    private func metric(_ title: String, count: Int, filter value: String) -> some View {
        Button { filter = value } label: {
            VStack(alignment: .leading, spacing: 5) {
                Text(hasLoaded ? String(count) : "—").font(BusinessDesign.TypeStyle.section).monospacedDigit()
                Text(title).font(.caption).foregroundStyle(BusinessDesign.muted)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(14).businessCard(radius: BusinessDesign.Radius.compact)
        }.buttonStyle(.plain).accessibilityAddTraits(filter == value ? .isSelected : [])
    }
    private func requestRow(_ item: ConciergeCareRequest) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label(item.source == "telegram" ? "Telegram" : "Care", systemImage: "bubble.left.and.bubble.right").font(.caption.weight(.semibold)).foregroundStyle(BusinessDesign.muted)
                Spacer(); statusLabel(item)
            }
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.contact_name).font(BusinessDesign.TypeStyle.title).foregroundStyle(BusinessDesign.ink)
                    Text("\(item.origin_code) · \(item.adults + item.children + item.infants) чел. · \(item.rooms) ном.").font(.subheadline).foregroundStyle(BusinessDesign.muted)
                }
                Spacer(); Image(systemName: "chevron.right").foregroundStyle(BusinessDesign.muted)
            }
            Text(dateRange(item)).font(.caption).foregroundStyle(BusinessDesign.muted)
            Text(item.id).font(.caption.monospaced()).foregroundStyle(BusinessDesign.muted)
        }.padding(BusinessDesign.Space.md).frame(maxWidth: .infinity, alignment: .leading).businessCard()
    }
    private func statusLabel(_ item: ConciergeCareRequest) -> some View {
        Text(item.statusTitle).font(.caption.weight(.semibold)).foregroundStyle(item.status == "CARE_REQUEST" ? BusinessDesign.securityBlue : BusinessDesign.ink)
            .padding(.horizontal, 10).padding(.vertical, 6).background(BusinessDesign.secondarySurface, in: Capsule())
    }
    private func dateRange(_ item: ConciergeCareRequest) -> String {
        if let start = item.exact_start_date, let end = item.exact_end_date { return start + " — " + end }
        return item.preferred_month ?? "Даты уточняются"
    }
    private func errorPanel(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(message, systemImage: "exclamationmark.circle").font(.footnote).foregroundStyle(.red)
            Button("Повторить загрузку") { Task { await load() } }.buttonStyle(BusinessActionStyle(primary: false))
        }.padding(12).businessCard(radius: BusinessDesign.Radius.compact)
    }
    private func requestDetail(_ item: ConciergeCareRequest) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BusinessDesign.Space.md) {
                BusinessPageHeading(title: item.contact_name, subtitle: item.id)
                statusLabel(item)
                if let error { errorPanel(error) }
                VStack(alignment: .leading, spacing: 12) {
                    Label("Параметры поездки", systemImage: "airplane").font(BusinessDesign.TypeStyle.title)
                    LabeledContent("Город вылета", value: item.origin_code)
                    LabeledContent("Даты", value: dateRange(item))
                    LabeledContent("Взрослые", value: String(item.adults))
                    LabeledContent("Дети", value: String(item.children))
                    LabeledContent("Младенцы", value: String(item.infants))
                    LabeledContent("Номера", value: String(item.rooms))
                    if let budget = item.budget_usd, budget > 0 { LabeledContent("Бюджет, USD", value: String(budget)) }
                    if let stars = item.hotel_class { LabeledContent("Категория отеля", value: "\(stars)★") }
                    if let notes = item.notes, !notes.isEmpty { Divider(); Text("Пожелания").font(.headline); Text(notes).font(.subheadline).textSelection(.enabled) }
                }.padding(BusinessDesign.Space.md).businessCard()
                VStack(alignment: .leading, spacing: 12) {
                    Label("Контакты", systemImage: "person.crop.circle").font(BusinessDesign.TypeStyle.title)
                    copyRow("Телефон", item.contact_phone)
                    if let telegram = item.contact_telegram, !telegram.isEmpty { copyRow("Telegram", telegram) }
                    if let locale = item.locale { LabeledContent("Язык", value: locale) }
                }.padding(BusinessDesign.Space.md).businessCard()
                if !closed(item) {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Работа с заявкой", systemImage: "checklist").font(BusinessDesign.TypeStyle.title)
                        if working == item.id { ProgressView().frame(maxWidth: .infinity) }
                        if (1...6).contains(item.adults + item.children + item.infants), (1...6).contains(item.rooms) {
                            Button { showBuilder = true } label: { Label("Подготовить предложение", systemImage: "doc.badge.plus") }.buttonStyle(BusinessActionStyle())
                                .disabled(working != nil)
                            Text("Откроется отдельный черновик с параметрами заявки. Рейсы, отели и цены нужно подобрать. Статус заявки изменяется вручную.").font(.caption).foregroundStyle(BusinessDesign.muted)
                        } else {
                            Text("Для этой группы требуется отдельный расчёт: конфигуратор поддерживает до 6 паломников и 6 номеров.").font(.caption).foregroundStyle(BusinessDesign.muted)
                        }
                        ForEach(states.indices, id: \.self) { index in
                            let state = states[index]
                            if state.0 != item.status {
                                Button(role: state.0 == "CANCELLED" ? .destructive : nil) {
                                    if ["COMPLETED", "CANCELLED"].contains(state.0) { confirmStatus = state.0; showConfirm = true }
                                    else { Task { await update(item, state.0) } }
                                } label: { Text(state.1) }.buttonStyle(BusinessActionStyle(primary: false)).disabled(working != nil)
                            }
                        }
                    }.padding(BusinessDesign.Space.md).businessCard()
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Даты заявки").font(BusinessDesign.TypeStyle.title)
                    LabeledContent("Создана", value: item.created_at)
                    if let due = item.response_due_at { LabeledContent("Ответ до", value: due) }
                    if let updated = item.updated_at { LabeledContent("Обновлена", value: updated) }
                }.font(.caption).padding(BusinessDesign.Space.md).businessCard()
            }.businessAdaptiveReadableWidth().padding(BusinessDesign.Space.page)
        }.background(BusinessDesign.background).refreshable { await load() }
    }
    private func copyRow(_ title: String, _ value: String) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) { Text(title).font(.caption).foregroundStyle(BusinessDesign.muted); Text(value).textSelection(.enabled) }
            Spacer()
            Button { UIPasteboard.general.string = value } label: { Image(systemName: "doc.on.doc").frame(width: 44, height: 44) }
                .buttonStyle(.plain).accessibilityLabel("Копировать \(title)")
        }
    }
    private func draft(for item: ConciergeCareRequest) -> UmrahPackageDraft {
        var draft = UmrahPackageDraft()
        draft.travelers = item.adults + item.children + item.infants
        draft.makkah.rooms = item.rooms; draft.medina.rooms = item.rooms
        draft.builderOrigin = ["TAS", "FEG", "NMA", "AZN", "SKD", "BHK", "KSQ", "TMJ", "UGC"].contains(item.origin_code) ? item.origin_code : "Все"
        draft.includeMedina = item.scope != "makkahOnly"
        if let stars = item.hotel_class { draft.comfort = stars >= 5 ? "Premium" : stars >= 3 ? "Standard" : "Economy" }
        draft.builderFinishAsOffer = true
        // Dates are request preferences, not verified flight/hotel dates. They remain in Concierge.
        // Contacts stay in Concierge; no automatic transmission or status changes.
        return draft
    }
    @MainActor private func load() async {
        let token = UUID(); generation = token; loading = true
        defer { if generation == token { loading = false } }
        do {
            let values = try await APIClient.shared.conciergeRequests()
            guard generation == token else { return }
            requests = values; hasLoaded = true; error = nil
        } catch { if generation == token { self.error = error.localizedDescription } }
    }
    @MainActor private func update(_ item: ConciergeCareRequest, _ state: String) async {
        guard working == nil else { return }; working = item.id; defer { working = nil; confirmStatus = nil }
        do { try await APIClient.shared.changeConciergeRequest(id: item.id, status: state); await load() }
        catch { self.error = error.localizedDescription }
    }
}
