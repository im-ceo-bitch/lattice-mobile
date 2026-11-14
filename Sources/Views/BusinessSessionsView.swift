import SwiftUI
import UIKit

struct BusinessSessionsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.businessUsesPersistentSidebar) private var usesPersistentSidebar
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.businessAdaptiveLayout) private var layout

    @State private var response: BusinessSessionsResponse?
    @State private var loading = true
    @State private var workingSessionID: String?
    @State private var errorMessage: String?
    @State private var confirmation: Confirmation?

    private var currentSession: BusinessAccountSession? {
        response?.sessions.first(where: \.isCurrent)
    }

    private var otherSessions: [BusinessAccountSession] {
        response?.sessions.filter { !$0.isCurrent } ?? []
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [BusinessDesign.background, BusinessDesign.tertiarySurface],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            if loading && response == nil {
                ProgressView("Проверяем защищённые сеансы…")
                    .font(.subheadline.weight(.medium))
            } else {
                content
            }
        }
        .navigationTitle("Устройства и сеансы")
        .navigationBarTitleDisplayMode(.inline)
        .businessNavigationSurface()
        .toolbar {
            if !usesPersistentSidebar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Закрыть") { dismiss() }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await load() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(loading || workingSessionID != nil)
                .accessibilityLabel("Обновить сеансы")
            }
        }
        .task { await load() }
        .alert(item: $confirmation) { item in
            switch item {
            case .terminate(let session):
                return Alert(
                    title: Text(session.isCurrent ? "Выйти на этом устройстве?" : "Завершить сеанс?"),
                    message: Text(session.isCurrent
                        ? "Для следующего входа потребуется логин и пароль. Основной статус устройства сохранится."
                        : "Устройство «\(session.displayName)» немедленно потеряет доступ к iumrah Business."),
                    primaryButton: .destructive(Text("Завершить")) {
                        Task { await terminate(session) }
                    },
                    secondaryButton: .cancel(Text("Отмена"))
                )
            case .terminateOthers:
                return Alert(
                    title: Text("Завершить все другие сеансы?"),
                    message: Text("Все остальные устройства потеряют доступ. Текущий основной сеанс останется активным."),
                    primaryButton: .destructive(Text("Завершить все")) {
                        Task { await terminateOthers() }
                    },
                    secondaryButton: .cancel(Text("Отмена"))
                )
            }
        }
        .alert("Не удалось выполнить действие", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("Понятно", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "Попробуйте ещё раз.")
        }
    }

    private var content: some View {
        ScrollView {
            Group {
                if layout.supportsDenseDashboard {
                    HStack(alignment: .top, spacing: 18) {
                        VStack(spacing: 22) {
                            hero
                            sessionsColumn
                        }
                        .frame(maxWidth: .infinity, alignment: .top)

                        VStack(spacing: 16) {
                            policyCard
                            expirationCard
                        }
                        .frame(width: 330, alignment: .top)
                    }
                } else {
                    VStack(spacing: 22) {
                        hero
                        sessionsColumn
                        policyCard
                        expirationCard
                    }
                }
            }
            .businessAdaptiveDetailWidth()
            .padding(.horizontal, 18)
            .padding(.top, 18)
            .padding(.bottom, 42)
        }
        .refreshable { await load() }
    }

    @ViewBuilder
    private var sessionsColumn: some View {
        if let currentSession {
            sectionLabel("ЭТО УСТРОЙСТВО")
            SessionCard(
                session: currentSession,
                currentIsPrimary: currentSession.isPrimary,
                working: workingSessionID == currentSession.id,
                onApprove: nil,
                onTerminate: { confirmation = .terminate(currentSession) }
            )
        }

        if !otherSessions.isEmpty {
            sectionLabel("АКТИВНЫЕ СЕАНСЫ")
            VStack(spacing: 12) {
                ForEach(otherSessions) { session in
                    SessionCard(
                        session: session,
                        currentIsPrimary: currentSession?.isPrimary == true,
                        working: workingSessionID == session.id,
                        onApprove: currentSession?.isPrimary == true && !session.trusted
                            ? { Task { await approve(session) } }
                            : nil,
                        onTerminate: currentSession?.isPrimary == true
                            ? { confirmation = .terminate(session) }
                            : nil
                    )
                }
            }

            if currentSession?.isPrimary == true {
                Button(role: .destructive) {
                    confirmation = .terminateOthers
                } label: {
                    Label("Завершить все другие сеансы", systemImage: "hand.raised.fill")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.red)
                .businessGlass(in: Capsule())
                .disabled(workingSessionID != nil)
            }
        }
    }

    private var hero: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(Color.blue.opacity(0.10))
                    .frame(width: 108, height: 108)
                Circle()
                    .stroke(BusinessDesign.line, lineWidth: 1)
                    .frame(width: 92, height: 92)
                Image(systemName: "laptopcomputer.and.iphone")
                    .font(.system(size: 43, weight: .medium))
                    .foregroundStyle(.blue)
            }
            .businessGlass(in: Circle())

            VStack(spacing: 8) {
                Text("Контроль каждого входа")
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                    .multilineTextAlignment(.center)
                Text("Проверяйте устройства, подтверждайте свои входы и мгновенно отключайте неизвестные сеансы.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 340)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }

    private var policyCard: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: "lock.shield.fill")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.green)
                .frame(width: 44, height: 44)
                .background(Color.green.opacity(0.11), in: Circle())
            VStack(alignment: .leading, spacing: 6) {
                Text("Основной сеанс защищён")
                    .font(.headline)
                Text(currentSession?.isPrimary == true
                    ? "Только это устройство может завершать другие сеансы. Новые входы никогда не смогут отключить Вас."
                    : "Это устройство может завершить только собственный сеанс. Управление другими входами доступно исключительно основному устройству.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(18)
        .businessCard(radius: 26)
    }

    private var expirationCard: some View {
        HStack(spacing: 14) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 20, weight: .semibold))
                .frame(width: 42, height: 42)
                .background(BusinessDesign.secondarySurface, in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text("Автоматическое завершение")
                    .font(.subheadline.weight(.semibold))
                Text("Неактивные сеансы завершаются через \(response?.inactivityDays ?? 180) дней.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text("6 мес.")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .padding(17)
        .businessCard(radius: 24)
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .tracking(0.8)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
            .padding(.bottom, -12)
    }

    @MainActor
    private func load() async {
        loading = true
        do {
            response = try await APIClient.shared.businessSessions()
        } catch {
            if response == nil { errorMessage = error.localizedDescription }
        }
        loading = false
    }

    @MainActor
    private func approve(_ session: BusinessAccountSession) async {
        workingSessionID = session.id
        do {
            try await APIClient.shared.approveBusinessSession(id: session.id)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            response = try await APIClient.shared.businessSessions()
        } catch {
            errorMessage = error.localizedDescription
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
        workingSessionID = nil
    }

    @MainActor
    private func terminate(_ session: BusinessAccountSession) async {
        workingSessionID = session.id
        if session.isCurrent {
            await auth.logout()
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            dismiss()
            return
        }
        do {
            _ = try await APIClient.shared.terminateBusinessSession(id: session.id)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            response = try await APIClient.shared.businessSessions()
        } catch {
            errorMessage = error.localizedDescription
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
        workingSessionID = nil
    }

    @MainActor
    private func terminateOthers() async {
        workingSessionID = "others"
        do {
            try await APIClient.shared.terminateOtherBusinessSessions()
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            response = try await APIClient.shared.businessSessions()
        } catch {
            errorMessage = error.localizedDescription
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
        workingSessionID = nil
    }
}

private struct SessionCard: View {
    let session: BusinessAccountSession
    let currentIsPrimary: Bool
    let working: Bool
    let onApprove: (() -> Void)?
    let onTerminate: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            HStack(alignment: .top, spacing: 14) {
                deviceIcon
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 7) {
                        Text(session.displayName)
                            .font(.headline)
                            .lineLimit(1)
                        if session.isCurrent {
                            Text("ЭТО ВЫ")
                                .font(.system(size: 9, weight: .bold))
                                .tracking(0.5)
                                .padding(.horizontal, 7)
                                .frame(height: 20)
                                .foregroundStyle(.blue)
                                .background(Color.blue.opacity(0.10), in: Capsule())
                        }
                    }
                    Text(session.softwareLine)
                        .font(.subheadline)
                    Text(session.activityLine)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                Spacer(minLength: 4)
                trustBadge
            }

            if let onApprove {
                Divider().opacity(0.65)
                Button(action: onApprove) {
                    Label("Подтвердить моё устройство", systemImage: "checkmark.shield.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.blue)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                .disabled(working)
            }

            if let onTerminate {
                Divider().opacity(0.65)
                Button(role: .destructive, action: onTerminate) {
                    HStack {
                        Label(session.isCurrent ? "Завершить этот сеанс" : "Завершить сеанс", systemImage: "hand.raised")
                            .font(.subheadline.weight(.semibold))
                        Spacer()
                        if working { ProgressView().controlSize(.small) }
                    }
                }
                .buttonStyle(.plain)
                .disabled(working)
            } else if !session.isCurrent && !currentIsPrimary {
                Divider().opacity(0.65)
                Label("Управляется основным устройством", systemImage: "lock.fill")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(17)
        .businessCard(radius: 28)
    }

    private var deviceIcon: some View {
        let platform = session.platform.lowercased()
        let isMac = platform == "macos" || platform == "mac" || session.deviceModel.lowercased().contains("mac")
        let isAndroid = platform == "android"
        let isIPad = !isMac && session.deviceModel.lowercased().contains("ipad")
        let tint: Color = isAndroid ? .green : (isMac ? .indigo : .blue)
        let symbol = isAndroid ? "apps.iphone" : (isMac ? "macbook" : (isIPad ? "ipad" : "iphone.gen3"))

        return ZStack {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(tint.gradient)
            Image(systemName: symbol)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.white)
        }
        .frame(width: 48, height: 48)
        .shadow(color: tint.opacity(0.20), radius: 8, y: 4)
    }

    @ViewBuilder private var trustBadge: some View {
        if session.isPrimary {
            Image(systemName: "crown.fill")
                .foregroundStyle(.orange)
                .accessibilityLabel("Основное устройство")
        } else if session.trusted {
            Image(systemName: "checkmark.seal.fill")
                .foregroundStyle(.green)
                .accessibilityLabel("Подтверждённое устройство")
        } else {
            Text("НОВЫЙ")
                .font(.system(size: 9, weight: .bold))
                .tracking(0.6)
                .foregroundStyle(.orange)
                .padding(.horizontal, 8)
                .frame(height: 22)
                .background(Color.orange.opacity(0.11), in: Capsule())
        }
    }
}

private enum Confirmation: Identifiable {
    case terminate(BusinessAccountSession)
    case terminateOthers

    var id: String {
        switch self {
        case .terminate(let session): return "terminate-\(session.id)"
        case .terminateOthers: return "terminate-others"
        }
    }
}

private extension BusinessAccountSession {
    var displayName: String {
        let platformValue = platform.lowercased()
        if platformValue == "macos" || platformValue == "mac" {
            if !deviceName.isEmpty, deviceName != "Mac" { return deviceName }
            if !deviceModel.isEmpty { return deviceModel }
            return "Mac"
        }
        if !deviceModel.isEmpty, deviceModel != "iPhone" { return deviceModel }
        if !deviceName.isEmpty { return deviceName }
        if !deviceModel.isEmpty { return deviceModel }
        return platformValue == "android" ? "Android" : "iPhone"
    }

    var softwareLine: String {
        let os = [osName, osVersion].filter { !$0.isEmpty }.joined(separator: " ")
        let app = appVersion.isEmpty ? "" : "iumrah Business \(appVersion)"
        return [os, app].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    var activityLine: String {
        let country = countryCode.isEmpty
            ? ""
            : (Locale(identifier: "ru_RU").localizedString(forRegionCode: countryCode) ?? countryCode)
        let location = [city, country].filter { !$0.isEmpty }.joined(separator: ", ")
        let activity = isCurrent ? "в сети" : Self.relativeTime(lastActiveAt)
        return [location, activity].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    static func relativeTime(_ raw: String) -> String {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let regular = ISO8601DateFormatter()
        regular.formatOptions = [.withInternetDateTime]
        guard let date = fractional.date(from: raw) ?? regular.date(from: raw) else { return "недавно" }
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}
