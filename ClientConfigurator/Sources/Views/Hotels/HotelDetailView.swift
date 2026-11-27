import SwiftUI
import MapKit

struct HotelDetailView: View {
    @EnvironmentObject private var settings: AppSettingsStore
    @EnvironmentObject private var journey: JourneyStore
    @Environment(\.dismiss) private var dismiss

    let hotel: HotelSummary
    var bookingID: String? = nil
    var selectionFlow: Bool = false
    var selectionRole: HotelSelectionRole = .makkah
    var onSelectionSaved: (() -> Void)? = nil

    @State private var detail: HotelDetail?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var selectedImageIndex = 0
    @State private var isGalleryPresented = false
    @State private var selectedRoomID: String?
    @State private var selectedRoomCategory: IumrahRoomCategoryOption?
    @State private var roomCategories: [IumrahRoomCategoryOption] = []
    @State private var isLoadingRoomCategories = false
    @State private var roomCategoryError: String?
    @State private var isSavingSelection = false
    @State private var roomImageIndices: [String: Int] = [:]
    @State private var selectionError: String?

    private let service = HotelCatalogService()
    private let packageEngine = RemotePackageEngineClient()

    var body: some View {
        GeometryReader { proxy in
            let contentWidth = max(0, proxy.size.width - (IumrahDesign.pagePadding * 2))

            ScrollView(showsIndicators: false) {
                LazyVStack(spacing: 0) {
                    heroCarousel
                        .frame(width: proxy.size.width)

                    LazyVStack(alignment: .leading, spacing: 30) {
                        identitySection

                        if selectionFlow || bookingID != nil {
                            IumrahRefundPolicyCard(component: .hotel, compact: false)
                        }


                        if let detail {
                            qualitySection(detail)
                            receptionClocksSection
                            photoOverviewSection(detail)
                            amenitiesSection(detail)
                            primaryRoomSection(detail)
                            actualRoomsSection(detail)
                            if !detail.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                aboutSection(detail)
                            }
                            mapSection(detail)
                            practicalSection(detail)
                        } else if isLoading {
                            loadingSection
                        } else if let errorMessage {
                            errorSection(errorMessage)
                        }
                    }
                    .frame(width: contentWidth, alignment: .leading)
                    .padding(.top, 24)
                    .padding(.bottom, shouldShowSelectionBar ? 128 : 48)
                }
                .frame(width: proxy.size.width, alignment: .top)
            }
        }
        .background(Color(uiColor: .systemBackground).ignoresSafeArea())
        .navigationTitle(hotel.name)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                ShareLink(item: hotel.name) { Image(systemName: "square.and.arrow.up") }
                IumrahPageHelpButton(inSystemToolbar: true)
            }
        }
        .modifier(IumrahHelpOverlayHost(enabled: true, explicitContext: IumrahHelpContext(key: "hotel.details")))
        .iumrahInternalNavigation()
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if shouldShowSelectionBar, let selectedName = currentSelectionName {
                selectionBar(selectedName)
            }
        }
        .task {
            await load()
            await loadRoomCategories()
        }
        .fullScreenCover(isPresented: $isGalleryPresented) {
            HotelGalleryView(hotelName: hotel.name, images: detail?.images ?? [])
                .environmentObject(settings)
        }
    }

    private var canSelectRooms: Bool { selectionFlow || bookingID != nil }
    private var shouldShowSelectionBar: Bool { bookingID == nil && selectionFlow && currentSelectionName != nil }

    private var currentSelectionName: String? {
        if let selectedRoomCategory { return localizedRoomCategoryName(selectedRoomCategory.category) }
        if let selectedRoomID, let room = detail?.rooms.first(where: { $0.id == selectedRoomID }) { return localizedRoomName(room.name) }

        switch selectionRole {
        case .makkah:
            guard journey.selectedHotel?.id == hotel.id else { return nil }
            return journey.selectedRoom.map { localizedRoomName($0.name) } ?? journey.selectedRoomCategory.map { localizedRoomCategoryName($0.category) }
        case .madinah:
            guard journey.selectedMadinahHotel?.id == hotel.id else { return nil }
            return journey.selectedMadinahRoom.map { localizedRoomName($0.name) } ?? journey.selectedMadinahRoomCategory.map { localizedRoomCategoryName($0.category) }
        }
    }

    // MARK: - Hero

    private var sortedImages: [HotelImage] {
        let all = (detail?.images ?? []).sorted(by: imageSort)
        let propertyImages = all.filter { image in
            let roomName = (image.roomName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let category = normalize(image.category)
            return roomName.isEmpty && !category.contains("room")
        }
        return propertyImages.isEmpty ? all : propertyImages
    }

    private var heroCarousel: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if sortedImages.isEmpty {
                    hotelImage(hotel.coverImageURL)
                } else {
                    TabView(selection: $selectedImageIndex) {
                        ForEach(Array(sortedImages.enumerated()), id: \.element.id) { index, image in
                            hotelImage(image.url).tag(index)
                        }
                    }
                    .tabViewStyle(.page(indexDisplayMode: .automatic))
                }
            }
            .frame(height: 340)
            .clipped()

            if !sortedImages.isEmpty {
                Button {
                    isGalleryPresented = true
                } label: {
                    HStack(spacing: 7) {
                        Image(systemName: "photo.on.rectangle.angled")
                        Text("\(min(selectedImageIndex + 1, sortedImages.count))/\(sortedImages.count)")
                    }
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .frame(height: 36)
                    .iumrahGlass(in: Capsule(), interactive: true, tint: .black.opacity(0.22), chrome: true)
                }
                .buttonStyle(.plain)
                .padding(.top, 14)
                .padding(.trailing, 16)
            }
        }
    }


    private var identitySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let stars = hotel.stars {
                Text(String(repeating: "★", count: stars))
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
            }

            Text(hotel.name)
                .font(.system(size: 31, weight: .bold, design: .rounded))
                .tracking(-0.9)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 7) {
                Image(systemName: "mappin.and.ellipse")
                Text(L10n.city(hotel.city, settings.language))
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.secondary)

            Label("iumrah Hotels", systemImage: "building.2.fill")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            if let address = detail?.address.trimmingCharacters(in: .whitespacesAndNewlines), !address.isEmpty {
                Text(address)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var receptionClocksSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionTitle(L10n.text("hotel_time_title", settings.language))
            Text(L10n.text("hotel_time_body", settings.language))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            LazyVGrid(
                columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)],
                spacing: 10
            ) {
                ReceptionClock(city: L10n.text("hotel_time_tashkent", settings.language), timeZoneID: "Asia/Tashkent")
                ReceptionClock(city: L10n.text("hotel_time_makkah", settings.language), timeZoneID: "Asia/Riyadh")
                ReceptionClock(city: L10n.text("hotel_time_madinah", settings.language), timeZoneID: "Asia/Riyadh")
                ReceptionClock(city: L10n.text("hotel_time_moscow", settings.language), timeZoneID: "Europe/Moscow")
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func photoOverviewSection(_ detail: HotelDetail) -> some View {
        let photos = detail.images.sorted(by: imageSort)
        if !photos.isEmpty {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .firstTextBaseline) {
                    sectionTitle(L10n.text("hotel_photos", settings.language))
                    Spacer()
                    Button {
                        isGalleryPresented = true
                    } label: {
                        Text(L10n.format("hotel_view_all_photos_fmt", settings.language, photos.count))
                            .font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.plain)
                }

                GeometryReader { proxy in
                    let gap: CGFloat = 4
                    let primaryWidth = ((proxy.size.width - gap) * 0.64)
                    let secondaryWidth = max(0, proxy.size.width - primaryWidth - gap)
                    let secondaryHeight = max(0, (proxy.size.height - gap) / 2)

                    HStack(spacing: gap) {
                        HotelCachedImage(rawURL: photos[0].url)
                            .frame(width: primaryWidth, height: proxy.size.height)
                            .clipped()

                        VStack(spacing: gap) {
                            HotelCachedImage(rawURL: photos[safe: 1]?.url ?? photos[0].url)
                                .frame(width: secondaryWidth, height: secondaryHeight)
                                .clipped()
                            HotelCachedImage(rawURL: photos[safe: 2]?.url ?? photos[0].url)
                                .frame(width: secondaryWidth, height: secondaryHeight)
                                .clipped()
                        }
                        .frame(width: secondaryWidth, height: proxy.size.height)
                    }
                    .frame(width: proxy.size.width, height: proxy.size.height)
                }
                .frame(height: 220)
                .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
                .onTapGesture { isGalleryPresented = true }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func money(_ value: Decimal) -> String {
        String(format: "$%.0f", NSDecimalNumber(decimal: value).doubleValue)
    }

    // MARK: - Hotel facts

    private func qualitySection(_ detail: HotelDetail) -> some View {
        HStack(spacing: 14) {
            if let rating = detail.rating {
                VStack(spacing: 4) {
                    Text(String(format: "%.1f", rating))
                        .font(.system(size: 26, weight: .bold, design: .rounded))
                    Text(ratingTitle(rating))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                .frame(width: 96, height: 88)
                .background(Color.iumrahRaisedBackground)
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(L10n.text("hotel_selected_quality", settings.language))
                    .font(.headline)
                if let count = detail.reviewCount {
                    Text(L10n.format("hotel_reviews_count", settings.language, count))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Text(L10n.text("hotels_note", settings.language))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(18)
        .background(Color.iumrahCardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 28, style: .continuous).strokeBorder(Color.primary.opacity(0.05), lineWidth: 0.5) }
    }

    @ViewBuilder
    private func amenitiesSection(_ detail: HotelDetail) -> some View {
        if !detail.amenities.isEmpty {
            VStack(alignment: .leading, spacing: 14) {
                sectionTitle(FlowCopy.text(.amenities, settings.language))
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                    ForEach(detail.amenities, id: \.self) { amenity in
                        HStack(spacing: 10) {
                            Image(systemName: amenityIcon(amenity))
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(.secondary)
                                .frame(width: 32, height: 32)
                                .background(Color.iumrahRaisedBackground, in: Circle())
                            Text(localizedAmenity(amenity))
                                .font(.footnote.weight(.semibold))
                                .lineLimit(2)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(12)
                        .frame(minHeight: 56)
                        .background(Color.iumrahCardBackground)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }
                }
            }
        }
    }

    // MARK: - Rooms

    private func primaryRoomSection(_ detail: HotelDetail) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionTitle(FlowCopy.text(.roomsPrepared, settings.language))
            Text(FlowCopy.text(.roomsPreparedBody, settings.language))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if isLoadingRoomCategories && roomCategories.isEmpty {
                HStack(spacing: 10) {
                    ProgressView()
                    Text(FlowCopy.text(.roomsLoading, settings.language))
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 20)
            } else if let roomCategoryError, roomCategories.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text(roomCategoryError)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button(L10n.text("retry", settings.language)) { Task { await loadRoomCategories() } }
                        .buttonStyle(IumrahSecondaryButtonStyle())
                }
            } else {
                LazyVStack(spacing: 12) {
                    ForEach(roomCategories) { option in
                        primaryRoomCard(option)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func primaryRoomCard(_ option: IumrahRoomCategoryOption) -> some View {
        let selected = isCategorySelected(option)

        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: categoryIcon(option.category))
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 46, height: 46)
                    .background(Color.iumrahRaisedBackground, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

                VStack(alignment: .leading, spacing: 3) {
                    Text(localizedRoomCategoryName(option.category))
                        .font(.system(size: 21, weight: .bold, design: .rounded))
                        .lineLimit(2)
                    Text(roomCategoryBody(option.category))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                Spacer(minLength: 8)

                if selected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(Color.iumrahCareLight)
                }
            }

            HStack(spacing: 8) {
                compactFact(icon: "person.2.fill", text: "\(option.maxGuests)")
                compactFact(icon: "bed.double.fill", text: localizedRoomCategoryBeds(option.category))
            }

            if canSelectRooms {
                Button { select(option) } label: {
                    HStack {
                        Text(selected ? FlowCopy.text(.roomChosen, settings.language) : FlowCopy.text(.chooseRoom, settings.language))
                        Spacer()
                        Image(systemName: selected ? "checkmark" : "arrow.right")
                    }
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(RoomSelectButtonStyle(selected: selected))
                .disabled(isSavingSelection)
            }
        }
        .padding(18)
        .frame(minHeight: canSelectRooms ? 214 : 168, alignment: .topLeading)
        .background(Color.iumrahCardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .strokeBorder(selected ? Color.iumrahCareLight.opacity(0.55) : Color.primary.opacity(0.055), lineWidth: selected ? 1.2 : 0.6)
        }
    }

    private func actualRoomsSection(_ detail: HotelDetail) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionTitle(FlowCopy.text(.hotelRooms, settings.language))
            Text(FlowCopy.text(.hotelRoomsBody, settings.language))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if detail.rooms.isEmpty {
                Text(L10n.text("hotel_rooms_empty", settings.language))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(20)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.iumrahCardBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            } else {
                LazyVStack(spacing: 12) {
                    ForEach(detail.rooms) { room in
                        actualRoomCard(room, detail: detail)
                            .frame(maxWidth: .infinity)
                    }
                }
            }

            if let selectionError {
                Text(selectionError)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func actualRoomCard(_ room: HotelRoom, detail: HotelDetail) -> some View {
        let selected = isRoomSelected(room)
        let roomImages = images(for: room, detail: detail)
        let cleanDescription = cleanRoomDescription(room.description)
        let cardHeight: CGFloat = canSelectRooms ? 236 : 196

        return GeometryReader { proxy in
            let mediaWidth = min(max(proxy.size.width * 0.36, 116), 142)

            HStack(spacing: 0) {
                ZStack(alignment: .topTrailing) {
                    if roomImages.isEmpty {
                        ZStack {
                            Color.iumrahRaisedBackground
                            VStack(spacing: 9) {
                                Image(systemName: "bed.double.fill")
                                    .font(.system(size: 28, weight: .light))
                                Text(FlowCopy.text(.hotelRooms, settings.language))
                                    .font(.caption2.weight(.semibold))
                                    .multilineTextAlignment(.center)
                            }
                            .foregroundStyle(.secondary)
                            .padding(10)
                        }
                    } else {
                        TabView(selection: roomImageSelectionBinding(for: room.id)) {
                            ForEach(Array(roomImages.enumerated()), id: \.offset) { index, image in
                                hotelImage(image.url)
                                    .tag(index)
                            }
                        }
                        .tabViewStyle(.page(indexDisplayMode: .never))
                    }

                    if roomImages.count > 1 {
                        VStack {
                            Label("\(roomImages.count)", systemImage: "photo.on.rectangle")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 9)
                                .frame(height: 28)
                                .background(.black.opacity(0.42), in: Capsule())

                            Spacer()

                            HStack(spacing: 4) {
                                ForEach(Array(roomImages.indices), id: \.self) { index in
                                    Capsule()
                                        .fill(index == (roomImageIndices[room.id] ?? 0) ? Color.white : Color.white.opacity(0.42))
                                        .frame(width: index == (roomImageIndices[room.id] ?? 0) ? 12 : 5, height: 5)
                                }
                            }
                            .padding(.horizontal, 8)
                            .frame(height: 23)
                            .background(.black.opacity(0.28), in: Capsule())
                        }
                        .padding(10)
                        .allowsHitTesting(false)
                    }
                }
                .frame(width: mediaWidth, height: cardHeight)
                .clipped()

                VStack(alignment: .leading, spacing: 9) {
                    HStack(alignment: .top, spacing: 8) {
                        Text(localizedRoomName(room.name))
                            .font(.system(size: 18, weight: .bold, design: .rounded))
                            .tracking(-0.2)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)

                        Spacer(minLength: 4)

                        if selected {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 19, weight: .semibold))
                                .foregroundStyle(Color.iumrahCareLight)
                        }
                    }

                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 6) { roomFacts(room) }
                        VStack(alignment: .leading, spacing: 6) { roomFacts(room) }
                    }

                    if let cleanDescription {
                        Text(cleanDescription)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(canSelectRooms ? 2 : 3)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer(minLength: 0)

                    if canSelectRooms {
                        Button { select(room) } label: {
                            HStack(spacing: 8) {
                                Text(selected ? FlowCopy.text(.roomChosen, settings.language) : FlowCopy.text(.chooseRoom, settings.language))
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.78)
                                Spacer(minLength: 4)
                                Image(systemName: selected ? "checkmark" : "arrow.right")
                                    .font(.system(size: 13, weight: .bold))
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(RoomSelectButtonStyle(selected: selected))
                        .disabled(isSavingSelection)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
            .frame(width: proxy.size.width, height: cardHeight)
        }
        .frame(height: cardHeight)
        .background(Color.iumrahCardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .strokeBorder(selected ? Color.iumrahCareLight.opacity(0.62) : Color.primary.opacity(0.055), lineWidth: selected ? 1.2 : 0.6)
        }
        .shadow(color: .black.opacity(0.04), radius: 12, y: 5)
    }

    @ViewBuilder
    private func roomFacts(_ room: HotelRoom) -> some View {
        if let guests = room.maxGuests {
            compactFact(icon: "person.2.fill", text: "\(guests)")
        }
        if let beds = cleanFact(room.beds) {
            compactFact(icon: "bed.double.fill", text: beds)
        }
        if let size = room.sizeM2 {
            compactFact(icon: "ruler", text: "\(Int(size)) m²")
        }
    }

    private func roomFactPill(icon: String, text: String) -> some View {
        Label(text, systemImage: icon)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white)
            .lineLimit(1)
            .padding(.horizontal, 11)
            .frame(height: 36)
            .background(.white.opacity(0.14), in: Capsule())
    }

    private func compactFact(icon: String, text: String) -> some View {
        Label(text, systemImage: icon)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .padding(.horizontal, 10)
            .frame(height: 32)
            .background(Color.iumrahRaisedBackground, in: Capsule())
    }

    private func roomImageSelectionBinding(for roomID: String) -> Binding<Int> {
        Binding(
            get: { roomImageIndices[roomID] ?? 0 },
            set: { roomImageIndices[roomID] = $0 }
        )
    }

    private func localizedRoomCategoryName(_ category: IumrahRoomCategory) -> String {
        switch category {
        case .double: return L10n.text("room_type_double", settings.language)
        case .triple: return L10n.text("room_type_triple", settings.language)
        case .quadruple: return L10n.text("room_type_quad", settings.language)
        }
    }

    private func localizedRoomCategoryBeds(_ category: IumrahRoomCategory) -> String {
        switch category {
        case .double: return L10n.text("room_beds_double", settings.language)
        case .triple: return L10n.text("room_beds_triple", settings.language)
        case .quadruple: return L10n.text("room_beds_quad", settings.language)
        }
    }

    private func localizedRoomName(_ raw: String) -> String {
        let raw = IumrahHotelRoomTitle.display(rate: raw, fallback: IumrahFlightCopy.text(settings.language, "Номер", "Room", "Xona", "Хона"))
        let normalized = normalize(raw)
        if normalized.contains("twin") && normalized.contains("city view") {
            switch settings.language {
            case .english, .turkish, .indonesian, .malay, .arabic: return "Twin Room · City View"
            case .russian: return "Twin · Вид на город"
            case .uzbek: return "Twin xona · Shahar manzarasi"
            case .uzbekCyrillic: return "Twin хона · Шаҳар манзараси"
            }
        }
        if normalized.contains("king") && normalized.contains("city view") {
            switch settings.language {
            case .english, .turkish, .indonesian, .malay, .arabic: return "King Room · City View"
            case .russian: return "King · Вид на город"
            case .uzbek: return "King xona · Shahar manzarasi"
            case .uzbekCyrillic: return "King хона · Шаҳар манзараси"
            }
        }
        if normalized.contains("double") && normalized.contains("city view") {
            switch settings.language {
            case .english, .turkish, .indonesian, .malay, .arabic: return "Double Room · City View"
            case .russian: return "Двухместный · Вид на город"
            case .uzbek: return "Ikki kishilik xona · Shahar manzarasi"
            case .uzbekCyrillic: return "Икки кишилик хона · Шаҳар манзараси"
            }
        }
        return raw
    }

    private func categoryIcon(_ category: IumrahRoomCategory) -> String {
        switch category {
        case .double: return "bed.double.fill"
        case .triple: return "person.3.fill"
        case .quadruple: return "person.3.fill"
        }
    }

    private func cleanFact(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let value = raw.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.count <= 80 else { return nil }
        let normalized = " \(value.lowercased()) "
        let pollutedTokens = [" sar ", "current price", "previous price", "select room", "% off", "taxes", "non-refundable"]
        guard !pollutedTokens.contains(where: normalized.contains) else { return nil }
        return value
    }

    private func cleanRoomDescription(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let value = raw.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }

        let pollutedTokens = [
            "the current price", "the previous price", "select room", "non-refundable",
            "total includes taxes", "we have ", "% off", " sar ", "double room double",
            "triple room triple", "quadruple room quadruple", "our lowest price"
        ]
        let normalized = " \(value.lowercased()) "
        guard !pollutedTokens.contains(where: normalized.contains) else { return nil }

        if value.count <= 190 { return value }
        let prefix = String(value.prefix(190))
        if let boundary = prefix.lastIndex(of: " ") {
            return String(prefix[..<boundary]) + "…"
        }
        return prefix + "…"
    }

    // MARK: - Remaining details

    private func aboutSection(_ detail: HotelDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle(L10n.text("hotel_about_title", settings.language))
            Text(detail.description)
                .font(.body)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(18)
                .background(Color.iumrahCardBackground)
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
    }

    @ViewBuilder
    private func mapSection(_ detail: HotelDetail) -> some View {
        if let latitude = detail.latitude, let longitude = detail.longitude {
            VStack(alignment: .leading, spacing: 14) {
                sectionTitle(L10n.text("hotel_location_title", settings.language))
                Map(initialPosition: .region(MKCoordinateRegion(
                    center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
                    span: MKCoordinateSpan(latitudeDelta: 0.015, longitudeDelta: 0.015)
                ))) {
                    Marker(hotel.name, coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude))
                }
                .frame(height: 245)
                .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))

                if let url = AppConfig.absoluteURL(detail.googleMapsURL) {
                    Link(destination: url) {
                        HStack {
                            Label(L10n.text("hotel_open_map", settings.language), systemImage: "map.fill")
                            Spacer()
                            Image(systemName: "arrow.up.right")
                        }
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 16)
                        .frame(height: 50)
                        .iumrahGlass(in: RoundedRectangle(cornerRadius: 17, style: .continuous), interactive: true)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func practicalSection(_ detail: HotelDetail) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionTitle(L10n.text("hotel_practical_title", settings.language))
            VStack(spacing: 0) {
                if let checkIn = detail.checkIn, !checkIn.isEmpty { practicalRow(L10n.text("hotel_checkin", settings.language), checkIn) }
                if let checkOut = detail.checkOut, !checkOut.isEmpty { Divider(); practicalRow(L10n.text("hotel_checkout", settings.language), checkOut) }
                if let type = detail.propertyType, !type.isEmpty { Divider(); practicalRow(L10n.text("hotel_property_type", settings.language), type) }
            }
            .padding(.horizontal, 18)
            .background(Color.iumrahCardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
    }

    private var loadingSection: some View {
        VStack(spacing: 12) { ProgressView(); Text(L10n.text("hotel_loading_detail", settings.language)).foregroundStyle(.secondary) }
            .frame(maxWidth: .infinity, minHeight: 210)
    }

    private func errorSection(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(message).font(.subheadline).foregroundStyle(.secondary)
            Button(L10n.text("retry", settings.language)) { Task { await load() } }
                .buttonStyle(IumrahSecondaryButtonStyle())
        }
        .padding(20)
        .background(Color.iumrahCardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func selectionBar(_ selectedName: String) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(FlowCopy.text(.selectedRoom, settings.language))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(selectedName)
                    .font(.headline)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Button {
                IumrahHaptics.success()
                onSelectionSaved?()
                dismiss()
            } label: {
                Text(FlowCopy.text(.done, settings.language))
                    .padding(.horizontal, 20)
            }
            .buttonStyle(IumrahPrimaryButtonStyle())
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color.iumrahCardBackground)
        .overlay(alignment: .top) { Divider().opacity(0.18) }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 26, weight: .bold, design: .rounded))
            .tracking(-0.4)
    }

    private func practicalRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.subheadline.weight(.semibold))
            Spacer(minLength: 12)
            Text(value).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 15)
    }

    // MARK: - Selection

    private func isRoomSelected(_ room: HotelRoom) -> Bool {
        if selectedRoomID == room.id && selectedRoomCategory == nil { return true }

        switch selectionRole {
        case .makkah:
            return journey.selectedHotel?.id == hotel.id && journey.selectedRoom?.id == room.id && journey.selectedRoomCategory == nil
        case .madinah:
            return journey.selectedMadinahHotel?.id == hotel.id && journey.selectedMadinahRoom?.id == room.id && journey.selectedMadinahRoomCategory == nil
        }
    }

    private func isCategorySelected(_ option: IumrahRoomCategoryOption) -> Bool {
        if selectedRoomCategory?.category == option.category { return true }

        switch selectionRole {
        case .makkah:
            return journey.selectedHotel?.id == hotel.id && journey.selectedRoomCategory?.category == option.category
        case .madinah:
            return journey.selectedMadinahHotel?.id == hotel.id && journey.selectedMadinahRoomCategory?.category == option.category
        }
    }

    private func select(_ room: HotelRoom) {
        guard canSelectRooms else { return }
        selectionError = nil
        selectedRoomID = room.id
        selectedRoomCategory = nil

        if bookingID != nil {
            return // Existing staff bookings are edited in Business, not the customer API.
        } else {
            if selectionRole == .makkah {
                journey.chooseHotel(hotel)
                journey.chooseRoom(room)
            } else {
                journey.chooseMadinahHotel(hotel)
                journey.chooseMadinahRoom(room)
            }
            IumrahHaptics.success()
            onSelectionSaved?()
            dismiss()
        }
    }

    private func select(_ option: IumrahRoomCategoryOption) {
        guard canSelectRooms else { return }
        selectionError = nil
        selectedRoomID = nil
        selectedRoomCategory = option

        if bookingID != nil {
            return // Existing staff bookings are edited in Business, not the customer API.
        } else {
            if selectionRole == .makkah {
                journey.chooseHotel(hotel)
                journey.chooseRoomCategory(option)
            } else {
                journey.chooseMadinahHotel(hotel)
                journey.chooseMadinahRoomCategory(option)
            }
            IumrahHaptics.success()
            onSelectionSaved?()
            dismiss()
        }
    }

    // MARK: - Images

    private func images(for room: HotelRoom, detail: HotelDetail) -> [HotelImage] {
        let roomName = normalize(room.name)
        let strong = detail.images.filter { image in
            let candidate = normalize([image.roomName, image.label].compactMap { $0 }.joined(separator: " "))
            return !candidate.isEmpty && (candidate.contains(roomName) || roomName.contains(candidate))
        }
        if !strong.isEmpty { return strong.sorted(by: imageSort) }

        let tokens = meaningfulTokens(room.name)
        let tokenMatches = detail.images.filter { image in
            let candidate = normalize([image.roomName, image.label, image.category].compactMap { $0 }.joined(separator: " "))
            return tokens.contains(where: { candidate.contains($0) })
        }
        if !tokenMatches.isEmpty { return tokenMatches.sorted(by: imageSort) }

        // Do not show a random room photo just to fill the card. If the backend
        // does not provide enough metadata for a safe match, the card uses the
        // deliberate room placeholder instead of misleading the pilgrim.
        return []
    }

    private func images(for category: IumrahRoomCategory, detail: HotelDetail) -> [HotelImage] {
        let terms: [String]
        switch category {
        case .double: terms = ["double", "king", "couple"]
        case .triple: terms = ["triple", "three", "3 bed"]
        case .quadruple: terms = ["quad", "four", "4 bed", "family"]
        }
        return detail.images.filter { image in
            let candidate = normalize([image.roomName, image.label, image.category].compactMap { $0 }.joined(separator: " "))
            return terms.contains(where: { candidate.contains($0) })
        }.sorted(by: imageSort)
    }

    private func roomCategoryBody(_ category: IumrahRoomCategory) -> String {
        switch category {
        case .double: return FlowCopy.text(.doubleRoomBody, settings.language)
        case .triple: return FlowCopy.text(.tripleRoomBody, settings.language)
        case .quadruple: return FlowCopy.text(.quadrupleRoomBody, settings.language)
        }
    }

    private func meaningfulTokens(_ value: String) -> [String] {
        let normalized = normalize(value)
        return ["double", "triple", "quad", "king", "twin", "suite", "deluxe", "family", "standard", "executive"]
            .filter { normalized.contains($0) }
    }

    private func normalize(_ value: String) -> String {
        value.lowercased().replacingOccurrences(of: "-", with: " ").replacingOccurrences(of: "_", with: " ")
    }

    private func imageSort(_ lhs: HotelImage, _ rhs: HotelImage) -> Bool {
        if lhs.isCover != rhs.isCover { return lhs.isCover && !rhs.isCover }
        return lhs.position < rhs.position
    }

    private func hotelImage(_ rawURL: String?) -> some View {
        HotelCachedImage(rawURL: rawURL)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipped()
    }

    private func ratingTitle(_ rating: Double) -> String {
        if rating >= 9 { return L10n.text("hotel_rating_exceptional", settings.language) }
        if rating >= 8 { return L10n.text("hotel_rating_very_good", settings.language) }
        if rating >= 7 { return L10n.text("hotel_rating_good", settings.language) }
        return L10n.text("hotel_selected_quality", settings.language)
    }

    private func localizedAmenity(_ raw: String) -> String {
        let normalized = raw.lowercased()
        if normalized.contains("breakfast") { return L10n.text("amenity_breakfast", settings.language) }
        if normalized.contains("transfer") || normalized.contains("shuttle") { return L10n.text("amenity_transfer", settings.language) }
        if normalized.contains("wifi") || normalized.contains("wi-fi") { return L10n.text("amenity_wifi", settings.language) }
        if normalized.contains("parking") { return L10n.text("amenity_parking", settings.language) }
        if normalized.contains("restaurant") { return L10n.text("amenity_restaurant", settings.language) }
        if normalized.contains("air condition") { return L10n.text("amenity_air_conditioning", settings.language) }
        if normalized.contains("family") { return L10n.text("amenity_family_rooms", settings.language) }
        if normalized.contains("24") || normalized.contains("reception") { return L10n.text("amenity_reception", settings.language) }
        if normalized.contains("lift") || normalized.contains("elevator") { return L10n.text("amenity_elevator", settings.language) }
        if normalized.contains("laundry") { return L10n.text("amenity_laundry", settings.language) }
        if normalized.contains("coffee") || normalized.contains("cafe") { return L10n.text("amenity_coffee_shop", settings.language) }
        if normalized.contains("concierge") { return L10n.text("amenity_concierge", settings.language) }
        if normalized.contains("spa") { return L10n.text("amenity_spa", settings.language) }
        if normalized.contains("dry clean") { return L10n.text("amenity_dry_cleaning", settings.language) }
        if normalized.contains("luggage") || normalized.contains("baggage") { return L10n.text("amenity_luggage_storage", settings.language) }
        if normalized.contains("fitness") || normalized.contains("gym") { return L10n.text("amenity_fitness_center", settings.language) }
        if normalized.contains("room service") { return L10n.text("amenity_room_service", settings.language) }
        if normalized.contains("non-smoking") || normalized.contains("non smoking") { return L10n.text("amenity_non_smoking", settings.language) }
        return raw
    }

    private func amenityIcon(_ raw: String) -> String {
        let normalized = raw.lowercased()
        if normalized.contains("breakfast") || normalized.contains("restaurant") { return "fork.knife" }
        if normalized.contains("transfer") || normalized.contains("shuttle") { return "bus.fill" }
        if normalized.contains("wifi") || normalized.contains("wi-fi") { return "wifi" }
        if normalized.contains("parking") { return "parkingsign.circle" }
        if normalized.contains("air condition") { return "snowflake" }
        if normalized.contains("family") { return "person.2.fill" }
        if normalized.contains("24") || normalized.contains("reception") { return "bell.fill" }
        if normalized.contains("lift") || normalized.contains("elevator") { return "arrow.up.arrow.down" }
        if normalized.contains("laundry") || normalized.contains("dry clean") { return "tshirt.fill" }
        if normalized.contains("coffee") || normalized.contains("cafe") { return "cup.and.saucer.fill" }
        if normalized.contains("concierge") { return "bell.fill" }
        if normalized.contains("spa") { return "leaf.fill" }
        if normalized.contains("luggage") || normalized.contains("baggage") { return "suitcase.fill" }
        if normalized.contains("fitness") || normalized.contains("gym") { return "figure.run" }
        if normalized.contains("room service") { return "fork.knife" }
        if normalized.contains("non-smoking") || normalized.contains("non smoking") { return "nosign" }
        return "checkmark"
    }

    @MainActor
    private func loadRoomCategories() async {
        guard !isLoadingRoomCategories else { return }
        isLoadingRoomCategories = true
        roomCategoryError = nil
        defer { isLoadingRoomCategories = false }
        do {
            roomCategories = try await packageEngine.roomCategories(hotelID: hotel.id)
        } catch {
            roomCategories = []
            roomCategoryError = FlowCopy.text(.roomsError, settings.language)
        }
    }

    @MainActor
    private func load() async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let loaded = try await service.hotelDetail(id: hotel.id)
            detail = loaded
        } catch {
            errorMessage = L10n.text("hotels_load_error", settings.language)
        }
    }
}

private struct RoomSelectButtonStyle: ButtonStyle {
    let selected: Bool
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(selected ? Color.iumrahCareDark : Color.primary)
            .padding(.horizontal, 18)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .iumrahGlass(
                in: RoundedRectangle(cornerRadius: 17, style: .continuous),
                interactive: true,
                tint: selected ? Color.iumrahCareLight.opacity(0.22) : nil
            )
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .opacity(configuration.isPressed ? 0.90 : 1)
    }
}

private struct ReceptionClock: View {
    let city: String
    let timeZoneID: String

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            VStack(spacing: 8) {
                clockFace(date: context.date)
                    .frame(width: 52, height: 52)

                Text(city)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)

                Text(timeText(context.date))
                    .font(.system(size: 19, weight: .bold, design: .rounded).monospacedDigit())
                    .lineLimit(1)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 118)
            .background(Color.iumrahCardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.05), lineWidth: 0.5)
            }
        }
    }

    private func clockFace(date: Date) -> some View {
        Canvas { context, size in
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let radius = min(size.width, size.height) / 2 - 1

            let circle = Path(ellipseIn: CGRect(
                x: center.x - radius,
                y: center.y - radius,
                width: radius * 2,
                height: radius * 2
            ))
            context.fill(circle, with: .color(Color.iumrahRaisedBackground))
            context.stroke(circle, with: .color(Color.primary.opacity(0.10)), lineWidth: 0.7)

            for tick in 0..<12 {
                let angle = Double(tick) * .pi / 6 - .pi / 2
                let outer = CGPoint(
                    x: center.x + cos(angle) * (radius - 5),
                    y: center.y + sin(angle) * (radius - 5)
                )
                let innerRadius = radius - (tick % 3 == 0 ? 10 : 8)
                let inner = CGPoint(
                    x: center.x + cos(angle) * innerRadius,
                    y: center.y + sin(angle) * innerRadius
                )
                var tickPath = Path()
                tickPath.move(to: inner)
                tickPath.addLine(to: outer)
                context.stroke(
                    tickPath,
                    with: .color(Color.primary.opacity(tick % 3 == 0 ? 0.56 : 0.24)),
                    lineWidth: tick % 3 == 0 ? 1.2 : 0.7
                )
            }

            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: timeZoneID) ?? .current
            let components = calendar.dateComponents([.hour, .minute], from: date)
            let hour = Double(components.hour ?? 0) + Double(components.minute ?? 0) / 60
            let minute = Double(components.minute ?? 0)
            drawHand(context: &context, center: center, radius: radius * 0.47, angle: hour / 12 * 2 * .pi - .pi / 2, width: 2.4)
            drawHand(context: &context, center: center, radius: radius * 0.67, angle: minute / 60 * 2 * .pi - .pi / 2, width: 1.4)
            context.fill(Path(ellipseIn: CGRect(x: center.x - 2.1, y: center.y - 2.1, width: 4.2, height: 4.2)), with: .color(.primary))
        }
    }

    private func drawHand(context: inout GraphicsContext, center: CGPoint, radius: CGFloat, angle: Double, width: CGFloat) {
        let point = CGPoint(x: center.x + cos(angle) * radius, y: center.y + sin(angle) * radius)
        var path = Path()
        path.move(to: center)
        path.addLine(to: point)
        context.stroke(path, with: .color(.primary), style: StrokeStyle(lineWidth: width, lineCap: .round))
    }

    private func timeText(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: timeZoneID)
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
}

struct HotelGalleryView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var settings: AppSettingsStore
    let hotelName: String
    let images: [HotelImage]

    @State private var selectedCategory = "all"
    @State private var viewerImage: HotelImage?

    private var sortedImages: [HotelImage] { images.sorted(by: imageSort) }

    private var categories: [String] {
        var values = ["all"]
        for image in sortedImages {
            let category = image.category.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if !category.isEmpty && !values.contains(category) { values.append(category) }
        }
        return values
    }

    private var filteredImages: [HotelImage] {
        guard selectedCategory != "all" else { return sortedImages }
        return sortedImages.filter { $0.category.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == selectedCategory }
    }

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 20) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(categories, id: \.self) { category in
                                Button {
                                    selectedCategory = category
                                    IumrahHaptics.selection()
                                } label: {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(categoryTitle(category))
                                            .font(.subheadline.weight(.semibold))
                                        Text("\(count(for: category))")
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }
                                    .padding(.horizontal, 15)
                                    .frame(height: 56)
                                    .background(
                                        selectedCategory == category ? Color.iumrahRaisedBackground : Color.iumrahCardBackground,
                                        in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    )
                                    .overlay {
                                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                                            .strokeBorder(selectedCategory == category ? Color.primary.opacity(0.38) : Color.primary.opacity(0.07), lineWidth: selectedCategory == category ? 1.2 : 0.7)
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, IumrahDesign.pagePadding)
                    }


                    Text(selectedCategory == "all"
                         ? "\(L10n.text("hotel_gallery_all", settings.language)) (\(filteredImages.count))"
                         : "\(categoryTitle(selectedCategory)) (\(filteredImages.count))")
                        .font(.system(size: 27, weight: .bold, design: .rounded))

                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 5), count: 3), spacing: 5) {
                        ForEach(filteredImages) { image in
                            Button {
                                viewerImage = image
                            } label: {
                                HotelCachedImage(rawURL: image.url)
                                    .aspectRatio(1, contentMode: .fill)
                                    .frame(maxWidth: .infinity)
                                    .clipped()
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, IumrahDesign.pagePadding)
                .padding(.bottom, 34)
            }
            .background(Color.iumrahPageBackground.ignoresSafeArea())
            .navigationTitle(hotelName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L10n.text("settings_done", settings.language)) { dismiss() }
                }
            }
        }
        .fullScreenCover(item: $viewerImage) { image in
            HotelImageViewer(images: filteredImages, initialImageID: image.id)
        }
    }

    private func count(for category: String) -> Int {
        category == "all" ? sortedImages.count : sortedImages.filter { $0.category.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == category }.count
    }

    private func categoryTitle(_ category: String) -> String {
        guard category != "all" else { return L10n.text("hotel_gallery_all", settings.language) }
        let normalized = category.lowercased()
        if normalized.contains("room") { return L10n.text("hotel_gallery_rooms", settings.language) }
        if normalized.contains("bath") { return L10n.text("hotel_gallery_bathroom", settings.language) }
        if normalized.contains("restaurant") || normalized.contains("food") { return L10n.text("hotel_gallery_restaurant", settings.language) }
        if normalized.contains("lobby") || normalized.contains("reception") { return L10n.text("hotel_gallery_lobby", settings.language) }
        if normalized.contains("view") || normalized.contains("exterior") { return L10n.text("hotel_gallery_view", settings.language) }
        if normalized.contains("facility") || normalized.contains("amenit") { return L10n.text("hotel_gallery_facility", settings.language) }
        return category.replacingOccurrences(of: "_", with: " ").capitalized
    }

    private func imageSort(_ lhs: HotelImage, _ rhs: HotelImage) -> Bool {
        if lhs.isCover != rhs.isCover { return lhs.isCover && !rhs.isCover }
        return lhs.position < rhs.position
    }
}

private struct HotelImageViewer: View {
    @Environment(\.dismiss) private var dismiss
    let images: [HotelImage]
    @State private var index: Int

    init(images: [HotelImage], initialImageID: String) {
        self.images = images
        _index = State(initialValue: images.firstIndex(where: { $0.id == initialImageID }) ?? 0)
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if images.isEmpty {
                Image(systemName: "photo")
                    .font(.system(size: 44, weight: .light))
                    .foregroundStyle(.white.opacity(0.45))
            } else {
                TabView(selection: $index) {
                    ForEach(Array(images.enumerated()), id: \.element.id) { offset, image in
                        ZoomableHotelImage(rawURL: image.url)
                            .tag(offset)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
            }
        }
        .overlay(alignment: .topLeading) {
            IumrahGlassIconButton(systemName: "xmark", size: 46, foreground: .white,
                tint: .black.opacity(0.22), accessibilityLabel: "Close") { dismiss() }
                .environment(\.colorScheme, .dark)
            .padding(18)
        }
        .overlay(alignment: .topTrailing) {
            if !images.isEmpty {
                Text("\(min(index + 1, images.count))/\(images.count)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .frame(height: 36)
                    .iumrahGlass(in: Capsule(), tint: .black.opacity(0.22), allowsStaticGlass: true, chrome: true)
                    .padding(22)
            }
        }
    }
}

private struct ZoomableHotelImage: View {
    let rawURL: String
    @State private var scale: CGFloat = 1
    @State private var previousScale: CGFloat = 1

    var body: some View {
        HotelCachedImage(rawURL: rawURL, contentMode: .fit, placeholderSystemName: "photo")
            .scaleEffect(scale)
            .gesture(
                MagnificationGesture()
                    .onChanged { value in
                        scale = min(4, max(1, previousScale * value))
                    }
                    .onEnded { _ in
                        previousScale = scale
                        if scale < 1.05 {
                            scale = 1
                            previousScale = 1
                        }
                    }
            )
            .onTapGesture(count: 2) {
                withAnimation(.easeInOut(duration: 0.2)) {
                    scale = scale > 1 ? 1 : 2
                    previousScale = scale
                }
            }
    }
}
