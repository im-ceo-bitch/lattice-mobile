import Foundation
import SwiftUI
import UIKit

@MainActor
final class OverviewStore: ObservableObject {
    @Published var bookings: [BookingSummary] = []
    @Published var unreadChats = 0
    @Published var ignavUsage: IgnavUsageSnapshot?
    @Published var loading = false
    @Published var recentSecurityEvent: BusinessSecurityLoginEvent?
    @Published var refreshWarning: String?
    @Published var hasLoadedBookings = false
    private var refreshGeneration = UUID()

    func reloadSecurityEvents() async {
        guard let response = try? await APIClient.shared.businessSecurityEvents(limit: 8) else { return }
        recentSecurityEvent = response.events.first(where: { !$0.isCurrent })
    }

    func reload() async {
        let generation = UUID()
        refreshGeneration = generation
        loading = true
        defer { if refreshGeneration == generation { loading = false } }
        async let bookingsTask = APIClient.shared.bookings()
        async let chatsTask = APIClient.shared.businessChatThreads()
        async let usageTask = APIClient.shared.ignavUsage()
        var failed: [String] = []
        let newBookings = try? await bookingsTask
        guard !Task.isCancelled, refreshGeneration == generation else { return }
        if let newBookings { bookings = newBookings; hasLoadedBookings = true }
        else { failed.append("бронирования") }
        let newChats = try? await chatsTask
        guard !Task.isCancelled, refreshGeneration == generation else { return }
        if let newChats { unreadChats = newChats.filter(\.unreadForStaff).count }
        else { failed.append("чаты") }
        let newUsage = try? await usageTask
        guard !Task.isCancelled, refreshGeneration == generation else { return }
        if let newUsage { ignavUsage = newUsage }
        else { failed.append("Ignav") }
        refreshWarning = failed.isEmpty ? nil : "Не обновлено: " + failed.joined(separator: ", ") + ". Показаны последние доступные данные."
    }
}

struct OverviewView: View {
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.businessAdaptiveLayout) private var layout
    @StateObject private var store = OverviewStore()
    @State private var showUmrahBuilder = false
    @State private var showPush = false
    @AppStorage("iumrah.business.security.dismissedEvent") private var dismissedSecurityEvent = ""

    var checking: Int { store.bookings.filter { operationalStatus($0) == .availabilityCheck }.count }
    var payment: Int { store.bookings.filter { operationalStatus($0) == .paymentPending }.count }
    var active: Int { store.bookings.filter { [.bookingConfirmed, .readyToTravel, .inTrip].contains(operationalStatus($0)) }.count }

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

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                BusinessPageHeading(title: "Обзор", subtitle: "Центр управления iumrah")
                if let warning = store.refreshWarning {
                    Label(warning, systemImage: "exclamationmark.circle")
                        .font(.footnote).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if let event = store.recentSecurityEvent, event.id != dismissedSecurityEvent {
                    securityBanner(event)
                }
                Button { showUmrahBuilder = true } label: {
                    HStack(spacing: 16) {
                        Image(systemName: "plus").font(.title2.weight(.medium))
                            .frame(width: 56, height: 56)
                            .businessGlass(in: RoundedRectangle(cornerRadius: 20), interactive: true)
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Создать умру").font(.title2.bold())
                            Text("Перелёт, отели и личный трансфер")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.headline)
                    }.foregroundStyle(BusinessDesign.ink).padding(22).businessCard(radius: 30)
                }.buttonStyle(.plain)

                VStack(alignment: .leading, spacing: 14) {
                    Text("БРОНИРОВАНИЯ").font(.caption2.bold()).tracking(2.2).foregroundStyle(.white.opacity(0.52))
                    Text(!store.hasLoadedBookings ? (store.loading ? "Проверяем бронирования…" : "Бронирования не загружены.") : checking == 0 ? "Очередь подтверждений чистая." : "\(checking) бронирований ждут подтверждения.")
                        .font(.largeTitle.bold()).foregroundStyle(.white)
                    Text("Актуальное состояние поездок и очередь подтверждений.")
                        .font(.subheadline).foregroundStyle(.white.opacity(0.62))
                    HStack { Image(systemName: "checkmark.shield.fill"); Text("SUPERADMIN").font(.caption2.bold()).tracking(1.5) }
                        .foregroundStyle(Color.orange).padding(.top, 10)
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding(26)
                .background(
                    LinearGradient(colors: [Color.black, Color(red: 0.11, green: 0.11, blue: 0.12)], startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 36, style: .continuous)
                )

                if layout.supportsDenseDashboard {
                    LazyVGrid(
                        columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 4),
                        spacing: 10
                    ) {
                        StatCard(title: "ВСЕГО", value: store.bookings.count, subtitle: "бронирований")
                        StatCard(title: "НАЛИЧИЕ", value: checking, subtitle: "проверить", attention: true)
                        StatCard(title: "ОПЛАТА", value: payment, subtitle: "ожидают")
                        StatCard(title: "В РАБОТЕ", value: active, subtitle: "активных")
                    }
                } else {
                    HStack(spacing: 10) {
                        StatCard(title: "ВСЕГО", value: store.bookings.count, subtitle: "бронирований")
                        StatCard(title: "НАЛИЧИЕ", value: checking, subtitle: "проверить", attention: true)
                    }
                    HStack(spacing: 10) {
                        StatCard(title: "ОПЛАТА", value: payment, subtitle: "ожидают")
                        StatCard(title: "В РАБОТЕ", value: active, subtitle: "активных")
                    }
                }


                Button { showPush = true } label: {
                    HStack { Image(systemName: "bell.badge"); Text("Уведомления").font(.headline); Spacer(); Text("\(store.unreadChats) непрочитанных").font(.caption); Image(systemName: "chevron.right") }
                        .foregroundStyle(BusinessDesign.ink).padding(18).businessCard(radius: 22)
                }.buttonStyle(.plain)
                DisclosureGroup("Использование API") { IgnavUsageCard(usage: store.ignavUsage, loading: store.loading) }.padding(16).businessCard(radius: 22)

                VStack(alignment: .leading, spacing: 12) {
                    HStack { Text("Последние бронирования").font(.title2.bold()); Spacer(); if store.loading { ProgressView() } }
                    ForEach(store.bookings.prefix(5)) { booking in
                        NavigationLink {
                            BookingDetailView(bookingID: booking.id)
                        } label: {
                            BookingRow(booking: booking, showsChevron: false)
                        }
                        .buttonStyle(.plain)
                    }
                    if store.hasLoadedBookings && store.bookings.isEmpty && !store.loading { Text("Заявок пока нет.").foregroundStyle(.secondary).padding(.vertical, 30).frame(maxWidth: .infinity) }
                }
                .padding(18).businessCard(radius: 30)
            }
            .businessAdaptiveReadableWidth()
            .padding(16)
        }
        .background(BusinessDesign.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .businessNavigationSurface()
        .sheet(isPresented: $showPush) { NavigationStack { BusinessPushDiagnosticsView() } }
        .sheet(isPresented: $showUmrahBuilder) { NavigationStack { UmrahBuilderView(owner: auth.user?.login ?? "") } }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { BusinessSidebarButton() }
            ToolbarItem(placement: .principal) { BusinessBrandLogo(width: 150, foreground: .white).frame(height: 36) }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Диагностика уведомлений") { showPush = true }
                    Button("Обновить") { Task { await store.reload() } }
                    Button("Выйти", role: .destructive) { Task { await auth.logout() } }
                } label: { Image(systemName: "ellipsis.circle") }
            }
        }
        .task {
            await store.reload()
            await store.reloadSecurityEvents()
        }
        .onReceive(NotificationCenter.default.publisher(for: .iumrahBusinessSecurityNewSession)) { _ in
            Task { await store.reloadSecurityEvents() }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("iumrah.business.bookingOperationsChanged"))) { _ in
            Task { await store.reload() }
        }
        .refreshable {
            await store.reload()
            await store.reloadSecurityEvents()
        }
    }

    private func securityBanner(_ event: BusinessSecurityLoginEvent) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "lock.shield")
                .font(.title2)
                .foregroundStyle(BusinessDesign.ink)
            VStack(alignment: .leading, spacing: 5) {
                Text("Новый вход").font(.headline)
                Text(event.deviceName.isEmpty ? event.deviceModel : event.deviceName)
                    .font(.subheadline).foregroundStyle(.secondary)
                NavigationLink {
                    BusinessSessionsView()
                } label: {
                    Text("Проверить устройства").font(.subheadline.weight(.semibold))
                }
                .foregroundStyle(BusinessDesign.ink)
            }
            Spacer(minLength: 0)
            Button {
                dismissedSecurityEvent = event.id
            } label: {
                Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Закрыть уведомление о входе")
        }
        .padding(16)
        .businessCard(radius: 22)
    }
}

private struct IgnavUsageCard: View {
    let usage: IgnavUsageSnapshot?
    let loading: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: "airplane.circle.fill")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(BusinessDesign.accent)
                    .frame(width: 48, height: 48)
                    .background(BusinessDesign.softOrange, in: Circle())
                VStack(alignment: .leading, spacing: 3) {
                    Text("IGNAV API").font(.caption2.bold()).tracking(1.5).foregroundStyle(.secondary)
                    Text("Бюджет поисковых запросов").font(.headline)
                }
                Spacer()
                if loading && usage == nil { ProgressView() }
            }

            if let usage {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("\(usage.remainingRequests)")
                            .font(.system(size: 38, weight: .bold, design: .rounded))
                            .monospacedDigit()
                        Text("осталось в \(usage.period)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 3) {
                        Text("\(usage.successfulRequests) / \(usage.monthlyBudget)")
                            .font(.headline.monospacedDigit())
                        Text("успешных запросов")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                ProgressView(value: min(1, max(0, usage.usedFraction)))
                    .tint(usage.usedFraction >= 0.85 ? Color.red : BusinessDesign.accent)

                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "info.circle")
                    Text(usage.trackingNote)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                if let last = usage.lastSuccessAt, !last.isEmpty {
                    Text("Последний успешный запрос: \(last.replacingOccurrences(of: "T", with: " ").prefix(16)) UTC")
                        .font(.caption2.monospaced())
                        .foregroundStyle(.tertiary)
                }
            } else if !loading {
                Text("Статистика Ignav временно недоступна.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(18)
        .businessCard(radius: 30)
    }
}

private struct StatCard: View {
    let title: String; let value: Int; let subtitle: String; var attention = false
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.caption2.bold()).tracking(1.5).foregroundStyle(.secondary)
            Spacer(minLength: 10)
            Text("\(value)").font(.system(size: 40, weight: .bold)).tracking(-2).foregroundStyle(attention ? BusinessDesign.accent : BusinessDesign.ink)
            Text(subtitle).font(.caption).foregroundStyle(.secondary)
        }
        .padding(18).frame(maxWidth: .infinity, minHeight: 130, alignment: .leading)
        .background(attention ? BusinessDesign.softOrange : BusinessDesign.card, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).stroke(BusinessDesign.line))
    }
}

struct BookingRow: View {
    let booking: BookingSummary
    var showsChevron = false

    private var statusLabel: String {
        if let raw = booking.operationStatus, let status = TripStatus(rawValue: raw) { return status.title }
        return booking.status.shortLabel
    }

    private var displayName: String {
        let value = booking.clientName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty || value == "Паломник" ? "Имя не синхронизировано" : value
    }

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Text(statusLabel)
                        .font(.caption2.bold())
                        .lineLimit(1)
                        .padding(.horizontal, 10)
                        .frame(height: 27)
                        .background(BusinessDesign.secondarySurface, in: Capsule())
                    Spacer(minLength: 8)
                    Text(booking.totalUsd, format: .currency(code: "USD").precision(.fractionLength(0)))
                        .font(.title3.bold())
                        .monospacedDigit()
                }

                Text(displayName)
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .lineLimit(1)

                if !booking.flightName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Label(booking.flightName, systemImage: "airplane.circle.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                HStack(spacing: 8) {
                    if let bookingNumber = booking.bookingDisplayNumber, !bookingNumber.isEmpty {
                        Text("Бронь \(bookingNumber)")
                            .font(.caption.monospaced().weight(.bold))
                            .foregroundStyle(.primary)
                            .padding(.horizontal, 10)
                            .frame(height: 28)
                            .background(BusinessDesign.secondarySurface, in: Capsule())
                    }
                    if let pilgrimID = booking.pilgrimID, !pilgrimID.isEmpty {
                        HStack(spacing: 5) {
                            Text("Iumrah ID \(pilgrimID)")
                                .monospaced()
                            Image(systemName: "doc.on.doc")
                                .font(.system(size: 10, weight: .semibold))
                        }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.primary)
                        .padding(.horizontal, 10)
                        .frame(height: 28)
                        .background(BusinessDesign.secondarySurface, in: Capsule())
                        .textSelection(.enabled)
                        .contextMenu {
                            Button {
                                UIPasteboard.general.string = pilgrimID
                            } label: {
                                Label("Копировать Iumrah ID", systemImage: "doc.on.doc")
                            }
                        }
                    }

                    Label("\(booking.originCode) → \(booking.outboundDestination)", systemImage: "airplane")
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Label("\(booking.travelerCount)", systemImage: "person.2.fill")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.tertiary)
                    .frame(width: 22)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .background(BusinessDesign.tertiarySurface, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).stroke(BusinessDesign.line, lineWidth: 1))
    }
}
