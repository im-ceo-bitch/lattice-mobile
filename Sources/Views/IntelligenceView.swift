import SwiftUI
import Charts

@MainActor
private final class IntelligenceStore: ObservableObject {
    @Published var overview: IntelligenceOverview?
    @Published var audience: IntelligenceAudience?
    @Published var audienceDevices: [IntelligenceDevice] = []
    @Published var scope = "external"
    @Published var audienceError: String?
    @Published var audienceLoading = false
    @Published var externalAudience: IntelligenceAudience?
    @Published var reportsError: String?
    @Published var changingDevice = false
    func loadAudience(append: Bool = false) async {
        guard !audienceLoading else { return }
        audienceLoading = true
        defer { audienceLoading = false }
        do {
            let result = try await APIClient.shared.intelligenceAudience(days: days, scope: scope, offset: append ? audienceDevices.count : 0)
            audience = result
            if result.scope == "external" { externalAudience = result }
            audienceDevices = append ? audienceDevices + result.devices : result.devices
            audienceError = nil
        } catch { audienceError = intelligenceFailureDescription(error) }
    }
    func classify(_ device: IntelligenceDevice) async {
        guard !changingDevice else { return }
        changingDevice = true
        defer { changingDevice = false }
        do {
            try await APIClient.shared.intelligenceClassify(device, isInternal: !device.internal)
            await reload()
        } catch { audienceError = intelligenceFailureDescription(error) }
    }
    @Published var reports: [IntelligenceReport] = []
    @Published var days = 7
    @Published var status: IntelligenceStatusResponse?
    @Published var loading = false
    @Published var generating = false
    @Published var message: String?

    func reload() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        var warnings: [String] = []
        // Partial success must be visible: a failed AI chat/history endpoint
        // must not hide working conversion charts.
        do { overview = try await APIClient.shared.intelligenceOverview(days: days) }
        catch { warnings.append("Обзор: " + intelligenceFailureDescription(error)) }
        await loadAudience()
        if scope == "internal" { externalAudience = try? await APIClient.shared.intelligenceAudience(days: days, scope: "external") }
        do { reports = try await APIClient.shared.intelligenceReports(); reportsError = nil }
        catch { reportsError = intelligenceFailureDescription(error) }
        do { status = try await APIClient.shared.intelligenceStatus() }
        catch { status = nil; warnings.append("Диагностика: " + intelligenceFailureDescription(error)) }
        message = warnings.isEmpty ? nil : warnings.joined(separator: "\n")
    }

    func generate() async {
        guard !generating else { return }
        generating = true
        defer { generating = false }
        do {
            try await APIClient.shared.generateIntelligenceReport()
            reports = try await APIClient.shared.intelligenceReports()
            reportsError = nil
        } catch {
            reportsError = intelligenceFailureDescription(error)
            if let fresh = try? await APIClient.shared.intelligenceReports() { reports = fresh }
        }
    }
}

// Clear operational errors while never displaying secret values or SQL errors.
private func intelligenceFailureDescription(_ error: Error) -> String {
    guard let apiError = error as? APIError else { return error.localizedDescription }
    switch apiError {
    case .server(let code):
        switch code {
        case "INTELLIGENCE_DATABASE_UNAVAILABLE", "DATABASE_UNAVAILABLE", "INTELLIGENCE_SCHEMA_UNAVAILABLE":
            return "База аналитики недоступна. Проверьте D1 iumrah-hotels и миграции Backend."
        case "INTELLIGENCE_BACKEND_FAILURE":
            return "Внутренняя ошибка аналитики на сервере. Проверьте Workers Observability."
        case "GEMINI_KEY_MISSING":
            return "В iumrah-backend отсутствует GEMINI_API_KEY."
        case "GEMINI_HTTP_400", "GEMINI_HTTP_404":
            return "Google отклонил запрос модели. Проверьте доступность Gemini 3.8 Flash для этого ключа."
        case "GEMINI_HTTP_401", "GEMINI_HTTP_403":
            return "Google отклонил Gemini API Key. Проверьте ограничения ключа в Google AI Studio."
        case "GEMINI_HTTP_429", "DAILY_AI_LIMIT":
            return "Достигнут бесплатный лимит Gemini или суточный лимит чата."
        case "GEMINI_HTTP_503", "GEMINI_REPORT_FAILED", "GEMINI_UNAVAILABLE", "GEMINI_EMPTY_RESPONSE", "GEMINI_TOOL_LIMIT":
            return "Gemini не смог сформировать ответ. Проверьте Workers Observability."
        default: return apiError.localizedDescription
        }
    default: return apiError.localizedDescription
    }
}

private enum IntelligencePage: String, CaseIterable, Identifiable {
    case overview = "Обзор"
    case journey = "Аудитория"
    case gemini = "Отчёты AI"
    case chat = "AI-чат"
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
                        Text(message).fixedSize(horizontal: false, vertical: true)
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
                    case .chat: IntelligenceChatView(days: store.days)
                    }
                }
            }
            .businessAdaptiveReadableWidth()
            .padding(16)
        }
        .background(BusinessDesign.background)
        .navigationTitle("Аналитика")
        .navigationBarTitleDisplayMode(.inline)
        .businessNavigationSurface()
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
            if let status = store.status {
                HStack(spacing: 10) {
                    Label(status.databaseReady ? "D1 подключена" : "D1 недоступна", systemImage: status.databaseReady ? "checkmark.circle" : "exclamationmark.circle")
                    Label(status.geminiKeyConfigured ? "Ключ Gemini найден" : "Ключ Gemini не найден", systemImage: "key")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityElement(children: .combine)
            }
            Text("Установки и браузеры, а не идентифицированные люди. Отмеченные тесты исключаются из обзора и новых AI-отчётов.")
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
            .disabled(store.loading || store.changingDevice || store.audienceLoading)
            .onChange(of: store.days) { _, _ in Task { await store.reload() } }

            if let data = store.overview {
                HStack(spacing: 10) {
                    intelligenceMetric("Установки", value: data.visitors, icon: "person.2")
                    intelligenceMetric("Сеансы", value: data.sessions, icon: "clock.arrow.circlepath")
                }
                HStack(spacing: 10) {
                    intelligenceMetric("События", value: data.events, icon: "cursorarrow.click.2")
                    intelligenceMetric("С бронью (событие)", value: data.funnel.first(where: { $0.event == "booking_completed" })?.visitors ?? 0, icon: "checkmark.circle")
                }

                if let audience = store.audience {
                    HStack {
                        Label("Тесты исключены", systemImage: "checkmark.shield")
                        Spacer()
                        Text("\(audience.internal.devices) уст. · \(audience.internal.sessions) сеансов")
                    }.font(.caption).foregroundStyle(.secondary).padding(14).businessCard(radius: 18)
                }
                dailyTrafficChart(data: data)
                if let audience = store.externalAudience, audience.days == data.days { geography(audience) }
                platformBreakdownChart(data: data)
                platformTrendChart(data: data)

                VStack(alignment: .leading, spacing: 17) {
                    Text("Путь к бронированию").font(.headline)
                    Text("Уникальные установки на каждом этапе за выбранный период. Этапы не обязательно принадлежат одной сессии.")
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

    private func dailyTrafficChart(data: IntelligenceOverview) -> some View {
            VStack(alignment: .leading, spacing: 13) {
                HStack {
                    Text("Активность по дням").font(.headline)
                    Spacer()
                    Image(systemName: "chart.xyaxis.line").foregroundStyle(.secondary)
                }
                if data.daily.isEmpty {
                    empty("График появится после первых событий.")
                } else {
                    Chart(data.daily) { point in
                        AreaMark(x: .value("День", point.day), y: .value("Посетители", point.visitors))
                            .foregroundStyle(Color(red: 0.40, green: 0.21, blue: 0.85).opacity(0.12))
                        LineMark(x: .value("День", point.day), y: .value("Посетители", point.visitors))
                            .interpolationMethod(.linear)
                            .foregroundStyle(Color(red: 0.40, green: 0.21, blue: 0.85))
                        PointMark(x: .value("День", point.day), y: .value("Посетители", point.visitors))
                            .foregroundStyle(Color(red: 0.40, green: 0.21, blue: 0.85))
                    }
                    .chartYScale(domain: 0...max(1, (data.daily.map(\.visitors).max() ?? 1)))
                    .chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) { value in
                        AxisGridLine(); AxisTick(); AxisValueLabel { if let day = value.as(String.self) { Text(String(day.suffix(5))) } }
                    } }
                    .frame(height: 185)
                }
            }
            .padding(19)
            .businessCard(radius: 24)
    }

    private func platformBreakdownChart(data: IntelligenceOverview) -> some View {
            VStack(alignment: .leading, spacing: 14) {
                Text("Платформы").font(.headline)
                Text("Уникальные посетители и события, принятые нашим Backend. Ноль событий не означает ноль установок.")
                    .font(.caption).foregroundStyle(.secondary)
                let items = data.platforms ?? []
                if items.isEmpty {
                    empty("Платформы пока не передают данные.")
                } else {
                    Chart(items) { item in
                        BarMark(x: .value("Платформа", item.displayName), y: .value("Посетители", item.visitors))
                            .foregroundStyle(by: .value("Платформа", item.displayName))
                            .cornerRadius(6)
                    }
                    .chartForegroundStyleScale(["iOS": Color.blue, "Android": Color.green, "Web": Color.purple])
                    .frame(height: 150)
                }
                ForEach(["ios", "android", "web"], id: \.self) { platform in
                    let matched = items.first(where: { $0.platform == platform })
                    HStack(spacing: 12) {
                        Image(systemName: platform == "ios" ? "iphone" : platform == "android" ? "smartphone" : "globe")
                            .frame(width: 28).foregroundStyle(.secondary)
                        Text(platform == "ios" ? "iOS" : platform == "android" ? "Android" : "Веб-сайт")
                            .font(.subheadline.weight(.medium))
                        Spacer()
                        if let matched {
                            Text("\(matched.visitors) уст. · \(matched.bookings) броней")
                                .font(.caption).foregroundStyle(.secondary)
                        } else {
                            Text("Нет событий").font(.caption).foregroundStyle(.tertiary)
                        }
                    }
                }
            }
            .padding(19)
            .businessCard(radius: 24)
    }

    private func platformTrendChart(data: IntelligenceOverview) -> some View {
            VStack(alignment: .leading, spacing: 12) {
                Text("Посетители по платформам").font(.headline)
                if let series = data.dailyPlatform, !series.isEmpty {
                    Chart(series) { item in
                        LineMark(x: .value("День", item.day), y: .value("Посетители", item.visitors))
                            .foregroundStyle(by: .value("Платформа", item.platformName))
                            .interpolationMethod(.linear)
                    }
                    .chartForegroundStyleScale(["iOS": Color.blue, "Android": Color.green, "Web": Color.purple])
                    .chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) { value in
                        AxisGridLine(); AxisTick(); AxisValueLabel { if let day = value.as(String.self) { Text(String(day.suffix(5))) } }
                    } }
                    .frame(height: 190)
                } else {
                    empty("Пока нет данных по платформам.")
                }
            }
            .padding(19)
            .businessCard(radius: 24)
    }

    private func geography(_ audience: IntelligenceAudience) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("География аудитории").font(.headline)
            Text("Последняя известная сеть установки, приблизительно. VPN может изменить страну и город.").font(.caption).foregroundStyle(.secondary)
            ForEach(audience.countries.prefix(8)) { country in
                HStack { Text(country.label); Spacer(); Text(country.devices.formatted()).monospacedDigit() }
            }
            if audience.countries.isEmpty { empty("Данных пока нет") }
            Divider()
            Text("Города").font(.subheadline.bold())
            ForEach(audience.cities.prefix(8)) { city in
                HStack {
                    Text(city.city.isEmpty ? "Город неизвестен (\(city.country.isEmpty ? "—" : city.country))" : "\(city.city) · \(city.country)")
                    Spacer(); Text(city.devices.formatted()).monospacedDigit()
                }.font(.subheadline)
            }
        }.padding(19).businessCard(radius: 24)
    }
    private var journeys: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Аудитория и устройства").font(.title3.bold())
            Picker("Период", selection: $store.days) { Text("7 дней").tag(7); Text("14 дней").tag(14); Text("30 дней").tag(30) }
                .pickerStyle(.segmented).disabled(store.loading || store.changingDevice || store.audienceLoading)
                .onChange(of: store.days) { _, _ in Task { await store.reload() } }
            Picker("Аудитория", selection: $store.scope) { Text("Не отмечены как тесты").tag("external"); Text("Тесты").tag("internal") }
                .pickerStyle(.segmented).disabled(store.loading || store.changingDevice || store.audienceLoading)
                .onChange(of: store.scope) { _, _ in Task { await store.reload() } }
            if let error = store.audienceError { Text(error).font(.footnote).foregroundStyle(.red) }
            if let data = store.audience, data.scope == store.scope {
                let total = data.scope == "internal" ? data.internal : data.external
                HStack {
                    intelligenceMetric("Установки", value: total.devices, icon: "smartphone")
                    intelligenceMetric("Сеансы", value: total.sessions, icon: "clock")
                }
                geography(data)
                VStack(alignment: .leading, spacing: 12) {
                    Text("Модели устройств").font(.headline)
                    ForEach(data.models.prefix(10)) { model in
                        HStack { Text(model.model.isEmpty ? "\(model.platform.uppercased()) · неизвестно" : model.model); Spacer(); Text(model.devices.formatted()) }
                    }
                }.padding(19).businessCard(radius: 24)
                Text("Установки за период").font(.headline)
                Text("Откройте карточку, чтобы просмотреть сеансы или исключить собственную установку. ID не является аппаратным идентификатором.").font(.caption).foregroundStyle(.secondary)
                ForEach(store.audienceDevices) { device in
                    NavigationLink {
                        IntelligenceDeviceDetail(device: device, days: store.days, store: store)
                    } label: {
                        VStack(alignment: .leading, spacing: 7) {
                            HStack {
                                Image(systemName: device.platform == "web" ? "globe" : "smartphone").font(.title2)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(device.title).font(.subheadline.bold())
                                    Text(device.location).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer(); Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                            }
                            Text("\(device.sessions) сеансов · \(device.events) событий · ID \(device.visitorId.prefix(8))").font(.caption).foregroundStyle(.secondary)
                            Text("Последняя активность: \(String(device.lastAt.prefix(16)).replacingOccurrences(of: "T", with: " ")) UTC").font(.caption2).foregroundStyle(.secondary)
                        }.padding(16).businessCard(radius: 20).foregroundStyle(.primary)
                    }.buttonStyle(.plain).disabled(store.loading || store.changingDevice || store.audienceLoading)
                }
                if store.audienceDevices.isEmpty { empty("Установок за период нет.") }
                if data.hasMore {
                    Button("Показать ещё") { Task { await store.loadAudience(append: true) } }.disabled(store.loading || store.changingDevice || store.audienceLoading)
                }
            }
        }
    }

    private var advisor: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let error = store.reportsError { Text(error).font(.footnote).foregroundStyle(.red) }
            Text("Ранее созданные отчёты могут содержать тестовую активность. Создайте новый после разметки устройств.").font(.caption).foregroundStyle(.secondary)
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
                            Text(["app_open":"Открыл приложение", "app_first_open":"Первый запуск", "app_background":"Ушёл в фон", "screen_view":"Открыл экран", "screen_exit":"Покинул экран", "search_started":"Начал поиск", "search_results":"Получил результаты", "flight_selected":"Выбрал рейс", "hotel_selected":"Выбрал отель", "checkout_started":"Начал оформление", "booking_submitted":"Отправил заявку", "booking_completed":"Завершил бронирование", "error":"Ошибка", "tap":"Нажатие"][event.name] ?? event.name)
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
        .navigationTitle("Путь пользователя").navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
        .task {
            do { events = try await APIClient.shared.intelligenceJourney(sessionID: sessionId).events }
            catch { self.error = error.localizedDescription }
            loading = false
        }
    }
}


// Business-only, server-grounded conversations. No API key is stored in iOS.
private struct IntelligenceChatView: View {
    let days: Int
    @AppStorage("iumrah.intelligence.ai.thread") private var savedThreadID = ""
    @State private var entries: [IntelligenceChatMessage] = []
    @State private var draft = ""
    @State private var sending = false
    @State private var notice: String?

    private let suggestions = [
        "Почему мало бронирований?",
        "На каком этапе пользователи уходят?",
        "Сравни iOS, Android и сайт",
        "Какие 3 улучшения UI/UX приоритетнее?"
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "sparkles")
                    .foregroundStyle(Color(red: 0.40, green: 0.21, blue: 0.85))
                VStack(alignment: .leading, spacing: 3) {
                    Text("iumrah AI Analyst").font(.title3.bold())
                    Text("Gemini 3.8 Flash · анализ серверных данных")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    savedThreadID = ""
                    entries = []
                    notice = nil
                } label: { Image(systemName: "square.and.pencil") }
                .accessibilityLabel("Новый диалог")
            }
            .padding(17)
            .businessCard(radius: 24)

            if entries.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Спроси о конверсии, маркетинге или дизайне")
                        .font(.headline)
                    Text("Ответы опираются на агрегированные метрики iumrah. Агент не может менять код, отправлять сообщения или запускать рекламу.")
                        .font(.subheadline).foregroundStyle(.secondary)
                    ForEach(suggestions, id: \.self) { suggestion in
                        Button { Task { await send(suggestion) } } label: {
                            HStack(spacing: 10) {
                                Text(suggestion).multilineTextAlignment(.leading)
                                Spacer(minLength: 3)
                                Image(systemName: "arrow.up.right")
                            }
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.primary)
                            .padding(12)
                            .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 14))
                        }
                        .disabled(sending)
                    }
                }
                .padding(17)
                .businessCard(radius: 24)
            }
            ForEach(entries) { entry in
                HStack {
                    if entry.role == "user" { Spacer(minLength: 38) }
                    VStack(alignment: .leading, spacing: 8) {
                        if entry.role == "assistant" {
                            Label("iumrah AI", systemImage: "sparkles")
                                .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        }
                        Text(entry.content).font(.subheadline).textSelection(.enabled)
                    }
                    .padding(14)
                    .background(entry.role == "user" ? Color(red: 0.40, green: 0.21, blue: 0.85).opacity(0.10) : BusinessDesign.secondarySurface,
                                in: RoundedRectangle(cornerRadius: 18))
                    if entry.role == "assistant" { Spacer(minLength: 20) }
                }
            }
            if sending {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Анализирую данные…").font(.subheadline).foregroundStyle(.secondary)
                }
                .padding(12)
            }
            if let notice {
                Text(notice).font(.footnote).foregroundStyle(.red)
            }
            HStack(alignment: .bottom, spacing: 10) {
                TextField("Спроси о данных iumrah…", text: $draft, axis: .vertical)
                    .lineLimit(1...4)
                    .textInputAutocapitalization(.sentences)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 21))
                Button { Task { await send(draft) } } label: {
                    Image(systemName: "arrow.up")
                        .font(.subheadline.bold())
                        .foregroundStyle(.white)
                        .frame(width: 42, height: 42)
                        .background(Color(red: 0.40, green: 0.21, blue: 0.85), in: Circle())
                }
                .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityLabel("Отправить запрос")
            }
            .padding(14)
            .businessCard(radius: 24)
        }
        .task { await loadHistory() }
    }

    private func loadHistory() async {
        guard !savedThreadID.isEmpty else { return }
        do {
            let history = try await APIClient.shared.intelligenceChatHistory(threadID: savedThreadID)
            entries = history.messages
            if history.threadId == nil { savedThreadID = "" }
        } catch { notice = "Не удалось загрузить историю диалога." }
    }

    private func send(_ raw: String) async {
        let message = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sending, !message.isEmpty else { return }
        sending = true
        notice = nil
        draft = ""
        // Display the user's question, but do not pretend that Gemini has replied yet.
        let userEntry = IntelligenceChatMessage(id: UUID().uuidString, role: "user", content: message, createdAt: Date().ISO8601Format())
        entries.append(userEntry)
        defer { sending = false }
        do {
            let answer = try await APIClient.shared.intelligenceChat(message: message, threadID: savedThreadID.isEmpty ? nil : savedThreadID, days: days)
            savedThreadID = answer.threadId
            entries.append(IntelligenceChatMessage(id: UUID().uuidString, role: "assistant", content: answer.answer, createdAt: Date().ISO8601Format()))
        } catch {
            entries.removeAll(where: { $0.id == userEntry.id })
            draft = message
            notice = intelligenceFailureDescription(error)
        }
    }
}

private struct IntelligenceDeviceDetail: View {
    let device: IntelligenceDevice
    let days: Int
    @ObservedObject var store: IntelligenceStore
    @Environment(\.dismiss) private var dismiss
    @State private var sessions: [IntelligenceSession] = []
    @State private var error: String?
    @State private var loading = true
    @State private var confirm = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(device.title).font(.title2.bold())
                Text(device.location).foregroundStyle(.secondary)
                Text("ID: \(device.visitorId)").font(.caption.monospaced()).textSelection(.enabled)
                if !device.osVersion.isEmpty { Text("ОС: \(device.osVersion)") }
                Text("\(device.sessions) сеансов · \(device.events) событий")
                Button(device.internal ? "Вернуть в общую аналитику" : "Это моё тестовое устройство") { confirm = true }
                    .buttonStyle(.borderedProminent).disabled(store.changingDevice)
                Text("Разметка применяется ко всем сохранённым событиям этой установки. История не удаляется.").font(.caption).foregroundStyle(.secondary)
                if let error = store.audienceError { Text(error).foregroundStyle(.red).font(.caption) }
                Text("История сеансов (до 100)").font(.headline)
                if loading { ProgressView() }
                if let error { Text(error).foregroundStyle(.red) }
                ForEach(sessions) { session in
                    NavigationLink {
                        IntelligenceJourneyView(sessionId: session.sessionId)
                    } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(String(session.startedAt.prefix(16)).replacingOccurrences(of: "T", with: " ") + " UTC")
                                Text("\(session.eventCount) событий").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer(); Image(systemName: "chevron.right")
                        }.padding(14).businessCard(radius: 18)
                    }.buttonStyle(.plain)
                }
            }.padding(16)
        }
        .navigationTitle("Устройство")
        .confirmationDialog("Изменить классификацию установки?", isPresented: $confirm, titleVisibility: .visible) {
            Button(device.internal ? "Вернуть в аналитику" : "Исключить тестовую установку") {
                Task { await store.classify(device); if store.audienceError == nil { dismiss() } }
            }
            Button("Отмена", role: .cancel) {}
        }
        .task {
            defer { loading = false }
            do { sessions = try await APIClient.shared.intelligenceDeviceSessions(device, days: days) }
            catch { self.error = intelligenceFailureDescription(error) }
        }
    }
}
