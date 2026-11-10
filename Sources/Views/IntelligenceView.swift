import SwiftUI

@MainActor
private final class IntelligenceStore: ObservableObject {
    @Published var overview: IntelligenceOverview?
    @Published var sessions: [IntelligenceSession] = []
    @Published var reports: [IntelligenceReport] = []
    @Published var days = 7
    @Published var loading = false
    @Published var generating = false
    @Published var message: String?

    func reload() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            async let overviewTask = APIClient.shared.intelligenceOverview(days: days)
            async let sessionsTask = APIClient.shared.intelligenceSessions(days: days)
            async let reportsTask = APIClient.shared.intelligenceReports()
            let newOverview = try await overviewTask
            let newSessions = try await sessionsTask
            let newReports = try await reportsTask
            overview = newOverview
            sessions = newSessions
            reports = newReports
            message = nil
        } catch {
            message = error.localizedDescription
        }
    }

    func generate() async {
        guard !generating else { return }
        generating = true
        defer { generating = false }
        do {
            try await APIClient.shared.generateIntelligenceReport()
            reports = try await APIClient.shared.intelligenceReports()
            message = nil
        } catch {
            message = error.localizedDescription
        }
    }
}

private enum IntelligencePage: String, CaseIterable, Identifiable {
    case overview = "Обзор"
    case journey = "Сессии"
    case gemini = "Gemini"
    var id: String { rawValue }
}

struct IntelligenceView: View {
    @StateObject private var store = IntelligenceStore()
    @State private var page: IntelligencePage = .overview

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header

                Picker("Раздел", selection: $page) {
                    ForEach(IntelligencePage.allCases) { page in Text(page.rawValue).tag(page) }
                }
                .pickerStyle(.segmented)

                if let message = store.message {
                    HStack(alignment: .top, spacing: 9) {
                        Image(systemName: "exclamationmark.circle")
                        Text(message)
                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(.red)
                    .font(.footnote)
                    .padding(16)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 18))
                }

                if store.loading && store.overview == nil {
                    ProgressView("Загружаем аналитику…")
                        .frame(maxWidth: .infinity, minHeight: 180)
                } else {
                    switch page {
                    case .overview: dashboard
                    case .journey: journeys
                    case .gemini: advisor
                    }
                }
            }
            .businessAdaptiveReadableWidth()
            .padding(16)
        }
        .background(BusinessDesign.background)
        .navigationTitle("Intelligence")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { BusinessSidebarButton() }
            ToolbarItem(placement: .topBarTrailing) {
                Button { Task { await store.reload() } } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(store.loading)
                .accessibilityLabel("Обновить аналитику")
            }
        }
        .task { await store.reload() }
        .refreshable { await store.reload() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "chart.xyaxis.line")
                    .font(.title2.weight(.semibold))
                    .frame(width: 52, height: 52)
                    .foregroundStyle(.white)
                    .background(Color(red: 0.40, green: 0.21, blue: 0.85), in: RoundedRectangle(cornerRadius: 17))
                VStack(alignment: .leading, spacing: 3) {
                    Text("iumrah Intelligence").font(.title2.bold())
                    Text("Поведение, конверсия и AI-рекомендации")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            Text("Вся статистика поступает с вашего сервера. Пока клиентское приложение не отправляет события, показатели останутся пустыми.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(18)
        .businessCard(radius: 24)
    }

    private var dashboard: some View {
        VStack(alignment: .leading, spacing: 16) {
            Picker("Период", selection: $store.days) {
                Text("7 дней").tag(7)
                Text("14 дней").tag(14)
                Text("30 дней").tag(30)
            }
            .pickerStyle(.segmented)
            .onChange(of: store.days) { _, _ in Task { await store.reload() } }

            if let data = store.overview {
                HStack(spacing: 10) {
                    intelligenceMetric("Посетители", value: data.visitors, icon: "person.2")
                    intelligenceMetric("Сеансы", value: data.sessions, icon: "clock.arrow.circlepath")
                }
                HStack(spacing: 10) {
                    intelligenceMetric("События", value: data.events, icon: "cursorarrow.click.2")
                    intelligenceMetric("Брони", value: data.funnel.first(where: { $0.event == "booking_completed" })?.visitors ?? 0, icon: "checkmark.circle")
                }

                VStack(alignment: .leading, spacing: 17) {
                    Text("Путь к бронированию").font(.headline)
                    Text("Уникальные посетители на каждом этапе за выбранный период. Этапы не обязательно принадлежат одной сессии.")
                        .font(.caption).foregroundStyle(.secondary)
                    let scale = max(1, data.funnel.map(\.visitors).max() ?? 1)
                    ForEach(data.funnel) { step in
                        VStack(alignment: .leading, spacing: 7) {
                            HStack {
                                Text(step.title).font(.subheadline)
                                Spacer()
                                Text(step.visitors.formatted()).font(.subheadline.weight(.semibold)).monospacedDigit()
                            }
                            GeometryReader { geometry in
                                Capsule().fill(BusinessDesign.secondarySurface)
                                    .overlay(alignment: .leading) {
                                        Capsule().fill(Color(red: 0.40, green: 0.21, blue: 0.85))
                                            .frame(width: max(0, geometry.size.width * CGFloat(step.visitors) / CGFloat(scale)))
                                    }
                            }
                            .frame(height: 8)
                        }
                    }
                }
                .padding(19)
                .businessCard(radius: 24)

                VStack(alignment: .leading, spacing: 12) {
                    Text("Популярные экраны").font(.headline)
                    if data.screens.isEmpty {
                        empty("Просмотры экранов пока не поступали.")
                    } else {
                        ForEach(data.screens.prefix(8)) { screen in
                            HStack {
                                Text(screen.screen).font(.subheadline).lineLimit(1)
                                Spacer()
                                VStack(alignment: .trailing, spacing: 3) {
                                    Text("\(screen.views) просмотров").font(.caption).foregroundStyle(.secondary)
                                    if let seconds = screen.averageSeconds {
                                        Text("В среднем: \(seconds) сек.").font(.caption2).foregroundStyle(.secondary)
                                    }
                                }
                            }
                            Divider()
                        }
                    }
                }
                .padding(19)
                .businessCard(radius: 24)

                if data.events == 0 {
                    empty("Данных пока нет. После подключения трекинга в клиентском iOS/Android приложении события начнут появляться здесь.")
                }
            } else {
                empty("Не удалось загрузить показатели. Проверьте деплой Worker и миграцию D1.")
            }
        }
    }

    private var journeys: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Последние сессии").font(.title3.bold())
            Text("Псевдонимные сессии без персональных и платёжных данных. Выход в фон не означает удаление приложения.")
                .font(.footnote).foregroundStyle(.secondary)
            if store.sessions.isEmpty {
                empty("Сессий пока нет.")
            } else {
                ForEach(store.sessions) { session in
                    NavigationLink {
                        IntelligenceJourneyView(sessionId: session.sessionId)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: session.platform == "ios" ? "iphone.gen3" : "smartphone")
                                .font(.title3)
                                .frame(width: 36)
                            VStack(alignment: .leading, spacing: 5) {
                                Text("Сессия \(String(session.sessionId.prefix(8)))")
                                    .font(.subheadline.weight(.semibold))
                                Text("\(session.platform.uppercased()) · \(session.eventCount) событий")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(String(session.lastEventAt.prefix(16)).replacingOccurrences(of: "T", with: " "))
                                .font(.caption2).foregroundStyle(.secondary)
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                        }
                        .foregroundStyle(.primary)
                        .padding(16)
                        .businessCard(radius: 20)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var advisor: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 9) {
                    Image(systemName: "sparkles").foregroundStyle(Color(red: 0.40, green: 0.21, blue: 0.85))
                    Text("Gemini · Product Advisor").font(.title3.bold())
                }
                Text("Ежедневный анализ последних 7 дней. Gemini получает только агрегированные метрики и сравнивает их с предыдущими 7 днями. Рекомендации нужно проверять экспериментами.")
                    .font(.subheadline).foregroundStyle(.secondary)
                Button {
                    Task { await store.generate() }
                } label: {
                    HStack(spacing: 8) {
                        if store.generating { ProgressView().tint(.white) }
                        Text(store.generating ? "Формируем отчёт…" : "Сформировать отчёт сейчас")
                    }
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity).frame(height: 48)
                    .foregroundStyle(.white)
                    .background(Color(red: 0.40, green: 0.21, blue: 0.85), in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(store.generating)
            }
            .padding(19)
            .businessCard(radius: 24)

            if store.reports.isEmpty {
                empty("Отчётов пока нет. Они появятся после поступления достаточного количества событий и настройки GEMINI_API_KEY на сервере.")
            }
            ForEach(store.reports) { item in
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Отчёт от \(String(item.createdAt.prefix(10)))").font(.headline)
                            Text("\(item.eventCount) событий · \(item.model.isEmpty ? "AI" : item.model)")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(reportStatus(item.status))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(item.status == "ready" ? Color.green : Color.secondary)
                    }
                    if let report = item.report {
                        Text(report.summary).font(.subheadline)
                        ForEach(Array(report.recommendations.enumerated()), id: \.offset) { index, advice in
                            VStack(alignment: .leading, spacing: 8) {
                                Text("\(index + 1). \(advice.area) · \(advice.priority)")
                                    .font(.subheadline.bold())
                                Text(advice.finding).font(.subheadline)
                                Text(advice.recommendation).font(.subheadline)
                                    .foregroundStyle(.primary)
                                Text("Проверить: \(advice.metric)")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 18))
                        }
                    } else if item.status == "no_data" {
                        Text("Недостаточно событий для обоснованных рекомендаций.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    } else if item.status == "failed" {
                        Text("Анализ не завершён: \(item.error ?? "Ошибка модели")")
                            .font(.subheadline).foregroundStyle(.secondary)
                    } else {
                        Text("Генерация отчёта запущена.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                .padding(19)
                .businessCard(radius: 24)
            }
        }
    }

    private func intelligenceMetric(_ title: String, value: Int, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon).font(.title3).foregroundStyle(.secondary)
            Text(value.formatted()).font(.system(size: 32, weight: .bold, design: .rounded)).monospacedDigit()
            Text(title).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 108, alignment: .leading)
        .padding(16)
        .businessCard(radius: 22)
    }

    private func empty(_ message: String) -> some View {
        Text(message)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            .businessCard(radius: 22)
    }

    private func reportStatus(_ status: String) -> String {
        switch status {
        case "ready": return "Готов"
        case "no_data": return "Мало данных"
        case "running": return "Анализируется"
        default: return "Ошибка"
        }
    }
}

private struct IntelligenceJourneyView: View {
    let sessionId: String
    @State private var events: [IntelligenceJourneyEvent] = []
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                Text("Сессия \(String(sessionId.prefix(8)))")
                    .font(.title2.bold())
                Text("События отсортированы по времени действия в приложении.")
                    .font(.caption).foregroundStyle(.secondary)
                if loading { ProgressView().frame(maxWidth: .infinity) }
                if let error { Text(error).foregroundStyle(.red).font(.footnote) }
                ForEach(Array(events.enumerated()), id: \.offset) { index, event in
                    HStack(alignment: .top, spacing: 12) {
                        Text("\(index + 1)")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .frame(width: 24)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(event.name.replacingOccurrences(of: "_", with: " "))
                                .font(.subheadline.weight(.semibold))
                            if !event.screen.isEmpty { Text(event.screen).font(.subheadline) }
                            if !event.elementId.isEmpty { Text("Элемент: \(event.elementId)").font(.caption).foregroundStyle(.secondary) }
                            Text(event.at.replacingOccurrences(of: "T", with: " ").prefix(19))
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .padding(16)
                    .businessCard(radius: 18)
                }
            }
            .businessAdaptiveReadableWidth()
            .padding(16)
        }
        .background(BusinessDesign.background)
        .navigationTitle("Путь пользователя")
        .task {
            do { events = try await APIClient.shared.intelligenceJourney(sessionID: sessionId).events }
            catch { self.error = error.localizedDescription }
            loading = false
        }
    }
}
