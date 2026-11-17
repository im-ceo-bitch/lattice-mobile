import Foundation
import SwiftUI

struct HotelAdminDetailView: View {
    let hotelID: String
    let onChanged: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var hotel: HotelAdminDetail?
    @State private var selectedStars = 3
    @State private var selectedCity = ""
    @State private var loading = true
    @State private var editingManualPrice = false
    @State private var manualPriceText = ""
    @State private var savingManualPrice = false
    @State private var savingStars = false
    @State private var savingCity = false
    @State private var deleting = false
    @State private var showDeleteConfirmation = false
    @State private var errorMessage: String?
    @State private var savedMessage: String?
    @State private var citySavedMessage: String?
    @State private var priceNotice: String?
    @State private var priceSuccessMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let hotel {
                    hero(hotel)
                    cityCard(hotel)
                    priceCard(hotel)
                    starsCard(hotel)
                    sourceCard(hotel)
                    detailsCard(hotel)
                    deleteCard(hotel)
                } else if !loading {
                    ContentUnavailableView(
                        "Отель недоступен",
                        systemImage: "building.2.crop.circle",
                        description: Text(errorMessage ?? "Не удалось загрузить карточку отеля.")
                    )
                }
            }
            .frame(maxWidth: 720, alignment: .leading)
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity)
        }
        .background(BusinessDesign.background.ignoresSafeArea())
        .navigationTitle("Отель")
        .navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
        .overlay {
            if loading {
                ProgressView()
                    .controlSize(.large)
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .onChange(of: selectedStars) { _, value in
            if hotel?.stars != value { savedMessage = nil }
        }
        .alert("Удалить отель?", isPresented: $showDeleteConfirmation) {
            Button("Отмена", role: .cancel) { }
            Button("Удалить", role: .destructive) {
                Task { await deleteHotel() }
            }
        } message: {
            Text("Отель будет удалён из D1, а связанные изображения — из Hotels Cloud. Это действие нельзя отменить.")
        }
        .alert("Не удалось выполнить действие", isPresented: Binding(
            get: { errorMessage != nil && hotel != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "Неизвестная ошибка")
        }
    }

    private func hero(_ hotel: HotelAdminDetail) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Group {
                if let imageURL = coverURL(hotel) {
                    AsyncImage(url: imageURL) { phase in
                        if let image = phase.image {
                            image.resizable().scaledToFill()
                        } else {
                            heroPlaceholder
                        }
                    }
                } else {
                    heroPlaceholder
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 210)
            .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))

            VStack(alignment: .leading, spacing: 7) {
                Text(hotel.name)
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .tracking(-0.8)

                HStack(spacing: 8) {
                    Label(hotel.city, systemImage: "mappin.and.ellipse")
                    if let stars = hotel.stars {
                        Text("·")
                        Text("\(stars)★")
                    }
                    if let rating = hotel.rating {
                        Text("·")
                        Label(rating.formatted(.number.precision(.fractionLength(1))), systemImage: "star.fill")
                    }
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)

                statusPill(hotel)
            }
        }
    }

    private func cityCard(_ hotel: HotelAdminDetail) -> some View {
        let current = canonicalManagedCity(hotel.city)
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Город")
                        .font(.title2.bold())
                    Text("Сохраняется в D1 и сразу используется клиентским каталогом и Primary Hotels.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                if current == nil {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                }
            }

            if current == nil {
                Label("Город не распознан. Выберите Makkah или Madinah вручную.", systemImage: "mappin.slash")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            }

            Picker("Город", selection: $selectedCity) {
                Text("Мекка").tag("Makkah")
                Text("Медина").tag("Madinah")
            }
            .pickerStyle(.segmented)

            if let citySavedMessage {
                Label(citySavedMessage, systemImage: "checkmark.circle.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.green)
            }

            Button {
                Task { await saveCity() }
            } label: {
                HStack {
                    if savingCity { ProgressView() }
                    Text(savingCity ? "Сохраняю…" : "Сохранить город")
                    Spacer()
                    Image(systemName: "checkmark")
                }
                .font(.headline)
                .padding(.horizontal, 16)
                .frame(height: 50)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
            .foregroundStyle(.primary)
            .disabled(savingCity || selectedCity.isEmpty || selectedCity == current)
        }
        .padding(17)
        .businessCard(radius: 28)
    }

    private func priceCard(_ hotel: HotelAdminDetail) -> some View {
        VStack(alignment: .leading, spacing: 15) {
            HStack(alignment: .firstTextBaseline) {
                Text("Цена")
                    .font(.title2.bold())
                Spacer()
                if let price = hotel.price {
                    Text(priceStatus(price))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(priceNeedsAttention(price) ? Color.orange : (price.isManualOverride == true ? BusinessDesign.accent : Color.secondary))
                }
            }

            if let price = hotel.price, let nightly = price.nightlyUSD, price.hasUsablePrice {
                VStack(alignment: .leading, spacing: 5) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(nightly.formatted(.currency(code: "USD").precision(.fractionLength(0))))
                            .font(.system(size: 34, weight: .bold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(priceNeedsAttention(price) ? Color.orange : Color.primary)
                        Text("/ ночь")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    if price.isManualOverride == true {
                        Text("Ручная цена · сохранена в D1")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(BusinessDesign.accent)
                        if let sourceNightly = price.sourceNightlyUSD {
                            Text("Последняя цена источника: \(sourceNightly.formatted(.currency(code: "USD").precision(.fractionLength(0))))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        if let fetchedAt = price.fetchedAt {
                            Text("Источник проверен: \(compactDate(fetchedAt))")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    } else {
                        if let provider = price.provider ?? hotel.sources.first?.provider {
                            Text(provider.capitalized)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        if let fetchedAt = price.fetchedAt {
                            Text("Последнее обновление: \(compactDate(fetchedAt))")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    }
                    if priceNeedsAttention(price) {
                        Label("Цена не обновилась. Показана последняя подтверждённая цена.", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.orange)
                            .padding(.top, 3)
                    }
                }
            } else if hotel.price?.status == "pending" {
                Label("Цена обновляется", systemImage: "arrow.clockwise")
                    .foregroundStyle(.secondary)
            } else {
                Label("Актуальная цена пока недоступна", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.secondary)
            }

            if editingManualPrice {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Цена за одну ночь · USD")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    HStack(spacing: 10) {
                        Text("$")
                            .font(.title2.bold())
                        TextField("173", text: $manualPriceText)
                            .keyboardType(.decimalPad)
                            .font(.title2.monospacedDigit())
                            .textFieldStyle(.plain)
                        Button(savingManualPrice ? "Сохраняю…" : "Сохранить") {
                            Task { await saveManualPrice() }
                        }
                        .fontWeight(.semibold)
                        .disabled(savingManualPrice || parsedManualPrice == nil)
                    }
                    .padding(.horizontal, 14)
                    .frame(height: 54)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 17, style: .continuous))

                    Text("Ручное значение становится текущей ценой в D1 и сразу используется клиентским каталогом.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Button {
                if !editingManualPrice {
                    manualPriceText = editablePrice(hotel.price?.nightlyUSD)
                }
                withAnimation(.easeInOut(duration: 0.2)) { editingManualPrice.toggle() }
            } label: {
                Label(editingManualPrice ? "Скрыть ручное изменение" : "Изменить цену вручную", systemImage: "pencil")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
            .foregroundStyle(.primary)

            if let priceSuccessMessage {
                Label(priceSuccessMessage, systemImage: "checkmark.circle.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.green)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 2)
            }

            if let priceNotice {
                Label(priceNotice, systemImage: "clock.arrow.circlepath")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 2)
            }

            Label("Автоматическая проверка источника отключена. Обновление цен выполняется через Hotels → Обновление цен → ChatGPT Sync.", systemImage: "doc.text.magnifyingglass")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
        }
        .padding(18)
        .businessCard(radius: 28)
    }

    private func starsCard(_ hotel: HotelAdminDetail) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Звёздность")
                    .font(.title2.bold())
                Text("Изменение сохраняется в D1. Клиентский каталог получает это значение из той же записи отеля.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Picker("Звёзды", selection: $selectedStars) {
                ForEach(1...5, id: \.self) { stars in
                    Text("\(stars)★").tag(stars)
                }
            }
            .pickerStyle(.segmented)

            HStack {
                if let savedMessage {
                    Label(savedMessage, systemImage: "checkmark.circle.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.green)
                }
                Spacer()
                Button("Сохранить") {
                    Task { await saveStars() }
                }
                .fontWeight(.semibold)
                .disabled(savingStars || selectedStars == hotel.stars)
            }
        }
        .padding(17)
        .businessCard(radius: 28)
    }

    @ViewBuilder
    private func sourceCard(_ hotel: HotelAdminDetail) -> some View {
        if let source = preferredSource(hotel), let url = URL(string: source.url) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Источник")
                    .font(.title2.bold())

                HStack(spacing: 12) {
                    Image(systemName: "link.circle.fill")
                        .font(.title2)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(source.provider)
                            .font(.headline)
                        Text("Источник цены и карточки отеля")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                }

                Link(destination: url) {
                    Label("Открыть источник", systemImage: "arrow.up.right.square")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.primary)
            }
            .padding(17)
            .businessCard(radius: 28)
        }
    }

    private func detailsCard(_ hotel: HotelAdminDetail) -> some View {
        VStack(alignment: .leading, spacing: 13) {
            Text("Карточка отеля")
                .font(.title2.bold())

            detailRow("Город", hotel.city)
            detailRow("Страна", hotel.country)
            detailRow("Номеров", "\(hotel.rooms.count)")
            detailRow("Фотографий", "\(hotel.images.count)")
            if !hotel.address.isEmpty {
                detailRow("Адрес", hotel.address)
            }
            if let reviewCount = hotel.reviewCount {
                detailRow("Отзывы", reviewCount.formatted())
            }
            detailRow("Статус", hotel.status == "published" ? "Опубликован" : hotel.status.capitalized)
        }
        .padding(17)
        .businessCard(radius: 28)
    }

    private func deleteCard(_ hotel: HotelAdminDetail) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Управление")
                .font(.title2.bold())
            Button(role: .destructive) {
                showDeleteConfirmation = true
            } label: {
                HStack {
                    if deleting {
                        ProgressView().tint(.red)
                    } else {
                        Image(systemName: "trash")
                    }
                    Text(deleting ? "Удаляем…" : "Удалить отель")
                    Spacer()
                }
                .font(.headline)
                .padding(.horizontal, 16)
                .frame(height: 52)
                .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 17, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(deleting)
        }
        .padding(17)
        .businessCard(radius: 28)
    }

    private func detailRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Text(title)
                .foregroundStyle(.secondary)
            Spacer(minLength: 14)
            Text(value)
                .multilineTextAlignment(.trailing)
        }
        .font(.subheadline)
    }

    @ViewBuilder
    private var heroPlaceholder: some View {
        BusinessDesign.secondarySurface
            .overlay {
                Image(systemName: "building.2.fill")
                    .font(.system(size: 42))
                    .foregroundStyle(.secondary)
            }
    }

    private func statusPill(_ hotel: HotelAdminDetail) -> some View {
        Text(hotel.status == "published" ? "LIVE" : (hotel.lifecycleState?.uppercased() ?? hotel.status.uppercased()))
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(hotel.status == "published" ? Color.green : Color.secondary)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background((hotel.status == "published" ? Color.green : Color.gray).opacity(0.09), in: Capsule())
    }

    private func coverURL(_ hotel: HotelAdminDetail) -> URL? {
        let path = hotel.images.first(where: \.isCover)?.url ?? hotel.images.first?.url
        return AppConfig.absoluteURL(path)
    }

    private func preferredSource(_ hotel: HotelAdminDetail) -> (provider: String, url: String)? {
        if let url = hotel.price?.sourceURL, !url.isEmpty {
            return (hotel.price?.provider?.capitalized ?? hotel.sources.first?.provider.capitalized ?? "Источник", url)
        }
        if let source = hotel.sources.first, !source.sourceURL.isEmpty {
            return (source.provider.capitalized, source.sourceURL)
        }
        return nil
    }

    private func priceStatus(_ price: HotelCachedPrice) -> String {
        switch price.status {
        case "manual": return "Ручная цена"
        case "fresh": return "Актуально"
        case "stale": return "Цена не обновилась"
        case "pending": return "Обновляется"
        case "failed": return "Цена не обновилась"
        default: return price.status.capitalized
        }
    }

    private func priceNeedsAttention(_ price: HotelCachedPrice) -> Bool {
        price.status == "stale" || price.status == "failed"
    }

    private func compactDate(_ raw: String) -> String {
        let iso = ISO8601DateFormatter()
        guard let date = iso.date(from: raw) else { return raw }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.timeZone = TimeZone(identifier: "Asia/Tashkent")
        formatter.dateFormat = "d MMM yyyy, HH:mm"
        return formatter.string(from: date)
    }

    @MainActor
    private func load() async {
        loading = hotel == nil
        defer { loading = false }
        do {
            let detail = try await APIClient.shared.hotelDetail(id: hotelID)
            hotel = detail
            selectedStars = detail.stars ?? 3
            selectedCity = canonicalManagedCity(detail.city) ?? ""
            if !editingManualPrice { manualPriceText = editablePrice(detail.price?.nightlyUSD) }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private var parsedManualPrice: Double? {
        let normalized = manualPriceText
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: ",", with: ".")
        guard let value = Double(normalized), value >= 1, value <= 10_000 else { return nil }
        return value
    }

    private func editablePrice(_ value: Double?) -> String {
        guard let value else { return "" }
        if value.rounded() == value { return String(Int(value)) }
        return String(format: "%.2f", value)
    }

    @MainActor
    private func saveManualPrice() async {
        guard let value = parsedManualPrice else { return }
        savingManualPrice = true
        defer { savingManualPrice = false }
        do {
            _ = try await APIClient.shared.setManualHotelPrice(id: hotelID, nightlyUSD: value)
            let latest = try await APIClient.shared.hotelDetail(id: hotelID)
            hotel = latest
            manualPriceText = editablePrice(latest.price?.nightlyUSD)
            editingManualPrice = false
            priceNotice = nil
            priceSuccessMessage = "Ручная цена сохранена в D1 и сразу используется клиентским каталогом."
            onChanged()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func canonicalManagedCity(_ raw: String) -> String? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if value == "makkah" || value == "mecca" { return "Makkah" }
        if value == "madinah" || value == "medina" { return "Madinah" }
        return nil
    }

    @MainActor
    private func saveCity() async {
        guard selectedCity == "Makkah" || selectedCity == "Madinah" else { return }
        savingCity = true
        citySavedMessage = nil
        defer { savingCity = false }
        do {
            let updated = try await APIClient.shared.updateHotelCity(id: hotelID, city: selectedCity)
            hotel = updated
            selectedCity = canonicalManagedCity(updated.city) ?? selectedCity
            citySavedMessage = "Город сохранён в базе"
            onChanged()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func saveStars() async {
        guard (1...5).contains(selectedStars) else { return }
        savingStars = true
        savedMessage = nil
        defer { savingStars = false }
        do {
            let updated = try await APIClient.shared.updateHotelStars(id: hotelID, stars: selectedStars)
            hotel = updated
            selectedStars = updated.stars ?? selectedStars
            savedMessage = "Сохранено в базе"
            onChanged()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func deleteHotel() async {
        deleting = true
        defer { deleting = false }
        do {
            try await APIClient.shared.deleteHotel(id: hotelID)
            onChanged()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
