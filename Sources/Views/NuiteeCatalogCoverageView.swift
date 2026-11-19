import SwiftUI

struct NuiteeCatalogCoverageEnvelope: Decodable {
    let ok: Bool
    let sandbox: Bool
    let cities: [City]
    struct City: Decodable, Identifiable {
        var id: String { city }
        let city: String
        let stored: Int
        let supplierUnique: Int?
        let unknownStars: Int
        let complete: Bool
        let stale: Bool
        let syncedAt: Double?
        let lastError: String?
        let priceCheckin: String
        let priceCheckout: String
        let priced: Int
        let priceAdults: Int
    }
}

struct NuiteeCatalogCoverageView: View {
    @State private var report: NuiteeCatalogCoverageEnvelope?
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Каталог Nuitee").font(.largeTitle.bold())
                Text("Один каталог для всех конфигураторов. Количество отражает уникальные ID, полученные при синхронизации, а не гарантированное наличие номеров.")
                    .font(.subheadline).foregroundStyle(.secondary)
                if let report {
                    Text(report.sandbox ? "Sandbox" : "Production").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(report.cities) { city in
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text(city.city == "makkah" ? "Мекка" : "Медина").font(.title2.bold())
                                Spacer()
                                Label(city.complete ? "Синхронизировано" : "Требует проверки", systemImage: city.complete ? "checkmark.circle" : "exclamationmark.circle")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            row("Получено уникальных ID", city.supplierUnique.map(String.init) ?? "—")
                            row("Сохранено отелей", String(city.stored))
                            row("Без звёзд", String(city.unknownStars))
                            Divider()
                            row("Цены в свежем кэше", "\(city.priced) / \(city.stored)")
                            Text("\(city.priceCheckin) — \(city.priceCheckout) · \(city.priceAdults) взрослых · 1 номер")
                                .font(.caption).foregroundStyle(.secondary)
                            if let timestamp = city.syncedAt {
                                Text("Синхронизация: " + Date(timeIntervalSince1970: timestamp / 1000).formatted(date: .abbreviated, time: .shortened))
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            if let last = city.lastError { Text(last).font(.caption).foregroundStyle(.secondary) }
                        }.padding(16).background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 22))
                    }
                }
                if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
                Button { Task { await load(refresh: true) } } label: {
                    HStack { if loading { ProgressView() }; Text("Синхронизировать каталог") }.frame(maxWidth: .infinity)
                }.buttonStyle(.borderedProminent).disabled(loading)
                Text("Синхронизация обновляет список и метаданные. Цены получаются отдельно для дат и состава гостей; эта кнопка не покупает номера.")
                    .font(.caption).foregroundStyle(.secondary)
            }.padding(18).frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(BusinessDesign.background)
        .navigationTitle("Nuitee")
        .navigationBarTitleDisplayMode(.inline)
        .task { if report == nil { await load() } }
        .refreshable { await load() }
    }
    private func row(_ label: String, _ value: String) -> some View {
        HStack { Text(label).foregroundStyle(.secondary); Spacer(); Text(value).fontWeight(.semibold).monospacedDigit() }.font(.subheadline)
    }
    @MainActor private func load(refresh: Bool = false) async {
        guard !loading else { return }
        loading = true; error = nil
        defer { loading = false }
        do { let value = try await APIClient.shared.nuiteeCatalogCoverage(refresh: refresh); guard !Task.isCancelled else { return }; report = value }
        catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
}
