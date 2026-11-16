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

    @State private var bookings: [BookingSummary] = []
    @State private var loading = true
    @State private var deleting = false
    @State private var error: String?
    @State private var filter: BookingListFilter = .all
    @State private var search = ""
    @State private var pendingBookingID: String?
    @State private var bookingPendingDelete: BookingSummary?
    @State private var selectedBooking: BookingSummary?
    @State private var loadGeneration = UUID()
    @Environment(\.scenePhase) private var scenePhase

    private var filteredBookings: [BookingSummary] {
        bookings.filter { booking in
            guard filter.matches(operationalStatus(booking)) else { return false }
            let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
            return query.isEmpty || [booking.id, booking.clientName ?? "", booking.pilgrimID ?? "", booking.bookingDisplayNumber ?? "", booking.bookingNumber.map { String($0) } ?? ""].contains { $0.localizedCaseInsensitiveContains(query) }
        }
    }

    var body: some View {
        Group {
            if layout.supportsTwoPaneWorkspace {
                desktopWorkspace
            } else {
                compactList
            }
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
            ToolbarItem(placement: .principal) {
                BusinessBrandLogo(width: 150, foreground: .white).frame(height: 36)
            }
        }
        .overlay {
            if (loading && bookings.isEmpty) || deleting {
                ZStack {
                    BusinessDesign.background.opacity(deleting ? 0.88 : 0.72).ignoresSafeArea()
                    ProgressView(deleting ? "Удаляю…" : "")
                }
            }
        }
        .searchable(text: $search, prompt: "Имя, номер брони, iumrah ID")
        .task { await load(); openPendingBooking() }
        .onReceive(NotificationCenter.default.publisher(for: .iumrahBusinessBookingOpen)) { notification in
            pendingBookingID = notification.object as? String
            Task { await load(); openPendingBooking() }
        }
        .onChange(of: scenePhase) { _, phase in if phase == .active { openPendingBooking() } }
        .onReceive(NotificationCenter.default.publisher(for: bookingOperationsChangedNotification)) { _ in
            Task { await load() }
        }
        .refreshable { await load() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await load() } }
        }
        .onChange(of: filter) { _, _ in
            guard layout.supportsTwoPaneWorkspace else { return }
            if let selectedBooking,
               !filteredBookings.contains(where: { $0.id == selectedBooking.id }) {
                self.selectedBooking = filteredBookings.first
            }
        }
        .alert("Удалить бронирование?", isPresented: Binding(
            get: { bookingPendingDelete != nil },
            set: { if !$0 { bookingPendingDelete = nil } }
        )) {
            Button("Отмена", role: .cancel) { bookingPendingDelete = nil }
            Button("Удалить полностью", role: .destructive) {
                guard let booking = bookingPendingDelete else { return }
                bookingPendingDelete = nil
                Task { await delete(booking) }
            }
        } message: {
            Text("Бронирование будет полностью удалено из основной базы, iumrah Business, чата и связанных операционных данных. Действие нельзя отменить.")
        }
    }

    private func openPendingBooking() {
        guard let id = pendingBookingID ?? BusinessNotificationRoute.pendingBooking,
              let booking = bookings.first(where: { $0.id == id }) else { return }
        filter = .all; search = ""; selectedBooking = booking
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

            if filteredBookings.isEmpty && !loading {
                ContentUnavailableView("Бронирований нет", systemImage: "suitcase.rolling", description: Text("В этой категории сейчас нет поездок."))
                    .frame(maxWidth: .infinity)
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            }

            ForEach(filteredBookings) { booking in
                BookingRow(booking: booking, showsChevron: showsChevron)
                    .contentShape(Rectangle())
                    .onTapGesture { selectedBooking = booking }
                    .listRowInsets(EdgeInsets(top: 7, leading: 18, bottom: 7, trailing: 18))
                    .listRowBackground(
                        layout.supportsTwoPaneWorkspace && selectedBooking?.id == booking.id
                            ? BusinessDesign.secondarySurface.opacity(0.72)
                            : Color.clear
                    )
                    .listRowSeparator(.hidden)
                    .contextMenu {
                        Button("Открыть") { selectedBooking = booking }
                        Divider()
                        Button("Удалить", role: .destructive) { bookingPendingDelete = booking }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            bookingPendingDelete = booking
                        } label: {
                            Label("Удалить", systemImage: "trash")
                        }
                    }
            }
        }
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(BookingListFilter.allCases) { item in
                    Button {
                        withAnimation(.snappy(duration: 0.24)) { filter = item }
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
                        .frame(height: 40)
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
        guard !deleting else { return }
        let generation = UUID()
        loadGeneration = generation
        if bookings.isEmpty { loading = true }
        defer { if loadGeneration == generation { loading = false } }
        error = nil
        do {
            let incoming = try await APIClient.shared.bookings()
            guard !Task.isCancelled, loadGeneration == generation, !deleting else { return }
            bookings = incoming
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

    @MainActor private func delete(_ booking: BookingSummary) async {
        deleting = true
        loadGeneration = UUID()
        loading = false
        error = nil
        do {
            try await APIClient.shared.deleteBooking(id: booking.id)
            withAnimation(.snappy) { bookings.removeAll { $0.id == booking.id } }
            if selectedBooking?.id == booking.id { selectedBooking = filteredBookings.first }
            NotificationCenter.default.post(name: bookingOperationsChangedNotification, object: booking.id)
        } catch {
            self.error = error.localizedDescription
        }
        deleting = false
    }
}
