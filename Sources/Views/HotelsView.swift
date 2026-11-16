import SwiftUI
import UIKit

struct HotelsView: View {
    var catalogMode = false
    @Environment(\.businessAdaptiveLayout) private var layout
    @State private var hotels: [HotelListItem] = []
    @State private var loading = false
    @State private var loadGeneration = UUID()
    @State private var showingCachedCatalog = false
    @Environment(\.scenePhase) private var scenePhase
    @State private var showAdd = false
    @State private var backendUnavailable = false
    @State private var cloudHealth: HotelCloudHealthResponse?
    @State private var backendMessage: String?
    @State private var importJobs: [HotelImportJob] = []
    @State private var importJobsError: String?
    @State private var jobActionID: String?
    @State private var selectedCatalogCity = "Makkah"

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                header
                cityCounters
                primaryHotelsEntry
                priceMonitoringEntry
                cloudStatus
                importsSection
                hotelCatalog.disabled(showingCachedCatalog)
                if !unclassifiedHotels.isEmpty {
                    unclassifiedCatalog.disabled(showingCachedCatalog)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .businessAdaptiveReadableWidth()
            .padding(.vertical, 14)
        }
        .contentMargins(.horizontal, 18, for: .scrollContent)
        .scrollIndicators(.hidden)
        .background(BusinessDesign.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .businessNavigationSurface()
        .toolbar { ToolbarItem(placement: .topBarLeading) { if !catalogMode { BusinessSidebarButton() } }
            ToolbarItem(placement: .principal) { BusinessBrandLogo(width: 150, foreground: .white).frame(height: 36) } }
        .sheet(isPresented: $showAdd, onDismiss: { Task { await load() } }) {
            AddHotelView()
        }
        .task {
            // Show a recent catalogue snapshot while revalidating against D1.
            if hotels.isEmpty, let cached = await APIClient.shared.cachedHotelCatalog(), !Task.isCancelled {
                hotels = cached
                showingCachedCatalog = true
            }
            async let prepareNotifications: Void = BusinessNotifications.prepare()
            await load()
            _ = await prepareNotifications
            await monitorImports()
        }
        .refreshable { await load() }
    }

    private var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Hotels")
                    .font(.system(size: 38, weight: .bold, design: .rounded))
                    .tracking(-1.5)
                Text("Каталог iumrah · Makkah и Madinah")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 12)
            Button { showAdd = true } label: {
                Image(systemName: "plus")
                    .font(.system(size: 18, weight: .bold))
                    .frame(width: 44, height: 44)
                    .foregroundStyle(BusinessDesign.onPrimaryControl)
                    .background(BusinessDesign.primaryControl, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Импортировать отель")
        }
    }


    private var primaryHotelsEntry: some View {
        NavigationLink {
            PrimaryHotelsView()
        } label: {
            HStack(spacing: 13) {
                ZStack {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(BusinessDesign.primaryControl)
                        .frame(width: 48, height: 48)
                    Image(systemName: "star.fill")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(BusinessDesign.onPrimaryControl)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text("Primary Hotels").font(.headline)
                    Text("1–3 рекомендуемых iumrah отеля на каждую категорию")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(.tertiary)
            }
            .padding(14)
            .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
    }

    private var priceMonitoringEntry: some View {
        NavigationLink {
            HotelPriceMonitoringView(hotels: $hotels)
        } label: {
            HStack(spacing: 13) {
                ZStack {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Color.orange.opacity(0.12))
                        .frame(width: 48, height: 48)
                    Image(systemName: "chart.line.uptrend.xyaxis")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.orange)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text("Обновление цен")
                        .font(.headline)
                    Text("Текущий каталог → ссылка ChatGPT → JSON → предпросмотр")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.bold())
                    .foregroundStyle(.tertiary)
            }
            .padding(14)
            .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
    }

    private var cityCounters: some View {
        HStack(spacing: 10) {
            HotelCountCard(title: "Makkah", count: hotels.filter { catalogCity(for: $0.city) == "Makkah" }.count)
            HotelCountCard(title: "Madinah", count: hotels.filter { catalogCity(for: $0.city) == "Madinah" }.count)
        }
    }

    private var cloudStatus: some View {
        HStack(spacing: 11) {
            Image(systemName: backendUnavailable ? "exclamationmark.icloud.fill" : "checkmark.icloud.fill")
                .font(.title3)
                .foregroundStyle(backendUnavailable ? .red : .green)
            VStack(alignment: .leading, spacing: 2) {
                Text(backendUnavailable ? "Hotels Cloud недоступен" : "Hotels Cloud подключён")
                    .font(.subheadline.weight(.semibold))
                if showingCachedCatalog {
                    Text(loading ? "Сохранённый каталог · обновляем данные" : "Сохранённый каталог · данные не обновлены")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let cloudHealth, !backendUnavailable {
                    Text("D1 · R2 · \(cloudHealth.hotels) отелей")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if let backendMessage {
                    Text(backendMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer()
            if loading { ProgressView().controlSize(.small) }
        }
        .padding(15)
        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    @ViewBuilder private var importsSection: some View {
        if !importJobs.isEmpty || importJobsError != nil {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Импорты").font(.title2.bold())
                    Spacer()
                    let activeCount = importJobs.filter(\.isActive).count
                    if activeCount > 0 {
                        Label("\(activeCount)", systemImage: "arrow.triangle.2.circlepath")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }

                if let importJobsError {
                    Label(importJobsError, systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                ForEach(Array(importJobs.prefix(8))) { job in
                    importJobCard(job)
                }
            }
            .padding(16)
            .businessCard(radius: 28)
        }
    }

    private var filteredHotels: [HotelListItem] {
        hotels.filter { catalogCity(for: $0.city) == selectedCatalogCity }
    }

    private var unclassifiedHotels: [HotelListItem] {
        hotels.filter { catalogCity(for: $0.city) == nil }
    }

    /// D1 historically contains a few provider/legacy spellings such as
    /// "Mecca" / "Medina".  Never classify the catalog by fragile substring
    /// checks ("makk" / "mad"), because those aliases silently disappear
    /// from both counters and the list.
    private func catalogCity(for rawCity: String) -> String? {
        let city = rawCity
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "-", with: " ")
            .replacingOccurrences(of: "_", with: " ")

        if city.contains("makkah") || city.contains("mecca") || city.contains("مكة") {
            return "Makkah"
        }
        if city.contains("madinah") || city.contains("medina") || city.contains("المدينة") {
            return "Madinah"
        }
        return nil
    }

    private var hotelCatalog: some View {
        VStack(alignment: .leading, spacing: 14) {
            Picker("Город", selection: $selectedCatalogCity) {
                Text("Мекка").tag("Makkah")
                Text("Медина").tag("Madinah")
            }
            .pickerStyle(.segmented)

            HStack {
                Text("База отелей").font(.title2.bold())
                Spacer()
                Text("\(filteredHotels.count)").foregroundStyle(.secondary)
            }

            if filteredHotels.isEmpty && !loading {
                ContentUnavailableView(
                    selectedCatalogCity == "Makkah" ? "В Мекке отелей пока нет" : "В Медине отелей пока нет",
                    systemImage: "building.2",
                    description: Text("Добавьте отель по прямой ссылке Booking или Expedia.")
                )
            }

            if layout.supportsDenseDashboard {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 420, maximum: 620), spacing: 12)], spacing: 12) {
                    ForEach(filteredHotels) { hotel in
                        hotelRow(hotel)
                    }
                }
            } else {
                ForEach(filteredHotels) { hotel in
                    hotelRow(hotel)
                }
            }
        }
        .padding(16)
        .businessCard(radius: 28)
    }

    private var unclassifiedCatalog: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Нужно определить город")
                        .font(.title3.bold())
                    Text("Эти записи есть в D1, но их city не распознан как Makkah или Madinah. Они больше не скрываются из интерфейса.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 12)
                Text("\(unclassifiedHotels.count)")
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(.orange)
            }

            if layout.supportsDenseDashboard {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 420, maximum: 620), spacing: 12)], spacing: 12) {
                    ForEach(unclassifiedHotels) { hotel in
                        hotelRow(hotel)
                    }
                }
            } else {
                ForEach(unclassifiedHotels) { hotel in
                    hotelRow(hotel)
                }
            }
        }
        .padding(16)
        .businessCard(radius: 28)
    }

    private func hotelRow(_ hotel: HotelListItem) -> some View {
        NavigationLink {
            HotelAdminDetailView(hotelID: hotel.id) {
                Task { await load() }
            }
        } label: {
            HStack(alignment: .center, spacing: 12) {
                ZStack {
                    BusinessDesign.secondarySurface
                    if let imageURL = AppConfig.absoluteURL(hotel.coverImageURL) {
                        AsyncImage(url: imageURL) { phase in
                            if let image = phase.image {
                                image
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: 76, height: 82)
                                    .clipped()
                            } else {
                                Image(systemName: "building.2.fill")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    } else {
                        Image(systemName: "building.2.fill")
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(width: 76, height: 82)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .layoutPriority(0)

                VStack(alignment: .leading, spacing: 6) {
                    Text(hotel.name)
                        .font(.subheadline.bold())
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)

                    HStack(spacing: 6) {
                        if let stars = hotel.stars {
                            Text("\(stars)★")
                        }
                        Text(hotel.city)
                        Text("·")
                        Label("\(hotel.imageCount)", systemImage: "photo")
                        Text("·")
                        Label("\(hotel.roomCount)", systemImage: "bed.double")
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)

                    hotelPriceLine(hotel)

                    HStack(spacing: 7) {
                        if let rating = hotel.rating {
                            Label(rating.formatted(.number.precision(.fractionLength(1))), systemImage: "star.fill")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }
                        statusPill(hotel)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .layoutPriority(1)

                Image(systemName: "chevron.right")
                    .font(.caption.bold())
                    .foregroundStyle(.tertiary)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(BusinessDesign.tertiarySurface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
    }

    @ViewBuilder
    private func hotelPriceLine(_ hotel: HotelListItem) -> some View {
        if let price = hotel.price, let nightly = price.nightlyUSD, price.hasUsablePrice {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Text(nightly.formatted(.currency(code: "USD").precision(.fractionLength(0))))
                        .font(.subheadline.weight(.bold))
                        .monospacedDigit()
                        .fixedSize(horizontal: true, vertical: false)
                    Text("/ ночь")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if price.status == "stale" {
                        Image(systemName: "clock.arrow.circlepath")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                    }
                }
                if let provider = hotel.sourceProvider ?? price.provider {
                    Text(provider)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        } else if let price = hotel.price, price.status == "pending" {
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Обновляем цену")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        } else if hotel.price?.status == "failed" {
            Label("Цена пока недоступна", systemImage: "exclamationmark.triangle")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.orange)
        } else {
            Text("Цена появится после импорта")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
    }

    private func statusPill(_ hotel: HotelListItem) -> some View {
        let live = hotel.status == "published"
        let failed = hotel.lifecycleState == "failed"
        let text = live ? "LIVE" : (hotel.lifecycleState?.uppercased() ?? "DRAFT")
        return Text(text)
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(live ? .green : (failed ? .red : .secondary))
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background((live ? Color.green : (failed ? Color.red : Color.gray)).opacity(0.08), in: Capsule())
    }

    @ViewBuilder private var placeholder: some View {
        BusinessDesign.secondarySurface
            .overlay(Image(systemName: "building.2.fill").foregroundStyle(.secondary))
    }

    @ViewBuilder
    private func importJobCard(_ job: HotelImportJob) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(job.hotelName)
                        .font(.subheadline.bold())
                        .lineLimit(2)
                    Text(importStatusText(job))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(job.status == "failed" ? .red : .secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                if job.isActive {
                    Text("\(job.progress)%")
                        .font(.caption.monospacedDigit().weight(.semibold))
                        .foregroundStyle(.secondary)
                } else if job.status == "completed" {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                }
            }

            if job.isActive {
                ProgressView(value: Double(job.progress), total: 100)
                    .tint(BusinessDesign.ink)
            }

            Text(importStageDetail(job))
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if let warning = job.warning, !warning.isEmpty {
                Label(warning, systemImage: "exclamationmark.triangle")
                    .font(.caption2)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let error = job.error, job.status == "failed" {
                Text(error)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(4)
            }

            HStack(spacing: 8) {
                if job.isActive {
                    Button(role: .destructive) { Task { await cancelJob(job) } } label: {
                        Label("Остановить", systemImage: "stop.circle")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(jobActionID == job.id)
                } else if job.status == "failed" {
                    Button { Task { await retryJob(job) } } label: {
                        Label("Повторить", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BusinessDesign.primaryControl)
                    .controlSize(.small)
                    .disabled(jobActionID == job.id)
                }

                if !job.isActive {
                    Button(role: .destructive) { Task { await deleteJob(job) } } label: {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(jobActionID == job.id)
                }

                Spacer()
                if jobActionID == job.id { ProgressView().controlSize(.small) }
            }
        }
        .padding(12)
        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func importStatusText(_ job: HotelImportJob) -> String {
        switch job.stage {
        case "cancelled": return "Остановлен"
        case "stale_recovered": return "Зависший импорт остановлен автоматически"
        default: break
        }
        switch job.status {
        case "queued": return "В очереди"
        case "running": return "Фоновая загрузка"
        case "completed": return job.stage == "completed_with_warnings" ? "Готово · с предупреждением" : (job.publishWhenComplete ? "Готово · опубликован" : "Готово · черновик")
        case "failed": return "Ошибка · можно повторить или удалить"
        default: return job.status
        }
    }

    private func importStageDetail(_ job: HotelImportJob) -> String {
        let stage: String
        switch job.stage {
        case "queued", "retry_queued": stage = "ожидает серверную очередь"
        case "preparing_media": stage = "подготавливаем фотографии"
        case "downloading_image": stage = "скачиваем исходную фотографию"
        case "optimizing_image": stage = "сжимаем фотографию"
        case "saving_to_r2": stage = "сохраняем в R2"
        case "media_progress": stage = "обрабатываем фотографии"
        case "image_retry_exhausted": stage = "одна фотография недоступна, продолжаем"
        case "completed": stage = "импорт завершён"
        case "completed_with_warnings": stage = "импорт завершён с предупреждением"
        case "integrity_failed": stage = "проверка целостности не пройдена"
        case "stale_recovered": stage = "сервер обнаружил отсутствие heartbeat и остановил зависший Workflow"
        case "cancelled": stage = "остановлено администратором"
        case "start_failed": stage = "не удалось запустить Cloudflare Workflow"
        default: stage = job.stage.replacingOccurrences(of: "_", with: " ")
        }
        var parts = ["\(job.storedImages)/\(job.totalImages) фото", stage]
        if let current = job.currentImage, current > 0, job.isActive { parts.append("№\(current) из \(job.totalImages)") }
        if let label = job.currentImageLabel, !label.isEmpty, job.isActive { parts.append(label) }
        if let mode = job.compressionMode, !mode.isEmpty {
            parts.append(mode == "provider-sized-fallback-v1" ? "provider-compressed" : "WebP")
        }
        if (job.retryCount ?? 0) > 0 { parts.append("retry \(job.retryCount ?? 0)") }
        return parts.joined(separator: " · ")
    }

    @MainActor func load() async {
        guard !Task.isCancelled else { return }
        let generation = UUID()
        loadGeneration = generation
        loading = true
        backendUnavailable = false
        backendMessage = nil
        defer { if loadGeneration == generation { loading = false } }

        // Independent reads run concurrently; an unavailable catalogue must not
        // prevent the health or import-job sections from receiving their results.
        async let catalogue = APIClient.shared.hotels()
        async let health = APIClient.shared.hotelCloudHealth()
        async let jobs = APIClient.shared.hotelImportJobs()
        do {
            let resolved = try await catalogue
            guard !Task.isCancelled, loadGeneration == generation else { return }
            hotels = resolved
            showingCachedCatalog = false
        } catch {
            guard !Task.isCancelled, loadGeneration == generation else { return }
            backendUnavailable = true
            backendMessage = error.localizedDescription
            showingCachedCatalog = !hotels.isEmpty
        }
        let resolvedHealth = try? await health
        guard !Task.isCancelled, loadGeneration == generation else { return }
        cloudHealth = resolvedHealth
        do {
            let resolvedJobs = try await jobs
            guard !Task.isCancelled, loadGeneration == generation else { return }
            importJobs = resolvedJobs
            importJobsError = nil
        } catch {
            guard !Task.isCancelled, loadGeneration == generation else { return }
            importJobsError = "Не удалось получить прогресс импортов: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func monitorImports() async {
        var previousActive = Set(importJobs.filter(\.isActive).map(\.id))
        while !Task.isCancelled {
            let hasActive = importJobs.contains(where: \.isActive)
            do { try await Task.sleep(for: .seconds(hasActive ? 3 : 20)) } catch { return }
            guard !Task.isCancelled, scenePhase == .active, !loading, jobActionID == nil else { continue }
            let generation = loadGeneration
            do {
                let jobs = try await APIClient.shared.hotelImportJobs()
                guard !Task.isCancelled else { return }
                guard loadGeneration == generation, jobActionID == nil else { continue }
                let currentActive = Set(jobs.filter(\.isActive).map(\.id))
                let finishedSomething = !previousActive.subtracting(currentActive).isEmpty
                previousActive = currentActive
                importJobs = jobs
                importJobsError = nil
                await BusinessNotifications.trackActiveHotelImports(jobs)
                await BusinessNotifications.notifyUnseenTerminalJobs(jobs)
                if finishedSomething { await load() }
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                guard loadGeneration == generation, jobActionID == nil else { continue }
                importJobsError = "Прогресс временно недоступен: \(error.localizedDescription)"
            }
        }
    }

    @MainActor private func retryJob(_ job: HotelImportJob) async {
        guard jobActionID == nil else { return }
        jobActionID = job.id
        loadGeneration = UUID()
        loading = false
        defer { jobActionID = nil }
        do {
            let retried = try await APIClient.shared.retryHotelImportJob(id: job.id)
            await BusinessNotifications.hotelImportStarted(retried)
            await load()
        } catch { importJobsError = error.localizedDescription }
    }

    @MainActor private func cancelJob(_ job: HotelImportJob) async {
        guard jobActionID == nil else { return }
        jobActionID = job.id
        loadGeneration = UUID()
        loading = false
        defer { jobActionID = nil }
        do {
            _ = try await APIClient.shared.cancelHotelImportJob(id: job.id)
            await load()
        } catch { importJobsError = error.localizedDescription }
    }

    @MainActor private func deleteJob(_ job: HotelImportJob) async {
        guard jobActionID == nil else { return }
        jobActionID = job.id
        loadGeneration = UUID()
        loading = false
        defer { jobActionID = nil }
        do {
            try await APIClient.shared.deleteHotelImportJob(id: job.id)
            importJobs.removeAll { $0.id == job.id }
            await load()
        } catch { importJobsError = error.localizedDescription }
    }

}

private struct HotelCountCard: View {
    let title: String
    let count: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased())
                .font(.caption2.bold())
                .tracking(1.5)
                .foregroundStyle(.secondary)
            Spacer(minLength: 12)
            Text("\(count)")
                .font(.system(size: 38, weight: .bold, design: .rounded))
                .tracking(-1.5)
            Text("hotels")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(18)
        .frame(maxWidth: .infinity, minHeight: 126, alignment: .leading)
        .businessCard(radius: 26)
    }
}

private struct AddHotelView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var sourceURLs = Array(repeating: "", count: 4)
    @State private var importRequest: ImportRequest?
    @State private var duplicateMessages: [Int: String] = [:]
    @State private var duplicateTasks: [Int: Task<Void, Never>] = [:]

    struct ImportRequest: Identifiable {
        let id = UUID()
        let urls: [String]
    }

    private var validURLs: [String] {
        sourceURLs.enumerated().compactMap { index, raw in
            guard duplicateMessages[index] == nil else { return nil }
            let clean = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            return provider(for: clean) == nil ? nil : clean
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Добавить отели")
                            .font(.system(size: 38, weight: .bold, design: .rounded))
                            .tracking(-1.4)
                        Text("До четырёх прямых ссылок Booking или Expedia. Importer читает их строго по очереди и никогда не смешивает карточки.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    VStack(alignment: .leading, spacing: 13) {
                        ForEach(sourceURLs.indices, id: \.self) { index in
                            hotelURLField(index: index)
                        }
                    }
                    .padding(16)
                    .businessCard(radius: 26)

                    VStack(alignment: .leading, spacing: 12) {
                        importFeature("doc.text.magnifyingglass", "Полная карточка", "Рейтинг, отзывы числом, описание, сервисы, правила, сборы и все доступные property details")
                        importFeature("mappin.and.ellipse", "Локация", "Координаты, Google Maps и расстояния/время до Каабы и других мест, если источник их показывает")
                        importFeature("photo.stack", "Фотографии", "Только hotel-media конкретной страницы; загрузка в R2 после подтверждения идёт уже на Cloudflare")
                        importFeature("bed.double", "Номера", "FAQ, парковка и другие посторонние строки больше не могут попасть в список номеров")
                    }
                    .padding(16)
                    .businessCard(radius: 26)

                    Button {
                        guard !validURLs.isEmpty else { return }
                        importRequest = ImportRequest(urls: validURLs)
                    } label: {
                        Label("Подготовить \(validURLs.count) \(validURLs.count == 1 ? "отель" : "отеля")", systemImage: "arrow.down.doc.fill")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .frame(height: 56)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BusinessDesign.primaryControl)
                    .disabled(validURLs.isEmpty)
                }
                .padding(.vertical, 18)
            }
            .contentMargins(.horizontal, 18, for: .scrollContent)
            .background(BusinessDesign.background)
            .navigationTitle("")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    BusinessBrandLogo(width: 118)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Закрыть") { dismiss() }
                }
            }
            .fullScreenCover(item: $importRequest) { request in
                HotelBatchImportView(sourceURLs: request.urls)
            }
        }
    }

    @ViewBuilder
    private func hotelURLField(index: Int) -> some View {
        let value = sourceURLs[index]
        let detected = provider(for: value)

        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("ССЫЛКА \(index + 1)")
                    .font(.caption2.bold())
                    .tracking(1.4)
                    .foregroundStyle(.secondary)
                Spacer()
                if let detected {
                    Label(detected.rawValue, systemImage: detected.sourceIcon)
                        .font(.caption2.bold())
                        .foregroundStyle(.secondary)
                }
            }

            HStack(spacing: 10) {
                Image(systemName: "link")
                    .foregroundStyle(.secondary)
                TextField(index == 0 ? "Вставьте ссылку отеля" : "Ещё одна ссылка — необязательно", text: $sourceURLs[index], axis: .vertical)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .lineLimit(1...3)
                    .onChange(of: sourceURLs[index]) { _, newValue in
                        scheduleDuplicateCheck(index: index, value: newValue)
                    }
                Button {
                    if let pasted = UIPasteboard.general.string {
                        sourceURLs[index] = pasted
                        scheduleDuplicateCheck(index: index, value: pasted)
                    }
                } label: {
                    Image(systemName: "doc.on.clipboard")
                        .foregroundStyle(.primary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 13)
            .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 17, style: .continuous))

            if let message = duplicateMessages[index] {
                Label(message, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            } else if !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && detected == nil {
                Label("Нужна ссылка Booking или Expedia", systemImage: "exclamationmark.circle")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    private func scheduleDuplicateCheck(index: Int, value: String) {
        duplicateTasks[index]?.cancel()
        duplicateMessages[index] = nil
        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard provider(for: clean) != nil else { return }
        duplicateTasks[index] = Task {
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled else { return }
            do {
                if let duplicate = try await APIClient.shared.checkHotelSourceDuplicate(clean) {
                    await MainActor.run {
                        duplicateMessages[index] = "Уже в базе: \(duplicate.name)"
                    }
                }
            } catch {
                // Full identity dedupe is repeated after the property page is read.
            }
        }
    }

    private func provider(for rawValue: String) -> HotelImportCoordinator.Provider? {
        var text = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if !text.lowercased().hasPrefix("http://") && !text.lowercased().hasPrefix("https://") { text = "https://\(text)" }
        guard let url = URL(string: text) else { return nil }
        return HotelImportCoordinator.Provider.detect(from: url)
    }

    private func importFeature(_ symbol: String, _ title: String, _ subtitle: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .semibold))
                .frame(width: 30, height: 30)
                .background(BusinessDesign.secondarySurface, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.bold())
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}
