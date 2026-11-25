import SwiftUI
import Foundation

struct BusinessNuiteeHotel: Decodable, Identifiable {
    let id: String
    let name: String
    let city: String?
    let address: String?
    let stars: Double?
    let coverImageURL: String?
    let rating: Double?
    let previewImages: [String]?
    var starCount: Int? { guard let stars, stars.isFinite, stars >= 1, stars <= 5 else { return nil }; return Int(stars.rounded()) }
    var photo: String? { coverImageURL ?? previewImages?.first }
}
struct BusinessNuiteePage: Decodable {
    let hotels: [BusinessNuiteeHotel]
    let total: Int
    let nextOffset: Int?
    let sandbox: Bool
    let hotelCatalogStale: Bool
}
struct BusinessNuiteeRate: Decodable, Identifiable {
    let offerId: String
    let roomId: String
    let roomName: String
    let mealPlan: String
    let price: Double
    let currency: String
    let refundable: Bool
    let cancellationDescription: String?
    var id: String { offerId + ":" + roomId + ":" + mealPlan + ":" + String(price) }
}
struct BusinessNuiteeRates: Decodable {
    let sandbox: Bool
    let rates: [BusinessNuiteeRate]
    let availabilityConfirmed: Bool
}
extension APIClient {
    func businessNuiteePage(city: String, query: String, stars: Int, offset: Int) async throws -> BusinessNuiteePage {
        var url = URLComponents(url: AppConfig.apiBaseURL.appending(path: "/api/package/nuitee/hotels"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "city", value: city), .init(name: "query", value: query), .init(name: "stars", value: String(stars)), .init(name: "offset", value: String(offset)), .init(name: "pageSize", value: "30"), .init(name: "catalogOnly", value: "1")]
        let (data, response) = try await perform(from: url.url!)
        try validate(response, data: data)
        return try decoder.decode(BusinessNuiteePage.self, from: data)
    }
    func businessNuiteeRates(id: String, checkIn: Date, checkOut: Date, adults: Int) async throws -> BusinessNuiteeRates {
        let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd"; formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(identifier: "Asia/Riyadh")
        return try await offerRequest(path: "/api/package/nuitee/rates", method: "POST", payload: ["hotelId":id,"checkin":formatter.string(from:checkIn),"checkout":formatter.string(from:checkOut),"adults":adults,"language":"ru"])
    }
}
struct BusinessNuiteeHotelsView: View {
    @State private var city = "makkah"
    @State private var query = ""
    @State private var stars = 0
    @State private var hotels: [BusinessNuiteeHotel] = []
    @State private var next: Int?
    @State private var total: Int?
    @State private var loading = false
    @State private var error: String?
    @State private var sandbox = false
    @State private var stale = false
    @State private var generation = UUID()
    @State private var favorites: Set<String> = []
    @State private var onlyFavorites = false
    @EnvironmentObject private var auth: AuthStore
    var fixedCity: String? = nil
    var onSelect: ((BusinessNuiteeHotel) -> Void)? = nil
    init(fixedCity: String? = nil, onSelect: ((BusinessNuiteeHotel) -> Void)? = nil) { self.fixedCity = fixedCity; self.onSelect = onSelect }
    private var key: String { "iumrah.business.nuitee.favorites." + (auth.user?.login ?? "") }
    private var scope: String { (fixedCity ?? city) + "|" + query + "|" + String(stars) }
    var body: some View {
        List {
            Section {
                if fixedCity == nil {
                    Picker("Город", selection: $city) { Text("Мекка").tag("makkah"); Text("Медина").tag("madinah") }.pickerStyle(.segmented)
                }
                Picker("Категория", selection: $stars) { Text("Все").tag(0); ForEach(1...5, id: \.self) { Text("\($0) ★").tag($0) } }
                Toggle("Избранные на этом устройстве", isOn: $onlyFavorites)
                if onSelect == nil { NavigationLink { NuiteeCatalogCoverageView() } label: { Label("Синхронизация и покрытие", systemImage: "arrow.triangle.2.circlepath") } }
                if sandbox { Label("Тестовый каталог Sandbox", systemImage: "exclamationmark.triangle").foregroundStyle(.orange) }
                if stale { Text("Каталог из кэша. Актуальность нужно проверить.").font(.caption).foregroundStyle(.secondary) }
            }
            Section(total.map { "Отели · \($0)" } ?? "Отели") {
                if let error { Text(error).font(.footnote).foregroundStyle(.secondary); Button("Повторить") { Task { await load(reset: true) } } }
                if hotels.isEmpty && !loading && error == nil { ContentUnavailableView("Нет отелей", systemImage: "building.2", description: Text("Измените фильтр или обновите каталог.")) }
                ForEach(hotels.filter { !onlyFavorites || favorites.contains($0.id) }) { hotel in
                    HStack(spacing: 10) {
                        if let onSelect {
                            Button { onSelect(hotel) } label: { hotelRow(hotel) }.buttonStyle(.plain).disabled(sandbox)
                        } else {
                            NavigationLink { BusinessNuiteeRateInspector(hotel: hotel) } label: { hotelRow(hotel) }
                        }
                        Button { if favorites.contains(hotel.id) { favorites.remove(hotel.id) } else { favorites.insert(hotel.id) }; UserDefaults.standard.set(Array(favorites), forKey: key) } label: { Image(systemName: favorites.contains(hotel.id) ? "heart.fill" : "heart").frame(width: 36, height: 44) }.buttonStyle(.borderless).accessibilityLabel("Избранное")
                    }
                }
                if loading { ProgressView().frame(maxWidth: .infinity) }
                if next != nil && !loading { Button("Загрузить ещё") { Task { await load(reset: false) } } }
                if onlyFavorites { Text("Избранные фильтруются по загруженным страницам.").font(.caption).foregroundStyle(.secondary) }
            }
        }
        .navigationTitle("Отели · Nuitee").navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
        .searchable(text: $query, prompt: "Название отеля")
        .onAppear { favorites = Set(UserDefaults.standard.stringArray(forKey: key) ?? []) }
        .task(id: scope) { try? await Task.sleep(for: .milliseconds(250)); if !Task.isCancelled { await load(reset: true) } }
        .refreshable { await load(reset: true) }
    }
    private func hotelRow(_ hotel: BusinessNuiteeHotel) -> some View {
        HStack(spacing: 12) {
            AsyncImage(url: AppConfig.absoluteURL(hotel.photo)) { image in image.resizable().scaledToFill() } placeholder: { Color.gray.opacity(0.12).overlay { Image(systemName: "building.2").foregroundStyle(.secondary) } }.frame(width: 74, height: 66).clipShape(RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 4) {
                Text(hotel.name).font(.headline).foregroundStyle(.primary)
                Text(hotel.starCount.map { "\($0) ★" } ?? "Категория не указана").font(.caption).foregroundStyle(.secondary)
                if let address = hotel.address, !address.isEmpty { Text(address).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
            }
            Spacer(minLength: 0)
        }.padding(.vertical, 4)
    }
    @MainActor private func load(reset: Bool) async {
        if !reset && loading { return }
        let token = UUID(); generation = token; loading = true; error = nil
        if reset { hotels = []; next = nil; total = nil }
        defer { if generation == token { loading = false } }
        do {
            let value = try await APIClient.shared.businessNuiteePage(city: fixedCity ?? city, query: query, stars: stars, offset: reset ? 0 : next ?? 0)
            guard generation == token, !Task.isCancelled else { return }
            let known = Set(hotels.map(\.id)); hotels += value.hotels.filter { !known.contains($0.id) }; next = value.nextOffset; total = value.total; sandbox = value.sandbox; stale = value.hotelCatalogStale
        } catch { if generation == token && !Task.isCancelled { self.error = error.localizedDescription } }
    }
}
private struct BusinessNuiteeRateInspector: View {
    let hotel: BusinessNuiteeHotel
    @State private var arrival = Date().addingTimeInterval(86400 * 10)
    @State private var departure = Date().addingTimeInterval(86400 * 15)
    @State private var guests = 2
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(hotel.name).font(.largeTitle.bold())
                if let address = hotel.address { Text(address).foregroundStyle(.secondary) }
                DatePicker("Заезд", selection: $arrival, displayedComponents: .date)
                DatePicker("Выезд", selection: $departure, displayedComponents: .date)
                Stepper("Взрослые: \(guests)", value: $guests, in: 1...6)
                BusinessNuiteeRatePanel(id: hotel.id, checkIn: arrival, checkOut: departure, guests: guests, select: nil)
            }.padding(18)
        }.navigationTitle("Тарифы").scrollDismissesKeyboard(.interactively)
    }
}
struct BusinessNuiteeRatePanel: View {
    let id: String
    let checkIn: Date
    let checkOut: Date
    let guests: Int
    var select: ((BusinessNuiteeRate) -> Void)?
    @State private var result: BusinessNuiteeRates?
    @State private var loading = false
    @State private var error: String?
    @State private var taskID = UUID()
    @State private var observedAt: Date?
    init(id: String, checkIn: Date, checkOut: Date, guests: Int, select: ((BusinessNuiteeRate) -> Void)?) { self.id = id; self.checkIn = checkIn; self.checkOut = checkOut; self.guests = guests; self.select = select }
    private var scope: String { "\(id)|\(checkIn.timeIntervalSince1970)|\(checkOut.timeIntervalSince1970)|\(guests)" }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button { Task { await load() } } label: { Label("Проверить тарифы Nuitee", systemImage: "magnifyingglass") }.buttonStyle(BusinessActionStyle(primary: false)).disabled(loading || checkOut <= checkIn)
            Text("На один номер, весь срок. Наличие не резервируется.").font(.caption).foregroundStyle(.secondary)
            if loading { ProgressView() }
            if let error { Text(error).font(.caption).foregroundStyle(.secondary) }
            if let result {
                if result.sandbox { Text("Sandbox — тестовые тарифы, нельзя использовать для продажи.").font(.caption).foregroundStyle(.orange) }
                if result.rates.isEmpty { Text(result.availabilityConfirmed ? "Нет доступных тарифов" : "Поставщик не подтвердил наличие").font(.subheadline).foregroundStyle(.secondary) }
                ForEach(Array(result.rates.enumerated()), id: \.offset) { _, rate in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(rate.roomName).font(.headline)
                        Text(rate.mealPlan.isEmpty ? "Питание уточнить" : rate.mealPlan).font(.caption)
                        Text(rate.price, format: .currency(code: "USD")).font(.title3.bold())
                        Text(rate.refundable ? "Возвратный тариф · условия уточнить" : "Невозвратный или ограниченный тариф").font(.caption).foregroundStyle(.secondary)
                        if let select, !result.sandbox, result.availabilityConfirmed { Button("Перенести в расчёт") { if let observedAt, Date().timeIntervalSince(observedAt) < 600 { select(rate) } else { self.result = nil; error = "Тариф устарел. Проверьте цену ещё раз." } }.buttonStyle(.bordered) }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(12).businessCard(radius: 16)
                }
            }
        }.onChange(of: scope) { _, _ in taskID = UUID(); result = nil; error = nil; loading = false }
    }
    @MainActor private func load() async {
        let token = UUID(); taskID = token; loading = true; error = nil; result = nil
        defer { if taskID == token { loading = false } }
        do { let value = try await APIClient.shared.businessNuiteeRates(id: id, checkIn: checkIn, checkOut: checkOut, adults: guests); if token == taskID { result = value; observedAt = Date() } }
        catch { if token == taskID { self.error = error.localizedDescription } }
    }
}
