import Foundation

struct LocalJourneyFlight: Codable, Identifiable, Hashable {
    let id: String
    let origin: String
    let destination: String
    let airline: String
    let flightNumber: String
    let airlineCode: String
    let durationMinutes: Int
    let stops: Int
    let departureAt: String
    let arrivalAt: String?
    /// USD per traveler, exactly as shown in discovery; nil is never zero.
    let displayedPrice: Double?
    // Exact discovery identities are retained for manual server revalidation.
    var publishedID: String? = nil
    var publishedIsPair: Bool? = nil
    var discoveryOffer: FlightDiscoveryOffer? = nil
    var publishedCabin: String? = nil
}

struct LocalJourneyRoom: Codable, Identifiable {
    let id: String
    let city: String
    let hotel: NuiteeHotel
    let rate: NuiteeRoomRate
    let checkin: Date
    let checkout: Date
    let adults: Int
    let childrenAges: [Int]
    var meals: HotelMealChoices? = nil
    var requiresRateRefresh: Bool? = nil
}

struct LocalJourneyPriceLine: Identifiable {
    let id: String
    let title: String
    let amount: Decimal
}

extension JourneyStore {
    var localRoomsComplete: Bool {
        guard trip.rooms > 0, trip.rooms <= max(1, trip.adults), trip.travelerCount <= trip.rooms * 5 else { return false }
        let cities = trip.scope == .makkahAndMadinah ? ["makkah", "madinah"] : ["makkah"]
        let windows = TripStayPlanner.windows(for: trip)
        let calendar = Calendar.current
        return cities.allSatisfy { city in
            guard let window = city == "makkah" ? Optional(windows.makkah) : windows.madinah,
                  window.checkOut > window.checkIn else { return false }
            let selected = (0..<trip.rooms).compactMap { localJourneyRooms["\(city):\($0)"] }
            guard selected.count == trip.rooms,
                  selected.reduce(0, { $0 + $1.adults }) == trip.adults,
                  selected.reduce(0, { $0 + $1.childrenAges.count }) == trip.children + trip.infants,
                  Set(selected.map { $0.hotel.id }).count == 1 else { return false }
            return selected.allSatisfy { room in
                room.requiresRateRefresh != true && room.city == city && room.adults > 0 && room.childrenAges.allSatisfy { (0...17).contains($0) } &&
                calendar.isDate(room.checkin, inSameDayAs: window.checkIn) &&
                calendar.isDate(room.checkout, inSameDayAs: window.checkOut) &&
                room.rate.price.isFinite && room.rate.price > 0 && room.rate.currency.uppercased() == "USD" && !room.rate.offerId.isEmpty
            }
        }
    }

    var localPriceLines: [LocalJourneyPriceLine]? {
        guard hasFinalGeneratorQuote, let quote else { return nil }
        return [.init(id: "server-total", title: "iumrah", amount: quote.totalPackagePrice)]
    }

    /// Selection changes invalidate the server quote. The phone never prices a package.
    func invalidateLocalJourneyQuote() {
        quote = nil
    }

    var localBookingRooms: [BookingNuiteeRoomSelection] {
        localJourneyRooms.values.filter { $0.requiresRateRefresh != true }.sorted { $0.id < $1.id }.map(\.bookingSelection)
    }
    var localBookingInputKey: String {
        if let cachedLocalBookingInputKey { return cachedLocalBookingInputKey }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let rooms = (try? encoder.encode(localBookingRooms)).flatMap { String(data:$0,encoding:.utf8) } ?? ""
        let pending = localJourneyRooms.values.filter { $0.requiresRateRefresh == true }.map(\.id).sorted().joined(separator: ",")
        let flightKey = localJourneyFlights.map { $0.id + ":" + $0.departureAt }.joined(separator: "|")
        let key = flightKey + "|" + (mixedFlightIdentity ?? "") + "|" + rooms + "|" + pending + "|" + String(trip.hashValue) + "|" + (selectedTransferVehicle?.rawValue ?? "") + "|" + String(haramainTrainSelected) + "|" + String(haramainTicketCount) + "|" + haramainFareClass.rawValue
        cachedLocalBookingInputKey = key
        return key
    }
    var localPackageTier: PackageTier? {
        let stars = localJourneyRooms.values.map { $0.hotel.roundedStars }
        guard !stars.isEmpty else { return nil }
        let highest = stars.map { (1...5).contains($0) ? $0 : 3 }.max() ?? 3
        return highest <= 2 ? .economy : highest <= 4 ? .standard : .luxury
    }

}

extension LocalJourneyRoom {
    var bookingSelection: BookingNuiteeRoomSelection {
        let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
        let included = rate.supplierMeals
        let chosen = meals ?? HotelMealChoices()
        let bundled = hotel.roundedStars <= 3
        let bundleRequested = chosen.breakfast || chosen.lunch || chosen.dinner
        let effective = HotelMealChoices(breakfast: included.breakfast || hotel.roundedStars >= 4 || (bundled ? bundleRequested : chosen.breakfast),
            lunch: (!bundled || city == "makkah") && (included.lunch || (bundled ? bundleRequested : chosen.lunch)),
            dinner: included.dinner || (bundled ? bundleRequested : chosen.dinner))
        return .init(id:id, city:city, hotelId:hotel.id, offerId:rate.offerId, roomId:rate.roomId,
                     checkin:f.string(from:checkin), checkout:f.string(from:checkout), adults:adults, children:childrenAges, meals:effective,
                     mealBundleRequested: bundled ? bundleRequested : nil)
    }
    var bookingHotel: HotelSummary {
        HotelSummary(id:hotel.id, name:hotel.name, city:city == "madinah" ? "Madinah" : "Makkah",
            stars:hotel.roundedStars, rating:nil, reviewCount:nil, status:"available", coverImageURL:hotel.coverImageURL,
            imageCount:hotel.previewImages?.count ?? 0, roomCount:1, price:nil, updatedAt:"")
    }
    var bookingRoom: HotelRoom {
        HotelRoom(id:rate.roomId, name:rate.roomName, maxGuests:adults + childrenAges.count,
            sizeM2:nil, beds:nil, view:nil, description:rate.mealPlan, amenities:[])
    }
}

/// Supplier revalidation used by Hotels, Transfer and Review pull-to-refresh.
/// A missing/expired/failed exact offer is removed rather than silently
/// presenting a stale rate as today's amount.
@MainActor
extension JourneyStore {
    func repricePendingJourneyRooms(language: String = "en") async {
        guard usesLocalJourney else { return }
        let requested = trip
        let snapshot = localJourneyRooms.filter { $0.value.requiresRateRefresh == true }
        var updated = localJourneyRooms
        let service = NuiteeHotelService()
        for (key, room) in snapshot.sorted(by: { $0.key < $1.key }) {
            guard !Task.isCancelled, trip == requested else { return }
            do {
                let response = try await service.rates(hotelID: room.hotel.id, checkin: room.checkin,
                    checkout: room.checkout, adults: room.adults, childrenAges: room.childrenAges, language: language)
                guard response.ok, response.adults == room.adults,
                    response.checkin == NuiteeHotelService.dateText(room.checkin),
                    response.checkout == NuiteeHotelService.dateText(room.checkout) else { continue }
                let matches = response.rates.filter { rate in
                    ((!room.rate.roomId.isEmpty && rate.roomId == room.rate.roomId) ||
                     (room.rate.roomId.isEmpty && rate.roomId.isEmpty && !room.rate.roomName.isEmpty &&
                      rate.roomName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == room.rate.roomName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())) &&
                    rate.supplierMeals == room.rate.supplierMeals && rate.refundable == room.rate.refundable && rate.cancellationTag == room.rate.cancellationTag &&
                    rate.currency.uppercased() == "USD" && rate.price.isFinite && rate.price > 0 && !rate.offerId.isEmpty
                }
                guard let rate = matches.min(by: { $0.price < $1.price }) else { continue }
                updated[key] = LocalJourneyRoom(id: key, city: room.city, hotel: room.hotel, rate: rate,
                    checkin: room.checkin, checkout: room.checkout, adults: room.adults,
                    childrenAges: room.childrenAges, meals: room.meals, requiresRateRefresh: false)
            } catch { /* Keep selection visible, but never treat an old offer as verified. */ }
        }
        guard !Task.isCancelled, trip == requested else { return }
        // Do not overwrite any room edited while the network request was running.
        var merged = localJourneyRooms
        for (key, old) in snapshot {
            guard let current = merged[key], current.requiresRateRefresh == true,
                  current.rate == old.rate, current.adults == old.adults, current.childrenAges == old.childrenAges,
                  current.hotel.id == old.hotel.id, current.meals == old.meals,
                  let fresh = updated[key], fresh.requiresRateRefresh != true else { continue }
            merged[key] = fresh
        }
        if merged.values.filter({ $0.requiresRateRefresh == true }).count < localJourneyRooms.values.filter({ $0.requiresRateRefresh == true }).count { localJourneyRooms = merged }
    }

    func refreshLocalJourneyRoomRates() async {
        guard usesLocalJourney else { return }
        let snapshot = localJourneyRooms
        let service = NuiteeHotelService()
        for (key, room) in snapshot.sorted(by: { $0.key < $1.key }) {
            guard !Task.isCancelled else { return }
            guard room.requiresRateRefresh != true else { continue }
            do {
                let response = try await service.rates(
                    hotelID: room.hotel.id, checkin: room.checkin, checkout: room.checkout,
                    adults: room.adults, childrenAges: room.childrenAges)
                guard let current = response.rates.first(where: {
                    $0.offerId == room.rate.offerId && $0.roomId == room.rate.roomId
                }), current.currency.uppercased() == "USD", current.price.isFinite,
                    current.price > 0 else {
                    // The selected price is a quote input, not a held room. Keep the choice.
                    continue
                }
                // Never overwrite a newly edited choice with a previous request.
                guard localJourneyRooms[key]?.rate.offerId == room.rate.offerId else { continue }
                localJourneyRooms[key] = LocalJourneyRoom(
                    id: room.id, city: room.city, hotel: room.hotel, rate: current,
                    checkin: room.checkin, checkout: room.checkout, adults: room.adults,
                    childrenAges: room.childrenAges, meals: room.meals)
            } catch {
                // A provider error is not proof of availability or of price.
                // A transport/provider failure must not erase the selected room.
            }
        }
        invalidateLocalJourneyQuote()
    }
}


enum ConfiguratorBookingCopy {
    static func message(_ code: String, language: AppSettingsStore.Language) -> String {
        let values: [String]
        if code.contains("PACKAGE_PRICE_BREAKDOWN_MISSING") || code.contains("PACKAGE_PRICE_BREAKDOWN_INVALID") || code.contains("PACKAGE_PRICE_BREAKDOWN_UNAVAILABLE") {
            values = ["Сервер не вернул полный расчёт стоимости. Обновите расчёт или обратитесь в поддержку (\(code)).", "The server did not return a complete price breakdown. Retry or contact support (\(code)).", "Server narx tafsilotlarini qaytarmadi. Qayta urinib ko‘ring (\(code)).", "Сервер нарх тафсилотларини қайтармади. Қайта уриниб кўринг (\(code))."]
        } else if code.contains("CORE_CUTOVER_PENDING") || code.contains("QUOTE_SEAL_NOT_CONFIGURED") || code.contains("INVALID_PACKAGE_QUOTE_SEAL_KEY") {
            values = ["Сервер расчёта пока не готов. Обратитесь в поддержку (\(code)).", "Pricing server is not ready. Contact support (\(code)).", "Narx serveri tayyor emas (\(code)).", "Нарх сервери тайёр эмас (\(code))."]
        } else if code.contains("AVIASALES_IDENTITY_INVALID") || code.contains("AVIASALES_ROUTE_MISMATCH") || code.contains("MIXED_ROUTE_MISMATCH") || code.contains("MIXED_IDENTITY_INVALID") || code.contains("MIXED_REQUIRES_ONE_WAY_FARES") {
            values = ["Не удалось проверить выбранный маршрут на сервере. Выберите рейсы заново. Если ошибка повторится, обратитесь в поддержку.", "The server could not verify the selected route. Select the flights again. If this continues, contact support.", "Server tanlangan yo‘nalishni tekshira olmadi. Reyslarni qayta tanlang. Xato takrorlansa, yordam xizmatiga murojaat qiling.", "Сервер танланган йўналишни текшира олмади. Рейсларни қайта танланг. Хато такрорланса, ёрдам хизматига мурожаат қилинг."]
        } else if code.contains("AVIASALES_PARTY_FARE_UNAVAILABLE") {
            values = ["Для этого рейса API не подтвердил тарифы детей и младенцев. Выберите опубликованный рейс с тарифом для вашего состава поездки.", "The API has not confirmed child and infant fares for this flight. Choose a published flight priced for your party.", "API bu reys uchun bolalar va chaqaloqlar tariflarini tasdiqlamadi. Guruhingiz uchun tarifi bor e’lon qilingan reysni tanlang.", "API бу рейс учун болалар ва чақалоқлар тарифларини тасдиқламади. Гуруҳингиз учун тарифи бор эълон қилинган рейсни танланг."]
        } else if code.contains("NUITEE_SELECTED_RATE_EXPIRED") || code.contains("NUITEE_RATE_TERMS_CHANGED") {
            values = ["Тариф или условия номера изменились. Вернитесь к выбору отеля и выберите актуальный номер.", "The room rate or terms changed. Return to hotels and select a current room offer.", "Xona tarifi yoki shartlari o‘zgardi. Mehmonxonalarga qaytib, amaldagi xonani tanlang.", "Хона тарифи ёки шартлари ўзгарди. Меҳмонхоналарга қайтиб, амалдаги хонани танланг."]
        } else if code.contains("NUITEE_") || code.contains("HOTEL_STARS_REQUIRED") || code.contains("SANDBOX_QUOTE_NOT_BOOKABLE") {
            values = ["Не удалось подтвердить выбранные номера. Проверьте даты и гостей, затем повторите расчёт или выберите номера заново.", "Could not confirm the selected rooms. Check dates and guests, then retry pricing or select rooms again.", "Tanlangan xonalar tasdiqlanmadi. Sanalar va mehmonlarni tekshirib, narxni qayta hisoblang yoki xonalarni qayta tanlang.", "Танланган хоналар тасдиқланмади. Саналар ва меҳмонларни текшириб, нархни қайта ҳисобланг ёки хоналарни қайта танланг."]
        } else { return code }
        switch language { case .russian: return values[0]; case .uzbek: return values[2]; case .uzbekCyrillic: return values[3]; default: return values[1] }
    }
}

struct HotelMealChoices: Codable, Hashable {
    var breakfast = false
    var lunch = false
    var dinner = false
}
extension NuiteeRoomRate {
    var supplierMeals: HotelMealChoices {
        if let includedMeals { return includedMeals }
        let board = mealPlan.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        if ["room only", "no meals", "without meals", "breakfast not included", "without breakfast", "no breakfast"].contains(where: { board.contains($0) }) { return HotelMealChoices() }
        let full = ["fb", "ai"].contains(board) || board.contains("full board") || board.contains("all inclusive")
        let half = board == "hb" || board.contains("half board")
        return HotelMealChoices(breakfast: full || half || board == "bb" || board.contains("breakfast"),
            lunch: full, dinner: full || half || board.contains("dinner"))
    }
}
