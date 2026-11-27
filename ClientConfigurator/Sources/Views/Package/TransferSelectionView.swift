import SwiftUI
import Foundation

struct TransferSelectionView: View {
    @EnvironmentObject private var journey: JourneyStore
    @EnvironmentObject private var settings: AppSettingsStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var inheritedColorScheme
    @Environment(\.iumrahAdaptiveLayout) private var adaptiveLayout

    @State private var selectedIndex = 1
    @State private var showFinalPackage = false
    @State private var isConfirming = false
    @State private var confirmationError: String?

    private let vehicles = TransferVehicleKind.allCases

    private var selectedVehicle: TransferVehicleKind {
        vehicles[min(max(selectedIndex, 0), vehicles.count - 1)]
    }

    private var includesMadinah: Bool { journey.trip.scope == .makkahAndMadinah }
    private var isVIP: Bool { selectedVehicle == .yukon }

    private var selectedVehicleAddOnUsd: Decimal {
        selectedVehicle.publicUpgradeUsd(for: journey.trip.scope)
    }

    private var currentPackageTotalUsd: Decimal? {
        guard journey.hasFinalGeneratorQuote else { return nil }
        return journey.quote?.totalPackagePrice
    }

    // Changes to the visible configuration invalidate the current quote. A
    // cancellable task requests a new server total, instead of synthesizing it.
    private var pricingSelectionKey: String {
        [selectedVehicle.rawValue, String(journey.haramainTrainSelected),
         journey.haramainFareClass.rawValue, String(journey.haramainTicketCount),
         String(journey.trip.hashValue)].joined(separator: "|")
    }

    var familyFlow = false
    var selectBeforeHotels = false
    @State private var showHotelsAfterTransfer = false
    var manualConfirm: ((TransferVehicleKind) -> Void)? = nil
    @State private var reviewing = false

    var body: some View {
        Group {
            if manualConfirm != nil {
                VStack(spacing: 20) {
                    vehicleStage
                    vehicleInformation
                    IumrahRefundPolicyCard(component: .transfer, compact: false)
                    if includesMadinah { haramainExpandedCard }
                    Button(localized("Добавить трансфер в пакет", "Add transfer to package", "Transferni paketga qo‘shish", "Трансферни пакетга қўшиш")) {
                        manualConfirm?(selectedVehicle)
                        IumrahHaptics.success()
                    }.buttonStyle(IumrahPrimaryButtonStyle())
                        .disabled(selectedVehicle.passengerCapacity < journey.trip.travelerCount)
                        .opacity(selectedVehicle.passengerCapacity < journey.trip.travelerCount ? 0.45 : 1)
                }.environment(\.colorScheme, isVIP ? .dark : .light)
            } else if familyFlow && reviewing { familyReview } else {
            matchedExperience
                .environment(\.colorScheme, isVIP ? .dark : .light)
        }
        }
        .modifier(IumrahTransferNavigationChrome(embedded: manualConfirm != nil))
        .background { if manualConfirm == nil { transferPageBackground } }
        .navigationDestination(isPresented: $showHotelsAfterTransfer) {
            AnyView(NuiteeJourneyHotelsView(transferAlreadySelected: true))
        }
        .navigationDestination(isPresented: $showFinalPackage) {
            AnyView(OfficialJourneyGuideStep(familyFlow: familyFlow))
        }
        .alert(errorTitle, isPresented: Binding(
            get: { confirmationError != nil },
            set: { if !$0 { confirmationError = nil } }
        )) {
            Button("OK", role: .cancel) { confirmationError = nil }
        } message: {
            Text(confirmationError ?? "")
        }
        .task { await prepareTransferSelection() }
        .task(id: pricingSelectionKey) {
            // Wait for a swipe/counter gesture to settle, never a request per frame.
            do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
            guard !Task.isCancelled, !isConfirming, !showFinalPackage, !showHotelsAfterTransfer, manualConfirm == nil, !selectBeforeHotels else { return }
            await refreshBasePackagePrice()
        }
    }

    private var transferPageBackground: some View {
        ZStack(alignment: .top) {
            Color.white
                .ignoresSafeArea(edges: .bottom)

            Color.black
                .opacity(isVIP ? 1 : 0)
                .ignoresSafeArea(edges: .bottom)


        }
        .animation(.easeInOut(duration: 0.58), value: isVIP)
    }

    private var pageBackground: Color {
        isVIP ? .black : .white
    }

    // MARK: - Matched Uber-style transfer service

    private var matchedExperience: some View {
        ZStack {
            pageBackground
                .ignoresSafeArea(edges: .bottom)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    IumrahJourneyHeader(showsNotifications: true) {
                        IumrahJourneyDisclosureCard(
                            title: localized("Ваш трансфер", "Your transfer", "Transferingiz", "Трансферингиз"),
                            total: currentPackagePriceTitle,
                            subtitle: "\(journey.trip.travelerCount) · " + routeTitle,
                            priceCaption: journey.hasFinalGeneratorQuote
                                ? localized("Итого за пакет", "Package total", "Paket jami", "Пакет жами")
                                : localized("За пакет", "Package total", "Paket jami", "Пакет жами")
                        ) {
                            IumrahTransferRouteDetails()
                        }
                    }
                    .environment(\.colorScheme, inheritedColorScheme)
                    VStack(spacing: 20) {
                    IumrahPageHelpCard("transfer.default", extraKey: includesMadinah ? "transfer.train" : nil)
                    if adaptiveLayout.isWide {
                        HStack(alignment: .top, spacing: 20) {
                            vehicleStage
                                .frame(maxWidth: .infinity, alignment: .top)

                            VStack(spacing: 16) {
                                vehicleInformation
                                IumrahRefundPolicyCard(component: .transfer, compact: false)
                            }
                            .frame(maxWidth: .infinity, alignment: .top)
                        }
                    } else {
                        vehicleStage
                        vehicleInformation
                        IumrahRefundPolicyCard(component: .transfer, compact: false)
                    }

                    if includesMadinah {
                        haramainExpandedCard
                    }

                    if familyFlow {
                        Button(localized("Проверить поездку","Review trip","Safarni tekshirish","Сафарни текшириш")) { reviewing = true }
                            .buttonStyle(IumrahPrimaryButtonStyle())
                    } else { confirmationButton }
                }
                .padding(.horizontal, IumrahDesign.pagePadding)
                .padding(.top, 20)
                .padding(.bottom, 46)
                }
                .background(IumrahNoVerticalBounce())
            }
            .modifier(IumrahJourneyRefresh {
                await refreshBasePackagePrice()
            })
            .scrollBounceBehavior(.basedOnSize)
            .scrollContentBackground(.hidden)
        }
    }

    private var matchedHeader: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(isVIP ? .white : .green)
                Text(isVIP
                     ? localized("VIP TRANSFER", "VIP TRANSFER", "VIP TRANSFER", "VIP TRANSFER")
                     : localized("ВЫБОР ТРАНСФЕРА", "CHOOSE TRANSFER", "TRANSFERNI TANLANG", "ТРАНСФЕРНИ ТАНЛАНГ"))
                    .font(.caption.weight(.bold))
                    .tracking(1.0)
                    .foregroundStyle(.secondary)

                Spacer()

                Text("\(selectedIndex + 1) / \(vehicles.count)")
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .foregroundStyle(.secondary)
                    .contentTransition(.numericText())
            }

            Text(isVIP
                 ? localized("VIP трансфер", "VIP transfer", "VIP transfer", "VIP трансфер")
                 : localized("Выберите подходящий трансфер", "Choose your transfer class", "Transfer turini tanlang", "Трансфер турини танланг"))
                .font(.system(size: isVIP ? 38 : 32, weight: .bold, design: .rounded))
                .tracking(-0.9)

            Text("\(routeTitle) · \(dateRangeTitle)")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var vehicleStage: some View {
        TransferVehicleStage(selectedIndex: selectedIndex, label: vehicleClassTitle(selectedVehicle),
            isConfirming: isConfirming, onSelect: selectVehicleIndex)
    }

    private var vehicleInformation: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(vehicleClassTitle(selectedVehicle))
                        .font(.caption.weight(.bold))
                        .tracking(0.85)
                        .foregroundStyle(.secondary)
                    Text(selectedVehicle.modelName)
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .tracking(-0.45)
                        .contentTransition(.opacity)
                }

                Spacer(minLength: 8)

                VStack(alignment: .trailing, spacing: 6) {
                    Label(availabilityTitle, systemImage: "checkmark.circle.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(isVIP ? .white : .green)
                    if selectedVehicle == .carnival {
                        Text(localized("Рекомендуем", "Recommended", "Tavsiya", "Тавсия"))
                            .font(.caption2.weight(.bold))
                            .padding(.horizontal, 9)
                            .frame(height: 25)
                            .background((isVIP ? Color.white : Color.iumrahCareLight).opacity(0.14), in: Capsule())
                    }
                }
            }

            Text(vehicleRecommendationBody(selectedVehicle))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 9) {
                metricChip(systemName: "person.2.fill", text: passengerMetric)
                metricChip(systemName: "suitcase.fill", text: luggageMetric)
                if requiredVehicleCount(for: selectedVehicle) > 1 {
                    metricChip(systemName: "car.2.fill", text: "\(requiredVehicleCount(for: selectedVehicle)) ×")
                }
            }

            transferCoverageCard

            if manualConfirm == nil {
            Divider()
            HStack(alignment: .lastTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(localized("Изменение пакета", "Package change", "Paket o‘zgarishi", "Пакет ўзгариши"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(vehicleAddOnTitle)
                        .font(.title3.monospacedDigit().weight(.bold))
                        .contentTransition(.numericText())
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 3) {
                    Text(localized("Итог сейчас", "Current total", "Joriy jami", "Жорий жами"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(currentPackagePriceTitle)
                        .font(.title3.monospacedDigit().weight(.bold))
                        .contentTransition(.numericText())
                }
            }
            }
        }
        .padding(19)
        .background(Color.iumrahCardBackground, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.06), lineWidth: 0.7)
        }
    }

    private var haramainExpandedCard: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 12) {
                Image("HaramainMark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 48, height: 48)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                VStack(alignment: .leading, spacing: 3) {
                    Text("Haramain High Speed Railway")
                        .font(.headline)
                    Text(trainSegmentTitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 8)

                if journey.haramainTrainSelected {
                    Label(localized("Добавлено", "Added", "Qo‘shildi", "Қўшилди"), systemImage: "checkmark.circle.fill")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.green)
                }
            }

            HaramainPhotoGallery(compact: true)

            Text(localized(
                "Замените только междугородний участок Мекка ↔ Медина поездом. Автомобиль до станции и после прибытия остаётся частью вашего iumrah Transfer.",
                "Replace only the Makkah ↔ Madinah intercity segment by train. Your car transfer to the station and after arrival remains part of iumrah Transfer.",
                "Faqat Makka ↔ Madina shaharlararo qismini poyezdga almashtiring. Vokzalgacha va keyingi avtomobil transferi iumrah Transfer tarkibida qoladi.",
                "Фақат Макка ↔ Мадина шаҳарлараро қисмини поездга алмаштиринг. Вокзалгача ва кейинги автомобиль трансфери iumrah Transfer таркибида қолади."
            ))
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 8) {
                trainFact(icon: "speedometer", title: "300 km/h")
                trainFact(icon: "clock.fill", title: "≈ 2h 20m")
                trainFact(icon: "wifi", title: "Wi‑Fi")
            }

            VStack(spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(localized("Билеты для вашей группы", "Tickets for your party", "Guruhingiz uchun chiptalar", "Гуруҳингиз учун чипталар"))
                            .font(.subheadline.weight(.semibold))
                        Text(localized("Standard", "Standard", "Standard", "Standard") + " · " + usd(Decimal(150)) + " / " + localized("паломник", "pilgrim", "ziyoratchi", "зиёратчи"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text("+\(usd(standardTrainPreviewUsd))")
                        .font(.title3.monospacedDigit().weight(.bold))
                        .contentTransition(.numericText())
                }

                Divider()

                CounterRow(
                    title: L10n.text("adults", settings.language),
                    subtitle: usd(Decimal(150)) + " / " + localized("билет", "ticket", "chipta", "чипта"),
                    value: Binding(
                        get: { journey.haramainAdultTickets },
                        set: { journey.setHaramainAdultTickets($0) }
                    ),
                    minimum: 1,
                    maximum: max(1, journey.trip.adults)
                )

                if journey.trip.children > 0 {
                    Divider()
                    CounterRow(
                        title: L10n.text("children", settings.language),
                        subtitle: usd(Decimal(150)) + " / " + localized("место", "seat", "joy", "жой"),
                        value: Binding(
                            get: { journey.haramainChildTickets },
                            set: { journey.setHaramainChildTickets($0) }
                        ),
                        minimum: 0,
                        maximum: journey.trip.children
                    )
                }
            }
            .padding(15)
            .background(Color.iumrahRaisedBackground, in: RoundedRectangle(cornerRadius: 22, style: .continuous))

            Button {
                journey.ensureHaramainTicketDefaults()
                        journey.setHaramainTrainSelected(!journey.haramainTrainSelected)
                journey.haramainTrainSelected ? IumrahHaptics.success() : IumrahHaptics.selection()
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: journey.haramainTrainSelected ? "checkmark.circle.fill" : "plus.circle.fill")
                        .font(.system(size: 20, weight: .bold))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(journey.haramainTrainSelected
                             ? localized("Поезд подключён", "Train added", "Poyezd qo‘shildi", "Поезд қўшилди")
                             : localized("Подключить поезд к поездке", "Add train to this trip", "Poyezdni safarga qo‘shish", "Поездни сафарга қўшиш"))
                            .font(.headline)
                        Text(journey.haramainTrainSelected
                             ? localized("Нажмите, чтобы отключить", "Tap to remove", "Olib tashlash uchun bosing", "Олиб ташлаш учун босинг")
                             : "+" + usd(standardTrainPreviewUsd) + " · Standard")
                            .font(.caption)
                            .opacity(0.72)
                    }
                    Spacer()
                    Image(systemName: journey.haramainTrainSelected ? "checkmark" : "arrow.right")
                        .font(.system(size: 14, weight: .bold))
                }
                .foregroundStyle(journey.haramainTrainSelected ? Color.white : Color.white)
                .padding(.horizontal, 17)
                .frame(maxWidth: .infinity)
                .frame(height: 62)
                .background(journey.haramainTrainSelected ? Color.green : Color.black, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .padding(18)
        .background(Color.iumrahCardBackground, in: RoundedRectangle(cornerRadius: 30, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .strokeBorder(journey.haramainTrainSelected ? Color.green.opacity(0.35) : Color.primary.opacity(0.06), lineWidth: 0.8)
        }
    }

    private func trainFact(icon: String, title: String) -> some View {
        Label(title, systemImage: icon)
            .font(.caption.weight(.semibold))
            .frame(maxWidth: .infinity)
            .frame(height: 38)
            .background(Color.iumrahRaisedBackground, in: Capsule())
    }

    private var familyReview: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                IumrahPageHelpCard("transfer.review")
                IumrahFoundationCompactSteps(total: 8, current: 7, language: settings.language)
                Text(localized("Ваша поездка","Your trip","Safaringiz","Сафарингиз")).font(.largeTitle.bold())
                Label(journey.trip.originCode + " → " + journey.trip.outboundDestinationCode + " · " + journey.trip.returnOriginCode + " → " + journey.trip.originCode, systemImage: "airplane")
                Text(dateRangeTitle)
                Label(String(journey.trip.travelerCount), systemImage: "person.2")
                if let hotel = journey.selectedHotel { Label(hotel.name, systemImage: "bed.double") }
                if let hotel = journey.selectedMadinahHotel, includesMadinah { Label(hotel.name, systemImage: "bed.double") }
                Label(selectedVehicle.rawValue.capitalized, systemImage: "car")
                if journey.haramainTrainSelected { Label("Haramain", systemImage: "tram") }
                Text(localized("Стоимость пакета","Package total","Paket narxi","Пакет нархи")).font(.caption)
                Text(currentPackagePriceTitle).font(.title2.bold())
                Button(localized("Изменить услуги","Edit services","Xizmatlarni o‘zgartirish","Хизматларни ўзгартириш")) { reviewing = false }
                confirmationButton
                if isConfirming { FamilyQuoteOrbit(still: reduceMotion).frame(maxWidth: .infinity) }
            }.padding(20).disabled(isConfirming)
        }
    }

    private var confirmationButton: some View {
        Button {
            Task { await confirmTransfer() }
        } label: {
            HStack(spacing: 10) {
                if isConfirming { ProgressView().tint(.white) }
                VStack(alignment: .center, spacing: 2) {
                    Text(selectBeforeHotels ? localized("Далее: выбрать отели", "Next: choose hotels", "Keyingi: mehmonxonalar", "Кейинги: меҳмонхоналар") : isConfirming ? confirmingTitle : (familyFlow ? localized("Собрать пакет","Build package","Paketni yig‘ish","Пакетни йиғиш") : confirmTitle))
                    if !isConfirming && !selectBeforeHotels {
                        Text(currentPackagePriceTitle)
                            .font(.caption.monospacedDigit())
                            .opacity(0.74)
                    }
                }

            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(IumrahPrimaryButtonStyle())
        .disabled(isConfirming || selectedVehicle.passengerCapacity < journey.trip.travelerCount)
    }

    // MARK: - Interaction / pricing

    @MainActor
    private func prepareTransferSelection() async {
        let trace = IumrahPerformanceTrace.begin("Transfer prepare")
        defer { IumrahPerformanceTrace.end("Transfer prepare", trace) }
        journey.ensureHaramainTicketDefaults()
        if familyFlow {
            let choice = journey.selectedTransferVehicle ?? journey.recommendedTransferVehicle()
            selectedIndex = vehicles.firstIndex(of: choice) ?? 0
            journey.chooseTransferVehicle(choice)
            return
        }

        let selected = journey.selectedTransferVehicle ?? journey.recommendedTransferVehicle()
        selectedIndex = vehicles.firstIndex(of: selected) ?? 1
        if journey.selectedTransferVehicle == nil {
            journey.chooseTransferVehicle(selected)
        }

        // The pricingSelectionKey task refreshes the authoritative price.
    }

    @MainActor
    private func refreshBasePackagePrice() async {
        guard !selectBeforeHotels else { return }
        await journey.buildConfiguratorQuote(language: settings.language.hotelContentCode)
    }

    private func selectVehicleIndex(_ target: Int) {
        selectedIndex = target
        let selected = vehicles[target]
        if journey.selectedTransferVehicle != selected {
            journey.chooseTransferVehicle(selected)
            IumrahHaptics.selection()
        }
    }

    @MainActor
    private func confirmTransfer() async {
        let trace = IumrahPerformanceTrace.begin("Transfer confirm")
        defer { IumrahPerformanceTrace.end("Transfer confirm", trace) }
        guard !isConfirming else { return }
        isConfirming = true
        confirmationError = nil
        journey.chooseTransferVehicle(selectedVehicle)
        journey.confirmTransferSelection()
        if selectBeforeHotels {
            guard selectedVehicle.passengerCapacity >= journey.trip.travelerCount else {
                isConfirming = false; journey.transferSelectionConfirmed = false; return
            }
            isConfirming = false; showHotelsAfterTransfer = true; IumrahHaptics.success(); return
        }

        // A transient pricing error must not trap the user on the transfer step.
        // Final review owns the authoritative quote and still gates booking.
        guard selectedVehicle.passengerCapacity >= journey.trip.travelerCount else {
            journey.transferSelectionConfirmed = false
            isConfirming = false
            return
        }

        IumrahHaptics.success()
        isConfirming = false
        showFinalPackage = true
    }

    // MARK: - Copy / formatting

    private var transferCoverageCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(localized("Что входит в трансфер", "Included in your transfer", "Transferga kiradi", "Трансферга киради"))
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 0) {
                    coverageStop(icon: "airplane.arrival", title: localized("Аэропорт", "Airport", "Aeroport", "Аэропорт"))
                    coverageLine
                    coverageStop(icon: "building.2.fill", title: "Makkah")
                    if includesMadinah {
                        coverageLine
                        coverageStop(icon: journey.haramainTrainSelected ? "train.side.front.car" : "car.fill", title: localized("Межгород", "Intercity", "Shaharlararo", "Шаҳарлараро"))
                        coverageLine
                        coverageStop(icon: "building.2.fill", title: "Madinah")
                    }
                    coverageLine
                    coverageStop(icon: "airplane.departure", title: localized("Вылет", "Departure", "Jo‘nab ketish", "Жўнаб кетиш"))
                }
                .padding(.horizontal, 2)
            }
        }
        .padding(14)
        .background(Color.iumrahRaisedBackground, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func coverageStop(icon: String, title: String) -> some View {
        VStack(spacing: 6) {
            ZStack {
                Circle().fill(Color.primary.opacity(0.08)).frame(width: 34, height: 34)
                Image(systemName: icon).font(.system(size: 13, weight: .semibold))
            }
            Text(title).font(.caption2.weight(.semibold)).lineLimit(1)
        }
        .frame(minWidth: 62)
    }

    private var coverageLine: some View {
        Capsule()
            .fill(Color.primary.opacity(0.18))
            .frame(width: 32, height: 2)
            .offset(y: -10)
    }

    private func metricChip(systemName: String, text: String) -> some View {
        Label(text, systemImage: systemName)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 11)
            .frame(height: 34)
            .background(Color.iumrahRaisedBackground, in: Capsule())
    }

    private func vehicleClassTitle(_ vehicle: TransferVehicleKind) -> String {
        switch vehicle {
        case .malibu: return localized("Sedan", "Sedan", "Sedan", "Sedan")
        case .carnival: return localized("Family", "Family", "Family", "Family")
        case .yukon: return "VIP"
        }
    }

    private func vehicleRecommendationBody(_ vehicle: TransferVehicleKind) -> String {
        switch vehicle {
        case .malibu:
            return localized(
                "Компактный частный трансфер. Доступен без доплаты к текущему пакету.",
                "A compact private transfer, available with no package surcharge.",
                "Ixcham shaxsiy transfer. Joriy paketga qo‘shimcha to‘lovsiz.",
                "Ихчам шахсий трансфер. Жорий пакетга қўшимча тўловсиз."
            )
        case .carnival:
            return localized(
                "Рекомендованный iumrah Family Transfer: больше пространства для семьи и багажа, без доплаты.",
                "The recommended iumrah Family Transfer: more room for your party and luggage with no surcharge.",
                "Tavsiya etilgan iumrah Family Transfer: oila va bagaj uchun ko‘proq joy, qo‘shimcha to‘lovsiz.",
                "Тавсия этилган iumrah Family Transfer: оила ва багаж учун кўпроқ жой, қўшимча тўловсиз."
            )
        case .yukon:
            return localized(
                "VIP-класс для поездки Мекка — Медина: больше пространства, приватности и отдельная премиальная подача.",
                "VIP class for the Makkah–Madinah journey with more space, privacy and a dedicated premium experience.",
                "Makka–Madina safari uchun VIP klass: ko‘proq joy, maxfiylik va premium tajriba.",
                "Макка–Мадина сафари учун VIP класс: кўпроқ жой, махфийлик ва премиум тажриба."
            )
        }
    }

    private func requiredVehicleCount(for vehicle: TransferVehicleKind) -> Int {
        max(1, Int(ceil(Double(max(1, journey.trip.travelerCount)) / Double(vehicle.passengerCapacity))))
    }

    private var passengerMetric: String {
        "\(min(journey.trip.travelerCount, selectedVehicle.passengerCapacity))/\(selectedVehicle.passengerCapacity)"
    }

    private var luggageMetric: String { "≤ \(selectedVehicle.luggageCapacity)" }

    private var availabilityTitle: String {
        localized("Класс трансфера", "Transfer class", "Transfer toifasi", "Трансфер тоифаси")
    }

    private var vehicleAddOnTitle: String {
        selectedVehicleAddOnUsd > 0 ? "+\(usd(selectedVehicleAddOnUsd))" : "+$0"
    }

    private var routeTitle: String {
        let cities = !includesMadinah ? "Makkah" : (journey.trip.arrivalAirport == .madinah ? "Madinah → Makkah" : "Makkah → Madinah")
        return journey.trip.outboundDestinationCode + " → " + cities + " → " + journey.trip.returnOriginCode
    }

    private var trainSegmentTitle: String {
        journey.trip.arrivalAirport == .madinah ? "Madinah → Makkah" : "Makkah → Madinah"
    }

    private var dateRangeTitle: String {
        "\(shortDate(journey.trip.departureDate)) – \(shortDate(journey.trip.returnDate))"
    }

    private func shortDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.setLocalizedDateFormatFromTemplate("dMMM")
        return formatter.string(from: date)
    }

    private var localeIdentifier: String {
        switch settings.language {
        case .russian: return "ru_RU"
        case .indonesian: return "id_ID"
        case .turkish: return TurkishLocalization.phrase("en_US")
        case .arabic: return "ar_SA"
        case .english: return "en_US"
        case .malay: return "ms_MY"
        case .uzbek: return "uz_Latn_UZ"
        case .uzbekCyrillic: return "uz_Cyrl_UZ"
        }
    }

    private var currentPackagePriceTitle: String {
        guard let currentPackageTotalUsd else { return "—" }
        return usd(currentPackageTotalUsd)
    }

    private var haramainTicketSummary: String {
        let count = journey.haramainTicketCount > 0 ? journey.haramainTicketCount : max(1, journey.trip.adults + journey.trip.children)
        return "\(count) × $150 · Standard"
    }

    private var standardTrainPreviewUsd: Decimal {
        let count = journey.haramainTicketCount > 0 ? journey.haramainTicketCount : max(1, journey.trip.adults + journey.trip.children)
        return Decimal(150 * count)
    }

    private var confirmTitle: String {
        localized("Далее: гид и команда", "Next: guide and team", "Keyingi: gid va jamoa", "Кейинги: гид ва жамоа")
    }

    private var confirmingTitle: String {
        localized("Подтверждаем трансфер…", "Confirming transfer…", "Transfer tasdiqlanmoqda…", "Трансфер тасдиқланмоқда…")
    }

    private var errorTitle: String {
        localized("Не удалось продолжить", "Could not continue", "Davom ettirib bo‘lmadi", "Давом эттириб бўлмади")
    }

    private func usd(_ value: Decimal) -> String {
        let number = NSDecimalNumber(decimal: value).doubleValue
        return String(format: "$%.0f", number)
    }

    private func localized(_ ru: String, _ en: String, _ uz: String, _ uzCy: String) -> String {
        transferLocalized(settings.language, russian: ru, english: en, uzbek: uz, uzbekCyrillic: uzCy)
    }
}

// MARK: - Cinematic vehicle stage

private struct TransferVehicleStage: View {
    let selectedIndex: Int
    let label: String
    let isConfirming: Bool
    let onSelect: (Int) -> Void
    @State private var dragOffset: CGFloat = 0
    private let vehicles = TransferVehicleKind.allCases
    private var isVIP: Bool { vehicles[selectedIndex] == .yukon }

    var body: some View {
        GeometryReader { proxy in
            let width = max(proxy.size.width, 1)
            let pageWidth = max(width * 0.88, 1)

            ZStack {
                RoundedRectangle(cornerRadius: 36, style: .continuous)
                    .fill(isVIP ? Color.black : Color.white)

                if isVIP {
                    RadialGradient(
                        colors: [
                            .white.opacity(0.78),
                            .white.opacity(0.34),
                            .white.opacity(0.08),
                            .clear
                        ],
                        center: .center,
                        startRadius: 8,
                        endRadius: 240
                    )
                    .scaleEffect(1.12)
                }

                TransferStageBackground(
                    label: label.uppercased(),
                    number: String(format: "%02d", selectedIndex + 1),
                    parallax: dragOffset * 0.16,
                    vip: isVIP
                )

                ForEach(Array(vehicles.enumerated()), id: \.element.id) { index, vehicle in
                    let relative = CGFloat(index - selectedIndex) + (dragOffset / pageWidth)
                    let distance = min(abs(relative), 1.35)
                    let scale = 1 - min(distance, 1) * 0.10
                    let opacity = 1 - min(distance, 1) * 0.42

                    if abs(relative) < 1.65 {
                    TransferVehicleHero(vehicle: vehicle, active: distance < 0.16)
                        .scaleEffect(scale)
                        .opacity(opacity)
                        .offset(
                            x: relative * width * 0.92,
                            y: min(distance, 1) * 8
                        )
                        .zIndex(Double(10 - distance))
                        .accessibilityHidden(index != selectedIndex)
                    }
                }
            }
            .contentShape(Rectangle())
            .clipped()
            .gesture(
                DragGesture(minimumDistance: 8, coordinateSpace: .local)
                    .onChanged { value in
                        guard !isConfirming else { return }
                        dragOffset = resistedTranslation(value.translation.width)
                    }
                    .onEnded { value in
                        guard !isConfirming else { return }
                        finishDrag(value, pageWidth: pageWidth)
                    }
            )
        }
        .frame(height: 340)
        .clipShape(RoundedRectangle(cornerRadius: 36, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 36, style: .continuous)
                .strokeBorder(isVIP ? Color.white.opacity(0.12) : Color.primary.opacity(0.055), lineWidth: 0.8)
        }
    }

    private func resistedTranslation(_ raw: CGFloat) -> CGFloat {
        if selectedIndex == 0, raw > 0 { return raw * 0.32 }
        if selectedIndex == vehicles.count - 1, raw < 0 { return raw * 0.32 }
        return raw
    }
    private func finishDrag(_ value: DragGesture.Value, pageWidth: CGFloat) {
        let projected = value.predictedEndTranslation.width
        let threshold = pageWidth * 0.19
        var target = selectedIndex
        if projected < -threshold { target = min(vehicles.count - 1, selectedIndex + 1) }
        else if projected > threshold { target = max(0, selectedIndex - 1) }
        withAnimation(.spring(response: 0.48, dampingFraction: 0.88)) {
            dragOffset = 0
            onSelect(target)
        }
    }
}

private struct TransferVehicleHero: View {
    let vehicle: TransferVehicleKind
    let active: Bool

    var body: some View {
        ZStack {
            Image(vehicle.assetName)
                .resizable()
                .scaledToFit()
                .padding(.horizontal, vehicle == .malibu ? 22 : 16)
                .scaleEffect(vehicle == .malibu ? 1.04 : 1.0)
                .accessibilityLabel(vehicle.modelName)
        }
        .padding(.horizontal, 4)
    }
}

private struct TransferStageBackground: View {
    let label: String
    let number: String
    let parallax: CGFloat
    let vip: Bool

    var body: some View {
        ZStack {
            Text(number)
                .font(.system(size: 156, weight: .black, design: .rounded))
                .foregroundStyle((vip ? Color.white : Color.primary).opacity(vip ? 0.055 : 0.035))
                .offset(x: parallax * 0.42, y: -58)

            Text(label)
                .font(.system(size: label == "VIP" ? 104 : 72, weight: .black, design: .rounded))
                .minimumScaleFactor(0.55)
                .lineLimit(1)
                .foregroundStyle((vip ? Color.white : Color.primary).opacity(vip ? 0.12 : 0.06))
                .offset(x: parallax, y: 84)
                .padding(.horizontal, 18)
        }
    }
}

// MARK: - Haramain gallery / ticket booking

private struct HaramainPhotoGallery: View {
    let compact: Bool
    private let images = ["HaramainHero", "HaramainGalleryStation", "HaramainGalleryInterior", "HaramainGalleryTrain"]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: 10) {
                ForEach(images, id: \.self) { name in
                    Image(name)
                        .resizable()
                        .scaledToFill()
                        .frame(width: compact ? 238 : 292, height: compact ? 145 : 184)
                        .clipped()
                        .clipShape(RoundedRectangle(cornerRadius: compact ? 20 : 24, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: compact ? 20 : 24, style: .continuous)
                                .strokeBorder(Color.white.opacity(0.10), lineWidth: 0.7)
                        }
                }
            }
        }
    }
}

private func transferLocalized(
    _ language: AppSettingsStore.Language,
    russian: String,
    english: String,
    uzbek: String,
    uzbekCyrillic: String
) -> String {
    switch language {
    case .russian: return russian
    case .indonesian: return IndonesianLocalization.phrase(english)
    case .turkish: return TurkishLocalization.phrase(english)
    case .arabic: return ArabicLocalization.phrase(english)
    case .english, .malay: return english
    case .uzbek: return uzbek
    case .uzbekCyrillic: return uzbekCyrillic
    }
}

private struct IumrahTransferNavigationChrome: ViewModifier {
    let embedded: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if embedded { content } else { content.toolbar(.hidden, for: .navigationBar).toolbar(.hidden, for: .tabBar) }
    }
}
