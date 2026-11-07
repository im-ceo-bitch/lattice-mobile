import Foundation
import SwiftUI
import UIKit

struct FlightCurationView: View {
    var tabMode = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.businessAdaptiveLayout) private var layout

    private enum SearchMode: String, CaseIterable, Identifiable {
        case outbound
        case inbound
        case roundTrip

        var id: String { rawValue }

        var title: String {
            switch self {
            case .outbound: return "Туда"
            case .inbound: return "Обратно"
            case .roundTrip: return "Туда-обратно"
            }
        }

        var apiValue: String {
            switch self {
            case .outbound: return "outbound_one_way"
            case .inbound: return "return_one_way"
            case .roundTrip: return "round_trip"
            }
        }
    }

    private enum SearchWorkspace: String, CaseIterable, Identifiable {
        case manual
        case bulk
        case charter
        case published
        case monitor

        var id: String { rawValue }

        var title: String {
            switch self {
            case .manual: return "Поиск"
            case .bulk: return "Массовый"
            case .charter: return "Чартеры"
            case .published: return "Опубликованные"
            case .monitor: return "Мониторинг"
            }
        }
    }

    private enum BatchDirection: String {
        case outbound
        case returnLeg = "return"

        init?(jsonValue: String?) {
            let value = (jsonValue ?? "outbound")
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
            switch value {
            case "outbound", "there", "forward": self = .outbound
            case "return", "inbound", "back": self = .returnLeg
            default: return nil
            }
        }

        var title: String { self == .outbound ? "Туда" : "Обратно" }
        var apiValue: String { self == .outbound ? "outbound_one_way" : "return_one_way" }
    }

    private enum BatchSearchStatus: String {
        case pending
        case searching
        case found
        case noResults
        case failed
    }

    private struct BatchJSONEnvelope: Decodable {
        struct Search: Decodable {
            let id: String?
            let direction: String?
            let from: String
            let to: String
            let date: String
        }

        let type: String?
        let searches: [Search]
    }

    private struct BatchSearchItem: Identifiable {
        let id: String
        let sourceID: String?
        let direction: BatchDirection
        let origin: String
        let destination: String
        let date: String
        var status: BatchSearchStatus = .pending
        var results: [BusinessFlightCurationItinerary] = []
        var providerRequests: Int?
        var error: String?
    }

    private enum BulkJSONError: LocalizedError {
        case invalidJSON
        case unsupportedType
        case empty
        case tooMany(Int)
        case invalidDirection(String)
        case invalidAirport(String)
        case invalidDate(String)

        var errorDescription: String? {
            switch self {
            case .invalidJSON:
                return "JSON не удалось прочитать. Проверьте запятые, кавычки и структуру searches."
            case .unsupportedType:
                return "Массовый режим принимает только type: one_way. Round-trip остаётся отдельным ручным режимом."
            case .empty:
                return "В JSON нет поисковых задач."
            case .tooMany(let count):
                return "В одном запуске максимум 20 поисков. Сейчас в JSON: \(count). Разделите список на 2–3 блока."
            case .invalidDirection(let value):
                return "Неизвестное direction: \(value). Используйте outbound или return."
            case .invalidAirport(let value):
                return "Некорректный IATA-код аэропорта: \(value). Нужны ровно 3 латинские буквы."
            case .invalidDate(let value):
                return "Некорректная дата: \(value). Используйте формат YYYY-MM-DD и не указывайте прошедший день."
            }
        }
    }

    private struct CharterJSONEnvelope: Decodable {
        struct Flight: Decodable {
            struct Airline: Decodable {
                let name: String
                let iata: String
            }

            struct Price: Decodable {
                let amount: Double
                let currency: String
                let type: String?
            }

            struct Source: Decodable {
                let name: String
                let url: String
                let publishedAt: String?

                enum CodingKeys: String, CodingKey {
                    case name, url
                    case publishedAt = "published_at"
                }
            }

            let id: String?
            let direction: String?
            let from: String
            let to: String
            let airline: Airline
            let flightNumber: String
            let departureAt: String
            let arrivalAt: String
            let price: Price
            let source: Source
            let cabinClass: String?

            enum CodingKeys: String, CodingKey {
                case id, direction, from, to, airline, price, source
                case flightNumber = "flight_number"
                case departureAt = "departure_at"
                case arrivalAt = "arrival_at"
                case cabinClass = "cabin_class"
            }
        }

        let type: String?
        let flights: [Flight]
    }

    private enum CharterJSONError: LocalizedError {
        case invalidJSON
        case unsupportedType
        case empty
        case tooMany(Int)
        case invalidDirection(String)
        case invalidAirport(String)
        case invalidAirlineCode(String)
        case invalidFlightNumber(String)
        case invalidTimestamp(String)
        case expiredFlight(String)
        case invalidPrice
        case invalidCurrency(String)
        case invalidSourceURL(String)

        var errorDescription: String? {
            switch self {
            case .invalidJSON:
                return "JSON чартеров не удалось прочитать. Проверьте структуру flights, кавычки и запятые."
            case .unsupportedType:
                return "Для этой вкладки используйте type: charter."
            case .empty:
                return "В JSON нет чартерных рейсов."
            case .tooMany(let count):
                return "За один импорт можно сформировать максимум 50 чартерных карточек. Сейчас: \(count)."
            case .invalidDirection(let value):
                return "Неизвестное direction: \(value). Используйте outbound или return."
            case .invalidAirport(let value):
                return "Некорректный IATA-код аэропорта: \(value). Нужны ровно 3 латинские буквы."
            case .invalidAirlineCode(let value):
                return "Некорректный IATA-код авиакомпании: \(value). Нужны 2 буквы/цифры."
            case .invalidFlightNumber(let value):
                return "Некорректный номер рейса: \(value)."
            case .invalidTimestamp(let value):
                return "Некорректные дата/время: \(value). Используйте ISO 8601 с часовым поясом, например 2026-09-09T15:40:00+05:00."
            case .expiredFlight(let value):
                return "Чартер \(value) уже в прошлом. Прошедшие рейсы нельзя импортировать или публиковать."
            case .invalidPrice:
                return "Цена чартерного билета должна быть больше 0."
            case .invalidCurrency(let value):
                return "Некорректная валюта: \(value). Используйте трёхбуквенный код, например USD."
            case .invalidSourceURL(let value):
                return "Некорректная ссылка источника: \(value). Нужна полная http/https ссылка."
            }
        }
    }

    @State private var workspace: SearchWorkspace = .manual
    @State private var searchMode: SearchMode = .roundTrip
    @State private var outboundOrigin = "TAS"
    @State private var outboundDestination = "JED"
    @State private var inboundOrigin = "MED"
    @State private var inboundDestination = "TAS"
    @State private var departureDate = Calendar.current.date(byAdding: .day, value: 21, to: Date()) ?? Date()
    @State private var returnDate = Calendar.current.date(byAdding: .day, value: 28, to: Date()) ?? Date()
    @State private var adults = 1
    @State private var selectedAirlines: Set<String> = ["HY", "C6", "HH", "9S", "2U", "FZ", "XY", "F3", "SV"]
    @State private var results: [BusinessFlightCurationItinerary] = []
    @State private var published: [BusinessCuratedFlightOffer] = []
    @State private var isSearching = false
    @State private var publishingIDs: Set<String> = []
    @State private var errorMessage: String?
    @State private var hasSearched = false
    @State private var searchDiagnostics: BusinessFlightCurationSearchResponse.Diagnostics?
    @State private var bulkJSON = ""
    @State private var batchSearches: [BatchSearchItem] = []
    @State private var expandedBatchSearchIDs: Set<String> = []
    @State private var selectedBatchResultKeys: Set<String> = []
    @State private var isBatchSearching = false
    @State private var isBatchPublishing = false
    @State private var charterJSON = ""
    @State private var charterResults: [BusinessFlightCurationItinerary] = []
    @State private var selectedCharterIDs: Set<String> = []
    @State private var isCharterPublishing = false
    @State private var flightSyncURL: URL?
    @State private var isFlightSyncing = false
    @State private var flightSyncMessage: String?
    @State private var flightSyncSavedCount: Int?

    private enum FlightSyncProtectionError: LocalizedError {
        case emptyPublished

        var errorDescription: String? {
            switch self {
            case .emptyPublished:
                return "Синхронизация остановлена: сервер вернул 0 опубликованных рейсов. Предыдущий снимок сохранён. Проверьте список и повторите после восстановления данных."
            }
        }
    }

    private let api = APIClient.shared

    private struct AirlineFilter: Identifiable {
        let code: String
        let name: String
        var id: String { code }
    }

    private let airlines: [AirlineFilter] = [
        .init(code: "HY", name: "Uzbekistan Airways"),
        .init(code: "C6", name: "Centrum Air"),
        .init(code: "HH", name: "Qanot Sharq"),
        .init(code: "9S", name: "Air Samarkand"),
        .init(code: "2U", name: "Fly Khiva"),
        .init(code: "FZ", name: "flydubai"),
        .init(code: "XY", name: "flynas"),
        .init(code: "F3", name: "flyadeal"),
        .init(code: "SV", name: "Saudia")
    ]

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 22) {
                intro
                workspacePicker
                workspaceContent
            }
            .businessAdaptiveReadableWidth()
            .padding(.horizontal, 18)
            .padding(.bottom, 36)
        }
        .background(BusinessDesign.background.ignoresSafeArea())
        .navigationTitle(tabMode ? "" : "Авиабилеты")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if tabMode {
                ToolbarItem(placement: .principal) { BusinessBrandLogo(width: 150).frame(height: 36) }
            }
            ToolbarItem(placement: .topBarLeading) {
                if tabMode {
                    BusinessSidebarButton()
                } else {
                    Button("Закрыть") { dismiss() }
                }
            }
        }
        .task {
            flightSyncURL = BusinessSessionVault.flightSyncAccessURL
            await restoreFlightSyncAccess()
            await loadPublished()
        }
        .onChange(of: published) { _, _ in
            guard flightSyncURL != nil else { return }
            Task { await syncFlightSnapshot(silent: true) }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { await loadPublished() }
        }
        .onChange(of: searchMode) { _, _ in
            results = []
            hasSearched = false
            searchDiagnostics = nil
        }
        .alert("Не удалось выполнить действие", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "Неизвестная ошибка")
        }
    }


    @ViewBuilder
    private var workspaceContent: some View {
        if workspace == .monitor {
            FlightHubMonitorView()
        } else if layout.supportsTwoPaneWorkspace && workspace != .published {
            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 18) {
                    workspaceControls
                }
                .frame(width: min(440, max(380, layout.availableSize.width * 0.38)), alignment: .topLeading)

                Divider()

                VStack(alignment: .leading, spacing: 18) {
                    workspaceResults
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
        } else {
            VStack(alignment: .leading, spacing: 22) {
                workspaceControls
                workspaceResults
            }
        }
    }

    @ViewBuilder
    private var workspaceControls: some View {
        switch workspace {
        case .manual:
            routeCard
            airlineFilters
            searchButton
        case .bulk:
            bulkSearchCard
            airlineFilters
        case .charter:
            charterImportCard
        case .published, .monitor:
            EmptyView()
        }
    }

    @ViewBuilder
    private var workspaceResults: some View {
        switch workspace {
        case .manual:
            if isSearching {
                ProgressView(searchProgressText)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 28)
            } else if !results.isEmpty {
                searchResults
            } else if hasSearched {
                emptySearchState
            } else if layout.supportsTwoPaneWorkspace {
                ContentUnavailableView(
                    "Настройте поиск",
                    systemImage: "airplane.departure",
                    description: Text("Маршрут, даты и авиакомпании остаются слева; найденные варианты появятся здесь.")
                )
                .frame(maxWidth: .infinity)
                .padding(.top, 80)
            }
        case .bulk:
            if !batchSearches.isEmpty {
                batchProgressSection
                batchResultsSection
            } else if layout.supportsTwoPaneWorkspace {
                ContentUnavailableView(
                    "Массовый поиск",
                    systemImage: "square.stack.3d.up",
                    description: Text("Вставьте JSON слева. Прогресс и результаты появятся в этой колонке.")
                )
                .frame(maxWidth: .infinity)
                .padding(.top, 80)
            }
        case .charter:
            if !charterResults.isEmpty {
                charterResultsSection
            } else if layout.supportsTwoPaneWorkspace {
                ContentUnavailableView(
                    "Чартеры",
                    systemImage: "airplane.circle",
                    description: Text("Импортируйте JSON слева — карточки для проверки появятся здесь.")
                )
                .frame(maxWidth: .infinity)
                .padding(.top, 80)
            }
        case .published:
            publishedSection
        case .monitor:
            EmptyView()
        }
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("Поиск и публикация рейсов")
                .font(.system(size: 26, weight: .bold))
                .tracking(-0.6)
            Text("Поиск, массовый ONE WAY, импорт чартеров и отдельная вкладка опубликованных рейсов. Round-trip остаётся отдельной линейкой внутри ручного поиска.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 10)
    }

    private var workspacePicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                ForEach(SearchWorkspace.allCases) { item in
                    Button {
                        withAnimation(.easeInOut(duration: 0.18)) { workspace = item }
                    } label: {
                        Text(item.title)
                            .font(.system(size: 13, weight: workspace == item ? .semibold : .medium))
                            .foregroundStyle(.primary)
                            .fixedSize(horizontal: true, vertical: false)
                            .padding(.horizontal, 14)
                            .frame(minWidth: 85, minHeight: 38)
                            .background(
                                workspace == item ? BusinessDesign.card : Color.clear,
                                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(4)
        }
        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(BusinessDesign.line, lineWidth: 0.8))
    }

    private var bulkSearchCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Массовый ONE WAY")
                        .font(.headline)
                    Text("Вставьте один JSON — Business последовательно выполнит каждый поиск через существующий curation-search. Максимум 20 задач за запуск.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Text("≤ 20")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 9)
                    .frame(height: 28)
                    .background(BusinessDesign.secondarySurface, in: Capsule())
            }

            TextEditor(text: $bulkJSON)
                .font(.system(size: 13, weight: .regular, design: .monospaced))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .scrollContentBackground(.hidden)
                .padding(10)
                .frame(minHeight: 210)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 17, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 17, style: .continuous).stroke(BusinessDesign.line))

            HStack(spacing: 10) {
                Button("Вставить пример") {
                    bulkJSON = Self.bulkJSONExample
                }
                .buttonStyle(.plain)
                .font(.caption.weight(.semibold))

                Spacer()

                if !bulkJSON.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button("Очистить") {
                        bulkJSON = ""
                        batchSearches = []
                        expandedBatchSearchIDs = []
                        selectedBatchResultKeys = []
                    }
                    .buttonStyle(.plain)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .disabled(isBatchSearching || isBatchPublishing)
                }
            }

            Stepper("Паломники: \(adults)", value: $adults, in: 1...9)
                .disabled(isBatchSearching || isBatchPublishing)

            HStack(spacing: 8) {
                Image(systemName: "arrow.trianglehead.branch")
                Text("Только прямые рейсы · 0 пересадок")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            }

            HStack(alignment: .top, spacing: 9) {
                Image(systemName: "externaldrive.badge.checkmark")
                    .foregroundStyle(.blue)
                Text("Новый batch не создаёт новую flight-архитектуру: каждый элемент вызывает тот же рабочий ручной endpoint. Поэтому действующий серверный кэш, нормализация результатов, логотипы и публикация сохраняются без отдельной реализации.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(12)
            .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 15, style: .continuous))

            Button {
                Task { await startBatchSearch() }
            } label: {
                HStack {
                    Image(systemName: "square.stack.3d.up.fill")
                    Text(isBatchSearching ? "Выполняем поиски…" : "Начать массовый поиск")
                        .fontWeight(.semibold)
                    Spacer()
                    if !batchSearches.isEmpty {
                        Text("\(batchSearches.count)")
                            .font(.caption.bold())
                            .padding(7)
                            .background(BusinessDesign.onPrimaryControl.opacity(0.18), in: Circle())
                    }
                }
                .foregroundStyle(BusinessDesign.onPrimaryControl)
                .padding(.horizontal, 18)
                .frame(height: 56)
                .background(BusinessDesign.primaryControl, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(
                bulkJSON.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || isBatchSearching
                || isBatchPublishing
                || selectedAirlines.isEmpty
            )
            .opacity(
                bulkJSON.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || selectedAirlines.isEmpty ? 0.45 : 1
            )
        }
        .padding(18)
        .background(BusinessDesign.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(BusinessDesign.line))
    }

    private var charterImportCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Чартерный JSON")
                        .font(.headline)
                    Text("Вставьте подтверждённые данные рейсов. Business не вызывает Ignav: он проверяет JSON, формирует карточки и публикует их через существующий flight publication flow.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Text("≤ 50")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 9)
                    .frame(height: 28)
                    .background(BusinessDesign.secondarySurface, in: Capsule())
            }

            TextEditor(text: $charterJSON)
                .font(.system(size: 13, weight: .regular, design: .monospaced))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .scrollContentBackground(.hidden)
                .padding(10)
                .frame(minHeight: 250)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 17, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 17, style: .continuous).stroke(BusinessDesign.line))

            HStack(spacing: 10) {
                Button("Вставить пример") {
                    charterJSON = Self.charterJSONExample
                }
                .buttonStyle(.plain)
                .font(.caption.weight(.semibold))

                Spacer()

                if !charterJSON.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button("Очистить") {
                        charterJSON = ""
                        charterResults = []
                        selectedCharterIDs = []
                    }
                    .buttonStyle(.plain)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .disabled(isCharterPublishing)
                }
            }

            HStack(alignment: .top, spacing: 9) {
                Image(systemName: "link.badge.plus")
                    .foregroundStyle(.orange)
                Text("Источник обязателен для каждого рейса. Ссылка, название источника, цена, валюта, перевозчик, номер рейса и точные ISO-даты сохраняются внутри itinerary, который отправляется в существующую публикацию.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(12)
            .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 15, style: .continuous))

            Button {
                parseCharterImport()
            } label: {
                HStack {
                    Image(systemName: "doc.badge.plus")
                    Text("Сформировать чартерные карточки")
                        .fontWeight(.semibold)
                    Spacer()
                    if !charterResults.isEmpty {
                        Text("\(charterResults.count)")
                            .font(.caption.bold())
                            .padding(7)
                            .background(BusinessDesign.onPrimaryControl.opacity(0.18), in: Circle())
                    }
                }
                .foregroundStyle(BusinessDesign.onPrimaryControl)
                .padding(.horizontal, 18)
                .frame(height: 56)
                .background(BusinessDesign.primaryControl, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(charterJSON.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isCharterPublishing)
            .opacity(charterJSON.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.45 : 1)
        }
        .padding(18)
        .background(BusinessDesign.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(BusinessDesign.line))
    }

    private var charterResultsSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Чартерные рейсы")
                        .font(.title3.bold())
                    Text("\(charterResults.count) карточек · данные из вставленного JSON")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Label("Без Ignav", systemImage: "checkmark.shield.fill")
                    .font(.caption2.bold())
                    .foregroundStyle(.orange)
                    .padding(.horizontal, 9)
                    .frame(minHeight: 29)
                    .background(Color.orange.opacity(0.09), in: Capsule())
            }

            HStack(spacing: 9) {
                Button("Выбрать все") {
                    selectedCharterIDs = Set(charterResults.filter { !isAlreadyPublished($0) }.map(\.id))
                }
                .buttonStyle(.plain)
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 11)
                .frame(minHeight: 38)
                .background(BusinessDesign.secondarySurface, in: Capsule())

                Button("Снять выбор") {
                    selectedCharterIDs = []
                }
                .buttonStyle(.plain)
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 11)
                .frame(minHeight: 38)
                .background(BusinessDesign.secondarySurface, in: Capsule())
            }

            Button {
                Task { await publishSelectedCharters() }
            } label: {
                HStack {
                    Image(systemName: "paperplane.fill")
                    Text(isCharterPublishing ? "Публикуем…" : "Опубликовать выбранные чартеры")
                        .fontWeight(.semibold)
                    Spacer()
                    Text("\(selectedCharterIDs.count)")
                        .font(.caption.bold())
                        .padding(7)
                        .background(BusinessDesign.onPrimaryControl.opacity(0.18), in: Circle())
                }
                .foregroundStyle(BusinessDesign.onPrimaryControl)
                .padding(.horizontal, 16)
                .frame(height: 50)
                .background(BusinessDesign.primaryControl, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(selectedCharterIDs.isEmpty || isCharterPublishing)
            .opacity(selectedCharterIDs.isEmpty ? 0.45 : 1)

            ForEach(charterResults) { itinerary in
                charterResultCard(itinerary)
            }
        }
    }

    private func charterResultCard(_ itinerary: BusinessFlightCurationItinerary) -> some View {
        let selected = selectedCharterIDs.contains(itinerary.id)
        let alreadyPublished = isAlreadyPublished(itinerary)
        let leg = itinerary.legs.first

        return VStack(alignment: .leading, spacing: 13) {
            HStack(spacing: 11) {
                Button {
                    guard !alreadyPublished else { return }
                    if selected { selectedCharterIDs.remove(itinerary.id) }
                    else { selectedCharterIDs.insert(itinerary.id) }
                } label: {
                    Image(systemName: alreadyPublished ? "checkmark.seal.fill" : (selected ? "checkmark.circle.fill" : "circle"))
                        .font(.title3)
                        .foregroundStyle(alreadyPublished ? Color.green : (selected ? BusinessDesign.accent : Color.secondary))
                }
                .buttonStyle(.plain)
                .disabled(alreadyPublished || isCharterPublishing)

                BusinessAirlineLogoView(airlineIATA: itinerary.primaryAirlineCode, size: 42)

                VStack(alignment: .leading, spacing: 3) {
                    Text(itinerary.primaryAirlineName)
                        .font(.subheadline.weight(.semibold))
                    Text(leg?.flightNumber ?? "Чартер")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                HStack(spacing: 5) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.yellow)
                    Text("CHARTER")
                        .foregroundStyle(.primary)
                }
                .font(.caption2.bold())
                .padding(.horizontal, 9)
                .frame(minHeight: 27)
                .background(Color.yellow.opacity(0.14), in: Capsule())
            }

            if let leg {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(leg.origin) → \(leg.destination)")
                            .font(.title3.bold())
                        Text("\(dateTime(leg.departureAt)) → \(dateTime(leg.arrivalAt))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(money(itinerary.price.amount, currency: itinerary.price.currency))
                            .font(.title3.bold())
                        Text("за 1 пассажира")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            HStack(spacing: 8) {
                Label(itinerary.priceType == "package" ? "Цена пакета" : "Цена билета", systemImage: "banknote")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)

                Text("·")
                    .foregroundStyle(.tertiary)
                Label("Вне регулярного расписания", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .symbolRenderingMode(.monochrome)

                if let sourceName = itinerary.sourceName, !sourceName.isEmpty {
                    Text("·")
                        .foregroundStyle(.tertiary)
                    Text(sourceName)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer()

                if let url = charterSourceURL(itinerary) {
                    Link(destination: url) {
                        Label("Источник", systemImage: "arrow.up.right.square")
                            .font(.caption2.bold())
                    }
                }
            }

            Button {
                Task { await publishCharter(itinerary) }
            } label: {
                HStack {
                    Image(systemName: alreadyPublished ? "checkmark.circle.fill" : "plus.circle.fill")
                    Text(alreadyPublished ? "Уже опубликовано" : "Опубликовать чартер")
                    Spacer()
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(alreadyPublished ? Color.secondary : Color.primary)
                .padding(.horizontal, 12)
                .frame(height: 40)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(alreadyPublished || publishingIDs.contains(itinerary.id) || isCharterPublishing)
        }
        .padding(15)
        .background(BusinessDesign.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(BusinessDesign.line))
    }

    private var routeCard: some View {
        VStack(spacing: 16) {
            Picker("Тип поиска", selection: $searchMode) {
                ForEach(SearchMode.allCases) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            if searchMode == .outbound || searchMode == .roundTrip {
                HStack(spacing: 12) {
                    airportField("Откуда", text: $outboundOrigin)
                    Image(systemName: "arrow.right")
                        .foregroundStyle(.secondary)
                    airportField("Куда", text: $outboundDestination)
                }

                DatePicker("Вылет", selection: $departureDate, in: Date()..., displayedComponents: .date)
            }

            if searchMode == .roundTrip {
                Divider()
            }

            if searchMode == .inbound || searchMode == .roundTrip {
                HStack(spacing: 12) {
                    airportField("Обратно из", text: $inboundOrigin)
                    Image(systemName: "arrow.right")
                        .foregroundStyle(.secondary)
                    airportField("Возврат", text: $inboundDestination)
                }

                DatePicker(
                    searchMode == .inbound ? "Дата" : "Возврат",
                    selection: $returnDate,
                    in: searchMode == .roundTrip ? max(departureDate, Date())... : Date()...,
                    displayedComponents: .date
                )
            }

            Stepper("Паломники: \(adults)", value: $adults, in: 1...9)

            HStack(spacing: 8) {
                Image(systemName: "arrow.trianglehead.branch")
                Text("Только прямые рейсы · 0 пересадок")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            }

            if searchMode == .roundTrip {
                HStack(alignment: .top, spacing: 9) {
                    Image(systemName: isExactReverseRoute ? "checkmark.seal.fill" : "info.circle.fill")
                        .foregroundStyle(isExactReverseRoute ? Color.green : Color.orange)
                    Text(roundTripRouteNote)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(12)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            }
        }
        .padding(18)
        .background(BusinessDesign.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(BusinessDesign.line))
        .onChange(of: departureDate) { _, newValue in
            if returnDate < newValue {
                returnDate = Calendar.current.date(byAdding: .day, value: 7, to: newValue) ?? newValue
            }
        }
    }

    private func airportField(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField("TAS", text: text)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .font(.system(size: 20, weight: .bold, design: .rounded))
                .onChange(of: text.wrappedValue) { _, value in
                    let clean = String(value.uppercased().filter { $0.isLetter }.prefix(3))
                    if clean != value { text.wrappedValue = clean }
                }
        }
        .padding(.horizontal, 13)
        .frame(maxWidth: .infinity, minHeight: 66, alignment: .leading)
        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 17, style: .continuous))
    }

    private var airlineFilters: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Авиакомпании")
                .font(.headline)
            Text("Выберите перевозчиков, которых Ignav должен включить в поиск.")
                .font(.caption)
                .foregroundStyle(.secondary)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 9) {
                    ForEach(airlines) { airline in
                        let selected = selectedAirlines.contains(airline.code)
                        Button {
                            if selected { selectedAirlines.remove(airline.code) }
                            else { selectedAirlines.insert(airline.code) }
                        } label: {
                            HStack(spacing: 8) {
                                BusinessAirlineLogoView(airlineIATA: airline.code, size: 30)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(airline.code).font(.caption.bold())
                                    Text(airline.name).font(.caption2).lineLimit(1)
                                }
                                if selected {
                                    Image(systemName: "checkmark.circle.fill")
                                        .font(.caption)
                                        .foregroundStyle(.green)
                                }
                            }
                            .foregroundStyle(.primary)
                            .padding(.horizontal, 10)
                            .frame(height: 48)
                            .background(selected ? Color.green.opacity(0.08) : BusinessDesign.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(selected ? Color.green.opacity(0.24) : BusinessDesign.line))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var searchButton: some View {
        Button {
            Task { await search() }
        } label: {
            HStack {
                Image(systemName: "magnifyingglass")
                Text(searchButtonTitle)
                    .fontWeight(.semibold)
                Spacer()
                if !selectedAirlines.isEmpty {
                    Text("\(selectedAirlines.count)")
                        .font(.caption.bold())
                        .padding(7)
                        .background(BusinessDesign.onPrimaryControl.opacity(0.18), in: Circle())
                }
            }
            .foregroundStyle(BusinessDesign.onPrimaryControl)
            .padding(.horizontal, 18)
            .frame(height: 56)
            .background(BusinessDesign.primaryControl, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!canSearch || isSearching)
        .opacity(canSearch ? 1 : 0.45)
    }

    private var emptySearchState: some View {
        let usable = searchDiagnostics?.usableItinerariesByLeg ?? []
        let raw = searchDiagnostics?.rawItinerariesByLeg ?? []

        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "airplane.circle")
                    .font(.title3)
                Text("Подходящих рейсов пока нет")
                    .font(.headline)
            }

            Text(emptySearchDescription)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            if searchDiagnostics != nil {
                if searchMode == .roundTrip {
                    let roundTrips = searchDiagnostics?.dedicatedRoundTripCount ?? 0
                    Text("Готовых единых round-trip Ignav: \(roundTrips). ONE WAY + RETURN в этом режиме не отображается.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Получено от провайдера: \(raw.first ?? 0). Подошло после проверки прямого рейса и авиакомпании: \(usable.first ?? 0).")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(17)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BusinessDesign.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(BusinessDesign.line))
    }

    private var searchResults: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Результаты")
                    .font(.title3.bold())
                Spacer()
                Text("\(results.count)")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
            }

            if searchMode == .roundTrip {
                Text("Здесь показывается только настоящий единый round-trip тариф Ignav. Комбинации ONE WAY + RETURN намеренно исключены и живут отдельно в ONE WAY inventory.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            ForEach(results.prefix(30)) { itinerary in
                resultCard(itinerary)
            }
        }
    }

    private func resultCard(_ itinerary: BusinessFlightCurationItinerary) -> some View {
        let alreadyPublished = published.contains { offer in
            offer.publicationIdentity == itinerary.publicationIdentity || offer.sourceCandidateID == itinerary.id
        }
        let total = itinerary.price.amount
        let perTraveler = total / Double(max(adults, 1))
        let badge = fareKindLabel(itinerary)
        let badgeColor = fareKindColor(itinerary)

        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                BusinessAirlineLogoView(airlineIATA: itinerary.primaryAirlineCode, size: 44)
                VStack(alignment: .leading, spacing: 4) {
                    Text(itinerary.primaryAirlineName)
                        .font(.headline)
                    Text(itinerary.legs.map(\.flightNumber).filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(money(total, currency: itinerary.price.currency))
                        .font(.headline)
                    Text("\(money(perTraveler, currency: itinerary.price.currency)) / чел.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Label(badge, systemImage: fareKindIcon(itinerary))
                .font(.caption.weight(.bold))
                .foregroundStyle(badgeColor)
                .padding(.horizontal, 10)
                .frame(minHeight: 29)
                .background(badgeColor.opacity(0.10), in: Capsule())

            if itinerary.price.status?.lowercased() == "unverified" {
                Label("Ориентировочная цена Ignav — рейс найден, но тариф ещё не подтверждён при booking lookup.", systemImage: "info.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ForEach(itinerary.legs.indices, id: \.self) { index in
                let leg = itinerary.legs[index]
                HStack(spacing: 8) {
                    Text("\(leg.origin) → \(leg.destination)")
                        .font(.subheadline.weight(.semibold))
                    Text(dateTime(leg.departureAt))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text("Прямой")
                        .font(.caption.bold())
                        .foregroundStyle(.green)
                }
            }

            Button {
                Task { await publish(itinerary) }
            } label: {
                HStack {
                    Image(systemName: alreadyPublished ? "checkmark.circle.fill" : "plus.circle.fill")
                    Text(alreadyPublished ? "Уже опубликовано" : "Опубликовать в iumrah")
                    Spacer()
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(alreadyPublished ? Color.secondary : Color.primary)
                .padding(.horizontal, 14)
                .frame(height: 46)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(alreadyPublished || publishingIDs.contains(itinerary.id))
        }
        .padding(17)
        .background(BusinessDesign.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(BusinessDesign.line))
    }

    private var publishedSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Опубликованные рейсы")
                    .font(.title3.bold())
                Spacer()
                if !published.isEmpty {
                    Text("\(published.count)")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                }
            }

            flightSyncCard

            if published.isEmpty {
                Text("Пока ничего не опубликовано. Выберите подходящий результат — он появится в клиентском блоке актуальных рейсов.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(17)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(BusinessDesign.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            } else {
                ForEach(published) { offer in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 12) {
                            BusinessAirlineLogoView(airlineIATA: offer.airlineCodes.first, size: 42)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(offer.airlineNames.first ?? offer.airlineCodes.first ?? "Рейс")
                                    .font(.subheadline.weight(.semibold))
                                HStack(spacing: 4) {
                                    if offer.itinerary?.fareScope?.lowercased() == "charter" {
                                        Image(systemName: "exclamationmark.triangle.fill")
                                            .foregroundStyle(.yellow)
                                    }
                                    Text(publishedKindLabel(offer))
                                        .foregroundStyle(offer.itinerary?.fareScope?.lowercased() == "charter" ? Color.primary : publishedKindColor(offer))
                                }
                                .font(.caption2.weight(.bold))
                                Text("\(offer.outboundOrigin) → \(offer.outboundDestination) · \(displayDate(offer.outboundDate))")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                if let inboundDate = offer.inboundDate,
                                   let inboundOrigin = offer.inboundOrigin,
                                   let inboundDestination = offer.inboundDestination {
                                    Text("\(inboundOrigin) → \(inboundDestination) · \(displayDate(inboundDate))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 3) {
                                Text(money(offer.perTravelerFare, currency: offer.currency))
                                    .font(.subheadline.bold())
                                Text("себестоимость / чел.")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            Button(role: .destructive) {
                                Task { await delete(offer) }
                            } label: {
                                Image(systemName: "trash")
                                    .frame(width: 36, height: 36)
                                    .background(Color.red.opacity(0.08), in: Circle())
                            }
                            .buttonStyle(.plain)
                        }

                        if offer.itinerary?.fareScope?.lowercased() == "charter",
                           let itinerary = offer.itinerary,
                           let url = charterSourceURL(itinerary) {
                            HStack(spacing: 6) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundStyle(.yellow)
                                Text(offer.itinerary?.sourceName ?? "Источник чартерного тарифа")
                                    .lineLimit(1)
                                Spacer()
                                Link("Открыть", destination: url)
                                    .fontWeight(.semibold)
                            }
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .padding(.top, 2)
                        }
                    }
                    .padding(15)
                    .background(BusinessDesign.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(BusinessDesign.line))
                }
            }
        }
    }

    private var flightSyncCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "arrow.triangle.2.circlepath.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(.blue)

                VStack(alignment: .leading, spacing: 4) {
                    Text("ChatGPT Sync")
                        .font(.headline)
                    Text("Read-only доступ только к опубликованным рейсам и их текущим ценам. ChatGPT не получает доступ к админке, публикации или удалению.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)

                if flightSyncURL != nil {
                    Menu {
                        Button("Синхронизировать", systemImage: "arrow.triangle.2.circlepath") {
                            Task { await syncFlightSnapshot(silent: false) }
                        }
                        Button("Отключить доступ", systemImage: "link.badge.minus", role: .destructive) {
                            Task { await revokeFlightSyncAccess() }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .font(.title3)
                    }
                    .disabled(isFlightSyncing)
                }
            }

            if let url = flightSyncURL {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundStyle(.green)
                    Text("Доступ включён")
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    Text("В Business: \(published.count) · Feed: \(flightSyncSavedCount.map(String.init) ?? "—")")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }

                Text(url.absoluteString)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .textSelection(.enabled)
                Text("Прямой JSON: \(url.appendingPathExtension("json").absoluteString)")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .textSelection(.enabled)

                HStack(spacing: 10) {
                    Button {
                        Task { await syncFlightSnapshot(silent: false) }
                    } label: {
                        HStack(spacing: 7) {
                            if isFlightSyncing {
                                ProgressView()
                                    .controlSize(.small)
                            } else {
                                Image(systemName: "arrow.triangle.2.circlepath")
                            }
                            Text("Синхронизировать")
                        }
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(isFlightSyncing)

                    Button {
                        UIPasteboard.general.string = url.appendingPathExtension("json").absoluteString
                        flightSyncMessage = "JSON-ссылка скопирована. Отправьте её в ваш чат ChatGPT."
                    } label: {
                        Image(systemName: "doc.on.doc")
                            .frame(width: 44, height: 44)
                            .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .buttonStyle(.plain)

                    ShareLink(item: url.appendingPathExtension("json")) {
                        Image(systemName: "square.and.arrow.up")
                            .frame(width: 44, height: 44)
                            .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            } else {
                Button {
                    Task { await createFlightSyncAccess() }
                } label: {
                    HStack {
                        if isFlightSyncing {
                            ProgressView()
                                .tint(.white)
                        } else {
                            Image(systemName: "link.badge.plus")
                        }
                        Text("Подключить ChatGPT")
                        Spacer()
                        Image(systemName: "chevron.right")
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 15)
                    .frame(height: 46)
                    .background(Color.black, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(isFlightSyncing)
            }

            if let flightSyncMessage {
                Text(flightSyncMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .background(BusinessDesign.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(BusinessDesign.line))
    }

    private var batchProgressSection: some View {
        let completed = batchSearches.filter { [.found, .noResults, .failed].contains($0.status) }.count
        let found = batchSearches.filter { $0.status == .found }.count
        let failed = batchSearches.filter { $0.status == .failed }.count
        let noResults = batchSearches.filter { $0.status == .noResults }.count
        let fraction = batchSearches.isEmpty ? 0 : Double(completed) / Double(batchSearches.count)

        return VStack(alignment: .leading, spacing: 13) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Массовый поиск")
                        .font(.title3.bold())
                    Text("\(completed) из \(batchSearches.count) завершено")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if isBatchSearching {
                    ProgressView()
                } else {
                    Image(systemName: failed == 0 ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .foregroundStyle(failed == 0 ? Color.green : Color.orange)
                }
            }

            ProgressView(value: fraction)

            HStack(spacing: 10) {
                batchCounter("Найдено", value: found, color: .green)
                batchCounter("Нет рейсов", value: noResults, color: .secondary)
                batchCounter("Ошибка", value: failed, color: failed > 0 ? .orange : .secondary)
            }

            if failed > 0 && !isBatchSearching {
                Button {
                    Task { await retryFailedBatchSearches() }
                } label: {
                    Label("Повторить только ошибки (\(failed))", systemImage: "arrow.clockwise")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(isBatchPublishing)
            }
        }
        .padding(17)
        .background(BusinessDesign.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(BusinessDesign.line))
    }

    private func batchCounter(_ title: String, value: Int, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(value)")
                .font(.headline)
                .foregroundStyle(color)
            Text(title)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 11)
        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
    }

    private var batchResultsSection: some View {
        let foundCount = batchSearches.reduce(0) { $0 + $1.results.count }
        let unpublishedCount = batchSearches.reduce(0) { partial, item in
            partial + item.results.filter { !isAlreadyPublished($0) }.count
        }

        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Результаты batch")
                        .font(.title3.bold())
                    Text("\(foundCount) тарифов · \(unpublishedCount) ещё не опубликовано")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }

            if foundCount > 0 {
                VStack(spacing: 9) {
                    HStack(spacing: 9) {
                        Button("Самый дешёвый / поиск") { selectCheapestFromEachBatchSearch() }
                            .buttonStyle(.plain)
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 11)
                            .frame(minHeight: 38)
                            .background(BusinessDesign.secondarySurface, in: Capsule())

                        Button("Выбрать все") { selectAllBatchResults() }
                            .buttonStyle(.plain)
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 11)
                            .frame(minHeight: 38)
                            .background(BusinessDesign.secondarySurface, in: Capsule())
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    Button {
                        Task { await publishSelectedBatchResults() }
                    } label: {
                        HStack {
                            Image(systemName: "paperplane.fill")
                            Text(isBatchPublishing ? "Публикуем…" : "Опубликовать выбранные")
                                .fontWeight(.semibold)
                            Spacer()
                            Text("\(selectedBatchResultKeys.count)")
                                .font(.caption.bold())
                                .padding(7)
                                .background(BusinessDesign.onPrimaryControl.opacity(0.18), in: Circle())
                        }
                        .foregroundStyle(BusinessDesign.onPrimaryControl)
                        .padding(.horizontal, 16)
                        .frame(height: 50)
                        .background(BusinessDesign.primaryControl, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(selectedBatchResultKeys.isEmpty || isBatchPublishing || isBatchSearching)
                    .opacity(selectedBatchResultKeys.isEmpty ? 0.45 : 1)
                }
            }

            ForEach(batchSearches) { item in
                batchSearchDisclosure(item)
            }
        }
    }

    private func batchSearchDisclosure(_ item: BatchSearchItem) -> some View {
        DisclosureGroup(isExpanded: expansionBinding(item.id)) {
            VStack(spacing: 10) {
                if item.status == .failed {
                    Text(item.error ?? "Неизвестная ошибка")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else if item.status == .noResults {
                    Text("Тот же ручной поиск не вернул прямых рейсов на эту дату. Это не считается ошибкой batch.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else if !item.results.isEmpty {
                    ForEach(item.results.prefix(20)) { itinerary in
                        batchResultRow(searchID: item.id, itinerary: itinerary)
                    }
                    if item.results.count > 20 {
                        Text("Показаны первые 20 из \(item.results.count) тарифов.")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding(.top, 10)
        } label: {
            HStack(spacing: 11) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 7) {
                        Text("\(item.origin) → \(item.destination)")
                            .font(.subheadline.bold())
                        Text(item.direction.title.uppercased())
                            .font(.caption2.bold())
                            .foregroundStyle(item.direction == .outbound ? Color.blue : Color.purple)
                    }
                    HStack(spacing: 7) {
                        Text(displayDate(item.date))
                        if let providerRequests = item.providerRequests {
                            Text("· \(providerRequests) provider req")
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                Spacer()

                if let cheapest = item.results.min(by: { $0.price.amount < $1.price.amount }) {
                    Text(money(cheapest.price.amount, currency: cheapest.price.currency))
                        .font(.subheadline.bold())
                }

                batchStatusBadge(item.status)
            }
            .contentShape(Rectangle())
        }
        .padding(15)
        .background(BusinessDesign.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(BusinessDesign.line))
    }

    private func batchResultRow(searchID: String, itinerary: BusinessFlightCurationItinerary) -> some View {
        let key = batchSelectionKey(searchID: searchID, itinerary: itinerary)
        let selected = selectedBatchResultKeys.contains(key)
        let alreadyPublished = isAlreadyPublished(itinerary)
        let perTraveler = itinerary.price.amount / Double(max(adults, 1))

        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 11) {
                Button {
                    guard !alreadyPublished else { return }
                    if selected { selectedBatchResultKeys.remove(key) }
                    else { selectedBatchResultKeys.insert(key) }
                } label: {
                    Image(systemName: alreadyPublished ? "checkmark.seal.fill" : (selected ? "checkmark.circle.fill" : "circle"))
                        .font(.title3)
                        .foregroundStyle(alreadyPublished ? Color.green : (selected ? BusinessDesign.accent : Color.secondary))
                }
                .buttonStyle(.plain)
                .disabled(alreadyPublished || isBatchPublishing)

                BusinessAirlineLogoView(airlineIATA: itinerary.primaryAirlineCode, size: 36)

                VStack(alignment: .leading, spacing: 3) {
                    Text(itinerary.primaryAirlineName)
                        .font(.subheadline.weight(.semibold))
                    Text(itinerary.legs.map(\.flightNumber).filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(money(itinerary.price.amount, currency: itinerary.price.currency))
                        .font(.subheadline.bold())
                    Text("\(money(perTraveler, currency: itinerary.price.currency)) / чел.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            if let leg = itinerary.legs.first {
                HStack {
                    Text("\(leg.origin) → \(leg.destination) · \(dateTime(leg.departureAt))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text("Прямой")
                        .font(.caption2.bold())
                        .foregroundStyle(.green)
                }
            }

            Button {
                Task { await publish(itinerary) }
            } label: {
                HStack {
                    Image(systemName: alreadyPublished ? "checkmark.circle.fill" : "plus.circle.fill")
                    Text(alreadyPublished ? "Уже опубликовано" : "Опубликовать этот тариф")
                    Spacer()
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(alreadyPublished ? Color.secondary : Color.primary)
                .padding(.horizontal, 12)
                .frame(height: 40)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(alreadyPublished || publishingIDs.contains(itinerary.id) || isBatchPublishing)
        }
        .padding(12)
        .background(BusinessDesign.secondarySurface.opacity(0.55), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func batchStatusBadge(_ status: BatchSearchStatus) -> some View {
        let configuration: (String, String, Color) = {
            switch status {
            case .pending: return ("Ожидает", "clock", .secondary)
            case .searching: return ("Поиск", "magnifyingglass", .blue)
            case .found: return ("Найдено", "checkmark.circle.fill", .green)
            case .noResults: return ("Нет", "minus.circle", .secondary)
            case .failed: return ("Ошибка", "exclamationmark.triangle.fill", .orange)
            }
        }()

        return Label(configuration.0, systemImage: configuration.1)
            .font(.caption2.bold())
            .foregroundStyle(configuration.2)
            .padding(.horizontal, 8)
            .frame(minHeight: 27)
            .background(configuration.2.opacity(0.09), in: Capsule())
    }

    private func expansionBinding(_ id: String) -> Binding<Bool> {
        Binding(
            get: { expandedBatchSearchIDs.contains(id) },
            set: { expanded in
                if expanded { expandedBatchSearchIDs.insert(id) }
                else { expandedBatchSearchIDs.remove(id) }
            }
        )
    }

    @MainActor
    private func startBatchSearch() async {
        do {
            let parsed = try parseBatchJSON()
            batchSearches = parsed
            expandedBatchSearchIDs = []
            selectedBatchResultKeys = []
            await executeBatch(indices: Array(batchSearches.indices))
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func retryFailedBatchSearches() async {
        let failedIndices = batchSearches.indices.filter { batchSearches[$0].status == .failed }
        guard !failedIndices.isEmpty else { return }
        await executeBatch(indices: Array(failedIndices))
    }

    @MainActor
    private func executeBatch(indices: [Int]) async {
        guard !indices.isEmpty else { return }
        isBatchSearching = true
        errorMessage = nil
        let frozenAdults = adults
        let frozenAirlines = selectedAirlines.sorted()
        defer { isBatchSearching = false }

        for index in indices {
            guard batchSearches.indices.contains(index) else { continue }
            let item = batchSearches[index]
            batchSearches[index].status = .searching
            batchSearches[index].error = nil
            batchSearches[index].results = []
            batchSearches[index].providerRequests = nil

            let request = BusinessFlightCurationSearchRequest(
                legs: [
                    .init(
                        origin: item.origin,
                        destination: item.destination,
                        departureDate: item.date,
                        maxStops: 0
                    )
                ],
                adults: frozenAdults,
                children: 0,
                infantsInSeat: 0,
                infantsOnLap: 0,
                cabinClass: "economy",
                airlinesInclude: frozenAirlines,
                allowSelfTransfer: false,
                curationMode: item.direction.apiValue
            )

            do {
                let response = try await api.searchFlightsForCuration(request)
                let sorted = response.itineraries.sorted { lhs, rhs in
                    if lhs.price.amount == rhs.price.amount {
                        return lhs.observedAt > rhs.observedAt
                    }
                    return lhs.price.amount < rhs.price.amount
                }
                batchSearches[index].results = sorted
                batchSearches[index].providerRequests = response.diagnostics?.providerRequests
                batchSearches[index].status = sorted.isEmpty ? .noResults : .found
                if !sorted.isEmpty {
                    expandedBatchSearchIDs.insert(item.id)
                }
            } catch {
                batchSearches[index].status = .failed
                batchSearches[index].error = error.localizedDescription
            }

            if index != indices.last! {
                try? await Task.sleep(nanoseconds: 180_000_000)
            }
        }
    }

    private func parseBatchJSON() throws -> [BatchSearchItem] {
        guard let data = bulkJSON.data(using: .utf8) else { throw BulkJSONError.invalidJSON }
        let envelope: BatchJSONEnvelope
        do {
            envelope = try JSONDecoder().decode(BatchJSONEnvelope.self, from: data)
        } catch {
            throw BulkJSONError.invalidJSON
        }

        if let type = envelope.type?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
           !type.isEmpty,
           type != "one_way" {
            throw BulkJSONError.unsupportedType
        }
        guard !envelope.searches.isEmpty else { throw BulkJSONError.empty }
        guard envelope.searches.count <= 20 else { throw BulkJSONError.tooMany(envelope.searches.count) }

        var seen: Set<String> = []
        var parsed: [BatchSearchItem] = []

        for input in envelope.searches {
            guard let direction = BatchDirection(jsonValue: input.direction) else {
                throw BulkJSONError.invalidDirection(input.direction ?? "")
            }
            let origin = input.from.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            let destination = input.to.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            guard isValidAirport(origin) else { throw BulkJSONError.invalidAirport(input.from) }
            guard isValidAirport(destination) else { throw BulkJSONError.invalidAirport(input.to) }

            let day = input.date.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let parsedDay = Self.apiDay.date(from: day),
                  Self.apiDay.string(from: parsedDay) == day,
                  Calendar.current.startOfDay(for: parsedDay) >= Calendar.current.startOfDay(for: Date()) else {
                throw BulkJSONError.invalidDate(input.date)
            }

            let key = "\(direction.rawValue)|\(origin)|\(destination)|\(day)"
            if seen.contains(key) { continue }
            seen.insert(key)

            parsed.append(BatchSearchItem(
                id: key,
                sourceID: input.id,
                direction: direction,
                origin: origin,
                destination: destination,
                date: day
            ))
        }

        guard !parsed.isEmpty else { throw BulkJSONError.empty }
        return parsed
    }

    private func isValidAirport(_ value: String) -> Bool {
        value.count == 3 && value.unicodeScalars.allSatisfy { scalar in
            scalar.value >= 65 && scalar.value <= 90
        }
    }

    private func batchSelectionKey(searchID: String, itinerary: BusinessFlightCurationItinerary) -> String {
        "\(searchID)|\(itinerary.publicationIdentity)"
    }

    private func isAlreadyPublished(_ itinerary: BusinessFlightCurationItinerary) -> Bool {
        published.contains { offer in
            offer.publicationIdentity == itinerary.publicationIdentity || offer.sourceCandidateID == itinerary.id
        }
    }

    private func selectCheapestFromEachBatchSearch() {
        var next: Set<String> = []
        for item in batchSearches where !item.results.isEmpty {
            let candidate = item.results
                .filter { !isAlreadyPublished($0) }
                .min(by: { $0.price.amount < $1.price.amount })
            if let candidate {
                next.insert(batchSelectionKey(searchID: item.id, itinerary: candidate))
            }
        }
        selectedBatchResultKeys = next
    }

    private func selectAllBatchResults() {
        var next: Set<String> = []
        for item in batchSearches {
            for itinerary in item.results where !isAlreadyPublished(itinerary) {
                next.insert(batchSelectionKey(searchID: item.id, itinerary: itinerary))
            }
        }
        selectedBatchResultKeys = next
    }

    @MainActor
    private func publishSelectedBatchResults() async {
        guard !selectedBatchResultKeys.isEmpty else { return }
        isBatchPublishing = true
        errorMessage = nil
        defer { isBatchPublishing = false }

        var seenPublicationIdentities: Set<String> = []
        var failures: [String] = []
        var successfulKeys: Set<String> = []

        for item in batchSearches {
            for itinerary in item.results {
                let key = batchSelectionKey(searchID: item.id, itinerary: itinerary)
                guard selectedBatchResultKeys.contains(key) else { continue }
                guard !isAlreadyPublished(itinerary) else {
                    successfulKeys.insert(key)
                    continue
                }
                guard !seenPublicationIdentities.contains(itinerary.publicationIdentity) else {
                    successfulKeys.insert(key)
                    continue
                }
                seenPublicationIdentities.insert(itinerary.publicationIdentity)
                publishingIDs.insert(itinerary.id)
                do {
                    _ = try await api.publishCuratedFlight(itinerary, travelerCount: adults)
                    successfulKeys.insert(key)
                } catch {
                    failures.append("\(item.origin)→\(item.destination): \(error.localizedDescription)")
                }
                publishingIDs.remove(itinerary.id)
            }
        }

        selectedBatchResultKeys.subtract(successfulKeys)
        do {
            published = try await api.curatedFlights()
        } catch {
            failures.append(error.localizedDescription)
        }

        if !failures.isEmpty {
            errorMessage = failures.prefix(3).joined(separator: "\n")
        }
    }

    private func parseCharterImport() {
        do {
            charterResults = try parseCharterJSON()
            selectedCharterIDs = Set(charterResults.filter { !isAlreadyPublished($0) }.map(\.id))
            errorMessage = nil
        } catch {
            charterResults = []
            selectedCharterIDs = []
            errorMessage = error.localizedDescription
        }
    }

    private func parseCharterJSON() throws -> [BusinessFlightCurationItinerary] {
        guard let data = charterJSON.data(using: .utf8) else { throw CharterJSONError.invalidJSON }
        let envelope: CharterJSONEnvelope
        do {
            envelope = try JSONDecoder().decode(CharterJSONEnvelope.self, from: data)
        } catch {
            throw CharterJSONError.invalidJSON
        }

        if let type = envelope.type?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
           !type.isEmpty,
           type != "charter" {
            throw CharterJSONError.unsupportedType
        }
        guard !envelope.flights.isEmpty else { throw CharterJSONError.empty }
        guard envelope.flights.count <= 50 else { throw CharterJSONError.tooMany(envelope.flights.count) }

        var seen: Set<String> = []
        var parsed: [BusinessFlightCurationItinerary] = []

        for input in envelope.flights {
            guard let direction = BatchDirection(jsonValue: input.direction) else {
                throw CharterJSONError.invalidDirection(input.direction ?? "")
            }

            let origin = input.from.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            let destination = input.to.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            guard isValidAirport(origin) else { throw CharterJSONError.invalidAirport(input.from) }
            guard isValidAirport(destination) else { throw CharterJSONError.invalidAirport(input.to) }

            let airlineCode = input.airline.iata.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            guard airlineCode.count == 2,
                  airlineCode.unicodeScalars.allSatisfy({ scalar in
                      (scalar.value >= 65 && scalar.value <= 90) || (scalar.value >= 48 && scalar.value <= 57)
                  }) else {
                throw CharterJSONError.invalidAirlineCode(input.airline.iata)
            }

            let airlineName = input.airline.name.trimmingCharacters(in: .whitespacesAndNewlines)
            let flightNumber = input.flightNumber.trimmingCharacters(in: .whitespacesAndNewlines).uppercased().replacingOccurrences(of: " ", with: "")
            guard !airlineName.isEmpty, !flightNumber.isEmpty, flightNumber.count <= 12 else {
                throw CharterJSONError.invalidFlightNumber(input.flightNumber)
            }

            guard Self.iso8601.date(from: input.departureAt) != nil else {
                throw CharterJSONError.invalidTimestamp(input.departureAt)
            }
            guard Self.iso8601.date(from: input.arrivalAt) != nil else {
                throw CharterJSONError.invalidTimestamp(input.arrivalAt)
            }
            guard let departure = Self.iso8601.date(from: input.departureAt),
                  let arrival = Self.iso8601.date(from: input.arrivalAt),
                  arrival > departure else {
                throw CharterJSONError.invalidTimestamp("\(input.departureAt) → \(input.arrivalAt)")
            }
            let departureDay = Self.apiDay.string(from: departure)
            let todayDay = Self.apiDay.string(from: Date())
            if departureDay < todayDay {
                throw CharterJSONError.expiredFlight("\(origin)→\(destination) · \(departureDay)")
            }

            guard input.price.amount > 0, input.price.amount.isFinite else { throw CharterJSONError.invalidPrice }
            let currency = input.price.currency.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            guard currency.count == 3,
                  currency.unicodeScalars.allSatisfy({ $0.value >= 65 && $0.value <= 90 }) else {
                throw CharterJSONError.invalidCurrency(input.price.currency)
            }

            let sourceURL = input.source.url.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let url = URL(string: sourceURL),
                  ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
                  url.host != nil else {
                throw CharterJSONError.invalidSourceURL(input.source.url)
            }

            let sourceName = input.source.name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !sourceName.isEmpty else { throw CharterJSONError.invalidSourceURL(input.source.url) }

            let durationMinutes = max(1, Int(arrival.timeIntervalSince(departure) / 60.0))
            let priceType = (input.price.type ?? "seat").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let observedAt = normalizedObservedAt(input.source.publishedAt) ?? Self.iso8601.string(from: Date())
            let cabin = (input.cabinClass ?? "economy").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let sourceID = input.id?.trimmingCharacters(in: .whitespacesAndNewlines)
            let identity = "\(airlineCode)|\(flightNumber)|\(origin)|\(destination)|\(input.departureAt)|\(input.arrivalAt)|\(sourceURL)"
            if seen.contains(identity) { continue }
            seen.insert(identity)

            let generatedID = sourceID?.isEmpty == false ? sourceID! : "charter-\(identity.hashValue.magnitude)"
            parsed.append(BusinessFlightCurationItinerary(
                id: generatedID,
                source: "charter",
                sourceName: sourceName,
                sourceURL: sourceURL,
                sourcePublishedAt: normalizedObservedAt(input.source.publishedAt),
                priceType: priceType,
                observedAt: observedAt,
                fareScope: "charter",
                price: .init(amount: input.price.amount, currency: currency, status: "unverified"),
                legs: [
                    .init(
                        airline: airlineName,
                        flightNumber: flightNumber,
                        airlineCode: airlineCode,
                        origin: origin,
                        destination: destination,
                        departureAt: input.departureAt,
                        arrivalAt: input.arrivalAt,
                        durationMinutes: durationMinutes,
                        stops: 0,
                        cabinClass: cabin.isEmpty ? "economy" : cabin
                    )
                ],
                cabinClass: cabin.isEmpty ? "economy" : cabin,
                ignavId: nil,
                offerType: "one_way",
                journeyRole: direction == .returnLeg ? "return" : "outbound"
            ))
        }

        guard !parsed.isEmpty else { throw CharterJSONError.empty }
        return parsed.sorted { lhs, rhs in
            let l = lhs.legs.first?.departureAt ?? ""
            let r = rhs.legs.first?.departureAt ?? ""
            if l == r { return lhs.price.amount < rhs.price.amount }
            return l < r
        }
    }

    private func normalizedObservedAt(_ rawValue: String?) -> String? {
        guard let rawValue = rawValue?.trimmingCharacters(in: .whitespacesAndNewlines), !rawValue.isEmpty else { return nil }
        if let date = Self.iso8601.date(from: rawValue) { return Self.iso8601.string(from: date) }
        if let day = Self.apiDay.date(from: rawValue) { return Self.iso8601.string(from: day) }
        return nil
    }

    @MainActor
    private func publishCharter(_ itinerary: BusinessFlightCurationItinerary) async {
        publishingIDs.insert(itinerary.id)
        defer { publishingIDs.remove(itinerary.id) }
        do {
            _ = try await api.publishCuratedFlight(itinerary, travelerCount: 1)
            published = try await api.curatedFlights()
            selectedCharterIDs.remove(itinerary.id)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func publishSelectedCharters() async {
        guard !selectedCharterIDs.isEmpty else { return }
        isCharterPublishing = true
        errorMessage = nil
        defer { isCharterPublishing = false }

        var successful: Set<String> = []
        var failures: [String] = []
        for itinerary in charterResults where selectedCharterIDs.contains(itinerary.id) {
            if isAlreadyPublished(itinerary) {
                successful.insert(itinerary.id)
                continue
            }
            publishingIDs.insert(itinerary.id)
            do {
                _ = try await api.publishCuratedFlight(itinerary, travelerCount: 1)
                successful.insert(itinerary.id)
            } catch {
                failures.append("\(itinerary.legs.first?.origin ?? "")→\(itinerary.legs.first?.destination ?? ""): \(error.localizedDescription)")
            }
            publishingIDs.remove(itinerary.id)
        }

        selectedCharterIDs.subtract(successful)
        do {
            published = try await api.curatedFlights()
        } catch {
            failures.append(error.localizedDescription)
        }
        if !failures.isEmpty {
            errorMessage = failures.prefix(3).joined(separator: "\n")
        }
    }

    private func charterSourceURL(_ itinerary: BusinessFlightCurationItinerary) -> URL? {
        let candidates = [itinerary.sourceURL, itinerary.source]
        for raw in candidates {
            guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !raw.isEmpty,
                  let url = URL(string: raw),
                  ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { continue }
            return url
        }
        return nil
    }

    private var canSearch: Bool {
        guard !selectedAirlines.isEmpty else { return false }
        switch searchMode {
        case .outbound:
            return outboundOrigin.count == 3 && outboundDestination.count == 3
        case .inbound:
            return inboundOrigin.count == 3 && inboundDestination.count == 3
        case .roundTrip:
            return [outboundOrigin, outboundDestination, inboundOrigin, inboundDestination].allSatisfy { $0.count == 3 }
                && departureDate <= returnDate
                && isExactReverseRoute
        }
    }

    private var isExactReverseRoute: Bool {
        outboundOrigin == inboundDestination && outboundDestination == inboundOrigin
    }

    private var roundTripRouteNote: String {
        if isExactReverseRoute {
            return "Маршрут зеркальный. Business ищет только единый round-trip тариф Ignav. ONE WAY + RETURN сюда не смешивается."
        }
        return "Это open-jaw, а не round-trip. Используйте отдельные режимы «Туда» и «Обратно» или массовый ONE WAY JSON."
    }

    private var searchButtonTitle: String {
        switch searchMode {
        case .outbound: return "Найти рейсы туда"
        case .inbound: return "Найти рейсы обратно"
        case .roundTrip: return "Найти round-trip"
        }
    }

    private var searchProgressText: String {
        switch searchMode {
        case .outbound: return "Ищем прямые рейсы туда…"
        case .inbound: return "Ищем прямые рейсы обратно…"
        case .roundTrip: return "Ищем единый round-trip тариф…"
        }
    }

    private var emptySearchDescription: String {
        switch searchMode {
        case .outbound:
            return "Ignav не вернул подходящий прямой рейс \(outboundOrigin) → \(outboundDestination) на выбранную дату."
        case .inbound:
            return "Ignav не вернул подходящий прямой рейс \(inboundOrigin) → \(inboundDestination) на выбранную дату."
        case .roundTrip:
            return "Ignav не вернул единый round-trip тариф для \(outboundOrigin) → \(outboundDestination) → \(inboundDestination) на выбранные даты."
        }
    }

    @MainActor
    private func search() async {
        guard canSearch else { return }
        isSearching = true
        errorMessage = nil
        defer { isSearching = false }

        let legs: [BusinessFlightCurationSearchRequest.Leg]
        switch searchMode {
        case .outbound:
            legs = [
                .init(origin: outboundOrigin, destination: outboundDestination, departureDate: Self.apiDay.string(from: departureDate), maxStops: 0)
            ]
        case .inbound:
            legs = [
                .init(origin: inboundOrigin, destination: inboundDestination, departureDate: Self.apiDay.string(from: returnDate), maxStops: 0)
            ]
        case .roundTrip:
            legs = [
                .init(origin: outboundOrigin, destination: outboundDestination, departureDate: Self.apiDay.string(from: departureDate), maxStops: 0),
                .init(origin: inboundOrigin, destination: inboundDestination, departureDate: Self.apiDay.string(from: returnDate), maxStops: 0)
            ]
        }

        let request = BusinessFlightCurationSearchRequest(
            legs: legs,
            adults: adults,
            children: 0,
            infantsInSeat: 0,
            infantsOnLap: 0,
            cabinClass: "economy",
            airlinesInclude: selectedAirlines.sorted(),
            allowSelfTransfer: false,
            curationMode: searchMode.apiValue
        )

        do {
            let response = try await api.searchFlightsForCuration(request)
            if searchMode == .roundTrip {
                results = response.itineraries.filter { $0.effectiveOfferType == "round_trip" }
            } else {
                results = response.itineraries
            }
            searchDiagnostics = response.diagnostics
            hasSearched = true
        } catch {
            results = []
            searchDiagnostics = nil
            hasSearched = false
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func loadPublished() async {
        do {
            var offers = try await api.curatedFlights()
            let expired = offers.filter(isExpiredPublishedOffer)
            if !expired.isEmpty {
                for offer in expired {
                    try? await api.deleteCuratedFlight(id: offer.id)
                }
                offers = try await api.curatedFlights()
            }
            published = offers.filter { !isExpiredPublishedOffer($0) }
            // A foreground refresh must also heal a stale/empty public feed
            // when the in-memory array is unchanged (onChange won't fire).
            if flightSyncURL != nil && !published.isEmpty {
                await syncFlightSnapshot(silent: true)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func isExpiredPublishedOffer(_ offer: BusinessCuratedFlightOffer) -> Bool {
        let rawDay = String(offer.outboundDate.prefix(10))
        guard rawDay.count == 10, Self.apiDay.date(from: rawDay) != nil else { return false }
        return rawDay < Self.apiDay.string(from: Date())
    }

    @MainActor
    private func publish(_ itinerary: BusinessFlightCurationItinerary) async {
        publishingIDs.insert(itinerary.id)
        defer { publishingIDs.remove(itinerary.id) }
        do {
            _ = try await api.publishCuratedFlight(itinerary, travelerCount: adults)
            published = try await api.curatedFlights()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func delete(_ offer: BusinessCuratedFlightOffer) async {
        do {
            try await api.deleteCuratedFlight(id: offer.id)
            published.removeAll { $0.id == offer.id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func restoreFlightSyncAccess() async {
        // The server URL is derived from the same owner and survives app installs
        // and token rotations. Prefer it over legacy token links stored on device.
        do {
            let status = try await api.flightSyncStatus()
            flightSyncSavedCount = status.enabled ? status.flightCount : nil
            guard status.enabled, let rawURL = status.accessURL,
                  let url = URL(string: rawURL) else {
                if !status.enabled {
                    BusinessSessionVault.clearFlightSyncAccessURL()
                    flightSyncURL = nil
                }
                return
            }
            try BusinessSessionVault.setFlightSyncAccessURL(url)
            flightSyncURL = url
        } catch {
            // Do not clear a previously working link after a transient outage.
        }
    }

    @MainActor
    private func freshFlightSyncOffers() async throws -> [BusinessCuratedFlightOffer] {
        // Never publish a transient @State snapshot: fetch the authoritative list
        // again immediately before every write. An API failure throws and leaves
        // the previous feed untouched.
        let offers = try await api.curatedFlights()
        let current = offers.filter { !isExpiredPublishedOffer($0) }
        guard !current.isEmpty else { throw FlightSyncProtectionError.emptyPublished }
        return current
    }

    @MainActor
    private func createFlightSyncAccess() async {
        guard !isFlightSyncing else { return }
        isFlightSyncing = true
        flightSyncMessage = nil
        defer { isFlightSyncing = false }

        do {
            let access = try await api.rotateFlightSyncAccess()
            guard let url = URL(string: access.accessURL) else {
                throw APIError.invalidURL
            }
            try BusinessSessionVault.setFlightSyncAccessURL(url)
            flightSyncURL = url
            let actualOffers = try await freshFlightSyncOffers()
            let snapshot = try await api.saveFlightSyncSnapshot(offers: actualOffers)
            flightSyncSavedCount = snapshot.flightCount
            UIPasteboard.general.string = url.appendingPathExtension("json").absoluteString
            flightSyncMessage = "Готово: \(snapshot.flightCount) рейсов синхронизировано. Прямая JSON-ссылка скопирована для ChatGPT."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func syncFlightSnapshot(silent: Bool) async {
        guard flightSyncURL != nil, !isFlightSyncing else { return }
        isFlightSyncing = true
        defer { isFlightSyncing = false }
        do {
            let actualOffers = try await freshFlightSyncOffers()
            let snapshot = try await api.saveFlightSyncSnapshot(offers: actualOffers)
            flightSyncSavedCount = snapshot.flightCount
            if !silent {
                flightSyncMessage = "Синхронизировано: \(snapshot.flightCount) опубликованных рейсов."
            } else {
                flightSyncMessage = nil
            }
        } catch {
            // Automatic failures must be visible too. Silently swallowing them
            // previously made the card claim success while the feed stayed empty.
            flightSyncMessage = "Flight Sync: \(error.localizedDescription)"
            if !silent { errorMessage = error.localizedDescription }
        }
    }

    @MainActor
    private func revokeFlightSyncAccess() async {
        guard !isFlightSyncing else { return }
        isFlightSyncing = true
        defer { isFlightSyncing = false }
        do {
            _ = try await api.revokeFlightSyncAccess()
            BusinessSessionVault.clearFlightSyncAccessURL()
            flightSyncURL = nil
            flightSyncSavedCount = nil
            flightSyncMessage = "Read-only ссылка отключена. Старый адрес больше не даёт доступ к списку рейсов."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func fareKindLabel(_ itinerary: BusinessFlightCurationItinerary) -> String {
        if itinerary.fareScope?.lowercased() == "charter" {
            return itinerary.effectiveJourneyRole == "return" ? "CHARTER · ОБРАТНО" : "CHARTER · ТУДА"
        }
        switch itinerary.effectiveOfferType {
        case "round_trip":
            return "ТУДА-ОБРАТНО · ЕДИНЫЙ ТАРИФ IGNAV"
        case "paired_one_way":
            return "ONE WAY + RETURN · СУММА 2 БИЛЕТОВ"
        default:
            return itinerary.effectiveJourneyRole == "return" ? "ONE WAY · ОБРАТНО" : "ONE WAY · ТУДА"
        }
    }

    private func fareKindIcon(_ itinerary: BusinessFlightCurationItinerary) -> String {
        if itinerary.fareScope?.lowercased() == "charter" { return "ticket.fill" }
        switch itinerary.effectiveOfferType {
        case "round_trip": return "arrow.left.arrow.right.circle.fill"
        case "paired_one_way": return "plus.circle.fill"
        default: return "arrow.right.circle.fill"
        }
    }

    private func fareKindColor(_ itinerary: BusinessFlightCurationItinerary) -> Color {
        if itinerary.fareScope?.lowercased() == "charter" { return .orange }
        switch itinerary.effectiveOfferType {
        case "round_trip": return .green
        case "paired_one_way": return .orange
        default: return .blue
        }
    }

    private func publishedKindLabel(_ offer: BusinessCuratedFlightOffer) -> String {
        if offer.itinerary?.fareScope?.lowercased() == "charter" {
            let role = offer.journeyRole ?? offer.itinerary?.effectiveJourneyRole ?? "outbound"
            return role == "return" ? "CHARTER · ОБРАТНО" : "CHARTER · ТУДА"
        }
        let type = offer.offerType ?? offer.itinerary?.effectiveOfferType ?? "paired_one_way"
        let role = offer.journeyRole ?? offer.itinerary?.effectiveJourneyRole ?? "complete"
        switch type {
        case "round_trip": return "ТУДА-ОБРАТНО · IGNAV"
        case "paired_one_way": return "ONE WAY + RETURN"
        default: return role == "return" ? "ONE WAY · ОБРАТНО" : "ONE WAY · ТУДА"
        }
    }

    private func publishedKindColor(_ offer: BusinessCuratedFlightOffer) -> Color {
        if offer.itinerary?.fareScope?.lowercased() == "charter" { return .orange }
        let type = offer.offerType ?? offer.itinerary?.effectiveOfferType ?? "paired_one_way"
        switch type {
        case "round_trip": return .green
        case "paired_one_way": return .orange
        default: return .blue
        }
    }

    private func money(_ value: Double, currency: String) -> String {
        let code = currency.uppercased()
        if code == "USD" { return "$\(Int(value.rounded()))" }
        return "\(Int(value.rounded())) \(code)"
    }

    private func dateTime(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: iso) else { return iso }
        return Self.displayDateTime.string(from: date)
    }

    private func displayDate(_ apiDate: String) -> String {
        guard let date = Self.apiDay.date(from: apiDate) else { return apiDate }
        return Self.displayDay.string(from: date)
    }

    private static var bulkJSONExample: String {
        let firstDate = Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date()
        let secondDate = Calendar.current.date(byAdding: .day, value: 14, to: Date()) ?? firstDate
        let firstDay = apiDay.string(from: firstDate)
        let secondDay = apiDay.string(from: secondDate)
        return """
        {
          "type": "one_way",
          "searches": [
            {
              "id": "TAS-JED-\(firstDay)",
              "direction": "outbound",
              "from": "TAS",
              "to": "JED",
              "date": "\(firstDay)"
            },
            {
              "id": "JED-TAS-\(secondDay)",
              "direction": "return",
              "from": "JED",
              "to": "TAS",
              "date": "\(secondDay)"
            }
          ]
        }
        """
    }

    private static var charterJSONExample: String {
        return """
        {
          "type": "charter",
          "flights": [
            {
              "id": "NMA-MED-F39135-2026-09-09",
              "direction": "outbound",
              "from": "NMA",
              "to": "MED",
              "airline": {
                "name": "flyadeal",
                "iata": "F3"
              },
              "flight_number": "F39135",
              "departure_at": "2026-09-09T15:40:00+05:00",
              "arrival_at": "2026-09-09T19:40:00+03:00",
              "price": {
                "amount": 329,
                "currency": "USD",
                "type": "seat"
              },
              "source": {
                "name": "Supplier / published source",
                "url": "https://example.com/charter-source",
                "published_at": "2026-09-06T17:00:00+05:00"
              },
              "cabin_class": "economy"
            }
          ]
        }
        """
    }

    private static let iso8601: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withColonSeparatorInTimeZone]
        return formatter
    }()

    private static let apiDay: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private static let displayDay: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ru_RU")
        f.dateFormat = "d MMM"
        return f
    }()

    private static let displayDateTime: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ru_RU")
        f.dateFormat = "d MMM, HH:mm"
        return f
    }()
}
