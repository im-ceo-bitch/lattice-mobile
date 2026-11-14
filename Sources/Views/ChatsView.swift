import Foundation
import PhotosUI
import SwiftUI
import UIKit

private func businessPilgrimName(_ booking: BookingSummary?) -> String {
    let value = booking?.clientName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return value.isEmpty || value == "Паломник" ? "Имя не синхронизировано" : value
}

private enum ChatFilter: String, CaseIterable, Identifiable {
    case new = "Новые"
    case active = "В процессе"
    case completed = "Завершённые"
    var id: String { rawValue }
}

struct ChatsView: View {
    @Environment(\.businessAdaptiveLayout) private var layout

    @State private var threads: [ChatThread] = []
    @State private var bookings: [BookingSummary] = []
    @State private var filter: ChatFilter = .new
    @State private var loading = true
    @State private var errorMessage: String?
    @State private var selectedThread: ChatThread?

    var body: some View {
        Group {
            if layout.supportsTwoPaneWorkspace {
                desktopWorkspace
            } else {
                compactWorkspace
            }
        }
        .background(BusinessDesign.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { BusinessSidebarButton() }
            ToolbarItem(placement: .principal) { BusinessBrandLogo(width: 150).frame(height: 36) }
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink { NewChatBookingPicker(bookings: bookings) } label: {
                    Image(systemName: "square.and.pencil")
                }
                .disabled(bookings.isEmpty)
            }
        }
        .overlay { if loading { ProgressView() } }
        .task { await load() }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("iumrah.business.bookingOperationsChanged"))) { _ in
            Task { await load() }
        }
        .onChange(of: filter) { _, _ in
            guard layout.supportsTwoPaneWorkspace else { return }
            if let selectedThread,
               !filteredThreads.contains(where: { $0.id == selectedThread.id }) {
                self.selectedThread = filteredThreads.first
            }
        }
        .refreshable { await load() }
    }

    private var compactWorkspace: some View {
        ScrollView {
            threadListContent(navigates: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 14)
        }
        .contentMargins(.horizontal, 18, for: .scrollContent)
        .scrollIndicators(.hidden)
    }

    private var desktopWorkspace: some View {
        HStack(spacing: 0) {
            ScrollView {
                threadListContent(navigates: false)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 16)
            }
            .scrollIndicators(.hidden)
            .frame(width: layout.listPaneWidth)
            .background(BusinessDesign.background)

            Divider()

            Group {
                if let selectedThread {
                    ChatConversationView(thread: selectedThread)
                        .id(selectedThread.id)
                } else {
                    ContentUnavailableView(
                        "Выберите чат",
                        systemImage: "message",
                        description: Text("Диалог откроется здесь, а список поездок останется доступен слева.")
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(BusinessDesign.background)
        }
    }

    @ViewBuilder
    private func threadListContent(navigates: Bool) -> some View {
        LazyVStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text("Чаты")
                    .font(.system(size: 38, weight: .bold, design: .rounded))
                    .tracking(-1.4)
                Text("Один паломник — один чат")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            filterBar

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            }

            if filteredThreads.isEmpty && !loading {
                ContentUnavailableView(emptyTitle, systemImage: "message", description: Text(emptySubtitle))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 42)
            } else {
                ForEach(filteredThreads) { thread in
                    if navigates {
                        NavigationLink { ChatConversationView(thread: thread) } label: {
                            ThreadCard(thread: thread)
                        }
                        .buttonStyle(.plain)
                    } else {
                        Button {
                            selectedThread = thread
                        } label: {
                            ThreadCard(thread: thread, showsChevron: false)
                        }
                        .buttonStyle(.plain)
                        .background(
                            selectedThread?.id == thread.id
                                ? BusinessDesign.secondarySurface.opacity(0.55)
                                : Color.clear,
                            in: RoundedRectangle(cornerRadius: 26, style: .continuous)
                        )
                        .contextMenu {
                            Button("Открыть") { selectedThread = thread }
                        }
                    }
                }
            }
        }
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 7) {
                ForEach(ChatFilter.allCases) { item in
                    Button { withAnimation(.snappy(duration: 0.25)) { filter = item } } label: {
                        HStack(spacing: 6) {
                            Text(item.rawValue)
                            if item == .new {
                                let count = threads.filter(\.unreadForStaff).count
                                if count > 0 {
                                    Text("\(count)")
                                        .font(.caption2.bold())
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(item == filter ? BusinessDesign.onPrimaryControl.opacity(0.18) : BusinessDesign.secondarySurface, in: Capsule())
                                }
                            }
                        }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(item == filter ? BusinessDesign.onPrimaryControl : Color.primary)
                        .padding(.horizontal, 12)
                        .frame(height: 38)
                        .background(item == filter ? BusinessDesign.primaryControl : BusinessDesign.secondarySurface, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 2)
        }
    }

    private var filteredThreads: [ChatThread] {
        switch filter {
        case .new: return threads.filter(\.unreadForStaff)
        case .active: return threads.filter { !isCompleted($0.booking) }
        case .completed: return threads.filter { isCompleted($0.booking) }
        }
    }

    private func isCompleted(_ booking: BookingSummary?) -> Bool {
        guard let booking else { return false }
        if let raw = booking.operationStatus, let status = TripStatus(rawValue: raw) { return status.isCompleted }
        return booking.status == .completed
    }

    private var emptyTitle: String {
        filter == .new ? "Новых сообщений нет" : filter == .active ? "Активных чатов нет" : "Завершённых чатов нет"
    }

    private var emptySubtitle: String {
        filter == .new ? "Непрочитанные сообщения появятся здесь." : "Чаты автоматически группируются по статусу поездки."
    }

    @MainActor private func load() async {
        loading = true
        errorMessage = nil
        do {
            async let chatThreadsRequest = APIClient.shared.businessChatThreads()
            async let bookingsRequest = APIClient.shared.bookings()
            let cloudThreads = try await chatThreadsRequest
            let resolvedBookings = try await bookingsRequest
            guard !Task.isCancelled else { return }
            bookings = resolvedBookings
            let bookingsByID = Dictionary(resolvedBookings.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            threads = cloudThreads.compactMap { cloud in
                let booking = bookingsByID[cloud.bookingID]
                guard booking != nil || cloud.pilgrimID != nil else { return nil }
                return ChatThread(
                    conversationID: cloud.id,
                    booking: booking,
                    pilgrimID: cloud.pilgrimID ?? booking?.pilgrimID,
                    pilgrimName: cloud.pilgrimName,
                    tripCount: cloud.tripCount ?? 1,
                    relatedBookings: cloud.pilgrimID.map { owner in resolvedBookings.filter { $0.pilgrimID == owner } } ?? (booking.map { [$0] } ?? []),
                    lastMessageAt: cloud.lastMessageAt,
                    lastMessagePreview: cloud.lastMessagePreview,
                    lastSenderType: cloud.lastSenderType,
                    unreadForStaff: cloud.unreadForStaff
                )
            }
            if threads.filter(\.unreadForStaff).isEmpty, filter == .new { filter = .active }
            if layout.supportsTwoPaneWorkspace {
                if let selectedThread,
                   let refreshed = threads.first(where: { $0.id == selectedThread.id }) {
                    self.selectedThread = refreshed
                } else {
                    selectedThread = filteredThreads.first
                }
            }
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }
}

private struct ThreadCard: View {
    let thread: ChatThread
    var showsChevron = true

    var body: some View {
        HStack(spacing: 13) {
            ZStack {
                Circle().fill(BusinessDesign.secondarySurface)
                Text(initials).font(.headline.weight(.bold))
            }
            .frame(width: 54, height: 54)

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(thread.pilgrimName ?? businessPilgrimName(thread.booking))
                        .font(.subheadline.bold()).lineLimit(1)
                    Spacer(minLength: 8)
                    Text(chatTime(thread.lastMessageAt)).font(.caption2).foregroundStyle(.tertiary)
                }
                Text(thread.lastMessagePreview.isEmpty ? "Нет сообщений" : thread.lastMessagePreview)
                    .font(.subheadline).foregroundStyle(thread.unreadForStaff ? .primary : .secondary)
                    .fontWeight(thread.unreadForStaff ? .semibold : .regular).lineLimit(2)
                HStack(spacing: 5) {
                    Text(thread.pilgrimID.map { "iumrah ID \($0)" } ?? "iumrah ID —").monospaced()
                    Text("·")
                    Text("Поездок: \(thread.tripCount)")
                    if let number = thread.booking?.bookingDisplayNumber { Text("· \(number)").monospaced() }
                    if thread.unreadForStaff { Spacer(); Circle().fill(BusinessDesign.accent).frame(width: 8, height: 8) }
                }
                .font(.caption2).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if showsChevron {
                Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(.tertiary)
            }
        }
        .padding(14)
        .background(BusinessDesign.tertiarySurface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(BusinessDesign.line, lineWidth: 1))
    }

    private var initials: String {
        let name = thread.pilgrimName ?? businessPilgrimName(thread.booking)
        return name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
    }
}

private struct NewChatBookingPicker: View {
    let bookings: [BookingSummary]
    var body: some View {
        List(bookings) { booking in
            NavigationLink { ChatConversationView(booking: booking) } label: {
                VStack(alignment: .leading, spacing: 5) {
                    Text(businessPilgrimName(booking)).font(.subheadline.bold())
                    Text("\(booking.bookingDisplayNumber.map { "Бронь \($0)" } ?? "Бронь #----") · \(booking.pilgrimID.map { "Iumrah ID \($0)" } ?? "Iumrah ID —") · \(booking.originCode) → \(booking.outboundDestination)")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Новый чат")
    }
}

struct ChatConversationView: View {
    @Environment(\.colorScheme) private var colorScheme

    let booking: BookingSummary?
    let conversationID: String
    let pilgrimID: String?
    let displayName: String
    let tripCount: Int
    let relatedBookings: [BookingSummary]

    init(booking: BookingSummary) {
        self.booking = booking
        conversationID = booking.id
        pilgrimID = booking.pilgrimID
        displayName = businessPilgrimName(booking)
        tripCount = 1
        relatedBookings = [booking]
    }

    init(thread: ChatThread) {
        booking = thread.booking
        conversationID = thread.id
        pilgrimID = thread.pilgrimID
        displayName = thread.pilgrimName ?? businessPilgrimName(thread.booking)
        tripCount = thread.tripCount
        relatedBookings = thread.relatedBookings
    }

    @State private var messages: [BusinessChatMessage] = []
    @State private var cursor = "0"
    @State private var scopeVersion: String?
    @State private var syncing = false
    @State private var draft = ""
    @State private var loading = true
    @State private var sending = false
    @State private var errorMessage: String?
    @State private var selectedPhoto: PhotosPickerItem?
    @FocusState private var composerFocused: Bool
    @State private var composerPanelHeight: CGFloat = 76

    private let bottomAnchorID = "business-chat-bottom"

    var body: some View {
        ScrollViewReader { proxy in
            ZStack(alignment: .bottom) {
                Color(uiColor: .systemBackground)
                    .ignoresSafeArea()

                conversation(proxy: proxy)
                    .ignoresSafeArea(.container, edges: .bottom)

                VStack(spacing: 6) {
                    if let errorMessage {
                        errorBar(errorMessage)
                    }
                    composer(proxy: proxy)
                }
                .businessAdaptiveDetailWidth()
                .padding(.bottom, composerFocused ? 8 : 12)
                .background {
                    GeometryReader { geometry in
                        Color.clear
                            .onAppear { composerPanelHeight = geometry.size.height }
                            .onChange(of: geometry.size.height) { _, value in
                                composerPanelHeight = value
                            }
                    }
                }
                .zIndex(10)
            }
            // Match the client Care chat: content runs through the physical
            // bottom edge while the keyboard safe area remains active.
            .ignoresSafeArea(.container, edges: .bottom)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(spacing: 8) {
                        pilgrimAvatar(size: 32)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(displayName).font(.system(size: 13.5, weight: .semibold)).lineLimit(1)
                            Text(pilgrimID.map { "iumrah ID \($0)" } ?? "Паломник").font(.system(size: 10.5, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if !relatedBookings.isEmpty {
                        Menu {
                            ForEach(relatedBookings) { trip in
                                NavigationLink { BookingDetailView(bookingID: trip.id) } label: {
                                    Text("\(trip.bookingDisplayNumber ?? "#----") · \(trip.status.shortLabel)")
                                }
                            }
                        } label: {
                            Image(systemName: "info.circle").font(.system(size: 18, weight: .medium))
                        }
                    }
                }
            }
            .task {
                await reload()
                await Task.yield()
                scrollToLatest(proxy, animated: false)
                await poll()
            }
            .onChange(of: selectedPhoto) { _, item in
                if let item { Task { await sendPhoto(item) } }
            }
            .onChange(of: messages.count) { _, _ in
                scrollToLatest(proxy)
            }
            .onChange(of: composerFocused) { _, focused in
                guard focused else { return }
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(120))
                    scrollToLatest(proxy)
                }
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbarBackground(.hidden, for: .navigationBar)
    }

    private func conversation(proxy: ScrollViewProxy) -> some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                bookingContext
                    .padding(.bottom, 10)

                if loading && messages.isEmpty {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text("Загрузка чата…")
                            .font(.system(size: 13.5, weight: .medium))
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 74)
                } else if messages.isEmpty {
                    VStack(spacing: 13) {
                        pilgrimAvatar(size: 74)
                        Text("Начните диалог")
                            .font(.system(size: 25, weight: .bold, design: .rounded))
                        Text("Сообщения и фотографии сохраняются в iumrah Cloud.")
                            .font(.system(size: 15.5))
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 34)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 58)
                } else {
                    ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                        if shouldShowDate(at: index) {
                            dateSeparator(message.createdAt)
                                .padding(.vertical, index == 0 ? 10 : 16)
                        }

                        BusinessChatMessageRow(
                            message: message,
                            pilgrimName: displayName,
                            groupStart: isGroupStart(at: index),
                            groupEnd: isGroupEnd(at: index),
                            timestampText: timeLabel(message.createdAt)
                        )
                        .id(message.id)
                        .padding(.bottom, isGroupEnd(at: index) ? 8 : 2)
                        .transition(
                            .asymmetric(
                                insertion: .move(edge: .bottom)
                                    .combined(with: .scale(scale: 0.96, anchor: message.isStaff ? .bottomTrailing : .bottomLeading))
                                    .combined(with: .opacity),
                                removal: .opacity
                            )
                        )
                    }
                }

                Color.clear
                    .frame(height: 2)
                    .id(bottomAnchorID)
            }
            .businessAdaptiveDetailWidth()
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 16)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .contentMargins(.bottom, max(88, composerPanelHeight + 10), for: .scrollContent)
    }

    @ViewBuilder private var bookingContext: some View {
        if let booking {
        NavigationLink {
            BookingDetailView(bookingID: booking.id)
        } label: {
            HStack(spacing: 7) {
                Image(systemName: "suitcase.rolling.fill")
                    .font(.system(size: 10.5, weight: .semibold))
                Text(booking.bookingDisplayNumber.map { "Бронь \($0)" } ?? "Бронь #----")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                Text("·")
                    .foregroundStyle(.secondary)
                Text("\(booking.originCode) → \(booking.outboundDestination)")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                Image(systemName: "chevron.right")
                    .font(.system(size: 8, weight: .bold))
            }
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .businessChatGlassSurface(in: Capsule(), interactive: true, tint: contextGlassTint)
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
        }
    }

    private func pilgrimAvatar(size: CGFloat) -> some View {
        ZStack {
            Circle().fill(Color(uiColor: .systemGray5))
            Text(pilgrimInitials)
                .font(.system(size: max(10, size * 0.34), weight: .bold, design: .rounded))
                .foregroundStyle(.primary)
        }
        .frame(width: size, height: size)
        .overlay { Circle().stroke(Color.primary.opacity(0.08), lineWidth: 0.65) }
    }

    private var pilgrimInitials: String {
        let name = displayName
        let result = name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
        return result.isEmpty ? "I" : result
    }

    private func composer(proxy: ScrollViewProxy) -> some View {
        // Keep the Business composer in parity with the proven client Care chat:
        // compact when empty, centered controls, and controlled growth for multiline text.
        BusinessChatGlassContainer(spacing: 8) {
            HStack(alignment: .center, spacing: 8) {
                PhotosPicker(selection: $selectedPhoto, matching: .images) {
                    Group {
                        if sending && selectedPhoto != nil {
                            ProgressView().controlSize(.mini)
                        } else {
                            Image(systemName: "plus")
                                .font(.system(size: 17, weight: .semibold))
                        }
                    }
                    .foregroundStyle(.primary)
                    .frame(width: 42, height: 42)
                    .contentShape(Circle())
                }
                .businessChatGlassButton()
                .disabled(sending)

                HStack(alignment: .center, spacing: 6) {
                    TextField("Сообщение…", text: $draft, axis: .vertical)
                        .focused($composerFocused)
                        .font(.system(size: 16.5))
                        .textFieldStyle(.plain)
                        .lineLimit(1...3)
                        // Keep an empty vertical TextField at its true single-line
                        // height on iOS 26; grow only when actual extra lines exist.
                        .fixedSize(horizontal: false, vertical: true)
                        .submitLabel(.send)
                        .tint(outgoingAccent)
                        .onSubmit {
                            guard canSend else { return }
                            send()
                        }
                        .padding(.leading, 14)
                        .padding(.vertical, 9)

                    if canSend || sending {
                        Button {
                            send()
                        } label: {
                            Group {
                                if sending {
                                    ProgressView()
                                        .controlSize(.mini)
                                        .tint(.white)
                                } else {
                                    Image(systemName: "arrow.up")
                                        .font(.system(size: 14.5, weight: .bold))
                                }
                            }
                            .foregroundStyle(.white)
                            .frame(width: 34, height: 34)
                            .background(outgoingAccent, in: Circle())
                            .contentShape(Circle())
                        }
                        .buttonStyle(.plain)
                        .disabled(!canSend)
                        .padding(.trailing, 5)
                        .transition(.scale(scale: 0.82).combined(with: .opacity))
                    }
                }
                .frame(minHeight: 48, maxHeight: 72, alignment: .center)
                .contentShape(RoundedRectangle(cornerRadius: 21, style: .continuous))
                .onTapGesture { composerFocused = true }
                .businessChatGlassSurface(
                    in: RoundedRectangle(cornerRadius: 21, style: .continuous),
                    interactive: true,
                    tint: composerGlassTint
                )
                .shadow(
                    color: Color.black.opacity(colorScheme == .dark ? (composerFocused ? 0.20 : 0.10) : (composerFocused ? 0.07 : 0.025)),
                    radius: composerFocused ? 8 : 4,
                    y: composerFocused ? 3 : 1
                )
                .animation(.spring(response: 0.28, dampingFraction: 0.86), value: composerFocused)
                .animation(.spring(response: 0.28, dampingFraction: 0.84), value: canSend)
            }
        }
        .padding(.horizontal, 12)
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !sending
    }

    private var outgoingAccent: Color {
        colorScheme == .dark
            ? Color(red: 0.10, green: 0.62, blue: 0.47)
            : Color(red: 0.055, green: 0.29, blue: 0.24)
    }

    private var composerGlassTint: Color? {
        if colorScheme == .dark {
            return composerFocused ? outgoingAccent.opacity(0.16) : Color.white.opacity(0.045)
        }
        return composerFocused ? outgoingAccent.opacity(0.065) : Color.primary.opacity(0.018)
    }

    private var contextGlassTint: Color? {
        colorScheme == .dark ? Color.white.opacity(0.035) : Color.primary.opacity(0.012)
    }

    private func errorBar(_ message: String) -> some View {
        HStack(spacing: 9) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(.red)
            Text(message)
                .font(.system(size: 12.5))
                .foregroundStyle(.primary)
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 9)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 17, style: .continuous))
        .padding(.horizontal, 12)
    }

    @MainActor private func syncMessages() async throws {
        guard !syncing else { return }
        syncing = true
        defer { syncing = false }
        var changed = false
        for _ in 0..<20 {
            try Task.checkCancellation()
            let before = cursor
            let page = try await APIClient.shared.businessChatMessages(bookingID: conversationID, after: cursor, scope: scopeVersion)
            try Task.checkCancellation()
            if page.reset == true { messages = []; changed = true }
            var indexed = Dictionary(messages.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            for message in page.messages { indexed[message.id] = message }
            if !page.messages.isEmpty {
                messages = indexed.values.sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }
                changed = true
            }
            scopeVersion = page.scopeVersion
            cursor = page.nextCursor ?? "0"
            guard page.hasMore == true, cursor != before || page.reset == true else { break }
        }
        if changed { _ = try? await APIClient.shared.markBusinessChatRead(bookingID: conversationID) }
    }

    @MainActor private func reload() async {
        do { try await syncMessages(); errorMessage = nil }
        catch is CancellationError { return }
        catch { errorMessage = error.localizedDescription }
        loading = false
    }

    @MainActor private func poll() async {
        while !Task.isCancelled {
            do { try await Task.sleep(for: .seconds(5)) } catch { break }
            guard !Task.isCancelled, !sending else { continue }
            try? await syncMessages()
        }
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""; sending = true; errorMessage = nil
        Task { @MainActor in
            do {
                let message = try await APIClient.shared.sendBusinessChatMessage(bookingID: conversationID, body: text, clientMessageID: UUID().uuidString)
                if !messages.contains(where: { $0.id == message.id }) { messages.append(message) }
            } catch { draft = text; errorMessage = error.localizedDescription }
            sending = false
        }
    }

    @MainActor private func sendPhoto(_ item: PhotosPickerItem) async {
        sending = true; errorMessage = nil; selectedPhoto = nil
        do {
            guard let raw = try await item.loadTransferable(type: Data.self), let optimized = chatJPEG(raw) else { throw APIError.server("Не удалось подготовить фотографию") }
            let message = try await APIClient.shared.sendBusinessChatImage(bookingID: conversationID, data: optimized)
            if !messages.contains(where: { $0.id == message.id }) { messages.append(message) }
        } catch { errorMessage = error.localizedDescription }
        sending = false
    }

    private func chatJPEG(_ data: Data) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        let maxSide: CGFloat = 1600
        let scale = min(1, maxSide / max(image.size.width, image.size.height))
        let size = CGSize(width: max(1, image.size.width * scale), height: max(1, image.size.height * scale))
        let renderer = UIGraphicsImageRenderer(size: size)
        let rendered = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        return rendered.jpegData(compressionQuality: 0.78)
    }

    private func shouldShowDate(at index: Int) -> Bool {
        guard index >= 0, index < messages.count else { return false }
        if index == 0 { return true }
        guard let current = parseISO(messages[index].createdAt), let previous = parseISO(messages[index - 1].createdAt) else { return false }
        return !Calendar.current.isDate(current, inSameDayAs: previous)
    }

    private func isGroupStart(at index: Int) -> Bool {
        guard index > 0 else { return true }
        return !sameMessageGroup(messages[index - 1], messages[index])
    }

    private func isGroupEnd(at index: Int) -> Bool {
        guard index < messages.count - 1 else { return true }
        return !sameMessageGroup(messages[index], messages[index + 1])
    }

    private func sameMessageGroup(_ lhs: BusinessChatMessage, _ rhs: BusinessChatMessage) -> Bool {
        guard lhs.isStaff == rhs.isStaff,
              let first = parseISO(lhs.createdAt),
              let second = parseISO(rhs.createdAt) else { return false }
        return abs(second.timeIntervalSince(first)) < 120
    }

    private func dateSeparator(_ value: String) -> some View {
        Text(dateSeparatorLabel(value))
            .font(.system(size: 12.5, weight: .semibold))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
    }

    private func dateSeparatorLabel(_ value: String) -> String {
        guard let date = parseISO(value) else { return value }
        if Calendar.current.isDateInToday(date) {
            return "Сегодня, \(date.formatted(date: .omitted, time: .shortened))"
        }
        if Calendar.current.isDateInYesterday(date) {
            return "Вчера, \(date.formatted(date: .omitted, time: .shortened))"
        }
        return date.formatted(.dateTime.day().month(.wide).hour().minute())
    }

    private func scrollToLatest(_ proxy: ScrollViewProxy, animated: Bool = true) {
        guard !messages.isEmpty else { return }
        if animated {
            withAnimation(.easeOut(duration: 0.22)) {
                proxy.scrollTo(bottomAnchorID, anchor: .bottom)
            }
        } else {
            proxy.scrollTo(bottomAnchorID, anchor: .bottom)
        }
    }
}

private func parseISO(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) { return date }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)
}

private func timeLabel(_ value: String) -> String {
    parseISO(value)?.formatted(date: .omitted, time: .shortened) ?? ""
}

private func chatTime(_ value: String) -> String {
    guard let date = parseISO(value) else { return "" }
    if Calendar.current.isDateInToday(date) { return date.formatted(date: .omitted, time: .shortened) }
    return date.formatted(.dateTime.day().month(.abbreviated))
}
