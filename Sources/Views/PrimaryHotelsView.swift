import Foundation
import SwiftUI

struct PrimaryHotelsView: View {
    var tabMode = false
    @Environment(\.dismiss) private var dismiss
    @State private var city = "Makkah"
    @State private var hotels: [HotelListItem] = []
    @State private var assignments: [PrimaryHotelAssignment] = []
    @State private var loading = true
    @State private var loadGeneration = UUID()
    @State private var loadedCity: String?
    @State private var errorMessage: String?
    @State private var priceEditor: PrimaryHotelPriceEditorContext?
    @State private var priceNotice: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Picker("Город", selection: $city) {
                    Text("Makkah").tag("Makkah")
                    Text("Madinah").tag("Madinah")
                }
                .pickerStyle(.segmented)

                VStack(alignment: .leading, spacing: 5) {
                    Text("Primary Hotels").font(.largeTitle.bold())
                    Text("Primary Hotels — отдельный ручной ценовой слой. Они не попадают в ChatGPT Hotel Sync, массовый JSON и автоматическое обновление цены. Для каждого Primary цена задаётся здесь вручную.")
                        .font(.subheadline).foregroundStyle(.secondary)
                }

                if let errorMessage { Text(errorMessage).font(.footnote).foregroundStyle(.red) }

                ForEach(1...5, id: \.self) { stars in
                    NavigationLink {
                        PrimaryHotelCategoryPicker(city: city, stars: stars, hotels: availableHotels(for: stars), selectedIDs: selectedIDs(for: stars)) {
                            Task { await load() }
                        }
                    } label: {
                        categoryCard(stars)
                    }
                    .buttonStyle(.plain)
                    .disabled(loading || loadedCity != city || errorMessage != nil)
                }

                if !primaryPricingAssignments.isEmpty {
                    primaryPricingSection.disabled(loading || loadedCity != city || errorMessage != nil)
                }

                if let priceNotice {
                    Label(priceNotice, systemImage: "checkmark.circle.fill")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.green)
                }
            }
            .businessAdaptiveDetailWidth()
            .padding(18)
        }
        .background(BusinessDesign.background)
        .navigationTitle("")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                if tabMode { BusinessSidebarButton() } else { Button("Закрыть") { dismiss() } }
            }
        }
        .overlay { if loading { ProgressView() } }
        .task { await load() }
        .refreshable { await load() }
        .onChange(of: city) { _, _ in Task { await load(reloadCatalog: false) } }
        .sheet(item: $priceEditor) { context in
            PrimaryHotelManualPriceSheet(context: context) {
                priceNotice = "Ручная цена Primary Hotel сохранена и уже используется как текущая."
                Task { await load() }
            }
        }
    }

    private func selectedIDs(for stars: Int) -> [String] {
        assignments.filter { $0.city.caseInsensitiveCompare(city) == .orderedSame && $0.stars == stars }.sorted { $0.position < $1.position }.map { $0.hotel.id }
    }

    private func availableHotels(for stars: Int) -> [HotelListItem] {
        _ = stars
        return hotels.filter {
            $0.city.caseInsensitiveCompare(city) == .orderedSame && $0.status == "published"
        }
    }

    private var primaryPricingAssignments: [PrimaryHotelAssignment] {
        var seen = Set<String>()
        return assignments
            .filter { $0.city.caseInsensitiveCompare(city) == .orderedSame }
            .sorted { lhs, rhs in
                if lhs.stars != rhs.stars { return lhs.stars < rhs.stars }
                return lhs.position < rhs.position
            }
            .filter { seen.insert($0.hotel.id).inserted }
    }

    private var primaryPricingSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Ручные цены Primary Hotels")
                    .font(.title3.bold())
                Text("Эти отели исключены из ChatGPT и массового мониторинга. Цена ниже — единственная цена, которую использует Primary Hotel.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ForEach(primaryPricingAssignments) { item in
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.hotel.name)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(2)
                        HStack(spacing: 6) {
                            Text("Primary")
                            Text("·")
                            if let nightly = item.hotel.price?.nightlyUSD {
                                Text("$\(nightly.formatted(.number.precision(.fractionLength(0...2)))) / ночь")
                                    .foregroundStyle(.primary)
                            } else {
                                Text("ручная цена не задана")
                                    .foregroundStyle(.orange)
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Изменить") {
                        priceEditor = PrimaryHotelPriceEditorContext(
                            hotelID: item.hotel.id,
                            hotelName: item.hotel.name,
                            city: item.city,
                            currentNightlyUSD: item.hotel.price?.nightlyUSD
                        )
                    }
                    .buttonStyle(.bordered)
                    .font(.caption.weight(.semibold))
                }
                .padding(.vertical, 3)
                if item.hotel.id != primaryPricingAssignments.last?.hotel.id { Divider() }
            }
        }
        .padding(16)
        .businessCard(radius: 26)
    }

    private func categoryCard(_ stars: Int) -> some View {
        let selected = assignments.filter { $0.city.caseInsensitiveCompare(city) == .orderedSame && $0.stars == stars }.sorted { $0.position < $1.position }
        return VStack(alignment: .leading, spacing: 12) {
            HStack { Text(String(repeating: "★", count: stars)).font(.headline); Spacer(); Text("\(selected.count)/3").foregroundStyle(.secondary); Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(.tertiary) }
            if selected.isEmpty { Text("Не настроено").foregroundStyle(.secondary) }
            else {
                ForEach(selected) { item in
                    HStack(spacing: 10) {
                        if let url = AppConfig.absoluteURL(item.hotel.coverImageURL) {
                            AsyncImage(url: url) { image in
                                image.resizable().scaledToFill()
                            } placeholder: {
                                BusinessDesign.secondarySurface
                            }
                            .frame(width: 46, height: 46)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.hotel.name).font(.subheadline.weight(.semibold)).lineLimit(2)
                            if let nightly = item.hotel.price?.nightlyUSD {
                                Text("Ручная цена · $\(nightly.formatted(.number.precision(.fractionLength(0...2))))")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            } else {
                                Text("Ручная цена не задана")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(.orange)
                            }
                        }
                        Spacer()
                    }
                }
            }
        }
        .padding(16).businessCard(radius: 26)
    }

    @MainActor private func load(reloadCatalog: Bool = true) async {
        let generation = UUID()
        loadGeneration = generation
        let requestedCity = city
        loading = true
        defer { if loadGeneration == generation { loading = false } }
        do {
            async let primaryRequest = APIClient.shared.primaryHotels(city: requestedCity)
            // Switching cities only changes assignments; the hotel catalogue covers both.
            let resolvedHotels: [HotelListItem]
            if reloadCatalog || hotels.isEmpty { resolvedHotels = try await APIClient.shared.hotels() }
            else { resolvedHotels = hotels }
            let resolvedAssignments = try await primaryRequest
            guard !Task.isCancelled, loadGeneration == generation, city == requestedCity else { return }
            hotels = resolvedHotels
            assignments = resolvedAssignments
            loadedCity = requestedCity
            errorMessage = nil
        } catch {
            guard !Task.isCancelled, loadGeneration == generation, city == requestedCity else { return }
            errorMessage = error.localizedDescription
            // Do not offer editing from another city's stale selection.
            assignments = []
            loadedCity = nil
        }
    }
}

private struct PrimaryHotelPriceEditorContext: Identifiable {
    let hotelID: String
    let hotelName: String
    let city: String
    let currentNightlyUSD: Double?
    var id: String { hotelID }
}

private struct PrimaryHotelManualPriceSheet: View {
    let context: PrimaryHotelPriceEditorContext
    let onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var priceText: String
    @State private var saving = false
    @State private var errorMessage: String?

    init(context: PrimaryHotelPriceEditorContext, onSaved: @escaping () -> Void) {
        self.context = context
        self.onSaved = onSaved
        _priceText = State(initialValue: context.currentNightlyUSD.map { String(format: "%.2f", $0).replacingOccurrences(of: ".00", with: "") } ?? "")
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(context.hotelName)
                        .font(.title3.bold())
                    Text("\(context.city) · Primary Hotel · только ручная цена")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Цена за ночь · USD")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    HStack(spacing: 10) {
                        Text("$").font(.title2.bold())
                        TextField("180", text: $priceText)
                            .keyboardType(.decimalPad)
                            .font(.title2.monospacedDigit())
                    }
                    .padding(.horizontal, 14)
                    .frame(height: 56)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                }

                Text("Эта цена не будет заменена ChatGPT, Hotel Sync, массовым JSON или автоматическим refresh. Она действует, пока Вы не измените её вручную.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                if let errorMessage {
                    Text(errorMessage).font(.footnote).foregroundStyle(.red)
                }

                Button { Task { await save() } } label: {
                    if saving { ProgressView().frame(maxWidth: .infinity) }
                    else { Text("Сохранить ручную цену").font(.headline).frame(maxWidth: .infinity) }
                }
                .frame(height: 54)
                .buttonStyle(.borderedProminent)
                .disabled(saving || parsedPrice == nil)

                Spacer()
            }
            .padding(18)
            .background(BusinessDesign.background)
            .navigationTitle("Цена Primary Hotel")
            .navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Закрыть") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }

    private var parsedPrice: Double? {
        let normalized = priceText.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespacesAndNewlines)
        guard let value = Double(normalized), value >= 1, value <= 10_000 else { return nil }
        return value
    }

    @MainActor private func save() async {
        guard let value = parsedPrice else { return }
        saving = true
        defer { saving = false }
        do {
            _ = try await APIClient.shared.setManualHotelPrice(id: context.hotelID, nightlyUSD: value)
            onSaved()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct PrimaryHotelCategoryPicker: View {
    let city: String
    let stars: Int
    let hotels: [HotelListItem]
    @State var selectedIDs: [String]
    let onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var saving = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section {
                ForEach(hotels) { hotel in
                    Button { toggle(hotel.id) } label: {
                        HStack(spacing: 12) {
                            if let url = AppConfig.absoluteURL(hotel.coverImageURL) {
                                AsyncImage(url: url) { image in
                                    image.resizable().scaledToFill()
                                } placeholder: {
                                    BusinessDesign.secondarySurface
                                }
                                .frame(width: 54, height: 54)
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                Text(hotel.name).font(.headline).foregroundStyle(.primary)
                                HStack(spacing: 6) {
                                    if let actualStars = hotel.stars {
                                        Text("\(actualStars)★")
                                    } else {
                                        Text("Без звёзд")
                                    }
                                    Text("·")
                                    Text("\(hotel.roomCount) номеров")
                                    Text("·")
                                    Text("\(hotel.imageCount) фото")
                                }
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: selectedIDs.contains(hotel.id) ? "checkmark.circle.fill" : "circle").foregroundStyle(selectedIDs.contains(hotel.id) ? BusinessDesign.accent : Color.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                }
            } header: { Text("Выберите до 3 отелей") }
            if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
        }
        .navigationTitle("\(city) · \(stars)★")
        .navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Сохранить") { Task { await save() } }.fontWeight(.semibold).disabled(saving) } }
    }

    private func toggle(_ id: String) {
        if let index = selectedIDs.firstIndex(of: id) { selectedIDs.remove(at: index) }
        else if selectedIDs.count < 3 { selectedIDs.append(id) }
    }

    @MainActor private func save() async {
        saving = true
        do { _ = try await APIClient.shared.savePrimaryHotels(city: city, stars: stars, hotelIDs: selectedIDs); onSaved(); dismiss() }
        catch { errorMessage = error.localizedDescription }
        saving = false
    }
}
