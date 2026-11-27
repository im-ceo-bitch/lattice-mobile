import SwiftUI

/// Shared, localized stay summary for the hotel detail and package review.
struct IumrahHotelStaySummary: View {
    @EnvironmentObject private var settings: AppSettingsStore
    let checkin: Date
    let checkout: Date
    let nights: Int
    var adults: Int? = nil
    var children: Int = 0
    var checkinTime: String? = nil
    var checkoutTime: String? = nil
    var editableStay: AnyView? = nil
    private func tr(_ ru: String, _ en: String, _ uz: String, _ cy: String) -> String {
        IumrahFlightCopy.text(settings.language, ru, en, uz, cy)
    }
    private func dateColumn(_ title: String, _ date: Date) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.subheadline).foregroundStyle(.secondary)
            Text(date.formatted(.dateTime.day().month(.abbreviated).locale(Locale(identifier: settings.language.localeIdentifier))))
                .font(.title3.weight(.bold))
            Text(date.formatted(.dateTime.weekday(.wide).locale(Locale(identifier: settings.language.localeIdentifier))))
                .font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Label(tr("Ваше проживание", "Your stay", "Sizning yashashingiz", "Сизнинг яшашингиз"), systemImage: "calendar")
                .font(.headline)
            HStack(alignment: .top, spacing: 18) {
                dateColumn(tr("Заезд", "Check-in", "Kirish", "Кириш"), checkin)
                Rectangle().fill(Color.primary.opacity(0.12)).frame(width: 1, height: 76)
                dateColumn(tr("Выезд", "Check-out", "Chiqish", "Чиқиш"), checkout)
            }
            Divider()
            Label(L10n.format("booking_nights_count", settings.language, nights), systemImage: "moon")
                .font(.subheadline.weight(.semibold))
            if let adults {
                Divider()
                Label("\(adults) " + tr("взрослых", "adults", "kattalar", "катталар") + (children > 0 ? " · \(children) " + tr("детей", "children", "bolalar", "болалар") : ""), systemImage: "person.2")
                    .font(.subheadline)
            }
            if let time = checkinTime, !time.isEmpty {
                LabeledContent(tr("Время заезда", "Check-in time", "Kirish vaqti", "Кириш вақти"), value: time).font(.subheadline)
            }
            if let time = checkoutTime, !time.isEmpty {
                LabeledContent(tr("Время выезда", "Check-out time", "Chiqish vaqti", "Чиқиш вақти"), value: time).font(.subheadline)
            }
            if let editableStay { Divider(); editableStay }
        }
        .padding(20).frame(maxWidth: .infinity, alignment: .leading)
        .modifier(IumrahAnimatedSearchBorder(radius: 26))
        .accessibilityElement(children: .contain)
    }
}

struct IumrahHotelMealsEditor: View {
    @EnvironmentObject private var settings: AppSettingsStore
    @Binding var selection: HotelMealChoices
    let stars: Int
    let city: String
    let included: HotelMealChoices
    private var madinah: Bool {
        let name = city.lowercased()
        return name.contains("madin") || name.contains("medin") || name.contains("медин") || name.contains("мадин")
    }
    private func tr(_ ru: String, _ en: String, _ uz: String, _ cy: String) -> String {
        IumrahFlightCopy.text(settings.language, ru, en, uz, cy)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(tr("Питание в отеле", "Hotel meals", "Mehmonxonada ovqatlanish", "Меҳмонхонада овқатланиш"), systemImage: "fork.knife")
                .font(.subheadline.weight(.semibold))
            if stars <= 3 {
                let fullyIncluded = included.breakfast && included.dinner && (madinah || included.lunch)
                if fullyIncluded {
                    Label(tr("Питание включено в тариф", "Meals included in rate", "Ovqat tarifga kiritilgan", "Овқат тарифга киритилган"), systemImage: "checkmark.circle.fill")
                        .font(.subheadline).foregroundStyle(.green)
                } else {
                    Toggle(madinah ? tr("Двухразовое питание", "Two meals daily", "Kuniga ikki mahal", "Кунига икки маҳал") : tr("Трёхразовое питание", "Three meals daily", "Kuniga uch mahal", "Кунига уч маҳал"), isOn: Binding(
                        get: { selection.breakfast || selection.lunch || selection.dinner },
                        set: { enabled in selection = HotelMealChoices(breakfast: enabled, lunch: enabled && !madinah, dinner: enabled) }))
                        .font(.subheadline.weight(.semibold)).tint(Color.iumrahInk)
                }
                if !fullyIncluded && (included.breakfast || included.lunch || included.dinner) {
                    Text(tr("Уже включённые в тариф приёмы пищи повторно не оплачиваются.", "Meals already included in the rate are not charged again.", "Tarifga kirgan ovqat uchun qayta to‘lov yo‘q.", "Тарифга кирган овқат учун қайта тўлов йўқ.")).font(.caption).foregroundStyle(.secondary)
                }
                Text(madinah ? tr("Завтрак и ужин", "Breakfast and dinner", "Nonushta va kechki ovqat", "Нонушта ва кечки овқат") : tr("Завтрак, обед и ужин", "Breakfast, lunch and dinner", "Nonushta, tushlik va kechki ovqat", "Нонушта, тушлик ва кечки овқат"))
                    .font(.subheadline).foregroundStyle(.secondary)
            } else {
                mealRow(tr("Завтрак", "Breakfast", "Nonushta", "Нонушта"), key: \.breakfast,
                    included: true, packageIncluded: !included.breakfast)
                mealRow(tr("Обед", "Lunch", "Tushlik", "Тушлик"), key: \.lunch, included: included.lunch)
                mealRow(tr("Ужин", "Dinner", "Kechki ovqat", "Кечки овқат"), key: \.dinner, included: included.dinner)
            }
            Text(tr("Дополнительное питание учитывается в итоговой цене пакета для гостей этого номера на весь срок проживания.",
                "Extra meals are included in the package calculation for this room’s guests throughout the stay.",
                "Qo‘shimcha ovqatlanish ushbu xona mehmonlari uchun butun yashash muddatiga paket narxida hisoblanadi.",
                "Қўшимча овқатланиш ушбу хона меҳмонлари учун бутун яшаш муддатига пакет нархида ҳисобланади."))
                .font(.caption).foregroundStyle(.secondary)
        }
    }
    @ViewBuilder private func mealRow(_ title: String, key: WritableKeyPath<HotelMealChoices, Bool>, included: Bool, packageIncluded: Bool = false) -> some View {
        if included {
            HStack(alignment: .top) {
                Text(title)
                Spacer()
                Text(packageIncluded ? tr("Включён в пакет iumrah", "Included by iumrah", "iumrah paketiga kiritilgan", "iumrah пакетига киритилган") : tr("Включено в тариф", "Included in rate", "Tarifga kiritilgan", "Тарифга киритилган"))
                    .foregroundStyle(.secondary).multilineTextAlignment(.trailing)
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.green)
            }.font(.subheadline).padding(.vertical, 5)
        } else {
            Toggle(title, isOn: Binding(get: { selection[keyPath: key] }, set: { selection[keyPath: key] = $0 }))
                .font(.subheadline).tint(Color.iumrahInk)
        }
    }
}

/// Loads only when mounted on a concrete hotel page; never from catalogue cards.
struct IumrahHotelReviewsSection: View {
    @EnvironmentObject private var settings: AppSettingsStore
    let hotelID: String
    let rating: Double?
    let reviewCount: Int?
    @State private var reviews: [NuiteeGuestReview] = []
    @State private var nextOffset: Int?
    @State private var total: Int?
    @State private var loading = false
    @State private var failed = false
    @State private var stale = false
    @State private var showAll = false
    @State private var selectedReview: NuiteeGuestReview?
    @State private var selectedListReview: NuiteeGuestReview?
    @State private var generation = UUID()
    @State private var loadedReviewKey: String?
    @State private var loadingReviewKey: String?
    @ScaledMetric(relativeTo: .body) private var compactReviewHeight: CGFloat = 278
    private func tr(_ ru: String, _ en: String, _ uz: String, _ cy: String) -> String {
        IumrahFlightCopy.text(settings.language, ru, en, uz, cy)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(tr("Отзывы и рейтинг", "Reviews and rating", "Sharhlar va reyting", "Шарҳлар ва рейтинг"))
                .font(.title2.bold())
            HStack(spacing: 12) {
                if let rating {
                    Text(String(format: "%.1f", rating))
                        .font(.title2.bold()).padding(14)
                        .foregroundStyle(Color.iumrahPrimaryButtonText)
                        .background(Color.iumrahPrimaryButtonBackground, in: RoundedRectangle(cornerRadius: 16))
                    Text(tr("Оценка гостей · из 10", "Guest rating · out of 10", "Mehmonlar bahosi · 10 dan", "Меҳмонлар баҳоси · 10 дан"))
                        .font(.subheadline)
                }
                Spacer(minLength: 0)
                if let count = total ?? reviewCount {
                    Text("\(count) " + tr("отзывов", "reviews", "sharh", "шарҳ"))
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            if !reviews.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 12) {
                        ForEach(reviews) { review in
                            Button { selectedReview = review } label: { reviewCard(review, compact: true).frame(width: 280) }
                                .buttonStyle(.plain)
                        }
                    }.padding(.vertical, 2).padding(.horizontal, IumrahDesign.pagePadding)
                }
                .padding(.horizontal, -IumrahDesign.pagePadding)
                Button(tr("Все отзывы", "All reviews", "Barcha sharhlar", "Барча шарҳлар")) { showAll = true }
                    .font(.subheadline.weight(.semibold)).tint(.primary)
            } else if loading || (loadedReviewKey == nil && !failed) {
                Text(tr("Загружаем отзывы…", "Loading reviews…", "Sharhlar yuklanmoqda…", "Шарҳлар юкланмоқда…"))
                    .font(.subheadline).foregroundStyle(.secondary)
            } else if !failed {
                Text(tr("Пока нет текстов отзывов.", "No review text available yet.", "Hozircha sharh matnlari mavjud emas.", "Ҳозирча шарҳ матнлари мавжуд эмас."))
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            if failed { retryButton }
            if stale {
                Text(tr("Показаны сохранённые отзывы", "Showing saved reviews", "Saqlangan sharhlar ko‘rsatilmoqda", "Сақланган шарҳлар кўрсатилмоқда"))
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .task(id: hotelID + "|" + settings.language.hotelContentCode) { await load(reset: true) }
        .sheet(item: $selectedReview) { review in IumrahHotelReviewDetail(review: review) }
        .sheet(isPresented: $showAll) {
            NavigationStack {
                ScrollView {
                    LazyVStack(spacing: 14) {
                        ForEach(reviews) { review in
                            Button { selectedListReview = review } label: { reviewCard(review, compact: false) }.buttonStyle(.plain)
                        }
                        if failed { retryButton }
                        else if nextOffset != nil {
                            Button(tr("Ещё отзывы", "More reviews", "Yana sharhlar", "Яна шарҳлар")) {
                                Task { await load(reset: false) }
                            }.disabled(loading).tint(.primary)
                        }
                    }.padding(20)
                }
                .background(Color.iumrahPageBackground)
                .navigationTitle(tr("Отзывы гостей", "Guest reviews", "Mehmonlar sharhlari", "Меҳмонлар шарҳлари"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(tr("Готово", "Done", "Tayyor", "Тайёр")) { showAll = false }
                    }
                }
            }.presentationDragIndicator(.visible)
                .sheet(item: $selectedListReview) { review in IumrahHotelReviewDetail(review: review) }
        }
    }
    private var retryButton: some View {
        Button(tr("Не удалось загрузить отзывы. Повторить", "Could not load reviews. Retry", "Sharhlar yuklanmadi. Qayta urinish", "Шарҳлар юкланмади. Қайта уриниш")) {
            Task { await load(reset: reviews.isEmpty) }
        }.font(.subheadline).tint(.primary).disabled(loading)
    }
    private func reviewCard(_ review: NuiteeGuestReview, compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Text(String(review.name.prefix(1)).uppercased())
                    .font(.headline).frame(width: 40, height: 40)
                    .background(Color.primary.opacity(0.06), in: Circle())
                VStack(alignment: .leading, spacing: 3) {
                    Text(review.name.isEmpty ? tr("Гость", "Guest", "Mehmon", "Меҳмон") : review.name).font(.subheadline.bold()).lineLimit(compact ? 1 : nil)
                    if !review.country.isEmpty {
                        Text(Locale(identifier: settings.language.localeIdentifier).localizedString(forRegionCode: review.country.uppercased()) ?? review.country)
                            .font(.caption).foregroundStyle(.secondary).lineLimit(compact ? 1 : nil)
                    }
                }
                Spacer()
                if let score = review.rating { Text(String(format: "%.1f", score)).font(.headline) }
            }
            if !review.headline.isEmpty { Text(review.headline).font(.subheadline.bold()).lineLimit(compact ? 2 : nil) }
            if !review.pros.isEmpty { Text(review.pros).font(.subheadline).lineLimit(compact ? 3 : nil) }
            if !review.cons.isEmpty {
                Text(tr("Что можно улучшить: ", "Could be improved: ", "Yaxshilash mumkin: ", "Яхшилаш мумкин: ") + review.cons)
                    .font(.subheadline).foregroundStyle(.secondary).lineLimit(compact ? 2 : nil)
            }
            if compact { Spacer(minLength: 0) }
            HStack {
                Text(reviewDate(review.date))
                Spacer()

            }.font(.caption2).foregroundStyle(.secondary)
        }
        .padding(18).frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: compact ? compactReviewHeight : nil, alignment: .topLeading)
        .clipped()
        .background(Color.iumrahCardBackground, in: RoundedRectangle(cornerRadius: 24))
    }
    private func reviewDate(_ value: String) -> String {
        let parser = DateFormatter(); parser.locale = Locale(identifier: "en_US_POSIX"); parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: String(value.prefix(10))) else { return value }
        return date.formatted(.dateTime.day().month(.abbreviated).year().locale(Locale(identifier: settings.language.localeIdentifier)))
    }
    @MainActor private func load(reset: Bool) async {
        let language = settings.language.hotelContentCode
        let key = hotelID + "|" + language
        if !reset, loading, loadingReviewKey == key { return }
        if reset, loadedReviewKey == key, !failed { return }
        if loadedReviewKey != key { reviews = []; nextOffset = nil; total = nil; stale = false }
        generation = UUID()
        let requestGeneration = generation
        loading = true; failed = false; loadingReviewKey = key
        defer { if generation == requestGeneration { loading = false; loadingReviewKey = nil } }
        do {
            let result = try await IumrahHotelReviewCache.shared.load(hotelID: hotelID, language: language, more: !reset)
            guard !Task.isCancelled, generation == requestGeneration else { return }
            reviews = result.reviews
            nextOffset = result.nextOffset; total = result.total; stale = result.stale
            loadedReviewKey = key
        } catch {
            guard !Task.isCancelled, generation == requestGeneration else { return }
            failed = true
        }
    }
}

private struct IumrahHotelReviewDetail: View {
    @EnvironmentObject private var settings: AppSettingsStore
    @Environment(\.dismiss) private var dismiss
    let review: NuiteeGuestReview
    @State private var original = false
    private func tr(_ ru: String, _ en: String, _ uz: String, _ cy: String) -> String { IumrahFlightCopy.text(settings.language, ru, en, uz, cy) }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(review.name).font(.title2.bold())
                            Text([Locale(identifier: settings.language.localeIdentifier).localizedString(forRegionCode: review.country.uppercased()) ?? review.country, review.date].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if let rating = review.rating { Text(String(format: "%.1f", rating)).font(.title2.bold()) }
                    }
                    Divider()
                    let headline = original ? (review.originalHeadline ?? review.headline) : review.headline
                    let pros = original ? (review.originalPros ?? review.pros) : review.pros
                    let cons = original ? (review.originalCons ?? review.cons) : review.cons
                    if !headline.isEmpty { Text(headline).font(.headline) }
                    if !pros.isEmpty { Text(pros).font(.body) }
                    if !cons.isEmpty { Text(tr("Что можно улучшить", "Could be improved", "Yaxshilash mumkin", "Яхшилаш мумкин")).font(.headline); Text(cons).font(.body).foregroundStyle(.secondary) }
                    if review.isTranslated == true {
                        Button(original ? tr("Показать перевод", "Show translation", "Tarjimani ko‘rsatish", "Таржимани кўрсатиш") : tr("Показать оригинал", "Show original", "Aslini ko‘rsatish", "Аслини кўрсатиш")) { withAnimation { original.toggle() } }
                            .buttonStyle(IumrahSecondaryButtonStyle())
                    } else if review.translationUnavailable == true {
                        Text(tr("Перевод пока недоступен. Показан оригинал.", "Translation unavailable. Showing original.", "Tarjima hozircha mavjud emas. Asl matn.", "Таржима ҳозирча мавжуд эмас. Асл матн.")).font(.caption).foregroundStyle(.secondary)
                    } else {
                        Text(tr("Показан исходный текст отзыва", "Showing original review text", "Sharhning asl matni", "Шарҳнинг асл матни")).font(.caption).foregroundStyle(.secondary)
                    }

                }.padding(24).frame(maxWidth: .infinity, alignment: .leading)
            }.background(Color.iumrahPageBackground)
                .navigationTitle(tr("Отзыв гостя", "Guest review", "Mehmon sharhi", "Меҳмон шарҳи"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button(tr("Готово", "Done", "Tayyor", "Тайёр")) { dismiss() } } }
        }.presentationDragIndicator(.visible)
    }
}
