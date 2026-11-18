import Foundation
import SwiftUI

private let bookingOperationsChangedNotification = Notification.Name("iumrah.business.bookingOperationsChanged")

private enum BookingListFilter: String, CaseIterable, Identifiable {
    case all, availability, payment, confirmed, ready, inTrip, completed, cancelled
    var id: String { rawValue }
    var title: String {
        switch self {
        case .all: return "Все"
        case .availability: return "Проверка"
        case .payment: return "Оплата и данные"
        case .confirmed: return "Подтверждено"
        case .ready: return "К поездке"
        case .inTrip: return "В поездке"
        case .completed: return "Завершено"
        case .cancelled: return "Отменено"
        }
    }
    func matches(_ status: TripStatus) -> Bool {
        switch self {
        case .all: return true
        case .availability: return status == .availabilityCheck
        case .payment: return status == .paymentPending
        case .confirmed: return status == .bookingConfirmed
        case .ready: return status == .readyToTravel
        case .inTrip: return status == .inTrip
        case .completed: return status == .completed
        case .cancelled: return status == .cancelled
        }
    }
}

struct BookingsView: View {
    @Environment(\.businessAdaptiveLayout) private var layout
    @EnvironmentObject private var navigation: BusinessNavigationStore
    @EnvironmentObject private var auth: AuthStore
    @State private var create = false

    @State private var showOffers = false
    @State private var bookings: [BookingSummary] = []
    @State private var loading = true
    @State private var hasLoadedBookings = false
    @State private var error: String?
    @State private var filter: BookingListFilter = .all
    @State private var taskFilter: String?
    @State private var expandQueue = false
    @State private var mineOnly = false
    @State private var myMemberID: String?
    @State private var search = ""
    @State private var pendingBookingID: String?
    @State private var selectedBooking: BookingSummary?
    @State private var loadGeneration = UUID()
    @Environment(\.scenePhase) private var scenePhase

    private var filteredBookings: [BookingSummary] {
        bookings.filter { booking in
            if let taskFilter, !(booking.operationTasks ?? []).contains(where: { $0.key == taskFilter }) { return false }
            if mineOnly && (myMemberID == nil || booking.managerID != myMemberID) { return false }
            guard filter.matches(operationalStatus(booking)) else { return false }
            let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
            return query.isEmpty || [booking.id, booking.clientName ?? "", booking.pilgrimID ?? "", booking.bookingDisplayNumber ?? "", booking.bookingNumber.map { String($0) } ?? ""].contains { $0.localizedCaseInsensitiveContains(query) }
        }.sorted { a,b in
            let at = a.operationTasks ?? [], bt = b.operationTasks ?? []
            let ap = at.map(\.priority).min() ?? 99, bp = bt.map(\.priority).min() ?? 99
            if ap != bp { return ap < bp }
            let ad = at.compactMap(\.dueAt).min() ?? "9999", bd = bt.compactMap(\.dueAt).min() ?? "9999"
            return ad == bd ? a.createdAt > b.createdAt : ad < bd
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Раздел", selection: $showOffers) { Text("Бронирования").tag(false); Text("Предложения").tag(true) }
                .pickerStyle(.segmented).padding(.horizontal, 16).padding(.vertical, 10)
            if showOffers { BusinessOffersView(search: search) }
            else if layout.supportsTwoPaneWorkspace { desktopWorkspace }
            else { compactList }
        }
        .background(BusinessDesign.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .businessNavigationSurface()
        .navigationDestination(item: $selectedBooking) { booking in
            if !layout.supportsTwoPaneWorkspace {
                BookingDetailView(bookingID: booking.id)
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { BusinessSidebarButton() }
            ToolbarItem(placement: .topBarTrailing) { Button { create = true } label: { Image(systemName: "plus").foregroundStyle(.white) }.accessibilityLabel("Создать умру") }
            ToolbarItem(placement: .principal) {
                BusinessBrandLogo(width: 150, foreground: .white).frame(height: 36)
            }
        }
        .overlay {
            if !showOffers && (loading && bookings.isEmpty) {
                ZStack {
                    BusinessDesign.background.opacity(0.72).ignoresSafeArea()
                    ProgressView()
                }
            }
        }
        .searchable(text: $search, prompt: showOffers ? "Package ID, отель или бронь" : "Имя, номер брони, iumrah ID")
        .sheet(isPresented: $create, onDismiss: { Task { await load() } }) { NavigationStack { UmrahBuilderView(owner: auth.user?.login ?? "", preferOffer: showOffers) } }
        .onAppear { applyFilterRequest() }
        .onChange(of: navigation.bookingFilterRequest) { _, _ in applyFilterRequest() }
        .task { if BusinessNotificationRoute.pendingOffer != nil { showOffers = true }; myMemberID = (try? await APIClient.shared.businessProfile())?.id; await load(); openPendingBooking() }
        .onReceive(NotificationCenter.default.publisher(for: .iumrahBusinessBookingOpen)) { notification in
            showOffers = false
            pendingBookingID = notification.object as? String
            Task { await load(); openPendingBooking() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .iumrahBusinessOfferOpen)) { _ in showOffers = true; search = "" }
        .onChange(of: scenePhase) { _, phase in if phase == .active { if BusinessNotificationRoute.pendingOffer != nil { showOffers = true }; openPendingBooking() } }
        .onReceive(NotificationCenter.default.publisher(for: bookingOperationsChangedNotification)) { _ in
            Task { await load() }
        }
        .refreshable { await load() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await load() } }
        }
        .onChange(of: taskFilter) { _, _ in if layout.supportsTwoPaneWorkspace { selectedBooking = filteredBookings.first } }
        .onChange(of: mineOnly) { _, _ in if layout.supportsTwoPaneWorkspace { selectedBooking = filteredBookings.first } }
        .onChange(of: filter) { _, _ in
            guard layout.supportsTwoPaneWorkspace else { return }
            if let selectedBooking,
               !filteredBookings.contains(where: { $0.id == selectedBooking.id }) {
                self.selectedBooking = filteredBookings.first
            }
        }

    }

    private func applyFilterRequest() {
        guard let raw = navigation.bookingFilterRequest else { return }
        navigation.bookingFilterRequest = nil
        search = ""; showOffers = false; taskFilter = nil; mineOnly = false; filter = BookingListFilter(rawValue: raw) ?? .all
    }
    private func openPendingBooking() {
        guard let id = pendingBookingID ?? BusinessNotificationRoute.pendingBooking,
              let booking = bookings.first(where: { $0.id == id }) else { return }
        showOffers = false; filter = .all; taskFilter = nil; mineOnly = false; search = ""; selectedBooking = booking
        pendingBookingID = nil; BusinessNotificationRoute.pendingBooking = nil
    }

    private var compactList: some View {
        bookingsList(showsChevron: true)
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
    }

    private var desktopWorkspace: some View {
        HStack(spacing: 0) {
            bookingsList(showsChevron: false)
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .frame(width: layout.listPaneWidth)
                .background(BusinessDesign.background)

            Divider()

            Group {
                if let selectedBooking {
                    BusinessAdaptivePaneHost {
                        BookingDetailView(bookingID: selectedBooking.id)
                    }
                    .id(selectedBooking.id)
                } else if !filteredBookings.isEmpty {
                    ContentUnavailableView(
                        "Выберите бронирование",
                        systemImage: "suitcase.rolling",
                        description: Text("Детали поездки откроются здесь, не закрывая список.")
                    )
                } else {
                    ContentUnavailableView(
                        "Бронирований нет",
                        systemImage: "suitcase.rolling",
                        description: Text("В этой категории сейчас нет поездок.")
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(BusinessDesign.background)
        }
    }

    private func bookingsList(showsChevron: Bool) -> some View {
        List {
            Section {
                BusinessPageHeading(title: "Бронирования", subtitle: "Управление поездками и статусами")
                    .listRowInsets(EdgeInsets(top: 12, leading: 18, bottom: 8, trailing: 18))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                operationsQueue
                    .listRowInsets(EdgeInsets(top: 4, leading: 18, bottom: 8, trailing: 18))
                    .listRowSeparator(.hidden).listRowBackground(Color.clear)
                filterBar
                    .listRowInsets(EdgeInsets(top: 2, leading: 0, bottom: 8, trailing: 0))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            }

            if let error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            }

            if filteredBookings.isEmpty && hasLoadedBookings && !loading {
                ContentUnavailableView("Бронирований нет", systemImage: "suitcase.rolling", description: Text("В этой категории сейчас нет поездок."))
                    .frame(maxWidth: .infinity)
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            }

            ForEach(filteredBookings) { booking in
                Button { selectedBooking = booking } label: {
                  VStack(alignment: .leading, spacing: 4) {
                    BookingRow(booking: booking, showsChevron: showsChevron)
                    if let task = booking.operationTasks?.min(by: { $0.priority < $1.priority }) {
                        Label(task.title, systemImage: task.priority == 0 ? "exclamationmark.circle" : "clock")
                            .font(.caption.weight(.semibold)).foregroundStyle(task.priority == 0 ? Color.orange : BusinessDesign.muted)
                    }
                  }.contentShape(Rectangle())
                }.buttonStyle(.plain)
                    .accessibilityAddTraits(layout.supportsTwoPaneWorkspace && selectedBooking?.id == booking.id ? .isSelected : [])
                    .listRowInsets(EdgeInsets(top: 7, leading: 18, bottom: 7, trailing: 18))
                    .listRowBackground(
                        layout.supportsTwoPaneWorkspace && selectedBooking?.id == booking.id
                            ? BusinessDesign.secondarySurface.opacity(0.72)
                            : Color.clear
                    )
                    .listRowSeparator(.hidden)
                    .contextMenu { Button("Открыть") { selectedBooking = booking } }
            }
        }
    }

    private var operationsQueue: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack { Text("Требуют внимания").font(.headline); Spacer(); if taskFilter != nil { Button("Все задачи") { taskFilter = nil; filter = .all } } }
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(expandQueue ? ["availability","receipt","payment","documents","ticket_purchase","departure","trip","cancellation","refund","finance_close","unassigned"] : ["availability","receipt","payment","documents"], id: \.self) { key in
                    let count = bookings.filter { (!mineOnly || (myMemberID != nil && $0.managerID == myMemberID)) && ($0.operationTasks ?? []).contains { $0.key == key } }.count
                    Button { taskFilter = taskFilter == key ? nil : key; filter = .all; search = "" } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(hasLoadedBookings ? "\(count)" : "—").font(.title2.bold()).monospacedDigit()
                            Text(BookingOperationTask(key: key, priority: 0, dueAt: nil).title).font(.caption).lineLimit(2)
                        }.frame(maxWidth: .infinity, minHeight: 52, alignment: .leading).padding(10)
                            .foregroundStyle(taskFilter == key ? BusinessDesign.onAccent : BusinessDesign.ink)
                            .background(taskFilter == key ? BusinessDesign.accent : BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 13))
                    }.buttonStyle(.plain).accessibilityAddTraits(taskFilter == key ? .isSelected : [])
                }
            }
            Button {
                expandQueue.toggle()
                if !expandQueue, let taskFilter, !["availability", "receipt", "payment", "documents"].contains(taskFilter) { self.taskFilter = nil }
            } label: { Label(expandQueue ? "Свернуть задачи" : "Все категории задач", systemImage: expandQueue ? "chevron.up" : "chevron.down") }.buttonStyle(BusinessActionStyle(primary: false))
            Toggle("Только мои бронирования", isOn: $mineOnly).font(.caption).disabled(myMemberID == nil)
        }.padding(12).businessCard(radius: 18)
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(BookingListFilter.allCases) { item in
                    Button {
                        withAnimation(.snappy(duration: 0.24)) { filter = item; taskFilter = nil }
                    } label: {
                        HStack(spacing: 6) {
                            Text(item.title)
                            let count = bookings.filter { item.matches(operationalStatus($0)) }.count
                            if item != .all && count > 0 {
                                Text("\(count)")
                                    .font(.caption2.bold())
                                    .padding(.horizontal, 6)
                                    .frame(height: 20)
                                    .background(filter == item ? BusinessDesign.onPrimaryControl.opacity(0.18) : BusinessDesign.secondarySurface, in: Capsule())
                            }
                        }
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(filter == item ? BusinessDesign.onPrimaryControl : BusinessDesign.ink)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 44)
                        .background(filter == item ? BusinessDesign.primaryControl : BusinessDesign.secondarySurface, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 18)
        }
    }

    private func operationalStatus(_ booking: BookingSummary) -> TripStatus {
        if let raw = booking.operationStatus, let value = TripStatus(rawValue: raw) { return value }
        switch booking.status {
        case .availabilityCheck: return .availabilityCheck
        case .paymentPending: return .paymentPending
        case .bookingConfirmed: return .bookingConfirmed
        case .readyToTravel: return .readyToTravel
        case .inTrip: return .inTrip
        case .completed: return .completed
        case .cancelled: return .cancelled
        }
    }

    @MainActor private func load() async {
        let generation = UUID()
        loadGeneration = generation
        if bookings.isEmpty { loading = true }
        defer { if loadGeneration == generation { loading = false } }
        error = nil
        do {
            let incoming = try await APIClient.shared.bookings()
            guard !Task.isCancelled, loadGeneration == generation else { return }
            bookings = incoming
            hasLoadedBookings = true
            if layout.supportsTwoPaneWorkspace {
                if let selectedBooking,
                   bookings.contains(where: { $0.id == selectedBooking.id }) {
                    self.selectedBooking = bookings.first(where: { $0.id == selectedBooking.id })
                } else {
                    selectedBooking = filteredBookings.first
                }
            }
        } catch {
            guard !Task.isCancelled, loadGeneration == generation else { return }
            self.error = error.localizedDescription
        }
    }

}
