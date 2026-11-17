import SwiftUI

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
                        Image(systemName: "bubble.left.and.bubble.right.fill").foregroundStyle(.blue).font(.title2)
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
                }.navigationTitle("Бронирование").navigationBarTitleDisplayMode(.inline).businessNavigationSurface().toolbar { ToolbarItem(placement: .cancellationAction) { Button("Закрыть") { accept = false } } }
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


private struct ConciergeRequestsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var requests: [ConciergeCareRequest] = []
    @State private var loading = true
    @State private var error: String?
    @State private var working: String?
    @State private var showClosed = false
    private let states = [("IN_REVIEW", "В работу"), ("QUOTING", "Расчёт"), ("READY", "Предложение готово"), ("CONTACTED", "Связались"), ("COMPLETED", "Закрыть"), ("CANCELLED", "Отменить")]
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                BusinessPageHeading(title: "Concierge", subtitle: "Заявки на индивидуальный расчёт — не бронирования")
                Toggle("Показать закрытые заявки", isOn: $showClosed)
                if let error { Text(error).foregroundStyle(.red); Button("Повторить") { Task { await load() } } }
                if loading && requests.isEmpty { ProgressView().frame(maxWidth: .infinity).padding() }
                else if !loading && requests.isEmpty { ContentUnavailableView("Нет заявок", systemImage: "bubble.left.and.bubble.right") }
                ForEach(requests.filter { showClosed || !["COMPLETED", "CANCELLED"].contains($0.status) }) { item in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack { Text(item.source == "telegram" ? "TELEGRAM" : "CARE").font(.caption.weight(.semibold)).foregroundStyle(.blue); Spacer(); Text(item.statusTitle).font(.caption.weight(.medium)) }
                        Text(item.contact_name).font(.headline)
                        Text(item.id).font(.caption.monospaced()).textSelection(.enabled)
                        Text("\(item.origin_code) · \(item.exact_start_date ?? item.preferred_month ?? "—") — \(item.exact_end_date ?? "—")").font(.subheadline)
                        Text("Взрослые: \(item.adults) · Дети: \(item.children) · Младенцы: \(item.infants) · Комнаты: \(item.rooms)").font(.caption).foregroundStyle(.secondary)
                        Text(item.contact_phone).textSelection(.enabled)
                        if let name = item.contact_telegram, !name.isEmpty { Text(name).textSelection(.enabled) }
                        if let notes = item.notes, !notes.isEmpty { Text(notes).font(.caption).foregroundStyle(.secondary) }
                        Text(item.created_at).font(.caption2).foregroundStyle(.secondary)
                        if !["COMPLETED", "CANCELLED"].contains(item.status) {
                            Menu { ForEach(states.indices, id: \.self) { index in Button(states[index].1) { Task { await update(item, states[index].0) } } } } label: { Label("Изменить состояние", systemImage: "arrow.triangle.2.circlepath") }.disabled(working != nil)
                        }
                    }.padding(16).frame(maxWidth: .infinity, alignment: .leading).businessCard(radius: 20)
                }
            }.businessAdaptiveReadableWidth().padding(20)
        }.navigationTitle("Заявки Concierge").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Готово") { dismiss() } } }
            .task { await load() }.refreshable { await load() }
    }
    @MainActor private func load() async {
        loading = true; defer { loading = false }
        do { requests = try await APIClient.shared.conciergeRequests(); error = nil }
        catch { self.error = error.localizedDescription }
    }
    @MainActor private func update(_ item: ConciergeCareRequest, _ state: String) async {
        guard working == nil else { return }; working = item.id; defer { working = nil }
        do { try await APIClient.shared.changeConciergeRequest(id: item.id, status: state); await load() }
        catch { self.error = error.localizedDescription }
    }
}
