import SwiftUI

// MARK: - Public policy model

enum IumrahPolicyKind: String, Identifiable, Hashable {
    case privacy
    case refund
    case paymentSecurity

    var id: String { rawValue }

    func title(_ language: AppSettingsStore.Language) -> String {
        switch (self, language) {
        case (.privacy, .russian): return "Политика конфиденциальности"
        case (.privacy, .turkish): return TurkishLocalization.phrase("Privacy Policy")
        case (.privacy, .arabic): return ArabicLocalization.phrase("Privacy Policy")
        case (.privacy, .indonesian), (.privacy, .malay), (.privacy, .english): return "Privacy Policy"
        case (.privacy, .uzbek): return "Maxfiylik siyosati"
        case (.privacy, .uzbekCyrillic): return "Махфийлик сиёсати"
        case (.refund, .russian): return "Политика возврата"
        case (.refund, .turkish): return TurkishLocalization.phrase("Refund Policy")
        case (.refund, .arabic): return ArabicLocalization.phrase("Refund Policy")
        case (.refund, .indonesian), (.refund, .malay), (.refund, .english): return "Refund Policy"
        case (.refund, .uzbek): return "Qaytarish siyosati"
        case (.refund, .uzbekCyrillic): return "Қайтариш сиёсати"
        case (.paymentSecurity, .russian): return "Безопасность оплаты"
        case (.paymentSecurity, .turkish): return TurkishLocalization.phrase("Payment Security")
        case (.paymentSecurity, .arabic): return ArabicLocalization.phrase("Payment Security")
        case (.paymentSecurity, .indonesian), (.paymentSecurity, .malay), (.paymentSecurity, .english): return "Payment Security"
        case (.paymentSecurity, .uzbek): return "To‘lov xavfsizligi"
        case (.paymentSecurity, .uzbekCyrillic): return "Тўлов хавфсизлиги"
        }
    }

    var icon: String {
        switch self {
        case .privacy: return "hand.raised.fill"
        case .refund: return "arrow.uturn.backward.circle.fill"
        case .paymentSecurity: return "creditcard.and.123"
        }
    }

    var role: IumrahIconRole {
        switch self {
        case .privacy: return .security
        case .refund: return .booking
        case .paymentSecurity: return .paymentPending
        }
    }
}

enum IumrahRefundComponent: String, Identifiable, Hashable {
    case package
    case flight
    case hotel
    case transfer
    case services

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .package: return "arrow.uturn.backward.circle.fill"
        case .flight: return "airplane"
        case .hotel: return "building.2.fill"
        case .transfer: return "car.fill"
        case .services: return "heart.fill"
        }
    }

    var role: IumrahIconRole {
        switch self {
        case .package: return .booking
        case .flight: return .travel
        case .hotel: return .hotel
        case .transfer: return .transfer
        case .services: return .care
        }
    }

    func title(_ language: AppSettingsStore.Language) -> String {
        switch (self, language) {
        case (.package, .russian): return "Возврат по Umrah-пакету"
        case (.package, .turkish): return TurkishLocalization.phrase("Umrah package refunds")
        case (.package, .arabic): return ArabicLocalization.phrase("Umrah package refunds")
        case (.package, .indonesian), (.package, .malay), (.package, .english): return "Umrah package refunds"
        case (.package, .uzbek): return "Umra paketi qaytarilishi"
        case (.package, .uzbekCyrillic): return "Умра пакети қайтарилиши"
        case (.flight, .russian): return "Авиабилет"
        case (.flight, .turkish): return TurkishLocalization.phrase("Flight")
        case (.flight, .arabic): return ArabicLocalization.phrase("Flight")
        case (.flight, .indonesian), (.flight, .malay), (.flight, .english): return "Flight"
        case (.flight, .uzbek): return "Aviachipta"
        case (.flight, .uzbekCyrillic): return "Авиачипта"
        case (.hotel, .russian): return "Отель"
        case (.hotel, .turkish): return TurkishLocalization.phrase("Hotel")
        case (.hotel, .arabic): return ArabicLocalization.phrase("Hotel")
        case (.hotel, .indonesian), (.hotel, .malay), (.hotel, .english): return "Hotel"
        case (.hotel, .uzbek): return "Mehmonxona"
        case (.hotel, .uzbekCyrillic): return "Меҳмонхона"
        case (.transfer, .russian): return "Трансфер"
        case (.transfer, .turkish): return TurkishLocalization.phrase("Transfer")
        case (.transfer, .arabic): return ArabicLocalization.phrase("Transfer")
        case (.transfer, .indonesian), (.transfer, .malay), (.transfer, .english): return "Transfer"
        case (.transfer, .uzbek): return "Transfer"
        case (.transfer, .uzbekCyrillic): return "Трансфер"
        case (.services, .russian): return "Сервисы iumrah"
        case (.services, .turkish): return TurkishLocalization.phrase("iumrah services")
        case (.services, .arabic): return ArabicLocalization.phrase("iumrah services")
        case (.services, .indonesian), (.services, .malay), (.services, .english): return "iumrah services"
        case (.services, .uzbek): return "iumrah xizmatlari"
        case (.services, .uzbekCyrillic): return "iumrah хизматлари"
        }
    }

    func badge(_ language: AppSettingsStore.Language) -> String {
        switch self {
        case .package:
            return localized(language,
                             ru: "Условия по каждому компоненту",
                             en: "Terms vary by component",
                             uz: "Har bir komponent uchun alohida",
                             uzCy: "Ҳар бир компонент учун алоҳида")
        case .flight:
            return localized(language,
                             ru: "По умолчанию без возврата",
                             en: "Non-refundable by default",
                             uz: "Odatda qaytarilmaydi",
                             uzCy: "Одатда қайтарилмайди")
        case .hotel:
            return localized(language,
                             ru: "По умолчанию без возврата",
                             en: "Non-refundable by default",
                             uz: "Odatda qaytarilmaydi",
                             uzCy: "Одатда қайтарилмайди")
        case .transfer:
            return localized(language,
                             ru: "Бесплатно за 24 часа",
                             en: "Free until 24 hours before",
                             uz: "24 soat oldin bepul",
                             uzCy: "24 соат олдин бепул")
        case .services:
            return localized(language,
                             ru: "Возврат до начала услуги",
                             en: "Refundable before service starts",
                             uz: "Xizmat boshlanguncha qaytariladi",
                             uzCy: "Хизмат бошлангунча қайтарилади")
        }
    }

    func summary(_ language: AppSettingsStore.Language) -> String {
        switch self {
        case .package:
            return localized(language,
                             ru: "Сумма возврата рассчитывается отдельно для авиабилета, отеля, трансфера и сервисов iumrah. Перед оплатой Вы увидите условия каждого компонента.",
                             en: "Your refund is calculated separately for the flight, hotel, transfer and iumrah services. You see each component’s terms before payment.",
                             uz: "Qaytarish summasi aviachipta, mehmonxona, transfer va iumrah xizmatlari uchun alohida hisoblanadi. To‘lovdan oldin har bir shart ko‘rsatiladi.",
                             uzCy: "Қайтариш суммаси авиачипта, меҳмонхона, трансфер ва iumrah хизматлари учун алоҳида ҳисобланади. Тўловдан олдин ҳар бир шарт кўрсатилади.")
        case .flight:
            return localized(language,
                             ru: "В базовый пакет включаются наиболее доступные тарифы. Такие билеты по умолчанию считаются невозвратными, если на конкретном тарифе прямо не указано иное. Возврат или изменение возможны только по правилам выбранного тарифа и авиакомпании.",
                             en: "The base package uses the most affordable fares. These tickets are treated as non-refundable unless the selected fare explicitly says otherwise. Any refund or change follows the fare and airline rules.",
                             uz: "Asosiy paketda eng qulay tariflar ishlatiladi. Tanlangan tarifda boshqacha ko‘rsatilmasa, bunday chiptalar qaytarilmaydi. Qaytarish yoki o‘zgartirish faqat tarif va aviakompaniya qoidalariga muvofiq amalga oshiriladi.",
                             uzCy: "Асосий пакетда энг қулай тарифлар ишлатилади. Танланган тарифда бошқача кўрсатилмаса, бундай чипталар қайтарилмайди. Қайтариш ёки ўзгартириш фақат тариф ва авиакомпания қоидаларига мувофиқ амалга оширилади.")
        case .hotel:
            return localized(language,
                             ru: "Базовая цена пакета использует невозвратный тариф отеля, если в карточке конкретного варианта не указана бесплатная отмена. Если отель или поставщик разрешает отмену, точный срок и удержание показываются до оплаты.",
                             en: "The base package uses a non-refundable hotel rate unless a specific option shows free cancellation. If the hotel or supplier permits cancellation, the exact deadline and fee are shown before payment.",
                             uz: "Asosiy paket narxi, agar aniq variantda bepul bekor qilish ko‘rsatilmagan bo‘lsa, qaytarilmaydigan mehmonxona tarifidan foydalanadi. Bekor qilish mumkin bo‘lsa, aniq muddat va ushlab qolish to‘lovdan oldin ko‘rsatiladi.",
                             uzCy: "Асосий пакет нархи, агар аниқ вариантда бепул бекор қилиш кўрсатилмаган бўлса, қайтарилмайдиган меҳмонхона тарифидан фойдаланади. Бекор қилиш мумкин бўлса, аниқ муддат ва ушлаб қолиш тўловдан олдин кўрсатилади.")
        case .transfer:
            return localized(language,
                             ru: "Отмена не позднее чем за 24 часа до подачи автомобиля — полный возврат стоимости трансфера. Позже удерживается $100, остальная сумма возвращается. После начала услуги или при неявке возврат рассматривается отдельно.",
                             en: "Cancel at least 24 hours before vehicle pickup for a full transfer refund. Later cancellations carry a $100 fee and the remainder is refunded. After service begins or in case of no-show, refunds are reviewed separately.",
                             uz: "Avtomobil kelishidan kamida 24 soat oldin bekor qilinsa, transfer summasi to‘liq qaytariladi. Keyinroq bekor qilinsa $100 ushlab qolinadi, qolgan summa qaytariladi. Xizmat boshlanganidan keyin yoki kelinmasa, qaytarish alohida ko‘rib chiqiladi.",
                             uzCy: "Автомобиль келишидан камида 24 соат олдин бекор қилинса, трансфер суммаси тўлиқ қайтарилади. Кейинроқ бекор қилинса $100 ушлаб қолинади, қолган сумма қайтарилади. Хизмат бошланганидан кейин ёки келинмаса, қайтариш алоҳида кўриб чиқилади.")
        case .services:
            return localized(language,
                             ru: "Неиспользованные сервисы iumrah возвращаются полностью до начала соответствующей услуги. Уже оказанная или начатая услуга считается использованной и рассчитывается отдельно.",
                             en: "Unused iumrah services are fully refundable before that service begins. A service that has already started or been delivered is treated as used and is settled separately.",
                             uz: "Foydalanilmagan iumrah xizmatlari tegishli xizmat boshlanishidan oldin to‘liq qaytariladi. Boshlangan yoki ko‘rsatilgan xizmat foydalanilgan hisoblanadi va alohida hisob-kitob qilinadi.",
                             uzCy: "Фойдаланилмаган iumrah хизматлари тегишли хизмат бошланишидан олдин тўлиқ қайтарилади. Бошланган ёки кўрсатилган хизмат фойдаланилган ҳисобланади ва алоҳида ҳисоб-китоб қилинади.")
        }
    }
}

private func localized(_ language: AppSettingsStore.Language, ru: String, en: String, uz: String, uzCy: String) -> String {
    switch language {
    case .russian: return ru
    case .turkish: return TurkishLocalization.phrase(en)
    case .arabic: return ArabicLocalization.phrase(en)
    case .indonesian, .malay, .english: return en
    case .uzbek: return uz
    case .uzbekCyrillic: return uzCy
    }
}

struct IumrahPolicyDetailView: View {
    @EnvironmentObject private var settings: AppSettingsStore
    let kind: IumrahPolicyKind
    var focus: IumrahRefundComponent? = nil

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 18) {
                policyHero

                IumrahPaymentMethodsMarquee(compact: true)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 2)

                switch kind {
                case .privacy:
                    privacyContent
                case .refund:
                    refundContent
                case .paymentSecurity:
                    paymentContent
                }
            }
            .padding(.horizontal, IumrahDesign.pagePadding)
            .padding(.top, 12)
            .padding(.bottom, 48)
        }
        .background(Color.iumrahPageBackground)
        .navigationTitle(kind.title(settings.language))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
    }

    private var policyHero: some View {
        HStack(alignment: .top, spacing: 14) {
            IumrahIconBadge(systemName: kind.icon, role: kind.role, size: 52, symbolSize: 21, cornerRadius: 17)
            VStack(alignment: .leading, spacing: 5) {
                Text(kind.title(settings.language))
                    .font(.system(size: 25, weight: .bold, design: .rounded))
                Text(heroSubtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .iumrahCard()
    }

    private var heroSubtitle: String {
        switch kind {
        case .privacy:
            return localized(settings.language,
                             ru: "Понятно о том, какие данные нужны iumrah для аккаунта, бронирования, поездки и поддержки.",
                             en: "A clear explanation of the data iumrah needs for your account, booking, journey and support.",
                             uz: "iumrah akkaunt, bron, safar va yordam uchun qaysi ma’lumotlardan foydalanishini aniq tushuntiradi.",
                             uzCy: "iumrah аккаунт, брон, сафар ва ёрдам учун қайси маълумотлардан фойдаланишини аниқ тушунтиради.")
        case .refund:
            return localized(settings.language,
                             ru: "Каждый компонент поездки имеет собственные условия. iumrah показывает их до оплаты и применяет к конкретному бронированию.",
                             en: "Each travel component has its own terms. iumrah shows them before payment and applies them to your booking.",
                             uz: "Safarning har bir komponenti o‘z shartlariga ega. iumrah ularni to‘lovdan oldin ko‘rsatadi va broningizga qo‘llaydi.",
                             uzCy: "Сафарнинг ҳар бир компоненти ўз шартларига эга. iumrah уларни тўловдан олдин кўрсатади ва бронга қўллайди.")
        case .paymentSecurity:
            return localized(settings.language,
                             ru: "В первой версии платежи временно оформляются вручную. Реквизиты, инвойс и подтверждение оплаты привязаны к конкретному бронированию.",
                             en: "In the first release, payments are temporarily handled manually. Payment details, invoice and proof of payment are tied to the booking.",
                             uz: "Birinchi versiyada to‘lovlar vaqtincha qo‘lda amalga oshiriladi. Rekvizitlar, invoice va to‘lov tasdig‘i aniq bron bilan bog‘lanadi.",
                             uzCy: "Биринчи версияда тўловлар вақтинча қўлда амалга оширилади. Реквизитлар, invoice ва тўлов тасдиғи аниқ брон билан боғланади.")
        }
    }

    private var privacyContent: some View {
        VStack(spacing: 14) {
            policySection(
                icon: "person.text.rectangle.fill",
                title: localized(settings.language, ru: "Какие данные используются", en: "Data we use", uz: "Qaysi ma’lumotlar ishlatiladi", uzCy: "Қайси маълумотлар ишлатилади"),
                body: localized(settings.language,
                                ru: "Данные профиля и iumrah ID; сведения о паломниках и поездке; паспортные и иные документы, которые Вы сами загружаете для оформления; контакты; данные бронирования; загруженные чеки; технические и защитные данные, необходимые для работы аккаунта и предотвращения злоупотреблений.",
                                en: "Profile and iumrah ID data; pilgrim and trip details; passport and other documents you submit for travel processing; contact details; booking data; uploaded payment receipts; and technical/security data needed to operate the account and prevent abuse.",
                                uz: "Profil va iumrah ID ma’lumotlari; ziyoratchi va safar ma’lumotlari; rasmiylashtirish uchun o‘zingiz yuklagan pasport va boshqa hujjatlar; aloqa ma’lumotlari; bron ma’lumotlari; yuklangan to‘lov cheklari; akkaunt ishlashi va suiiste’molning oldini olish uchun zarur texnik va xavfsizlik ma’lumotlari.",
                                uzCy: "Профил ва iumrah ID маълумотлари; зиёратчи ва сафар маълумотлари; расмийлаштириш учун ўзингиз юклаган паспорт ва бошқа ҳужжатлар; алоқа маълумотлари; брон маълумотлари; юкланган тўлов чеклари; аккаунт ишлаши ва суиистеъмолнинг олдини олиш учун зарур техник ва хавфсизлик маълумотлари."))

            policySection(
                icon: "checkmark.shield.fill",
                title: localized(settings.language, ru: "Зачем это нужно", en: "Why we use it", uz: "Nima uchun kerak", uzCy: "Нима учун керак"),
                body: localized(settings.language,
                                ru: "Чтобы создать и защитить аккаунт, собрать Umrah-пакет, оформить выбранные услуги, связаться с Вами по поездке, предоставить поддержку, подтвердить оплату, подготовить документы и выполнять обязательства по бронированию.",
                                en: "To create and protect your account, build the Umrah package, arrange selected services, contact you about the journey, provide support, verify payment, prepare documents and fulfil the booking.",
                                uz: "Akkaunt yaratish va himoyalash, Umra paketini tuzish, tanlangan xizmatlarni rasmiylashtirish, safar bo‘yicha aloqa qilish, yordam ko‘rsatish, to‘lovni tasdiqlash, hujjatlarni tayyorlash va bron majburiyatlarini bajarish uchun.",
                                uzCy: "Аккаунт яратиш ва ҳимоялаш, Умра пакетини тузиш, танланган хизматларни расмийлаштириш, сафар бўйича алоқа қилиш, ёрдам кўрсатиш, тўловни тасдиқлаш, ҳужжатларни тайёрлаш ва брон мажбуриятларини бажариш учун."))

            policySection(
                icon: "arrow.triangle.branch",
                title: localized(settings.language, ru: "Передача поставщикам", en: "Sharing with providers", uz: "Hamkorlarga uzatish", uzCy: "Ҳамкорларга узатиш"),
                body: localized(settings.language,
                                ru: "Только необходимые для исполнения поездки данные могут передаваться соответствующему поставщику: авиакомпании или билетному поставщику, отелю, перевозчику, визовому или иному сервисному партнёру. iumrah не передаёт больше данных, чем требуется для соответствующей услуги.",
                                en: "Only data needed to deliver the journey may be shared with the relevant provider: airline or ticket supplier, hotel, transfer provider, visa or other service partner. iumrah does not share more data than is needed for that service.",
                                uz: "Safarni bajarish uchun zarur ma’lumotlargina tegishli hamkorga — aviakompaniya yoki chipta yetkazib beruvchiga, mehmonxonaga, transfer xizmatiga, viza yoki boshqa xizmat hamkoriga uzatilishi mumkin. iumrah tegishli xizmat uchun zarur bo‘lganidan ortiq ma’lumot uzatmaydi.",
                                uzCy: "Сафарни бажариш учун зарур маълумотларгина тегишли ҳамкорга — авиакомпания ёки чипта етказиб берувчига, меҳмонхонага, трансфер хизматига, виза ёки бошқа хизмат ҳамкорига узатилиши мумкин. iumrah тегишли хизмат учун зарур бўлганидан ортиқ маълумот узатмайди."))

            policySection(
                icon: "lock.shield.fill",
                title: localized(settings.language, ru: "Как защищаются данные", en: "How data is protected", uz: "Ma’lumotlar qanday himoyalanadi", uzCy: "Маълумотлар қандай ҳимояланади"),
                body: localized(settings.language,
                                ru: "Приложение обращается к iumrah через HTTPS. Доступ к аккаунту и бронированиям ограничивается механизмами авторизации iumrah ID, сеансами и токенами конкретного бронирования. Пароль не хранится в открытом виде. Документы и чеки доступны только в защищённом контексте соответствующего аккаунта или бронирования.",
                                en: "The app connects to iumrah over HTTPS. Access to accounts and bookings is restricted through iumrah ID authentication, sessions and booking-specific tokens. Passwords are not stored in plain text. Documents and receipts are available only within the protected account or booking context.",
                                uz: "Ilova iumrah bilan HTTPS orqali ishlaydi. Akkaunt va bronlarga kirish iumrah ID autentifikatsiyasi, sessiyalar va aniq bron tokenlari bilan cheklanadi. Parol ochiq ko‘rinishda saqlanmaydi. Hujjatlar va cheklar faqat tegishli himoyalangan akkaunt yoki bron ichida mavjud.",
                                uzCy: "Илова iumrah билан HTTPS орқали ишлайди. Аккаунт ва бронларга кириш iumrah ID аутентификацияси, сессиялар ва аниқ брон токенлари билан чекланади. Парол очиқ кўринишда сақланмайди. Ҳужжатлар ва чеклар фақат тегишли ҳимояланган аккаунт ёки брон ичида мавжуд."))

            policySection(
                icon: "trash.slash.fill",
                title: localized(settings.language, ru: "Хранение и удаление", en: "Retention and deletion", uz: "Saqlash va o‘chirish", uzCy: "Сақлаш ва ўчириш"),
                body: localized(settings.language,
                                ru: "Данные хранятся столько, сколько необходимо для поездки, поддержки, безопасности и обязательного учёта. Запрос на доступ, исправление или удаление можно направить через iumrah Care. Часть данных может сохраняться дольше, если этого требуют расчёты, споры, безопасность или применимые правила.",
                                en: "Data is retained for as long as needed for the trip, support, security and required records. You can request access, correction or deletion through iumrah Care. Some records may need to be retained longer for accounting, disputes, security or applicable requirements.",
                                uz: "Ma’lumotlar safar, yordam, xavfsizlik va zarur hisob uchun kerak bo‘lgan muddatgacha saqlanadi. Kirish, tuzatish yoki o‘chirish so‘rovini iumrah Care orqali yuborishingiz mumkin. Hisob-kitob, nizolar, xavfsizlik yoki amaldagi talablar sabab ayrim ma’lumotlar uzoqroq saqlanishi mumkin.",
                                uzCy: "Маълумотлар сафар, ёрдам, хавфсизлик ва зарур ҳисоб учун керак бўлган муддатгача сақланади. Кириш, тузатиш ёки ўчириш сўровини iumrah Care орқали юборишингиз мумкин. Ҳисоб-китоб, низолар, хавфсизлик ёки амалдаги талаблар сабаб айрим маълумотлар узоқроқ сақланиши мумкин."))


            policySection(
                icon: "message.fill",
                title: localized(settings.language, ru: "Контакт по конфиденциальности", en: "Privacy contact", uz: "Maxfiylik bo‘yicha aloqa", uzCy: "Махфийлик бўйича алоқа"),
                body: localized(settings.language,
                                ru: "По вопросам конфиденциальности, доступа к данным, исправления или удаления используйте iumrah Care внутри приложения. Запрос будет привязан к Вашему аккаунту или бронированию для безопасной проверки.",
                                en: "For privacy questions, data access, correction or deletion requests, use iumrah Care inside the app. The request is linked to your account or booking for secure verification.",
                                uz: "Maxfiylik, ma’lumotlarga kirish, tuzatish yoki o‘chirish bo‘yicha savollar uchun ilova ichidagi iumrah Care’dan foydalaning. Xavfsiz tekshiruv uchun so‘rov akkauntingiz yoki broningiz bilan bog‘lanadi.",
                                uzCy: "Махфийлик, маълумотларга кириш, тузатиш ёки ўчириш бўйича саволлар учун илова ичидаги iumrah Care’дан фойдаланинг. Хавфсиз текширув учун сўров аккаунтингиз ёки брон билан боғланади."))
        }
    }

    private var refundContent: some View {
        VStack(spacing: 14) {
            refundRule(.flight)
            refundRule(.hotel)
            refundRule(.transfer)
            refundRule(.services)

            policySection(
                icon: "calendar.badge.clock",
                title: localized(settings.language, ru: "Условия фиксируются при бронировании", en: "Terms are fixed at booking", uz: "Shartlar bron paytida belgilanadi", uzCy: "Шартлар брон пайтида белгиланади"),
                body: localized(settings.language,
                                ru: "Если конкретный авиатариф, отель или поставщик показывает другие условия, именно они имеют приоритет и отображаются перед оплатой. Условия конкретного бронирования не должны ухудшаться задним числом после его подтверждения.",
                                en: "If a specific fare, hotel rate or supplier shows different terms, those terms take priority and are displayed before payment. The accepted terms for a booking should not be made worse retroactively after confirmation.",
                                uz: "Agar aniq avia tarif, mehmonxona tarifi yoki hamkor boshqa shartlarni ko‘rsatsa, o‘sha shartlar ustuvor bo‘ladi va to‘lovdan oldin ko‘rsatiladi. Tasdiqlangan bron shartlari keyinchalik orqaga qarab yomonlashtirilmaydi.",
                                uzCy: "Агар аниқ авиа тариф, меҳмонхона тарифи ёки ҳамкор бошқа шартларни кўрсатса, ўша шартлар устувор бўлади ва тўловдан олдин кўрсатилади. Тасдиқланган брон шартлари кейинчалик орқага қараб ёмонлаштирилмайди."))
        }
    }

    private var paymentContent: some View {
        VStack(spacing: 14) {
            IumrahManualPaymentNotice(showPolicyLink: false)

            policySection(
                icon: "number.square.fill",
                title: localized(settings.language, ru: "Реквизиты только внутри бронирования", en: "Payment details stay inside the booking", uz: "Rekvizitlar bron ichida", uzCy: "Реквизитлар брон ичида"),
                body: localized(settings.language,
                                ru: "Оплачивайте только по реквизитам, которые показаны в защищённом экране Вашего конкретного бронирования. Перед переводом проверьте номер брони, сумму и получателя. iumrah не просит PIN, CVV/CVC или пароль от банковского приложения.",
                                en: "Pay only using the details shown in the protected screen for your specific booking. Before transferring, verify the booking reference, amount and recipient. iumrah never asks for your PIN, CVV/CVC or banking-app password.",
                                uz: "Faqat aniq broningizning himoyalangan sahifasida ko‘rsatilgan rekvizitlar bo‘yicha to‘lang. O‘tkazmadan oldin bron raqami, summa va qabul qiluvchini tekshiring. iumrah PIN, CVV/CVC yoki bank ilovasi parolini so‘ramaydi.",
                                uzCy: "Фақат аниқ броннинг ҳимояланган саҳифасида кўрсатилган реквизитлар бўйича тўланг. Ўтказмадан олдин брон рақами, сумма ва қабул қилувчини текширинг. iumrah PIN, CVV/CVC ёки банк иловаси паролини сўрамайди."))

            policySection(
                icon: "doc.text.fill",
                title: localized(settings.language, ru: "Инвойс и чек", en: "Invoice and receipt", uz: "Invoice va chek", uzCy: "Invoice ва чек"),
                body: localized(settings.language,
                                ru: "Инвойс формируется из данных конкретного бронирования и доступен для сохранения в PDF. После ручной оплаты загрузите банковский чек: подтверждение прикрепляется к бронированию и используется для сверки платежа.",
                                en: "The invoice is generated from the specific booking and can be saved as a PDF. After manual payment, upload your bank receipt: the proof is attached to the booking and used to reconcile the payment.",
                                uz: "Invoice aniq bron ma’lumotlaridan yaratiladi va PDF sifatida saqlanishi mumkin. Qo‘lda to‘lovdan keyin bank chekini yuklang: tasdiq bronga biriktiriladi va to‘lovni tekshirish uchun ishlatiladi.",
                                uzCy: "Invoice аниқ брон маълумотларидан яратилади ва PDF сифатида сақланиши мумкин. Қўлда тўловдан кейин банк чекини юкланг: тасдиқ бронга бириктирилади ва тўловни текшириш учун ишлатилади."))

            policySection(
                icon: "arrow.uturn.backward.circle.fill",
                title: localized(settings.language, ru: "Если поездка отменяется", en: "If the trip is cancelled", uz: "Safar bekor qilinsa", uzCy: "Сафар бекор қилинса"),
                body: IumrahRefundComponent.package.summary(settings.language))
        }
    }

    private func refundRule(_ component: IumrahRefundComponent) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 11) {
                IumrahIconBadge(systemName: component.icon, role: component.role, size: 40, symbolSize: 16, cornerRadius: 13)
                VStack(alignment: .leading, spacing: 2) {
                    Text(component.title(settings.language)).font(.headline)
                    Text(component.badge(settings.language)).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                }
            }
            Text(component.summary(settings.language))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .iumrahCard()
        .overlay(alignment: .topTrailing) {
            if focus == component {
                Image(systemName: "checkmark.seal.fill")
                    .foregroundStyle(.green)
                    .padding(16)
            }
        }
    }

    private func policySection(icon: String, title: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: icon)
                .font(.headline)
            Text(body)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .iumrahCard()
    }
}

// MARK: - Contextual refund card

struct IumrahRefundPolicyCard: View {
    @EnvironmentObject private var settings: AppSettingsStore
    let component: IumrahRefundComponent
    var compact: Bool = true
    @State private var showPolicy = false

    var body: some View {
        Button {
            showPolicy = true
        } label: {
            HStack(alignment: .center, spacing: 12) {
                IumrahIconBadge(systemName: component.icon, role: component.role, size: compact ? 40 : 46, symbolSize: compact ? 16 : 19, cornerRadius: compact ? 13 : 15)
                VStack(alignment: .leading, spacing: 3) {
                    Text(component.title(settings.language))
                        .font(compact ? .subheadline.weight(.semibold) : .headline)
                    Text(component.badge(settings.language))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(compact ? 2 : nil)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.forward")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(compact ? 14 : 17)
        .background(Color.iumrahCardBackground, in: RoundedRectangle(cornerRadius: compact ? 20 : 24, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: compact ? 20 : 24, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.075), lineWidth: 0.7)
        }
        .sheet(isPresented: $showPolicy) {
            NavigationStack {
                IumrahPolicyDetailView(kind: .refund, focus: component)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button(localized(settings.language, ru: "Готово", en: "Done", uz: "Tayyor", uzCy: "Тайёр")) {
                                showPolicy = false
                            }
                        }
                    }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Initial manual-payment state

struct IumrahManualPaymentNotice: View {
    @EnvironmentObject private var settings: AppSettingsStore
    var showPolicyLink: Bool = true
    @State private var showPolicy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                IumrahIconBadge(systemName: "wrench.and.screwdriver.fill", role: .warning, size: 42, symbolSize: 17, cornerRadius: 14)
                VStack(alignment: .leading, spacing: 4) {
                    Text(localized(settings.language,
                                   ru: "Временная ручная оплата",
                                   en: "Temporary manual payment",
                                   uz: "Vaqtinchalik qo‘lda to‘lov",
                                   uzCy: "Вақтинчалик қўлда тўлов"))
                        .font(.headline)
                    Text(localized(settings.language,
                                   ru: "Первые 35 дней запуска",
                                   en: "First 35 days after launch",
                                   uz: "Ishga tushgandan keyingi dastlabki 35 kun",
                                   uzCy: "Ишга тушгандан кейинги дастлабки 35 кун"))
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 4)
            }

            Text(localized(settings.language,
                           ru: "Платёжный провайдер проходит серверное подключение и будет включён в следующем обновлении. Пока оплата выполняется вручную только по реквизитам внутри Вашего бронирования.",
                           en: "The payment provider is undergoing server integration and will be enabled in the next update. Until then, payment is made manually only using the details inside your booking.",
                           uz: "To‘lov provayderi serverga ulanmoqda va keyingi yangilanishda yoqiladi. Hozircha to‘lov faqat broningiz ichidagi rekvizitlar bo‘yicha qo‘lda amalga oshiriladi.",
                           uzCy: "Тўлов провайдери серверга уланмоқда ва кейинги янгиланишда ёқилади. Ҳозирча тўлов фақат брон ичидаги реквизитлар бўйича қўлда амалга оширилади."))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 8) {
                Label(localized(settings.language, ru: "Инвойс", en: "Invoice", uz: "Invoice", uzCy: "Invoice"), systemImage: "doc.text.fill")
                Label(localized(settings.language, ru: "Чек", en: "Receipt", uz: "Chek", uzCy: "Чек"), systemImage: "checkmark.seal.fill")
                Spacer(minLength: 0)
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)

            if showPolicyLink {
                Button {
                    showPolicy = true
                } label: {
                    HStack {
                        Text(localized(settings.language, ru: "Как защищена ручная оплата", en: "How manual payment is protected", uz: "Qo‘lda to‘lov qanday himoyalanadi", uzCy: "Қўлда тўлов қандай ҳимояланади"))
                        Spacer()
                        Image(systemName: "chevron.forward")
                    }
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.primary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(16)
        .background(Color.yellow.opacity(0.14), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(Color.yellow.opacity(0.38), lineWidth: 0.8)
        }
        .sheet(isPresented: $showPolicy) {
            NavigationStack {
                IumrahPolicyDetailView(kind: .paymentSecurity)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button(localized(settings.language, ru: "Готово", en: "Done", uz: "Tayyor", uzCy: "Тайёр")) {
                                showPolicy = false
                            }
                        }
                    }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
    }
}
