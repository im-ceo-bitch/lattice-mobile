import SwiftUI

struct HotelReviewView: View {
    @ObservedObject var coordinator: HotelImportCoordinator
    @Environment(\.dismiss) private var dismiss
    @State private var publishing = false
    @State private var publishStatus: String?
    @State private var importJob: HotelImportJob?
    @State private var importIdempotencyKey = UUID().uuidString
    @State private var showPossibleDuplicateAlert = false
    @State private var bookingManualPriceText = ""
    @State private var bookingManualPriceError: String?

    private let columns = [
        GridItem(.flexible(), spacing: 8),
        GridItem(.flexible(), spacing: 8)
    ]

    var body: some View {
        ScrollView {
            if let draft = coordinator.draft {
                LazyVStack(alignment: .leading, spacing: 16) {
                    hotelHero(draft)
                    sourceCard(draft)
                    priceCard(draft)
                    hotelFacts(draft)
                    gallery(draft)
                    rooms(draft)
                    amenities(draft)
                    locationDetails(draft)
                    compactSourceNotes(draft)
                    publishBlock(draft)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 18)
                .padding(.vertical, 14)
            }
        }
        .scrollIndicators(.hidden)
        .background(BusinessDesign.background)
        .navigationTitle("Проверка отеля")
        .navigationBarTitleDisplayMode(.inline).businessNavigationSurface()
        .alert("Возможный дубль", isPresented: $showPossibleDuplicateAlert) {
            Button("Отмена", role: .cancel) {}
            Button("Всё равно сохранить") {
                if let draft = coordinator.draft {
                    submit(draft, allowPossibleDuplicate: true)
                }
            }
        } message: {
            if let duplicate = coordinator.duplicateCandidate {
                Text("Похожий отель уже есть в базе: \(duplicate.name). Совпадение не считается достаточным для автоматической блокировки — проверьте карточку перед продолжением.")
            }
        }
    }

    @ViewBuilder private func hotelHero(_ draft: HotelDraft) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if let cover = draft.images.first(where: { $0.isCover && $0.selected }), let url = URL(string: cover.url) {
                GeometryReader { proxy in
                    ZStack {
                        BusinessDesign.secondarySurface
                        AsyncImage(url: url) { phase in
                            if let image = phase.image {
                                image
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: proxy.size.width, height: 232)
                                    .clipped()
                            } else {
                                ProgressView()
                            }
                        }
                    }
                    .frame(width: proxy.size.width, height: 232)
                    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                }
                .frame(height: 232)
                .clipped()
            }

            VStack(alignment: .leading, spacing: 8) {
                Text(draft.name)
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .tracking(-1.1)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 8) {
                    if let stars = draft.stars {
                        Label("\(stars)★", systemImage: "star.fill")
                    }
                    if let rating = draft.rating {
                        let scale = draft.ratingScale ?? (rating > 5 ? 10 : 5)
                        Label("\(rating.formatted(.number.precision(.fractionLength(1)))) / \(Int(scale))", systemImage: "hand.thumbsup.fill")
                    }
                    if let reviews = draft.reviewCount {
                        Text("\(reviews.formatted()) отзывов")
                    }
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

                Text([draft.city, draft.country].filter { !$0.isEmpty }.joined(separator: ", "))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                if !draft.address.isEmpty {
                    Text(draft.address)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(14)
        .businessCard(radius: 28)
    }

    @ViewBuilder private func sourceCard(_ draft: HotelDraft) -> some View {
        if let source = draft.sources.first {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    Image(systemName: coordinator.currentProvider?.sourceIcon ?? "link.circle.fill")
                        .font(.title3)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(source.provider)
                            .font(.headline)
                        Text("Прямая карточка отеля")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundStyle(.green)
                }

                if let url = URL(string: source.sourceURL) {
                    Link(destination: url) {
                        HStack(spacing: 6) {
                            Text(url.host ?? source.sourceURL)
                            Spacer()
                            Image(systemName: "arrow.up.right")
                        }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    }
                }

                Text("Importer использовал только эту страницу. Поиск похожих отелей и смешивание данных из других карточек отключены.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(16)
            .businessCard(radius: 26)
        }
    }

    @ViewBuilder private func priceCard(_ draft: HotelDraft) -> some View {
        let bookingSource = draft.sources.contains { $0.provider.lowercased() == "booking" }

        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(draft.importedPrice == nil ? Color.orange.opacity(0.12) : Color.green.opacity(0.12))
                        .frame(width: 46, height: 46)
                    Image(systemName: draft.importedPrice == nil ? "exclamationmark.triangle.fill" : "banknote.fill")
                        .foregroundStyle(draft.importedPrice == nil ? .orange : .green)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text("Цена для генератора")
                        .font(.headline)
                    if let price = draft.importedPrice {
                        Text("\(price.currency) \(price.amount.formatted(.number.precision(.fractionLength(0...2)))) · 1 номер / \(price.nights) ночь")
                            .font(.subheadline.weight(.semibold))
                        if price.method == "booking-admin-manual-usd" {
                            Text("Ручная Booking цена · будет сохранена в D1")
                                .font(.caption)
                                .foregroundStyle(.orange)
                        } else if let room = price.roomName, !room.isEmpty {
                            Text(room)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                    } else {
                        Text(bookingSource
                             ? "Booking не вернул цену. Для Booking можно указать рабочую цену вручную в USD и опубликовать отель."
                             : "Цена не получена — отель нельзя публиковать и использовать в генераторе.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
            }

            if bookingSource && draft.importedPrice == nil {
                VStack(alignment: .leading, spacing: 9) {
                    Text("Ручная цена Booking · USD за 1 ночь")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    HStack(spacing: 10) {
                        Text("$")
                            .font(.title3.bold())
                        TextField("Например 72", text: $bookingManualPriceText)
                            .keyboardType(.decimalPad)
                            .font(.title3.weight(.semibold))
                            .textFieldStyle(.plain)
                    }
                    .padding(.horizontal, 14)
                    .frame(height: 52)
                    .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

                    if let bookingManualPriceError {
                        Text(bookingManualPriceError)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }

                    Button { applyBookingManualPrice() } label: {
                        Label("Использовать эту цену и разрешить публикацию", systemImage: "checkmark.circle.fill")
                            .font(.subheadline.bold())
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(BusinessDesign.onPrimaryControl)
                    .background(BusinessDesign.primaryControl, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .padding(12)
                .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }

            if let price = draft.importedPrice, let total = price.totalAmount, total > price.amount {
                Text("Итого у источника: \(price.totalCurrency ?? price.currency) \(total.formatted(.number.precision(.fractionLength(0...2))))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .businessCard(radius: 26)
    }

    private func applyBookingManualPrice() {
        let normalized = bookingManualPriceText
            .replacingOccurrences(of: ",", with: ".")
            .replacingOccurrences(of: "$", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let value = Double(normalized), value.isFinite, value >= 15, value <= 5000 else {
            bookingManualPriceError = "Введите цену за одну ночь от $15 до $5000."
            return
        }
        bookingManualPriceError = nil
        coordinator.setManualBookingImportPriceUSD(value)
    }

    @ViewBuilder private func hotelFacts(_ draft: HotelDraft) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Данные отеля")
                .font(.title2.bold())

            if let propertyType = draft.propertyType {
                factRow("building.2", "Тип", propertyType)
            }
            if let brand = draft.brand { factRow("tag", "Бренд", brand) }
            if let chain = draft.chain, chain != draft.brand { factRow("link", "Сеть", chain) }
            if let postalCode = draft.postalCode { factRow("envelope", "Индекс", postalCode) }
            if let stars = draft.stars {
                factRow("star", "Категория", "\(stars) звёзд")
            }
            if let rating = draft.rating {
                let scale = draft.ratingScale ?? (rating > 5 ? 10 : 5)
                let reviews = draft.reviewCount.map { " · \($0.formatted()) отзывов" } ?? ""
                factRow("hand.thumbsup", "Рейтинг", "\(rating.formatted(.number.precision(.fractionLength(1)))) / \(Int(scale))\(reviews)")
            }
            if let checkIn = draft.checkIn { factRow("arrow.right.circle", "Check-in", checkIn) }
            if let checkOut = draft.checkOut { factRow("arrow.left.circle", "Check-out", checkOut) }

            if !draft.description.isEmpty {
                Divider()
                Text(draft.description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .businessCard(radius: 26)
    }

    private func factRow(_ symbol: String, _ label: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .frame(width: 24)
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.subheadline.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder private func compactSourceNotes(_ draft: HotelDraft) -> some View {
        let sourceDetailCount = draft.policies.count + draft.facts.count + draft.fees.count + draft.importantInformation.count
        if sourceDetailCount > 0 {
            DisclosureGroup {
                Text("Эти служебные детали доступны только для проверки источника и не записываются в основной catalog core. В D1 сохраняются ключевые данные выбора: отель, адрес/гео, рейтинг, удобства, nearby, номера и оптимизированные фотографии.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.top, 8)
            } label: {
                HStack {
                    Label("Служебные данные источника", systemImage: "doc.text.magnifyingglass")
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    Text("\(sourceDetailCount)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
            .padding(16)
            .businessCard(radius: 24)
        }
    }

    @ViewBuilder private func additionalDetails(_ draft: HotelDraft) -> some View {
        let hasDetails = !draft.highlights.isEmpty ||
            !draft.food.isEmpty ||
            !draft.parkingTransport.isEmpty ||
            !draft.accessibility.isEmpty ||
            !draft.importantInformation.isEmpty ||
            !draft.services.isEmpty ||
            !draft.facts.isEmpty ||
            !draft.fees.isEmpty ||
            !draft.policies.isEmpty

        if hasDetails {
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 14) {
                    propertyIntelligence(draft)
                    servicesAndFacts(draft)
                    fees(draft)
                    policies(draft)
                }
                .padding(.top, 12)
            } label: {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Дополнительные данные")
                        .font(.headline)
                    Text("Правила, сборы и служебные детали")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(16)
            .businessCard(radius: 26)
        }
    }

    @ViewBuilder private func propertyIntelligence(_ draft: HotelDraft) -> some View {
        if !draft.highlights.isEmpty || !draft.food.isEmpty || !draft.parkingTransport.isEmpty || !draft.accessibility.isEmpty || !draft.importantInformation.isEmpty {
            VStack(alignment: .leading, spacing: 14) {
                Text("О гостинице")
                    .font(.title2.bold())

                if !draft.highlights.isEmpty {
                    detailGroup("sparkles", "Главное", draft.highlights)
                }
                if !draft.food.isEmpty {
                    detailGroup("fork.knife", "Питание", draft.food.map { $0.value == "Yes" ? $0.label : "\($0.label): \($0.value)" })
                }
                if !draft.parkingTransport.isEmpty {
                    detailGroup("car", "Парковка и транспорт", draft.parkingTransport.map { $0.value == "Yes" ? $0.label : "\($0.label): \($0.value)" })
                }
                if !draft.accessibility.isEmpty {
                    detailGroup("figure.roll", "Доступность", draft.accessibility)
                }
                if !draft.importantInformation.isEmpty {
                    detailGroup("info.circle", "Важная информация", draft.importantInformation)
                }
            }
            .padding(16)
            .businessCard(radius: 26)
        }
    }

    private func detailGroup(_ symbol: String, _ title: String, _ values: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: symbol)
                .font(.subheadline.bold())
            ForEach(Array(values.prefix(18)), id: \.self) { value in
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "checkmark")
                        .font(.caption2.bold())
                        .padding(.top, 3)
                    Text(value)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    @ViewBuilder private func locationDetails(_ draft: HotelDraft) -> some View {
        if !draft.nearby.isEmpty || draft.googleMapsURL != nil {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("Рядом с отелем").font(.title2.bold())
                    Spacer()
                    if let maps = draft.googleMapsURL, let url = URL(string: maps) {
                        Link(destination: url) {
                            Label("Карта", systemImage: "map")
                                .font(.subheadline.bold())
                        }
                    }
                }

                ForEach(draft.nearby) { place in
                    HStack(alignment: .top, spacing: 11) {
                        Image(systemName: "mappin.and.ellipse")
                            .foregroundStyle(.secondary)
                            .frame(width: 22)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(place.name).font(.subheadline.weight(.semibold))
                            HStack(spacing: 6) {
                                if let minutes = place.durationMinutes {
                                    Text("\(minutes) мин \(place.travelMode ?? "")")
                                }
                                if let distance = place.distanceText { Text(distance) }
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                }
            }
            .padding(16)
            .businessCard(radius: 26)
        }
    }

    @ViewBuilder private func servicesAndFacts(_ draft: HotelDraft) -> some View {
        if !draft.services.isEmpty || !draft.facts.isEmpty {
            VStack(alignment: .leading, spacing: 14) {
                Text("Сервисы и детали").font(.title2.bold())

                if !draft.services.isEmpty {
                    FlowLayout {
                        ForEach(draft.services, id: \.self) { service in
                            Text(service)
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(BusinessDesign.secondarySurface, in: Capsule())
                        }
                    }
                }

                ForEach(draft.facts) { fact in
                    factRow("checkmark.circle", fact.label, fact.value == "Yes" ? fact.group : fact.value)
                }
            }
            .padding(16)
            .businessCard(radius: 26)
        }
    }

    @ViewBuilder private func fees(_ draft: HotelDraft) -> some View {
        if !draft.fees.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text("Сборы и стоимость услуг").font(.title2.bold())
                ForEach(draft.fees) { fee in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "creditcard")
                            .foregroundStyle(.secondary)
                            .padding(.top, 1)
                        Text(fee.value)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(14)
            .businessCard(radius: 28)
        }
    }

    @ViewBuilder private func gallery(_ draft: HotelDraft) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Фотографии")
                        .font(.title2.bold())
                    Text("\(draft.images.count) найдено · \(draft.selectedImages.count) выбрано")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Menu {
                    Button("Выбрать все") { coordinator.selectAllTrustedImages() }
                    Button("Снять выбор") { coordinator.deselectAllImages() }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
                }
            }

            Text("Здесь только фотографии, которые принадлежат hotel-media CDN конкретной страницы Booking/Expedia. Логотипы сайта, флаги, аватары и рекомендации других отелей не импортируются.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            ForEach(photoKinds(for: draft), id: \.self) { kind in
                let items = draft.images.filter { $0.kind == kind }
                if !items.isEmpty {
                    imageSection(kind.title, images: items)
                }
            }
        }
        .padding(14)
        .businessCard(radius: 28)
    }

    private func photoKinds(for draft: HotelDraft) -> [HotelImageKind] {
        let order: [HotelImageKind] = [.exterior, .view, .room, .bathroom, .lobby, .restaurant, .breakfast, .lounge, .gym, .spa, .pool, .facility, .amenity, .gallery, .other]
        return order.filter { kind in draft.images.contains(where: { $0.kind == kind }) }
    }

    private func imageSection(_ title: String, images: [HotelImageCandidate]) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text(title).font(.headline)
                Spacer()
                Text("\(images.count)").font(.caption).foregroundStyle(.secondary)
            }
            imageGrid(images)
        }
    }

    private func imageGrid(_ images: [HotelImageCandidate]) -> some View {
        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(images) { image in
                ZStack(alignment: .topTrailing) {
                    AsyncImage(url: URL(string: image.url)) { phase in
                        if let loaded = phase.image {
                            loaded.resizable().scaledToFill()
                        } else {
                            ZStack {
                                BusinessDesign.secondarySurface
                                ProgressView().controlSize(.small)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 132)
                    .clipped()
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .opacity(image.selected ? 1 : 0.28)

                    Button { coordinator.toggleImage(image.id) } label: {
                        Image(systemName: image.selected ? "checkmark.circle.fill" : "circle")
                            .font(.title3)
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(.white, .black.opacity(0.68))
                    }
                    .padding(8)

                    if image.isCover {
                        Text("COVER")
                            .font(.system(size: 8, weight: .black))
                            .padding(.horizontal, 7)
                            .frame(height: 20)
                            .background(.black.opacity(0.74), in: Capsule())
                            .foregroundStyle(.white)
                            .padding(8)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                    }
                }
                .contextMenu {
                    Button("Сделать обложкой") { coordinator.setCover(image.id) }
                }
            }
        }
    }

    @ViewBuilder private func rooms(_ draft: HotelDraft) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Номера").font(.title2.bold())
                Spacer()
                Text("\(draft.rooms.count)").foregroundStyle(.secondary)
            }

            if draft.rooms.isEmpty {
                VStack(spacing: 14) {
                    ContentUnavailableView(
                        "Номера пока не подтверждены",
                        systemImage: "bed.double",
                        description: Text("Карточка отеля уже получена. Публикация заблокирована, пока importer не подтвердит реальные типы номеров.")
                    )

                    Button {
                        coordinator.retryRoomRecovery()
                    } label: {
                        HStack(spacing: 8) {
                            if coordinator.roomRecoveryRunning { ProgressView().tint(.white) }
                            Image(systemName: "arrow.clockwise")
                            Text(coordinator.roomRecoveryRunning ? "Ищем номера…" : "Повторить поиск номеров")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(BusinessDesign.onPrimaryControl)
                    .background(BusinessDesign.primaryControl, in: Capsule())
                    .disabled(coordinator.roomRecoveryRunning)
                }
            } else {
                ForEach(draft.rooms) { room in
                    roomCard(room)
                }
            }
        }
        .padding(14)
        .businessCard(radius: 28)
    }

    private func roomCard(_ room: HotelRoomDraft) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .top, spacing: 11) {
                Image(systemName: "bed.double.fill")
                    .font(.title3)
                    .frame(width: 30, height: 30)
                    .background(BusinessDesign.secondarySurface, in: Circle())
                Text(room.name)
                    .font(.subheadline.bold())
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }

            let details = [
                room.maxGuests.map { "до \($0) гостей" },
                room.sizeM2.map { "\($0.formatted(.number.precision(.fractionLength(0...1)))) м²" },
                room.beds,
                room.view
            ].compactMap { $0 }

            if !details.isEmpty {
                Text(details.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if !room.amenities.isEmpty {
                Text(room.amenities.prefix(8).joined(separator: " · "))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            let roomMeta = [room.category, room.smoking].compactMap { $0 } + room.bathroom + room.accessibility
            if !roomMeta.isEmpty {
                Text(roomMeta.prefix(8).joined(separator: " · "))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(13)
        .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    @ViewBuilder private func amenities(_ draft: HotelDraft) -> some View {
        if !draft.amenities.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text("Удобства").font(.title2.bold())
                FlowLayout(spacing: 7) {
                    ForEach(draft.amenities, id: \.self) { item in
                        Text(item)
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 11)
                            .padding(.vertical, 8)
                            .background(BusinessDesign.secondarySurface, in: Capsule())
                    }
                }
            }
            .padding(14)
            .businessCard(radius: 28)
        }
    }

    @ViewBuilder private func policies(_ draft: HotelDraft) -> some View {
        if !draft.policies.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text("Правила").font(.title2.bold())
                ForEach(draft.policies, id: \.self) { policy in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "checkmark.circle")
                            .foregroundStyle(.secondary)
                            .padding(.top, 1)
                        Text(policy)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(14)
            .businessCard(radius: 28)
        }
    }

    @ViewBuilder private func publishBlock(_ draft: HotelDraft) -> some View {
        let canPublish = !draft.sources.isEmpty && !draft.selectedHotelImages.isEmpty && !draft.rooms.isEmpty

        VStack(spacing: 12) {
            if let duplicate = coordinator.duplicateCandidate, duplicate.isPossible {
                VStack(alignment: .leading, spacing: 5) {
                    Label("Возможно, отель уже существует", systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline.bold())
                    Text("\(duplicate.name) · уверенность \(Int((duplicate.confidence ?? 0) * 100))%. Автоматическое объединение отключено.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }

            if let publishStatus {
                Text(publishStatus)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            if let job = importJob {
                VStack(spacing: 7) {
                    HStack {
                        Text(job.hotelName).font(.caption.bold())
                        Spacer()
                        Text("\(job.progress)%").font(.caption.monospacedDigit())
                    }
                    ProgressView(value: Double(job.progress), total: 100)
                        .tint(BusinessDesign.ink)
                    Text(importProgressText(job))
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
                            .foregroundStyle(.red)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(12)
                .background(BusinessDesign.secondarySurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }

            if !canPublish {
                Text("Для публикации нужен источник, хотя бы одно фото самого отеля и хотя бы один распознанный тип номера. Фото комнат и цена необязательны — их можно добавить позже.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            if draft.selectedImages.count > 48 {
                Text("В R2 будет сохранено до 48 наиболее полезных фотографий: обложка, номера и основные зоны отеля. Они сжимаются сервером перед сохранением.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Button {
                if coordinator.duplicateCandidate?.isPossible == true {
                    showPossibleDuplicateAlert = true
                } else {
                    submit(draft, allowPossibleDuplicate: false)
                }
            } label: {
                HStack {
                    if publishing { ProgressView().tint(.white) }
                    Text(publishing ? "Запускаем…" : (importJob?.isActive == true ? "Импорт выполняется в фоне" : (canPublish ? "Добавить в iumrah Hotels" : "Сохранить черновик")))
                }
                .font(.headline)
                .frame(maxWidth: .infinity)
                .frame(height: 56)
            }
            .buttonStyle(.borderedProminent)
            .tint(BusinessDesign.primaryControl)
            .disabled(publishing || importJob?.isActive == true || draft.sources.isEmpty)

            Button("Закрыть") { dismiss() }
                .font(.subheadline.bold())
                .foregroundStyle(.secondary)
        }
        .padding(14)
        .businessCard(radius: 28)
    }
    private func importProgressText(_ job: HotelImportJob) -> String {
        let stage: String
        switch job.stage {
        case "queued", "retry_queued": stage = "в очереди"
        case "preparing_media": stage = "подготовка фотографий"
        case "downloading_image": stage = "скачивание"
        case "optimizing_image": stage = "сжатие"
        case "saving_to_r2": stage = "сохранение в R2"
        case "media_progress": stage = "обработка фотографий"
        case "image_retry_exhausted": stage = "одна фотография недоступна, продолжаем"
        case "completed_with_warnings": stage = "завершено с предупреждением"
        case "completed": stage = "завершено"
        case "integrity_failed": stage = "проверка целостности не пройдена"
        case "stale_recovered": stage = "зависший импорт остановлен автоматически"
        case "cancelled": stage = "остановлено администратором"
        default: stage = job.stage.replacingOccurrences(of: "_", with: " ")
        }
        var value = "Фото: \(job.storedImages)/\(job.totalImages) · \(stage)"
        if let current = job.currentImage, current > 0, job.isActive { value += " · №\(current)/\(job.totalImages)" }
        if let label = job.currentImageLabel, !label.isEmpty, job.isActive { value += " · \(label)" }
        return value
    }

    private func submit(_ draft: HotelDraft, allowPossibleDuplicate: Bool) {
        let canPublish = !draft.sources.isEmpty && !draft.selectedHotelImages.isEmpty && !draft.rooms.isEmpty
        publishing = true
        publishStatus = draft.selectedImages.isEmpty ? "Сохраняем серверный черновик…" : "Передаём отель в защищённую фоновую очередь…"
        Task { @MainActor in
            do {
                await BusinessNotifications.prepare()
                var cloudDraft = draft
                cloudDraft.status = "draft"
                if cloudDraft.selectedImages.isEmpty {
                    _ = try await APIClient.shared.saveHotel(cloudDraft, allowPossibleDuplicate: allowPossibleDuplicate)
                    publishing = false
                    publishStatus = "Черновик сохранён в D1. Можно вернуться к нему после дополнительной проверки данных и фотографий."
                    return
                }
                let job = try await APIClient.shared.startHotelImport(
                    cloudDraft,
                    publishWhenComplete: canPublish,
                    idempotencyKey: importIdempotencyKey,
                    allowPossibleDuplicate: allowPossibleDuplicate
                )
                importJob = job
                await BusinessNotifications.hotelImportStarted(job)
                publishing = false
                publishStatus = canPublish
                    ? "Фоновый импорт запущен. После сохранения хотя бы одного фото отеля карточка будет опубликована; фото комнат и цена необязательны."
                    : "Отель сохранится черновиком. Для публикации нужен источник, фото самого отеля и хотя бы один распознанный номер."
                await monitor(jobID: job.id)
            } catch let APIError.possibleDuplicate(duplicate) {
                coordinator.duplicateCandidate = duplicate
                publishing = false
                showPossibleDuplicateAlert = true
                publishStatus = "Найдено возможное совпадение. Проверьте предупреждение перед продолжением."
            } catch {
                publishing = false
                publishStatus = "Ошибка Hotels Cloud: \(error.localizedDescription)"
            }
        }
    }

    @MainActor
    private func monitor(jobID: String) async {
        var lastStatus = ""
        for _ in 0..<240 {
            do {
                let job = try await APIClient.shared.hotelImportJob(id: jobID)
                importJob = job
                if job.status != lastStatus || job.isActive {
                    lastStatus = job.status
                    if job.isActive {
                        publishStatus = "Фоновая загрузка: \(job.storedImages) из \(job.totalImages) фото · \(job.progress)%"
                    } else if job.isCompleted {
                        publishStatus = "Готово. \(job.hotelName) сохранён полностью · \(job.storedImages) фото."
                        await BusinessNotifications.hotelImportFinished(job)
                        return
                    } else {
                        publishStatus = job.error ?? "Импорт остановлен. Отель оставлен черновиком — данные не потеряны."
                        await BusinessNotifications.hotelImportFinished(job)
                        return
                    }
                }
            } catch {
                // The cloud job keeps running even if this screen temporarily loses network.
            }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
    }
}

struct FlowLayout<Content: View>: View {
    var spacing: CGFloat = 8
    @ViewBuilder var content: () -> Content

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 110), spacing: spacing)],
            alignment: .leading,
            spacing: spacing
        ) {
            content()
        }
    }
}
