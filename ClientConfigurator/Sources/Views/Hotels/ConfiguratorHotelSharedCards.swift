import SwiftUI

enum StorefrontPackageInfoSheet: String, Identifiable {
    case visa
    case guide
    case care
    case trust

    var id: String { rawValue }
}

struct PackageHotelDetailCard: View {
    let hotel: StorefrontPackageHotel
    let selectedRoomName: String?
    let chooseRoomText: String
    let language: AppSettingsStore.Language
    let onOpen: () -> Void

    var body: some View {
        Button {
            IumrahHaptics.selection()
            onOpen()
        } label: {
            GeometryReader { proxy in
                let mediaWidth = min(max(proxy.size.width * 0.31, 108), 124)
                HStack(spacing: 0) {
                    ZStack {
                        if let imageURL = hotel.coverImageURL, !imageURL.isEmpty {
                            HotelCachedImage(rawURL: imageURL)
                                .frame(width: mediaWidth, height: 150)
                        } else {
                            Color.iumrahRaisedBackground
                                .overlay {
                                    Image(systemName: "building.2.fill")
                                        .font(.title2)
                                        .foregroundStyle(.secondary)
                                }
                        }
                    }
                    .frame(width: mediaWidth, height: 150)
                    .clipped()

                    VStack(alignment: .leading, spacing: 7) {
                        Text(hotel.name)
                            .font(.headline)
                            .foregroundStyle(.primary)
                            .lineLimit(2)
                        HStack(spacing: 6) {
                            if let stars = hotel.stars {
                                Text(String(repeating: "★", count: max(1, min(5, stars))))
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(IumrahIconRole.rating.color)
                            }
                            Text(cityTitle)
                                .font(.caption.weight(.medium))
                                .foregroundStyle(.secondary)
                        }
                        Label(nightsText, systemImage: "moon.stars.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)

                        Spacer(minLength: 0)

                        HStack(spacing: 6) {
                            Image(systemName: "bed.double.fill")
                                .font(.caption)
                            Text(selectedRoomName ?? chooseRoomText)
                                .font(.caption.weight(.semibold))
                                .lineLimit(1)
                            Spacer(minLength: 4)
                            Image(systemName: "chevron.right")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(.tertiary)
                        }
                        .foregroundStyle(selectedRoomName == nil ? .secondary : .primary)
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                }
                .frame(width: proxy.size.width, height: 150)
            }
            .frame(height: 150)
            .background(Color.iumrahCardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 25, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 25, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.055), lineWidth: 0.6)
            }
        }
        .buttonStyle(.plain)
    }

    private var cityTitle: String { L10n.city(hotel.city, language) }
    private var nightsText: String {
        switch language {
        case .russian: return "\(hotel.nights) ноч."
        case .english, .turkish, .indonesian, .malay, .arabic: return "\(hotel.nights) nights"
        case .uzbek: return "\(hotel.nights) tun"
        case .uzbekCyrillic: return "\(hotel.nights) тун"
        }
    }
}

struct StorefrontPackageInformationSheet: View {
    @Environment(\.dismiss) private var dismiss
    let kind: StorefrontPackageInfoSheet
    let language: AppSettingsStore.Language
    var preview: StorefrontFlightPackagePreview? = nil

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    switch kind {
                    case .visa:
                        visaContent
                    case .guide:
                        guideContent
                    case .care:
                        careContent
                    case .trust:
                        trustContent
                    }
                }
                .padding(IumrahDesign.pagePadding)
                .padding(.bottom, 28)
            }
            .background(Color.iumrahPageBackground)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(doneTitle) { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    @ViewBuilder
    private var header: some View {
        if kind == .visa {
            visaHero
        } else {
            VStack(alignment: .leading, spacing: 8) {
                IumrahIconBadge(systemName: headerIcon, role: headerRole, size: 50, symbolSize: 20, cornerRadius: 16)
                Text(sheetTitle)
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .tracking(-0.7)
                Text(sheetSubtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var visaHero: some View {
        VStack(alignment: .leading, spacing: 14) {
            ZStack(alignment: .bottomLeading) {
                Image("SaudiVisaRiyadhHero")
                    .resizable()
                    .scaledToFill()
                    .frame(height: 190)
                    .frame(maxWidth: .infinity)
                    .clipped()

                LinearGradient(
                    colors: [.clear, .black.opacity(0.74)],
                    startPoint: .top,
                    endPoint: .bottom
                )

                VStack(alignment: .leading, spacing: 8) {
                    Text(sheetTitle)
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .tracking(-0.6)
                    Text(sheetSubtitle)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.white.opacity(0.82))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(18)
            }
            .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))

            HStack(spacing: 12) {
                Image("SaudiEVisaLogo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 118, height: 68)
                    .padding(.horizontal, 8)
                    .background(.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .strokeBorder(Color.black.opacity(0.06), lineWidth: 0.7)
                    }

                Text(tr("Официальная туристическая eVisa Саудовской Аравии", "Official Saudi tourist eVisa", "Saudiya rasmiy turistik eVisa", "Саудия расмий туристик eVisa"))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var visaContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    visaChip("1 \(tr("год", "year", "yil", "йил"))")
                    visaChip(tr("Многократная", "Multiple entry", "Ko‘p kirish", "Кўп кириш"))
                    visaChip(tr("До 90 дней", "Up to 90 days", "90 kungacha", "90 кунгача"))
                }
                VStack(alignment: .leading, spacing: 8) {
                    visaChip("1 \(tr("год", "year", "yil", "йил"))")
                    visaChip(tr("Многократный въезд · до 90 дней", "Multiple entry · up to 90 days", "Ko‘p kirish · 90 kungacha", "Кўп кириш · 90 кунгача"))
                }
            }

            infoCard {
                infoPoint(
                    icon: "building.columns.fill",
                    title: tr("Для Умры", "For Umrah", "Umra uchun", "Умра учун"),
                    body: tr("Туристическая eVisa подходит для Умры. Для Хаджа она не используется.", "The tourist eVisa can be used for Umrah. It is not a Hajj visa.", "Turistik eVisa Umra uchun ishlatiladi. Haj vizasi emas.", "Туристик eVisa Умра учун ишлатилади. Ҳаж визаси эмас.")
                )
                Divider()
                infoPoint(
                    icon: "person.text.rectangle",
                    title: tr("Паспорт", "Passport", "Pasport", "Паспорт"),
                    body: tr("Для официальной eVisa паспорт должен соответствовать требованиям Saudi Visa и иметь не менее 6 месяцев действия на дату въезда.", "For the official eVisa, the passport must meet Saudi Visa requirements and have at least 6 months validity on the date of entry.", "Rasmiy eVisa uchun pasport Saudi Visa talablariga mos bo‘lishi va kirish sanasida kamida 6 oy amal qilishi kerak.", "Расмий eVisa учун паспорт Saudi Visa талабларига мос бўлиши ва кириш санасида камида 6 ой амал қилиши керак.")
                )
                Divider()
                infoPoint(
                    icon: "checkmark.seal.fill",
                    title: tr("Решение по визе", "Visa decision", "Viza qarori", "Виза қарори"),
                    body: tr("Окончательное решение о выдаче визы и въезде принимает компетентный орган Саудовской Аравии.", "The competent Saudi authority makes the final visa and admission decision.", "Viza va kirish bo‘yicha yakuniy qarorni Saudiya vakolatli organi qabul qiladi.", "Виза ва кириш бўйича якуний қарорни Саудия ваколатли органи қабул қилади.")
                )
            }

            Link(destination: URL(string: "https://visa.visitsaudi.com/")!) {
                HStack {
                    Label(officialVisaSourceTitle, systemImage: "safari.fill")
                    
                    
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(IumrahPrimaryButtonStyle())
        }
    }

    private func visaChip(_ text: String) -> some View {
        Text(text)
            .font(.caption.weight(.bold))
            .padding(.horizontal, 12)
            .frame(height: 34)
            .background(Color.iumrahRaisedBackground, in: Capsule())
    }

    private var guideContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Label(tr("Команда iumrah в Саудовской Аравии", "iumrah team in Saudi Arabia", "Saudiya Arabistonidagi iumrah jamoasi", "Саудия Арабистонидаги iumrah жамоаси"), systemImage: "person.2.fill")
                    .font(.headline)
                Text(tr(
                    "К вашей семье или группе привязывается персональное сопровождение на месте. Это операционная команда поездки, а не общий чат поддержки.",
                    "Your family or group gets personal on-the-ground assistance. This is the trip operations team, not a general support chat.",
                    "Oilangiz yoki guruhingizga joydagi shaxsiy hamrohlik biriktiriladi. Bu umumiy chat emas, safar operatsion jamoasi.",
                    "Оилангиз ёки гуруҳингизга жойдаги шахсий ҳамроҳлик бириктирилади. Бу умумий чат эмас, сафар операцион жамоаси."
                ))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            }
            .iumrahCard()

            infoCard {
                guidePoint("airplane.arrival", tr("Встреча после прилёта", "Arrival welcome", "Kelganda kutib olish", "Келганда кутиб олиш"), tr("Встречают в аэропорту и помогают пройти первые организационные шаги поездки.", "They meet you at the airport and help with the first operational steps of the trip.", "Aeroportda kutib oladi va safarning dastlabki tashkiliy ishlarida yordam beradi.", "Аэропортда кутиб олади ва сафарнинг дастлабки ташкилий ишларида ёрдам беради."))
                Divider()
                guidePoint("building.2.fill", tr("Заселение и язык", "Check-in and language", "Joylashish va til", "Жойлашиш ва тил"), tr("Помогают с заселением, общением на арабском и вопросами к отелю.", "They assist with hotel check-in, Arabic communication and hotel questions.", "Mehmonxonaga joylashish, arab tilida muloqot va hotel savollarida yordam beradi.", "Меҳмонхонага жойлашиш, араб тилида мулоқот ва меҳмонхона саволларида ёрдам беради."))
                Divider()
                guidePoint("car.fill", tr("Трансферы и маршрут", "Transfers and route", "Transfer va yo‘nalish", "Трансфер ва йўналиш"), tr("Контролируют ключевые переезды, встречи транспорта и переход между городами, если Медина включена.", "They coordinate key transfers, vehicle meetings and the intercity leg when Madinah is included.", "Asosiy transferlar, transport bilan uchrashuv va Madina bo‘lsa shaharlararo yo‘lni nazorat qiladi.", "Асосий трансферлар, транспорт билан учрашув ва Мадина бўлса шаҳарлараро йўлни назорат қилади."))
                Divider()
                guidePoint("mappin.and.ellipse", tr("Умра и зияраты", "Umrah and ziyarat", "Umra va ziyoratlar", "Умра ва зиёратлар"), tr("Сопровождают включённую программу и помогают по организационным вопросам в течение поездки.", "They accompany the included program and help with operational questions throughout the trip.", "Kiritilgan dasturda hamroh bo‘ladi va safar davomida tashkiliy savollarda yordam beradi.", "Киритилган дастурда ҳамроҳ бўлади ва сафар давомида ташкилий саволларда ёрдам беради."))
                Divider()
                guidePoint("airplane.departure", tr("До обратного вылета", "Through return departure", "Qaytishgacha", "Қайтишгача"), tr("В конце поездки сопровождают организацию выезда и трансфер в аэропорт на обратный рейс.", "At the end of the trip they coordinate departure and the airport transfer for your return flight.", "Safar oxirida jo‘nash va qaytish reysi uchun aeroport transferini muvofiqlashtiradi.", "Сафар охирида жўнаш ва қайтиш рейси учун аэропорт трансферини мувофиқлаштиради."))
            }
        }
    }

    private var careContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 14) {
                Image("CareChatAvatar")
                    .resizable()
                    .scaledToFill()
                    .frame(width: 64, height: 64)
                    .clipShape(Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text("Абдулазиз")
                        .font(.headline)
                    Text(tr("Основатель iumrah · iumrah Care", "Founder of iumrah · iumrah Care", "iumrah asoschisi · iumrah Care", "iumrah асосчиси · iumrah Care"))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            .iumrahCard()

            Text(tr(
                "До бронирования и во время поездки вы можете напрямую обсудить со мной пакет, отель, сезон, оплату, изменения или любой вопрос по вашей Умре. Я контролирую поддержку поездки и остаюсь доверенным контактом со стороны iumrah.",
                "Before booking and during the trip, you can contact me directly about the package, hotel, season, payment, changes or any question about your Umrah. I oversee trip support and remain your trusted iumrah contact.",
                "Bron qilishdan oldin va safar davomida paket, mehmonxona, mavsum, to‘lov, o‘zgarishlar yoki Umrangiz bo‘yicha istalgan savolni men bilan bevosita muhokama qilishingiz mumkin. Men safar yordamini nazorat qilaman va iumrah tomonidan ishonchli aloqangiz bo‘lib qolaman.",
                "Брон қилишдан олдин ва сафар давомида пакет, меҳмонхона, мавсум, тўлов, ўзгаришлар ёки Умрангиз бўйича исталган саволни мен билан бевосита муҳокама қилишингиз мумкин. Мен сафар ёрдамини назорат қиламан ва iumrah томонидан ишончли алоқангиз бўлиб қоламан."
            ))
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)

            Link(destination: URL(string: "https://t.me/saudiclub966")!) {
                HStack {
                    Label(tr("Написать Абдулазизу", "Message Abdulaziz", "Abdulazizga yozish", "Абдулазизга ёзиш"), systemImage: "paperplane.fill")
                    
                    Text("Telegram")
                        .font(.caption.weight(.semibold))
                        .opacity(0.74)
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(IumrahPrimaryButtonStyle())

            Link(destination: URL(string: "tel:+998508898845")!) {
                HStack {
                    Label(callTitle, systemImage: "phone.fill")
                    
                    Text("+998 50 889 88 45")
                        .font(.caption.weight(.semibold))
                        .opacity(0.74)
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(IumrahPrimaryButtonStyle())
        }
    }

    private var trustContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            infoCard {
                infoPoint(
                    icon: "person.crop.circle.fill",
                    title: tr("Живой контакт до оплаты", "A real contact before payment", "To‘lovdan oldin jonli aloqa", "Тўловдан олдин жонли алоқа"),
                    body: tr("Перед бронированием можно напрямую обсудить пакет и оплату с основателем iumrah — Абдулазизом.", "Before booking, you can discuss the package and payment directly with iumrah founder Abdulaziz.", "Bron qilishdan oldin paket va to‘lovni iumrah asoschisi Abdulaziz bilan bevosita muhokama qilishingiz mumkin.", "Брон қилишдан олдин пакет ва тўловни iumrah асосчиси Абдулазиз билан бевосита муҳокама қилишингиз мумкин.")
                )
                Divider()
                infoPoint(
                    icon: "doc.text.fill",
                    title: tr("Инвойс и чек", "Invoice and receipt", "Invoice va chek", "Invoice ва чек"),
                    body: tr("Сумма и состав заказа фиксируются в инвойсе; после подтверждения оплаты вы получаете подтверждение и чек оплаты.", "The order amount and contents are recorded in the invoice; after payment confirmation you receive payment confirmation and a receipt.", "Buyurtma summasi va tarkibi invoice’da qayd etiladi; to‘lov tasdiqlangach tasdiq va chek olasiz.", "Буюртма суммаси ва таркиби invoice’да қайд этилади; тўлов тасдиқлангач тасдиқ ва чек оласиз.")
                )
                Divider()
                infoPoint(
                    icon: "checkmark.shield.fill",
                    title: tr("Ответственность iumrah", "iumrah responsibility", "iumrah javobgarligi", "iumrah жавобгарлиги"),
                    body: tr("iumrah контролирует подтверждение отеля и выполнение iumrah Services: трансферы, сопровождение, зияраты и поддержку по поездке.", "iumrah controls hotel confirmation and delivery of iumrah Services: transfers, assistance, ziyarat and trip support.", "iumrah mehmonxona tasdig‘i va iumrah Services bajarilishini nazorat qiladi: transfer, hamrohlik, ziyoratlar va safar yordami.", "iumrah меҳмонхона тасдиғи ва iumrah Services бажарилишини назорат қилади: трансфер, ҳамроҳлик, зиёратлар ва сафар ёрдами.")
                )
                Divider()
                infoPoint(
                    icon: "airplane",
                    title: tr("Ответственность авиакомпании", "Airline responsibility", "Aviakompaniya javobgarligi", "Авиакомпания жавобгарлиги"),
                    body: tr("Выполнение рейса, задержка или отмена находятся в зоне ответственности авиакомпании. Изменение или возврат билета определяется правилами выбранного тарифа и авиакомпании.", "Flight operation, delay or cancellation are the airline’s responsibility. Ticket changes and refunds follow the selected fare and airline rules.", "Reysni bajarish, kechikish yoki bekor qilish aviakompaniya javobgarligida. Chipta o‘zgarishi va qaytarilishi tanlangan tarif va aviakompaniya qoidalariga bog‘liq.", "Рейсни бажариш, кечикиш ёки бекор қилиш авиакомпания жавобгарлигида. Чипта ўзгариши ва қайтарилиши танланган тариф ва авиакомпания қоидаларига боғлиқ.")
                )
            }

            VStack(alignment: .leading, spacing: 8) {
                Text(tr("Возврат — отдельная политика", "Refunds are a separate policy", "Qaytarish — alohida siyosat", "Қайтариш — алоҳида сиёсат"))
                    .font(.headline)
                Text(tr("Правила возврата показываются отдельно по авиабилету, отелю, трансферу и сервисам iumrah — без смешивания с блоком доверия.", "Refund rules are shown separately for flights, hotels, transfers and iumrah services rather than being mixed into the trust section.", "Qaytarish qoidalari aviachipta, mehmonxona, transfer va iumrah xizmatlari bo‘yicha alohida ko‘rsatiladi.", "Қайтариш қоидалари авиачипта, меҳмонхона, трансфер ва iumrah хизматлари бўйича алоҳида кўрсатилади."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                NavigationLink {
                    IumrahPolicyDetailView(kind: .refund)
                } label: {
                    HStack {
                        Label(tr("Открыть политику возврата", "Open refund policy", "Qaytarish siyosatini ochish", "Қайтариш сиёсатини очиш"), systemImage: "arrow.uturn.backward.circle.fill")
                        
                        
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(IumrahPrimaryButtonStyle())
            }
            .iumrahCard()
        }
    }

    private func infoCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            content()
        }
        .iumrahCard()
    }

    private func infoPoint(icon: String, title: String, body: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            IumrahIconBadge(systemName: icon, role: .security, size: 38, symbolSize: 14, cornerRadius: 12)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(body).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func guidePoint(_ icon: String, _ title: String, _ body: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            IumrahIconBadge(systemName: icon, role: .care, size: 38, symbolSize: 14, cornerRadius: 12)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(body).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var headerIcon: String {
        switch kind {
        case .visa: return "doc.text.fill"
        case .guide: return "person.crop.circle.badge.checkmark"
        case .care: return "heart.fill"
        case .trust: return "checkmark.shield.fill"
        }
    }

    private var headerRole: IumrahIconRole {
        switch kind {
        case .visa: return .document
        case .guide, .care: return .care
        case .trust: return .security
        }
    }

    private var sheetTitle: String {
        switch kind {
        case .visa: return tr("Saudi eVisa для Умры", "Saudi eVisa for Umrah", "Umra uchun Saudi eVisa", "Умра учун Saudi eVisa")
        case .guide: return "iumrah Guide"
        case .care: return "iumrah Care"
        case .trust: return tr("Доверие перед бронированием", "Confidence before booking", "Bron oldidan ishonch", "Брон олдидан ишонч")
        }
    }

    private var sheetSubtitle: String {
        switch kind {
        case .visa:
            return tr("Коротко о визе, которая используется для этой поездки.", "A concise view of the visa used for this trip.", "Ushbu safarda ishlatiladigan viza haqida qisqacha.", "Ушбу сафарда ишлатиладиган виза ҳақида қисқача.")
        case .guide:
            return tr("Персональная команда сопровождения на месте в Саудовской Аравии — от прилёта до обратного вылета.", "Personal on-the-ground assistance in Saudi Arabia from arrival through return departure.", "Saudiya Arabistonida kelishdan qaytishgacha shaxsiy hamrohlik jamoasi.", "Саудия Арабистонида келишдан қайтишгача шахсий ҳамроҳлик жамоаси.")
        case .care:
            return tr("Прямой контакт с основателем iumrah по пакету, бронированию и вашей поездке.", "Direct contact with the iumrah founder about your package, booking and trip.", "Paket, bron va safaringiz bo‘yicha iumrah asoschisi bilan bevosita aloqa.", "Пакет, брон ва сафарингиз бўйича iumrah асосчиси билан бевосита алоқа.")
        case .trust:
            return tr("Кто отвечает за вашу поездку, какие документы вы получаете и где проходит граница ответственности авиакомпании.", "Who is responsible for your trip, which documents you receive, and where airline responsibility begins.", "Safaringiz uchun kim javob beradi, qaysi hujjatlarni olasiz va aviakompaniya javobgarligi qayerdan boshlanadi.", "Сафарингиз учун ким жавоб беради, қайси ҳужжатларни оласиз ва авиакомпания жавобгарлиги қаердан бошланади.")
        }
    }

    private var officialVisaSourceTitle: String { tr("Открыть Saudi Visa", "Open Saudi Visa", "Saudi Visa’ni ochish", "Saudi Visa’ни очиш") }
    private var callTitle: String { tr("Позвонить", "Call", "Qo‘ng‘iroq", "Қўнғироқ") }
    private var doneTitle: String { tr("Готово", "Done", "Tayyor", "Тайёр") }

    private func tr(_ ru: String, _ en: String, _ uz: String, _ uzCy: String) -> String {
        switch language {
        case .russian: return ru
        case .english, .turkish, .indonesian, .malay, .arabic: return en
        case .uzbek: return uz
        case .uzbekCyrillic: return uzCy
        }
    }
}
