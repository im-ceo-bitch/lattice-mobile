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
    var inline = false
    init(fixedCity: String? = nil, onSelect: ((BusinessNuiteeHotel) -> Void)? = nil, inline: Bool = false) { self.fixedCity = fixedCity; self.onSelect = onSelect; self.inline = inline }
    private var key: String { "iumrah.business.nuitee.favorites." + (auth.user?.login ?? "") }
    private var scope: String { (fixedCity ?? city) + "|" + query + "|" + String(stars) }
    var body: some View {
        Group {
            if inline { catalogContent }
            else { ScrollView { catalogContent.padding(18) }.navigationTitle("Отели · Nuitee").navigationBarTitleDisplayMode(.inline).businessNavigationSurface().refreshable { await load(reset: true) } }
        }
        .onAppear { favorites = Set(UserDefaults.standard.stringArray(forKey: key) ?? []) }
        .task(id: scope) { try? await Task.sleep(for: .milliseconds(250)); if !Task.isCancelled { await load(reset: true) } }
    }
    private var catalogContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            if fixedCity == nil { Picker("Город", selection: $city) { Text("Мекка").tag("makkah"); Text("Медина").tag("madinah") }.pickerStyle(.segmented) }
            TextField("Найти отель", text: $query).textFieldStyle(.roundedBorder).submitLabel(.search)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach([0, 3, 4, 5, 1, 2], id: \.self) { value in
                        Button { stars = value } label: {
                            Text(value == 0 ? "Все" : "\(value) ★").font(.subheadline.weight(.semibold)).padding(.horizontal, 12).padding(.vertical, 9).foregroundStyle(stars == value ? BusinessDesign.onAccent : BusinessDesign.ink).background(stars == value ? BusinessDesign.accent : BusinessDesign.secondarySurface, in: Capsule())
                        }.buttonStyle(.plain).accessibilityAddTraits(stars == value ? .isSelected : [])
                    }
                }
            }
            hotelEditorial
            Toggle("Избранные на этом устройстве", isOn: $onlyFavorites)
            if onSelect == nil { NavigationLink { NuiteeCatalogCoverageView() } label: { Label("Синхронизация и покрытие", systemImage: "arrow.triangle.2.circlepath") } }
            if sandbox { Label("Тестовый каталог Sandbox", systemImage: "exclamationmark.triangle").foregroundStyle(.orange) }
            if stale { Text("Каталог из кэша. Актуальность нужно проверить.").font(.caption).foregroundStyle(.secondary) }
            Text(total.map { "Отели · \($0)" } ?? "Отели").font(.headline)
            if let error { Text(error).font(.footnote).foregroundStyle(.secondary); Button("Повторить") { Task { await load(reset: true) } } }
            let visible = hotels.filter { !onlyFavorites || favorites.contains($0.id) }
            if visible.isEmpty && !loading && error == nil { Text("Нет отелей по выбранному фильтру. Измените условия поиска.").font(.subheadline).foregroundStyle(.secondary) }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), spacing: 12)], spacing: 12) {
                ForEach(visible) { hotel in
                    VStack(alignment: .leading, spacing: 8) {
                        if let onSelect {
                            Button { onSelect(hotel) } label: { hotelRow(hotel) }.buttonStyle(.plain).disabled(sandbox || loading)
                        } else { NavigationLink { BusinessNuiteeRateInspector(hotel: hotel) } label: { hotelRow(hotel) }.buttonStyle(.plain) }
                        Button { if favorites.contains(hotel.id) { favorites.remove(hotel.id) } else { favorites.insert(hotel.id) }; UserDefaults.standard.set(Array(favorites), forKey: key) } label: { Label(favorites.contains(hotel.id) ? "В избранном" : "В избранное", systemImage: favorites.contains(hotel.id) ? "heart.fill" : "heart").font(.caption).frame(minHeight: 32) }.buttonStyle(.plain)
                    }.padding(10).businessCard(radius: 18)
                }
            }
            if loading { ProgressView().frame(maxWidth: .infinity) }
            if next != nil && !loading { Button("Загрузить ещё") { Task { await load(reset: false) } }.buttonStyle(BusinessActionStyle(primary: false)) }
            if onlyFavorites { Text("Избранные фильтруются по загруженным страницам.").font(.caption).foregroundStyle(.secondary) }
        }
    }
    private var hotelEditorial: some View {
        let makkah = (fixedCity ?? city) == "makkah"
        let title: String = stars == 4 ? "Баланс комфорта, расположения и стоимости" : stars == 5 ? "Максимум комфорта. Больше времени для поклонения." : stars > 0 ? "Разумный выбор для вашей умры" : "Проживание под ваши пожелания"
        let detail: String = stars == 4 ? "Комфортное проживание с возможностью подобрать удобное расположение и сохранить разумный бюджет." : stars == 5 ? "Выбирайте премиальные номера, высокий уровень сервиса и удобное расположение." : "Сравните расположение, номер и питание, чтобы подобрать подходящий вариант для вашей семьи."
        let note = makkah && stars == 4 ? "Встречаются варианты в 100–200 м от Харама. Некоторые отели, в том числе voco и Courtyard by Marriott, могут быть расположены дальше; расстояние уточняйте по конкретному объекту." : "Звёздность не гарантирует близость к мечети. Проверяйте расположение и условия выбранного тарифа."
        return StudioEditorialBlock(title: title, detail: detail, note: note, symbol: "building.2")
    }
    private func hotelRow(_ hotel: BusinessNuiteeHotel) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            AsyncImage(url: AppConfig.absoluteURL(hotel.photo)) { image in image.resizable().scaledToFill() } placeholder: { Color.gray.opacity(0.12).overlay { Image(systemName: "building.2").font(.largeTitle).foregroundStyle(.secondary) } }.frame(maxWidth: .infinity).frame(height: 145).clipped().clipShape(RoundedRectangle(cornerRadius: 12))
            Text(hotel.starCount.map { String(repeating: "★", count: $0) } ?? "Категория не указана").font(.caption).foregroundStyle(.secondary)
            Text(hotel.name).font(.headline).foregroundStyle(.primary).fixedSize(horizontal: false, vertical: true)
            if let address = hotel.address, !address.isEmpty { Text(address).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
            Text(onSelect == nil ? "Проверить тарифы" : "Выбрать отель").font(.subheadline.weight(.semibold)).foregroundStyle(BusinessDesign.ink).padding(.vertical, 6)
        }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
    }
    @MainActor private func load(reset: Bool) async {
        if !reset && loading { return }
        let requestedScope = scope; let token = UUID(); generation = token; loading = true; error = nil
        if reset { hotels = []; next = nil; total = nil }
        defer { if generation == token { loading = false } }
        do {
            let value = try await APIClient.shared.businessNuiteePage(city: fixedCity ?? city, query: query, stars: stars, offset: reset ? 0 : next ?? 0)
            guard generation == token, scope == requestedScope, !Task.isCancelled else { return }
            let known = Set(hotels.map(\.id)); hotels += value.hotels.filter { !known.contains($0.id) }; next = value.nextOffset; total = value.total; sandbox = value.sandbox; stale = value.hotelCatalogStale
        } catch { if generation == token && scope == requestedScope && !Task.isCancelled { self.error = error.localizedDescription } }
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
                        Text(rate.price, format: .currency(code: rate.currency)).font(.title3.bold())
                        Text(rate.refundable ? "Возвратный тариф · условия уточнить" : "Невозвратный или ограниченный тариф").font(.caption).foregroundStyle(.secondary)
                        if rate.currency.uppercased() != "USD" { Text("Для расчёта в USD подтвердите цену отдельно.").font(.caption).foregroundStyle(.secondary) }
                        if let select, !result.sandbox, result.availabilityConfirmed, rate.currency.uppercased() == "USD", rate.price.isFinite, rate.price > 0 { Button("Перенести в расчёт") { if let observedAt, Date().timeIntervalSince(observedAt) < 600 { select(rate) } else { self.result = nil; error = "Тариф устарел. Проверьте цену ещё раз." } }.buttonStyle(.bordered) }
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
