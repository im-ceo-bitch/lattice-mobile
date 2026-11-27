import SwiftUI

private struct BrandText {
    let ru: String, en: String, uz: String
    init(_ ru: String,_ en: String,_ uz: String) { self.ru=ru; self.en=en; self.uz=uz }
    func value(_ language: AppSettingsStore.Language) -> String {
        switch language { case .russian: return ru; case .uzbek: return uz; case .uzbekCyrillic: return Self.cyrillic(uz); default: return en }
    }
    private static func cyrillic(_ input: String) -> String {
        // Deterministic Uzbek Latin → Cyrillic display. Brand name stays unchanged.
        let pairs = [("o‘","ў"),("g‘","ғ"),("sh","ш"),("ch","ч"),("yo","ё"),("yu","ю"),("ya","я"),("ng","нг"),("a","а"),("b","б"),("d","д"),("e","е"),("f","ф"),("g","г"),("h","ҳ"),("i","и"),("j","ж"),("k","к"),("l","л"),("m","м"),("n","н"),("o","о"),("p","п"),("q","қ"),("r","р"),("s","с"),("t","т"),("u","у"),("v","в"),("x","х"),("y","й"),("z","з"),("’","ъ")]
        var text = input.replacingOccurrences(of: "iumrah", with: "§")
        for (latin,cy) in pairs { text = text.replacingOccurrences(of: latin.prefix(1).uppercased()+String(latin.dropFirst()), with: cy.uppercased()).replacingOccurrences(of: latin, with: cy) }
        return text.replacingOccurrences(of: "§", with: "iumrah")
    }
}
private struct BrandReason: Identifiable {
    let id: Int
    let label: BrandText, title: BrandText, detail: BrandText
    let icon: String
}
private enum BrandContent {
    static let slogan = BrandText("Ближе к своим близким. Ближе к поклонению.","Closer to your loved ones. Closer to worship.","Yaqinlaringizga yaqinroq. Ibodatga yaqinroq.")
    static let subtitle = BrandText("Индивидуальная умра. Прозрачная стоимость. Персональная забота.","Individual Umrah. Transparent pricing. Personal care.","Individual umra. Shaffof narx. Shaxsiy g‘amxo‘rlik.")
    static let missionTitle = BrandText("Мы создали не просто туристическую платформу.","We built more than a travel platform.","Biz shunchaki sayohat platformasini yaratmadik.")
    static let mission = BrandText("Мы хотели дать каждой семье возможность отправиться на умру вместе. Самостоятельно выбрать своё путешествие, понимать его стоимость и не зависеть от расписания больших групп.","We wanted every family to be able to go on Umrah together. To choose their own journey, understand its cost and travel without depending on the schedule of a large group.","Har bir oilaga birga umra safariga borish imkonini bermoqchi edik. Safarini mustaqil tanlash, narxini tushunish va katta guruhlar jadvaliga bog‘liq bo‘lmaslik uchun.")
    static let missionEnd = BrandText("Потому что умра — это прежде всего поклонение, а не туристическая поездка.","Because Umrah is first and foremost an act of worship, not a tourist trip.","Chunki umra — avvalo ibodat, sayyohlik safari emas.")
    static let why = BrandText("Почему iumrah?","Why iumrah?","Nega iumrah?")
    static let compare = BrandText("Сравнить с групповым туром","Compare with group travel","Guruhli safar bilan taqqoslash")
    static let reasons: [BrandReason] = [
        .init(id:0,label:.init("Наша миссия","Our mission","Missiyamiz"),title:.init("Умра должна быть доступна каждой семье.","Umrah should be accessible to every family.","Umra har bir oila uchun imkonli bo‘lishi kerak."),detail:.init("Самостоятельно организуйте индивидуальную умру для своих близких. С понятной стоимостью и без необходимости обращаться в традиционную турфирму.","Organize an individual Umrah for your loved ones, with clear pricing and without relying on a traditional travel agency.","Yaqinlaringiz uchun individual umrani mustaqil tashkil qiling. Tushunarli narx bilan va an’anaviy turfirmaga murojaat qilmasdan."),icon:"heart"),
        .init(id:1,label:.init("Свобода путешествия","Freedom to travel","Safar erkinligi"),title:.init("Ваше путешествие. Ваш темп.","Your journey. Your pace.","Safaringiz. O‘z sur’atingiz."),detail:.init("Без ожидания большой группы и необходимости подстраиваться под чужое расписание.","No waiting for a large group or adapting to someone else’s schedule.","Katta guruhni kutmasdan va boshqalarning jadvaliga moslashmasdan."),icon:"clock"),
        .init(id:2,label:.init("Персональное сопровождение","Personal guidance","Shaxsiy hamrohlik"),title:.init("Один гид. Для вашей семьи.","One guide. For your family.","Bir gid. Oilangiz uchun."),detail:.init("Задавайте вопросы, получайте объяснения и совершайте умру без спешки.","Ask questions, receive explanations and perform Umrah without rushing.","Savollar bering, tushuntirishlar oling va umrani shoshilmasdan bajaring."),icon:"person.2"),
        .init(id:3,label:.init("Индивидуальный транспорт","Private transport","Shaxsiy transport"),title:.init("Ваш личный автомобиль.","Your private car.","Shaxsiy avtomobilingiz."),detail:.init("Путешествуйте вместе с близкими, не ожидая остальных пассажиров.","Travel with your loved ones without waiting for other passengers.","Boshqa yo‘lovchilarni kutmasdan yaqinlaringiz bilan sayohat qiling."),icon:"car.side"),
        .init(id:4,label:.init("Прозрачность","Transparency","Shaffoflik"),title:.init("Знайте, за что платите.","Know what you pay for.","Nima uchun to‘layotganingizni biling."),detail:.init("Стоимость каждой услуги вашего путешествия доступна ещё до бронирования.","See the price of each service before booking.","Safaringizdagi har bir xizmat narxini bron qilishdan oldin ko‘ring."),icon:"receipt"),
        .init(id:5,label:.init("Свобода выбора","Freedom of choice","Tanlov erkinligi"),title:.init("Создайте свою умру.","Create your own Umrah.","O‘z umrangizni tuzing."),detail:.init("Ваши даты, авиабилеты, отели, номера и дополнительные услуги.","Your dates, flights, hotels, rooms and additional services.","Sizning sanalaringiz, aviachiptalaringiz, mehmonxonalaringiz, xonalaringiz va qo‘shimcha xizmatlaringiz."),icon:"slider.horizontal.3"),
        .init(id:6,label:.init("Наша ответственность","Our responsibility","Mas’uliyatimiz"),title:.init("Вы поклоняетесь. Мы заботимся.","You worship. We take care.","Siz ibodat qiling. Biz g‘amxo‘rlik qilamiz."),detail:.init("Наша команда помогает вам на каждом этапе путешествия.","Our team supports you at every stage of your journey.","Jamoamiz safaringizning har bir bosqichida sizga yordam beradi."),icon:"checkmark.shield"),
        .init(id:7,label:.init("Почувствуйте разницу","Experience the difference","Farqni his qiling"),title:.init("Два формата. Совершенно разный опыт.","Two formats. A completely different experience.","Ikki format. Butunlay boshqa tajriba."),detail:.init("Узнайте, чем индивидуальная умра с iumrah отличается от традиционного группового путешествия.","Discover how individual Umrah with iumrah differs from traditional group travel.","iumrah bilan individual umra an’anaviy guruhli safardan qanday farq qilishini biling."),icon:"arrow.left.arrow.right")
    ]
}
private struct BrandSurface: ViewModifier {
    func body(content: Content) -> some View { content.foregroundStyle(.white).background(LinearGradient(colors:[Color(white:0.12),Color(white:0.025)],startPoint:.topLeading,endPoint:.bottomTrailing),in:RoundedRectangle(cornerRadius:24)).environment(\.colorScheme,.dark) }
}
private struct BrandCTA: View {
    let title: String; let action: () -> Void
    var body: some View { Button(action: action) { HStack { Spacer(minLength:0); Text(title).font(.system(.subheadline,design:.rounded,weight:.semibold)).multilineTextAlignment(.center); Spacer(minLength:0); Image(systemName:"arrow.right") }.foregroundStyle(.black).padding(12).frame(minHeight:44).background(.white,in:Capsule()) }.buttonStyle(.plain) }
}
struct IumrahSloganCard: View {
    @EnvironmentObject private var settings: AppSettingsStore
    var body: some View {
        VStack(alignment:.leading,spacing:14) {
            Text("iumrah").font(.system(size:34,weight:.heavy,design:.rounded))
            Text(BrandContent.slogan.value(settings.language)).font(.system(.title2,design:.rounded,weight:.bold)).fixedSize(horizontal:false,vertical:true)
            Text(BrandContent.subtitle.value(settings.language)).font(.subheadline).foregroundStyle(Color.white.opacity(0.72))
            Divider().overlay(Color.white.opacity(0.14))
            Text("iumrah.app").font(.caption).foregroundStyle(Color.white.opacity(0.6))
        }.frame(maxWidth:.infinity,alignment:.leading).padding(24)
            .background { IumrahWorldDotsHeaderBackground(mapOpacity:0.25).overlay { LinearGradient(colors:[.black.opacity(0.05),.black.opacity(0.85)],startPoint:.top,endPoint:.bottom) } }
            .clipShape(RoundedRectangle(cornerRadius:24)).foregroundStyle(.white).environment(\.colorScheme,.dark)
    }
}
struct IumrahMissionCard: View {
    @EnvironmentObject private var settings: AppSettingsStore
    var body: some View {
        VStack(alignment:.leading,spacing:16) {
            Text(BrandContent.reasons[0].label.value(settings.language).uppercased()).font(.caption.weight(.medium)).foregroundStyle(Color.white.opacity(0.55))
            Text(BrandContent.missionTitle.value(settings.language)).font(.system(.title2,design:.rounded,weight:.bold))
            Text(BrandContent.mission.value(settings.language)).font(.subheadline).foregroundStyle(Color.white.opacity(0.75))
            Divider().overlay(Color.white.opacity(0.15))
            Text(BrandContent.missionEnd.value(settings.language)).font(.subheadline.weight(.medium))
            HStack { Text("iumrah").font(.title3.bold()); Spacer(); Image(systemName:"heart").foregroundStyle(Color.white.opacity(0.5)) }
        }.padding(22).frame(maxWidth:.infinity,alignment:.leading).modifier(BrandSurface())
    }
}
struct WhyIumrahCarousel: View {
    @EnvironmentObject private var settings: AppSettingsStore
    @State private var selected: Int? = 0
    @State private var showing = false
    @State private var performAfterDismiss = false
    var primaryTitle: String? = nil
    var onPrimary: (() -> Void)? = nil
    var body: some View {
        VStack(alignment:.leading,spacing:12) {
            HStack { Text(BrandContent.why.value(settings.language)).font(.system(.title2,design:.rounded,weight:.bold)); Spacer(); Text("\((selected ?? 0)+1) / 8").font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
            ScrollView(.horizontal,showsIndicators:false) {
                LazyHStack(spacing:12) {
                    ForEach(BrandContent.reasons) { reason in
                        VStack(alignment:.leading,spacing:12) {
                            HStack { Text(reason.label.value(settings.language)).font(.caption).foregroundStyle(Color.white.opacity(0.65)); Spacer(); Image(systemName:reason.icon).font(.title2) }
                            Spacer(minLength:0)
                            Text(reason.title.value(settings.language)).font(.system(.title2,design:.rounded,weight:.bold)).fixedSize(horizontal:false,vertical:true)
                            Text(reason.detail.value(settings.language)).font(.subheadline).foregroundStyle(Color.white.opacity(0.75)).fixedSize(horizontal:false,vertical:true)
                            Spacer(minLength:0)
                            if reason.id == 7 { BrandCTA(title:BrandContent.compare.value(settings.language)) { showing = true } }
                            else { HStack { Text("iumrah").font(.headline); Spacer(); Text(String(format:"%02d / 08",reason.id+1)).font(.caption2).foregroundStyle(Color.white.opacity(0.5)) } }
                        }.padding(18).frame(width:284).frame(minHeight:290,alignment:.leading).modifier(BrandSurface()).id(reason.id)
                    }
                }.scrollTargetLayout()
            }.scrollTargetBehavior(.viewAligned).scrollPosition(id:$selected)
            HStack(spacing:5) { ForEach(0..<8) { i in Capsule().fill(Color.primary.opacity(selected == i ? 0.65 : 0.18)).frame(width:selected == i ? 20 : 5,height:5) } }.frame(maxWidth:.infinity).accessibilityHidden(true)
        }.sheet(isPresented:$showing,onDismiss:{ if performAfterDismiss { performAfterDismiss=false; onPrimary?() } }) {
            NavigationStack { WhyIumrahView(primaryTitle:primaryTitle,onPrimary:{ performAfterDismiss=true; showing=false }) }
        }
    }
}
struct WhyIumrahView: View {
    @EnvironmentObject private var settings: AppSettingsStore
    @Environment(\.dismiss) private var dismiss
    var primaryTitle: String? = nil
    var onPrimary: (() -> Void)? = nil
    private func t(_ r:String,_ e:String,_ u:String)->String { BrandText(r,e,u).value(settings.language) }
    private func photo(_ asset:String)->some View { Image(asset).resizable().scaledToFill().frame(height:210).frame(maxWidth:.infinity).clipped().clipShape(RoundedRectangle(cornerRadius:18)) }
    private func story(_ title:String,_ body:String,_ asset:String)->some View { VStack(alignment:.leading,spacing:12) { photo(asset); Text(title).font(.system(.title2,design:.rounded,weight:.bold)); Text(body).font(.body).foregroundStyle(.secondary) }.padding(16).frame(maxWidth:.infinity,alignment:.leading).background(Color.iumrahCardBackground,in:RoundedRectangle(cornerRadius:24)) }
    var body: some View {
        ScrollView { LazyVStack(alignment:.leading,spacing:20) {
            heroSection
            story(t("Это ваше путешествие.","This is your journey.","Bu sizning safaringiz."),t("Не нужно ждать, пока соберутся десятки других паломников. Ваше путешествие строится вокруг вас и вашей семьи.","No waiting for dozens of other pilgrims. Your journey is built around you and your family.","O‘nlab boshqa ziyoratchilarni kutish shart emas. Safar siz va oilangizga mos tashkil qilinadi."),"AboutIumrahPilgrims")
            story(t("Каждый ваш вопрос важен.","Every question matters.","Har bir savolingiz muhim."),t("В большой группе индивидуального внимания может не хватать всем. Ваш персональный гид помогает именно вашей семье.","In a large group, personal attention may be limited. Your private guide helps your family.","Katta guruhda har bir kishiga e’tibor yetmasligi mumkin. Shaxsiy gidingiz oilangizga yordam beradi."),"IumrahCareTeamHero")
            story(t("Не торопитесь.","Take your time.","Shoshilmang."),t("Совершайте поклонение в удобном для вас темпе, не потому, что нужно успеть за группой.","Worship at your own pace, without having to keep up with a group.","Guruhga yetib olish uchun emas, o‘zingizga qulay sur’atda ibodat qiling."),"AboutIumrahKaabaTouch")
            transportSection
            priceExample
            comparison
            supportSection
            IumrahMissionCard()
            IumrahSloganCard()
            Button(primaryTitle ?? t("Создать своё путешествие","Create your journey","O‘z safaringizni tuzing")) { if let onPrimary { onPrimary() } else { dismiss() } }.buttonStyle(IumrahPrimaryButtonStyle())
        }.padding(16) }.background(Color.iumrahPageBackground).navigationTitle(BrandContent.why.value(settings.language)).navigationBarTitleDisplayMode(.inline).toolbar { ToolbarItem(placement:.topBarTrailing) { Button { dismiss() } label:{ Image(systemName:"xmark") } } }
    }
    private var heroSection: some View {
        VStack(alignment:.leading,spacing:14) { photo("AboutIumrahKaabaCorner"); Text(t("Возможно, именно так вы всегда хотели совершить умру.","Perhaps this is how you always wanted to perform Umrah.","Balki umrani aynan shunday ado etishni istagandirsiz.")).font(.system(.largeTitle,design:.rounded,weight:.bold)); Text(t("Вместе со своими близкими. Без спешки. Без необходимости подстраиваться под других.","With your loved ones. Without rushing or adapting to others.","Yaqinlaringiz bilan. Shoshilmasdan. Boshqalarga moslashmasdan.")).foregroundStyle(Color.white.opacity(0.75)) }.padding(18).modifier(BrandSurface())
    }
    private var transportSection: some View {
        VStack(alignment:.leading,spacing:12) { Text(t("Ваш автомобиль. Ваш маршрут.","Your car. Your route.","Avtomobilingiz. Yo‘nalishingiz.")).font(.system(.title2,design:.rounded,weight:.bold)); Image("ConfiguratorTransferCarnival").resizable().scaledToFit().frame(height:145).frame(maxWidth:.infinity); ForEach([t("Встреча в аэропорту","Airport pickup","Aeroportda kutib olish"),t("Индивидуальные трансферы","Private transfers","Shaxsiy transferlar"),t("Переезды между городами","Intercity travel","Shaharlar orasida safar"),t("Поездки по программе зияратов","Ziyarat trips","Ziyorat dasturi bo‘yicha safarlar")],id:\.self){ Label($0,systemImage:"checkmark.circle") } }.padding(18).frame(maxWidth:.infinity,alignment:.leading).background(Color.iumrahCardBackground,in:RoundedRectangle(cornerRadius:24))
    }
    private var supportSection: some View {
        VStack(alignment:.leading,spacing:12) { Text(t("Вы не останетесь одни.","You are not alone.","Siz yolg‘iz qolmaysiz.")).font(.title2.bold()); Text("iumrah " + t("Поддержка","Support","Yordam")).foregroundStyle(.secondary); ForEach(Array([t("Создаёте путешествие","Create your journey","Safaringizni tuzasiz"),t("Проверяем наличие и стоимость","We check availability and price","Mavjudlik va narxni tekshiramiz"),t("Оформляем документы","Prepare documents","Hujjatlarni tayyorlaymiz"),t("Встречаем в Саудовской Аравии","Meet you in Saudi Arabia","Saudiya Arabistonida kutib olamiz"),t("Сопровождаем до возвращения домой","Support you until you return home","Uyga qaytguningizcha hamrohlik qilamiz")].enumerated()),id:\.offset) { item in HStack { Text("\(item.offset+1)").font(.headline.monospacedDigit()).frame(width:28,height:28).background(Color.secondary.opacity(0.12),in:Circle()); Text(item.element).font(.subheadline) } } }.padding(18).frame(maxWidth:.infinity,alignment:.leading).background(Color.iumrahCardBackground,in:RoundedRectangle(cornerRadius:24))
    }
    private var priceExample: some View {
        VStack(alignment:.leading,spacing:11) {
            Text(t("Никаких загадок в стоимости.","No mystery in pricing.","Narxda yashirin jumboqlar yo‘q.")).font(.title2.bold())
            ForEach(Array(zip([t("Авиабилеты","Flights","Aviachiptalar"),t("Проживание","Hotels","Mehmonxonalar"),t("Визы","Visas","Vizalar"),t("Трансфер","Transfer","Transfer"),t("Персональный гид","Private guide","Shaxsiy gid"),t("Зияраты","Ziyarats","Ziyoratlar"),t("Поддержка и комиссия · 9%","Support and fee · 9%","Yordam va komissiya · 9%"),t("Комиссия оплаты · 2%","Payment fee · 2%","To‘lov komissiyasi · 2%"),t("Округление","Rounding","Yaxlitlash")],["1 098 $","1 289.22 $","240 $","473.72 $","400 $","200 $","333.08 $","82.40 $","3.58 $"]).enumerated()),id:\.offset) { item in HStack { Text(item.element.0).font(.subheadline); Spacer(); Text(item.element.1).font(.subheadline.weight(.semibold)).monospacedDigit() } }
            Divider(); HStack { Text(t("Стоимость путешествия","Total journey price","Safar narxi")).font(.headline); Spacer(); Text("4 120 $").font(.title2.bold()) }
            Text(t("Пример пакета на двоих. Стоимость зависит от выбранных услуг.","Example for two travelers. Price depends on selected services.","Ikki kishilik paket misoli. Narx tanlangan xizmatlarga bog‘liq.")).font(.caption).foregroundStyle(.secondary)
        }.padding(18).background(Color.iumrahCardBackground,in:RoundedRectangle(cornerRadius:24))
    }
    private var comparison: some View {
        VStack(alignment:.leading,spacing:12) {
            Text(t("Почувствуйте разницу","Experience the difference","Farqni his qiling")).font(.title2.bold())
            HStack(alignment:.top,spacing:12) { VStack(alignment:.leading){ Image("AboutIumrahPilgrims").resizable().scaledToFill().frame(height:120).clipped().clipShape(RoundedRectangle(cornerRadius:12)); Text(t("Групповая умра","Group Umrah","Guruhli umra")).font(.headline) }; VStack(alignment:.leading){ Image("IumrahCareTeamHero").resizable().scaledToFill().frame(height:120).clipped().clipShape(RoundedRectangle(cornerRadius:12)); Text("iumrah").font(.headline) } }
            ForEach(Array(zip([t("Общее расписание","Shared schedule","Umumiy jadval"),t("Гид на группу","Group guide","Guruh gidi"),t("Общий транспорт","Shared transport","Umumiy transport"),t("Готовый маршрут","Fixed route","Tayyor yo‘nalish"),t("Цена всего тура","Tour price","Tur narxi"),t("Общий темп","Group pace","Umumiy sur’at")],[t("Ваше расписание","Your schedule","Jadvalingiz"),t("Персональный гид","Private guide","Shaxsiy gid"),t("Личный автомобиль","Private car","Shaxsiy avtomobil"),t("Ваш выбор","Your choice","Tanlovingiz"),t("Стоимость каждой услуги","Itemized pricing","Har bir xizmat narxi"),t("Ваш темп","Your pace","O‘z sur’atingiz")]).enumerated()),id:\.offset){ item in Divider(); HStack(alignment:.top){ Text(item.element.0).foregroundStyle(.secondary).frame(maxWidth:.infinity,alignment:.leading); Label(item.element.1,systemImage:"checkmark").fontWeight(.medium).frame(maxWidth:.infinity,alignment:.leading) }.font(.subheadline) }
            Text(t("Сравнение типичных форматов путешествия. Условия отдельных туроператоров могут отличаться. Фотографии иллюстративные.","Comparison of typical travel formats. Individual operators may differ. Images are illustrative.","Odatdagi safar formatlari taqqoslandi. Ayrim turoperatorlar shartlari farq qilishi mumkin. Rasmlar namuna sifatida berilgan.")).font(.caption).foregroundStyle(.secondary)
        }.padding(18).background(Color.iumrahCardBackground,in:RoundedRectangle(cornerRadius:24))
    }
}
