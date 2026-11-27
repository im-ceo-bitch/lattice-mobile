import SwiftUI

enum HotelSelectionRole: String, Hashable {
    case makkah
    case madinah
}

struct HotelSelectionView: View {
    @EnvironmentObject private var journey: JourneyStore
    @EnvironmentObject private var settings: AppSettingsStore
    @Environment(\.iumrahAdaptiveLayout) private var adaptiveLayout
    @Environment(\.dismiss) private var dismiss
    @State private var initialSelectionSignature: String = ""
    @State private var didStoreInitialSelection = false
    let role: HotelSelectionRole

    init(role: HotelSelectionRole = .makkah) {
        self.role = role
    }

    private var sourceHotels: [HotelSummary] {
        role == .makkah ? journey.hotels : journey.madinahHotels
    }

    private var selectedHotelID: String? {
        role == .makkah ? journey.selectedHotel?.id : journey.selectedMadinahHotel?.id
    }

    private var filteredHotels: [HotelSummary] {
        let allowed = Set(journey.trip.packageTier.selectableHotelStars)
        return sourceHotels
            .filter { hotel in
                guard let stars = hotel.stars else { return false }
                return allowed.contains(stars)
            }
            .sorted { lhs, rhs in
                let lhsPrimary = lhs.stars == journey.trip.packageTier.primaryHotelStars
                let rhsPrimary = rhs.stars == journey.trip.packageTier.primaryHotelStars
                if lhsPrimary != rhsPrimary { return lhsPrimary && !rhsPrimary }
                if lhs.hasFreshCatalogPrice != rhs.hasFreshCatalogPrice {
                    return lhs.hasFreshCatalogPrice && !rhs.hasFreshCatalogPrice
                }
                if lhs.stars != rhs.stars { return (lhs.stars ?? 0) > (rhs.stars ?? 0) }
                return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
            }
    }

    private var primaryHotels: [HotelSummary] {
        filteredHotels.filter { $0.stars == journey.trip.packageTier.primaryHotelStars }
    }

    private var superEconomyHotels: [HotelSummary] {
        guard journey.trip.packageTier == .economy else { return [] }
        return filteredHotels.filter { $0.stars == 1 }
    }

    @ViewBuilder
    private func hotelLink(_ hotel: HotelSummary) -> some View {
        NavigationLink {
            HotelDetailView(hotel: hotel, selectionFlow: true, selectionRole: role)
        } label: {
            HotelCard(
                hotel: hotel,
                badge: selectedHotelID == hotel.id
                    ? FlowCopy.text(.selected, settings.language)
                    : (journey.trip.packageTier == .economy && hotel.stars == 1 ? superEconomyTitle : nil)
            )
        }
        .buttonStyle(.plain)
    }

    private func hotelSectionHeader(_ title: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.headline)
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 4)
    }

    private var economyHotelsTitle: String {
        switch settings.language {
        case .russian: return "Эконом · 2★"
        case .turkish: return TurkishLocalization.phrase("Economy · 2★")
        case .arabic: return ArabicLocalization.phrase("Economy · 2★")
        case .indonesian, .malay, .english: return "Economy · 2★"
        case .uzbek: return "Ekonom · 2★"
        case .uzbekCyrillic: return "Эконом · 2★"
        }
    }

    private var economyHotelsBody: String {
        switch settings.language {
        case .russian: return "Основной выбор категории — практичные 2★ отели."
        case .turkish: return TurkishLocalization.phrase("The main Economy selection: practical 2★ hotels.")
        case .arabic: return ArabicLocalization.phrase("The main Economy selection: practical 2★ hotels.")
        case .indonesian, .malay, .english: return "The main Economy selection: practical 2★ hotels."
        case .uzbek: return "Ekonom toifasining asosiy tanlovi — amaliy 2★ mehmonxonalar."
        case .uzbekCyrillic: return "Эконом тоифасининг асосий танлови — амалий 2★ меҳмонхоналар."
        }
    }

    private var superEconomyTitle: String {
        switch settings.language {
        case .russian: return "Super Economy · 1★"
        case .turkish: return TurkishLocalization.phrase("Super Economy · 1★")
        case .arabic: return ArabicLocalization.phrase("Super Economy · 1★")
        case .indonesian, .malay, .english: return "Super Economy · 1★"
        case .uzbek: return "Super Economy · 1★"
        case .uzbekCyrillic: return "Super Economy · 1★"
        }
    }

    private var superEconomyBody: String {
        switch settings.language {
        case .russian: return "Если важнее минимальная стоимость пакета — доступны и 1★ варианты."
        case .turkish: return TurkishLocalization.phrase("If the lowest package price matters most, 1★ options are also available.")
        case .arabic: return ArabicLocalization.phrase("If the lowest package price matters most, 1★ options are also available.")
        case .indonesian, .malay, .english: return "If the lowest package price matters most, 1★ options are also available."
        case .uzbek: return "Paket narxini yanada kamaytirish muhim bo‘lsa, 1★ variantlar ham mavjud."
        case .uzbekCyrillic: return "Пакет нархини янада камайтириш муҳим бўлса, 1★ вариантлар ҳам мавжуд."
        }
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(spacing: 18) {
                VStack(alignment: .leading, spacing: 9) {
                    Text(role == .makkah ? FlowCopy.text(.hotelSelectionTitleMakkah, settings.language) : FlowCopy.text(.hotelSelectionTitleMadinah, settings.language))
                        .font(.system(size: 32, weight: .bold, design: .rounded))
                        .tracking(-0.7)
                    Text(FlowCopy.text(.hotelSelectionBody, settings.language))
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                IumrahRefundPolicyCard(component: .hotel, compact: true)

                if filteredHotels.isEmpty {
                    VStack(spacing: 14) {
                        if role == .makkah ? journey.isLoadingHotels : journey.isLoadingMadinahHotels {
                            ProgressView()
                        } else {
                            Image(systemName: "building.2")
                                .font(.largeTitle)
                                .foregroundStyle(.secondary)
                        }
                        Text(L10n.text("primary_hotel_empty", settings.language))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 48)
                } else {
                    if journey.trip.packageTier == .economy {
                        if !primaryHotels.isEmpty {
                            hotelSectionHeader(
                                economyHotelsTitle,
                                subtitle: economyHotelsBody
                            )
                            hotelCards(primaryHotels)
                        }

                        if !superEconomyHotels.isEmpty {
                            hotelSectionHeader(
                                superEconomyTitle,
                                subtitle: superEconomyBody
                            )
                            hotelCards(superEconomyHotels)
                        }
                    } else {
                        hotelCards(primaryHotels)
                    }
                }
            }
            .padding(.horizontal, IumrahDesign.pagePadding)
            .padding(.top, 12)
            .padding(.bottom, 42)
        }
        .background(Color.iumrahPageBackground)
        .iumrahInternalNavigation(progress: nil)
        .task {
            if role == .makkah, journey.hotels.isEmpty { await journey.loadMakkahHotels() }
            if role == .madinah, journey.madinahHotels.isEmpty { await journey.loadMadinahHotels() }
            storeInitialSelectionIfNeeded()
        }
        .onAppear {
            storeInitialSelectionIfNeeded()
        }
        .onChange(of: currentSelectionSignature) { _, newValue in
            guard didStoreInitialSelection else {
                initialSelectionSignature = newValue
                didStoreInitialSelection = true
                return
            }
            guard !newValue.isEmpty, newValue != initialSelectionSignature else { return }
            initialSelectionSignature = newValue
            dismiss()
        }
    }

    @ViewBuilder
    private func hotelCards(_ hotels: [HotelSummary]) -> some View {
        if adaptiveLayout.layoutClass == .compact {
            ForEach(hotels) { hotel in
                hotelLink(hotel)
            }
        } else {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 320, maximum: 520), spacing: 16, alignment: .top)],
                alignment: .leading,
                spacing: 16
            ) {
                ForEach(hotels) { hotel in
                    hotelLink(hotel)
                }
            }
        }
    }

    private var currentSelectionSignature: String {
        let hotelID = role == .makkah ? journey.selectedHotel?.id : journey.selectedMadinahHotel?.id
        let roomID = role == .makkah ? journey.selectedRoom?.id : journey.selectedMadinahRoom?.id
        let categoryID = role == .makkah ? journey.selectedRoomCategory?.id : journey.selectedMadinahRoomCategory?.id
        return [hotelID ?? "", roomID ?? "", categoryID ?? ""].joined(separator: "|")
    }

    private func storeInitialSelectionIfNeeded() {
        guard !didStoreInitialSelection else { return }
        initialSelectionSignature = currentSelectionSignature
        didStoreInitialSelection = true
    }
}
