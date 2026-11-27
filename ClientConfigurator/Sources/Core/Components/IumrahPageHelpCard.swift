import SwiftUI

/// Reviewed page guidance. Every entry has explicit RU / EN / UZ / UZ-Cyrillic copy.
enum IumrahPageHelp {
    struct Copy { let title: String; let body: String }
    static func text(_ key: String, language: AppSettingsStore.Language) -> Copy? {
        let index: Int
        switch language {
        case .russian: index = 0
        case .uzbek: index = 2
        case .uzbekCyrillic: index = 3
        default: index = 1
        }
        return entries[key]?[index]
    }
    static let entries: [String: [Copy]] = [
        "home.default": [.init(title: "Начните с маршрута", body: "Раскройте поиск: укажите аэропорт вылета, маршрут, даты и пассажиров. Нажмите «Найти авиабилеты», чтобы перейти к выбору перелётов."), .init(title: "Start with your route", body: "Expand search and choose your departure airport, route, dates and travelers. Tap “Find flights” to choose your flights."), .init(title: "Safar yo‘nalishidan boshlang", body: "Qidiruvni ochib, jo‘nash aeroporti, yo‘nalish, sanalar va yo‘lovchilarni belgilang. Parvozlarni tanlash uchun «Reyslarni topish» tugmasini bosing."), .init(title: "Сафар ёъналишидан бошланг", body: "Қидирувни очиб, жўнаш аеропорти, ёъналиш, саналар ва ёъловчиларни белгиланг. Парвозларни танлаш учун «Рейсларни топиш» тугмасини босинг.")],
        "home.search_invalid": [.init(title: "Проверьте параметры поездки", body: "Проверьте аэропорт вылета, даты и количество пассажиров. После заполнения поиска можно перейти к выбору рейсов."), .init(title: "Check your trip details", body: "Check your departure airport, dates and traveler count. Complete the search details to continue to flights."), .init(title: "Safar ma’lumotlarini tekshiring", body: "Jo‘nash aeroporti, sanalar va yo‘lovchilar sonini tekshiring. Reyslarga o‘tish uchun qidiruv ma’lumotlarini to‘ldiring."), .init(title: "Сафар маълумотларини текширинг", body: "Жўнаш аеропорти, саналар ва ёъловчилар сонини текширинг. Рейсларга ўтиш учун қидирув маълумотларини тўлдиринг.")],
        "discovery.hotels": [.init(title: "Подберите отель на свои даты", body: "Выберите Мекку или Медину. В поиске укажите заезд, число ночей, номера и гостей, затем нажмите «Найти отели». Откройте понравившийся отель, чтобы посмотреть номера и условия."), .init(title: "Find a hotel for your dates", body: "Choose Makkah or Madinah. Enter check-in, nights, rooms and guests, then search for hotels. Open a hotel to see rooms and conditions."), .init(title: "Sanalaringizga mos mehmonxona toping", body: "Makka yoki Madinani tanlang. Kirish sanasi, tunlar, xonalar va mehmonlar sonini kiritib, mehmonxonalarni qidiring. Xonalar va shartlarni ko‘rish uchun mehmonxonani oching."), .init(title: "Саналарингизга мос меҳмонхона топинг", body: "Макка ёки Мадинани танланг. Кириш санаси, тунлар, хоналар ва меҳмонлар сонини киритиб, меҳмонхоналарни қидиринг. Хоналар ва шартларни кўриш учун меҳмонхонани очинг.")],
        "discovery.hotel_name_empty": [.init(title: "Попробуйте другое название", body: "Сократите название отеля или уберите его из поиска. Проверьте выбранный город и фильтр звёзд."), .init(title: "Try another hotel name", body: "Shorten the hotel name or clear it from search. Check the selected city and star filter."), .init(title: "Boshqa nom bilan qidiring", body: "Mehmonxona nomini qisqartiring yoki qidiruvdan o‘chiring. Tanlangan shahar va yulduzlar filtrini tekshiring."), .init(title: "Бошқа ном билан қидиринг", body: "Меҳмонхона номини қисқартиринг ёки қидирувдан ўчиринг. Танланган шаҳар ва юлдузлар филтрини текширинг.")],
        "discovery.family": [.init(title: "Проверьте размещение семьи", body: "Укажите число номеров, взрослых и возраст каждого ребёнка. Откройте подходящий отель и проверьте условия размещения для вашей семьи."), .init(title: "Check your family’s accommodation", body: "Enter the rooms, adults and each child’s age. Open a suitable hotel and check accommodation conditions for your family."), .init(title: "Oilangiz uchun joylashuvni tekshiring", body: "Xonalar, kattalar soni va har bir bolaning yoshini kiriting. Mos mehmonxonani ochib, oilangiz uchun joylashuv shartlarini tekshiring."), .init(title: "Оилангиз учун жойлашувни текширинг", body: "Хоналар, катталар сони ва ҳар бир боланинг ёшини киритинг. Мос меҳмонхонани очиб, оилангиз учун жойлашув шартларини текширинг.")],
        "discovery.flights": [.init(title: "Выберите направление перелёта", body: "Переключайте рейсы туда и обратно. Для поиска на свои даты раскройте поиск, укажите аэропорты, пассажиров и класс перелёта, затем нажмите «Найти авиабилеты»."), .init(title: "Choose your flight direction", body: "Switch between outbound and return flights. For your own dates, expand search, choose airports, travelers and cabin class, then search for flights."), .init(title: "Parvoz yo‘nalishini tanlang", body: "Borish va qaytish reyslari orasida almashing. O‘z sanalaringiz uchun qidiruvni ochib, aeroportlar, yo‘lovchilar va parvoz klassini belgilang, so‘ng reyslarni qidiring."), .init(title: "Парвоз ёъналишини танланг", body: "Бориш ва қайтиш рейслари орасида алмашинг. Ўз саналарингиз учун қидирувни очиб, аеропортлар, ёъловчилар ва парвоз классини белгиланг, сўнг рейсларни қидиринг.")],
        "discovery.flights_empty": [.init(title: "Попробуйте поиск на свои даты", body: "В этом направлении пока нет рейсов в каталоге. Укажите даты и аэропорты в поиске, чтобы проверить варианты для своей поездки."), .init(title: "Search for your dates", body: "There are no catalog flights for this direction yet. Enter dates and airports in search to check options for your trip."), .init(title: "O‘z sanalaringiz bo‘yicha qidiring", body: "Katalogda bu yo‘nalish bo‘yicha reyslar hozircha yo‘q. Safaringiz uchun variantlarni tekshirish maqsadida sanalar va aeroportlarni kiriting."), .init(title: "Ўз саналарингиз бўйича қидиринг", body: "Каталогда бу ёъналиш бўйича рейслар ҳозирча ёъқ. Сафарингиз учун вариантларни текшириш мақсадида саналар ва аеропортларни киритинг.")],
        "discovery.weekends": [.init(title: "Подберите короткую поездку", body: "Укажите аэропорт вылета, дату начала, от двух до четырёх ночей и пассажиров. Нажмите «Найти авиабилеты», чтобы выбрать перелёты для поездки."), .init(title: "Plan a short trip", body: "Choose your departure airport, start date, two to four nights and travelers. Search for flights to select your journey."), .init(title: "Qisqa safarni rejalashtiring", body: "Jo‘nash aeroporti, boshlanish sanasi, ikki-to‘rt tun va yo‘lovchilarni belgilang. Safar parvozlarini tanlash uchun reyslarni qidiring."), .init(title: "Қисқа сафарни режалаштиринг", body: "Жўнаш аеропорти, бошланиш санаси, икки-тўрт тун ва ёъловчиларни белгиланг. Сафар парвозларини танлаш учун рейсларни қидиринг.")],
        "bookings.empty": [.init(title: "Начните новую поездку", body: "Выберите готовый вариант, откройте конфигуратор или обратитесь в iumrah Care. Здесь вы сможете следить за поездкой после создания бронирования."), .init(title: "Start a new trip", body: "Choose a ready-made option, open the configurator or send a request to iumrah Care. You can track your trip here once a booking is created."), .init(title: "Yangi safarni boshlang", body: "Tayyor variantni tanlang, konfiguratorni oching yoki iumrah Care xizmatiga murojaat qiling. Bron yaratilgach, safaringizni shu yerda kuzatishingiz mumkin."), .init(title: "Янги сафарни бошланг", body: "Тайёр вариантни танланг, конфигураторни очинг ёки iumrah Care хизматига мурожаат қилинг. Брон яратилгач, сафарингизни шу йерда кузатишингиз мумкин.")],
        "bookings.active": [.init(title: "Посмотрите следующий этап", body: "Здесь показаны этапы вашего бронирования. Посмотрите текущий этап и откройте доступное действие, если от вас нужны данные или подтверждение."), .init(title: "Check the next stage", body: "This page shows your booking stages. Check the current stage and open an available action if details or confirmation are needed from you."), .init(title: "Keyingi bosqichni ko‘ring", body: "Bu sahifada bron bosqichlari ko‘rsatilgan. Joriy bosqichni tekshiring va sizdan ma’lumot yoki tasdiq kerak bo‘lsa, mavjud amalni oching."), .init(title: "Кейинги босқични кўринг", body: "Бу саҳифада брон босқичлари кўрсатилган. Жорий босқични текширинг ва сиздан маълумот ёки тасдиқ керак бўлса, мавжуд амални очинг.")],
        "bookings.status": [.init(title: "Проверьте готовность поездки", body: "Посмотрите статус оформления, доступные документы и детали поездки. Если нужно изменить бронирование, воспользуйтесь доступными действиями на этой странице."), .init(title: "Check your trip’s progress", body: "Check the booking status, available documents and trip details. Use the available actions on this page if your booking needs changes."), .init(title: "Safar tayyorgarligini tekshiring", body: "Bron holati, mavjud hujjatlar va safar tafsilotlarini ko‘ring. Bronni o‘zgartirish kerak bo‘lsa, sahifadagi mavjud amallardan foydalaning."), .init(title: "Сафар тайёргарлигини текширинг", body: "Брон ҳолати, мавжуд ҳужжатлар ва сафар тафсилотларини кўринг. Бронни ўзгартириш керак бўлса, саҳифадаги мавжуд амаллардан фойдаланинг.")],
        "bookings.schedule": [.init(title: "Посмотрите план по дням", body: "Откройте нужный день в календаре поездки и посмотрите его события. Так вы сможете сверить план на выбранную дату."), .init(title: "View your daily itinerary", body: "Select a day in the trip calendar to see its events and check the plan for that date."), .init(title: "Kunlik rejangizni ko‘ring", body: "Safar taqvimida kerakli kunni tanlab, uning tadbirlari va rejasini ko‘ring."), .init(title: "Кунлик режангизни кўринг", body: "Сафар тақвимида керакли кунни танлаб, унинг тадбирлари ва режасини кўринг.")],
        "support.no_booking": [.init(title: "Задайте вопрос до бронирования", body: "Позвоните нам или напишите в Telegram. Личный чат внутри приложения станет доступен, когда появится активное бронирование."), .init(title: "Ask before booking", body: "Call us or write on Telegram. Personal in-app chat becomes available when you have an active booking."), .init(title: "Bron qilishdan oldin savol bering", body: "Bizga qo‘ng‘iroq qiling yoki Telegram orqali yozing. Ilovadagi shaxsiy chat faol bron paydo bo‘lganda ochiladi."), .init(title: "Брон қилишдан олдин савол беринг", body: "Бизга қўнғироқ қилинг ёки Telegram орқали ёзинг. Иловадаги шахсий чат фаол брон пайдо бўлганда очилади.")],
        "support.active": [.init(title: "Обратитесь по своей поездке", body: "Откройте чат, чтобы обсудить активное бронирование. Также можно позвонить или написать в Telegram."), .init(title: "Get help with your trip", body: "Open chat to discuss your active booking. You can also call us or write on Telegram."), .init(title: "Safaringiz bo‘yicha yordam oling", body: "Faol broningizni muhokama qilish uchun chatni oching. Shuningdek, qo‘ng‘iroq qilishingiz yoki Telegram orqali yozishingiz mumkin."), .init(title: "Сафарингиз бўйича ёрдам олинг", body: "Фаол бронингизни муҳокама қилиш учун чатни очинг. Шунингдек, қўнғироқ қилишингиз ёки Telegram орқали ёзишингиз мумкин.")],
        "account.guest": [.init(title: "Ваши поездки в одном месте", body: "Профиль появится после первого бронирования. Если поездка уже оформлена, найдите её по подтверждённой почте или номеру телефона."), .init(title: "Your trips in one place", body: "Your profile appears after your first booking. To restore an existing trip, use the verified email or phone from your booking."), .init(title: "Safarlaringiz bir joyda", body: "Profil birinchi brondan keyin paydo bo‘ladi. Mavjud safarni tasdiqlangan email yoki telefon orqali toping."), .init(title: "Сафарларингиз бир жойда", body: "Профиль биринчи брондан кейин пайдо бўлади. Мавжуд сафарни тасдиқланган email ёки телефон орқали топинг.")],
        "account.signed_in": [.init(title: "Проверьте данные путешественников", body: "Откройте свои данные и данные попутчиков. Здесь также доступны ваш iumrah ID, поездки и настройки приложения."), .init(title: "Check traveler details", body: "Open your personal details and travel companions. Your iumrah ID, trips and app settings are also available here."), .init(title: "Yo‘lovchilar ma’lumotlarini tekshiring", body: "Shaxsiy ma’lumotlaringiz va hamrohlaringizni oching. Bu yerda iumrah ID, safarlar va ilova sozlamalari ham mavjud."), .init(title: "Ёъловчилар маълумотларини текширинг", body: "Шахсий маълумотларингиз ва ҳамроҳларингизни очинг. Бу йерда iumrah ID, сафарлар ва илова созламалари ҳам мавжуд.")],
        "account.sms": [.init(title: "Введите код из SMS", body: "Проверьте указанный номер, введите код из SMS и нажмите «Подтвердить и войти»."), .init(title: "Enter the SMS code", body: "Check the phone number, enter your SMS code and tap “Confirm and sign in”."), .init(title: "SMS kodni kiriting", body: "Telefon raqamini tekshiring, SMS kodni kiriting va «Tasdiqlab kirish» tugmasini bosing."), .init(title: "SMS кодни киритинг", body: "Телефон рақамини текширинг, SMS кодни киритинг ва «Тасдиқлаб кириш» тугмасини босинг.")],
        "calendar.departure": [.init(title: "Выберите дату вылета", body: "Выберите любую будущую дату. Зелёным отмечены даты с прямыми рейсами. Затем выберите возвращение."), .init(title: "Choose your departure date", body: "Choose any future date. Green dates have non-stop flights. Then choose your return date."), .init(title: "Jo‘nash sanasini tanlang", body: "Istalgan kelgusi sanani tanlang. Yashil sanalarda to‘g‘ridan-to‘g‘ri reyslar bor. Keyin qaytish sanasini tanlang."), .init(title: "Жўнаш санасини танланг", body: "Исталган келгуси санани танланг. Яшил саналарда тўғридан-тўғри рейслар бор. Кейин қайтиш санасини танланг.")],
        "calendar.return": [.init(title: "Выберите дату возвращения", body: "Выберите дату позже вылета. Зелёные даты подсказывают прямые рейсы; остальные будущие даты тоже доступны. Проверьте обе даты и продолжайте."), .init(title: "Choose your return date", body: "Choose a date after departure. Green dates indicate non-stop flights; other future dates are selectable too. Check both dates and continue."), .init(title: "Qaytish sanasini tanlang", body: "Jo‘nashdan keyingi sanani tanlang. Yashil sanalar to‘g‘ridan-to‘g‘ri reyslarni bildiradi; boshqa kelgusi sanalarni ham tanlash mumkin. Sanalarni tekshirib, davom eting."), .init(title: "Қайтиш санасини танланг", body: "Жўнашдан кейинги санани танланг. Яшил саналар тўғридан-тўғри рейсларни билдиради; бошқа келгуси саналарни ҳам танлаш мумкин. Саналарни текшириб, давом этинг.")],
        "home.passengers": [.init(title: "Укажите всех пассажиров", body: "Укажите взрослых, детей и младенцев, которые поедут с вами. Выберите класс перелёта и примените изменения."), .init(title: "Include every traveler", body: "Enter the adults, children and infants traveling with you. Choose a cabin class and apply your changes."), .init(title: "Barcha yo‘lovchilarni kiriting", body: "Siz bilan boradigan kattalar, bolalar va chaqaloqlar sonini kiriting. Parvoz klassini tanlab, o‘zgarishlarni tasdiqlang."), .init(title: "Барча ёъловчиларни киритинг", body: "Сиз билан борадиган катталар, болалар ва чақалоқлар сонини киритинг. Парвоз классини танлаб, ўзгаришларни тасдиқланг.")],
        "flights.outbound": [.init(title: "Выберите перелёт в Саудовскую Аравию", body: "Откройте подходящий рейс и проверьте время, аэропорты и пересадки. Выберите его, затем переходите к обратному перелёту."), .init(title: "Choose your flight to Saudi Arabia", body: "Open a flight and check its times, airports and stops. Select it, then continue to the return flight."), .init(title: "Saudiya Arabistoniga reysni tanlang", body: "Reysni ochib, vaqtlar, aeroportlar va almashib o‘tishlarni tekshiring. Uni tanlab, qaytish reysiga o‘ting."), .init(title: "Саудия Арабистонига рейсни танланг", body: "Рейсни очиб, вақтлар, аеропортлар ва алмашиб ўтишларни текширинг. Уни танлаб, қайтиш рейсига ўтинг.")],
        "flights.inbound": [.init(title: "Выберите возвращение домой", body: "Откройте подходящий обратный рейс и проверьте дату и аэропорт вылета. После выбора обоих перелётов нажмите «Выбрать отель»."), .init(title: "Choose your flight home", body: "Open a return flight and check its date and departure airport. Once both flights are selected, tap “Choose hotel”."), .init(title: "Uyga qaytish reysini tanlang", body: "Qaytish reysini ochib, sana va jo‘nash aeroportini tekshiring. Ikkala reys tanlangach, «Mehmonxona tanlash» tugmasini bosing."), .init(title: "Уйга қайтиш рейсини танланг", body: "Қайтиш рейсини очиб, сана ва жўнаш аеропортини текширинг. Иккала рейс танлангач, «Меҳмонхона танлаш» тугмасини босинг.")],
        "flights.inbound_empty": [.init(title: "Измените перелёт или даты", body: "Для выбранного рейса туда не найдено совместимого возвращения. Нажмите «Изменить рейс туда» или измените даты в поиске."), .init(title: "Change flights or dates", body: "No compatible return flight was found. Tap “Change outbound” or change the search dates."), .init(title: "Reys yoki sanalarni o‘zgartiring", body: "Mos qaytish reysi topilmadi. «Borish reysini o‘zgartirish» tugmasini bosing yoki qidiruv sanalarini o‘zgartiring."), .init(title: "Рейс ёки саналарни ўзгартиринг", body: "Мос қайтиш рейси топилмади. «Бориш рейсини ўзгартириш» тугмасини босинг ёки қидирув саналарини ўзгартиринг.")],
        "flights.empty": [.init(title: "Попробуйте другие параметры", body: "На выбранные параметры подходящих рейсов пока нет. Измените даты или класс перелёта в поиске."), .init(title: "Try different search details", body: "No flights match your search yet. Try other dates or a different cabin class."), .init(title: "Boshqa parametrlarni sinang", body: "Qidiruvingizga mos reyslar hozircha yo‘q. Boshqa sanalar yoki parvoz klassini sinab ko‘ring."), .init(title: "Бошқа параметрларни синанг", body: "Қидирувингизга мос рейслар ҳозирча ёъқ. Бошқа саналар ёки парвоз классини синаб кўринг.")],
        "flights.error": [.init(title: "Повторите загрузку рейсов", body: "Рейсы не удалось загрузить. Нажмите «Повторить», чтобы попробовать ещё раз."), .init(title: "Load flights again", body: "Flights could not be loaded. Tap “Retry” to try again."), .init(title: "Reyslarni qayta yuklang", body: "Reyslarni yuklab bo‘lmadi. Yana urinish uchun «Qayta urinish» tugmasini bosing."), .init(title: "Рейсларни қайта юкланг", body: "Рейсларни юклаб бўлмади. Яна уриниш учун «Қайта уриниш» тугмасини босинг.")],
        "flights.loading": [.init(title: "Дождитесь вариантов перелёта", body: "Поиск ещё выполняется. Когда появятся рейсы, откройте подходящий вариант и проверьте его условия."), .init(title: "Wait for flight options", body: "The search is still running. When flights appear, open a suitable option and check its conditions."), .init(title: "Reys variantlarini kuting", body: "Qidiruv hali davom etmoqda. Reyslar paydo bo‘lgach, mos variantni ochib, shartlarini tekshiring."), .init(title: "Рейс вариантларини кутинг", body: "Қидирув ҳали давом этмоқда. Рейслар пайдо бўлгач, мос вариантни очиб, шартларини текширинг.")],
        "flights.details": [.init(title: "Проверьте рейс перед выбором", body: "Проверьте аэропорты, даты, время вылета и пересадки. Если рейс подходит, выберите его для поездки."), .init(title: "Check the flight before choosing", body: "Check airports, dates, departure times and stops. If the flight suits you, select it for your trip."), .init(title: "Tanlashdan oldin reysni tekshiring", body: "Aeroportlar, sanalar, jo‘nash vaqti va almashib o‘tishlarni tekshiring. Reys mos bo‘lsa, safaringiz uchun tanlang."), .init(title: "Танлашдан олдин рейсни текширинг", body: "Аеропортлар, саналар, жўнаш вақти ва алмашиб ўтишларни текширинг. Рейс мос бўлса, сафарингиз учун танланг.")],
        "hotels.makkah": [.init(title: "Выберите проживание в Мекке", body: "Откройте отель, сравните номера, питание и условия отмены. Добавьте подходящий номер в план умры."), .init(title: "Choose your stay in Makkah", body: "Open a hotel and compare rooms, meals and cancellation conditions. Add a suitable room to your Umrah plan."), .init(title: "Makkada turar joy tanlang", body: "Mehmonxonani ochib, xonalar, ovqatlanish va bekor qilish shartlarini solishtiring. Mos xonani Umra rejangizga qo‘shing."), .init(title: "Маккада турар жой танланг", body: "Меҳмонхонани очиб, хоналар, овқатланиш ва бекор қилиш шартларини солиштиринг. Мос хонани Умра режангизга қўшинг.")],
        "hotels.madinah": [.init(title: "Выберите проживание в Медине", body: "Проверьте даты проживания в Медине. Откройте отель и добавьте подходящий номер в план умры."), .init(title: "Choose your stay in Madinah", body: "Check your stay dates in Madinah. Open a hotel and add a suitable room to your Umrah plan."), .init(title: "Madinada turar joy tanlang", body: "Madinada qolish sanalarini tekshiring. Mehmonxonani ochib, mos xonani Umra rejangizga qo‘shing."), .init(title: "Мадинада турар жой танланг", body: "Мадинада қолиш саналарини текширинг. Меҳмонхонани очиб, мос хонани Умра режангизга қўшинг.")],
        "hotels.child_ages": [.init(title: "Укажите возраст детей", body: "Раскройте карточку «Отели и номера» сверху и укажите возраст каждого ребёнка. Эти данные нужны для подбора размещения."), .init(title: "Enter the children’s ages", body: "Expand the hotel summary above and enter each child’s age. These details are needed to find suitable accommodation."), .init(title: "Bolalarning yoshini kiriting", body: "Yuqoridagi mehmonxonalar kartasini ochib, har bir bolaning yoshini kiriting. Bu ma’lumotlar mos joylashuvni topish uchun kerak."), .init(title: "Болаларнинг ёшини киритинг", body: "Юқоридаги меҳмонхоналар картасини очиб, ҳар бир боланинг ёшини киритинг. Бу маълумотлар мос жойлашувни топиш учун керак.")],
        "hotels.multiple_rooms": [.init(title: "Выберите каждый номер", body: "Переключайте «Номер 1», «Номер 2» и остальные номера. Для каждого добавьте подходящий вариант; если в маршруте есть Медина, заполните размещение и там."), .init(title: "Choose every room", body: "Switch between Room 1, Room 2 and the other rooms, adding an option for each. If your route includes Madinah, complete accommodation there too."), .init(title: "Har bir xonani tanlang", body: "1-xona, 2-xona va boshqa xonalar orasida almashib, har biri uchun variant qo‘shing. Yo‘nalishda Madina bo‘lsa, u yerdagi joylashuvni ham to‘ldiring."), .init(title: "Ҳар бир хонани танланг", body: "1-хона, 2-хона ва бошқа хоналар орасида алмашиб, ҳар бири учун вариант қўшинг. Ёъналишда Мадина бўлса, у йердаги жойлашувни ҳам тўлдиринг.")],
        "hotels.complete": [.init(title: "Переходите к трансферу", body: "Проверьте выбранные отели, номера и даты проживания. Нажмите «Выбрать трансфер», чтобы продолжить."), .init(title: "Continue to transfers", body: "Check your hotels, rooms and stay dates. Tap “Choose transfer” to continue."), .init(title: "Transferga o‘ting", body: "Mehmonxonalar, xonalar va yashash sanalarini tekshiring. Davom etish uchun «Transferni tanlash» tugmasini bosing."), .init(title: "Трансферга ўтинг", body: "Меҳмонхоналар, хоналар ва яшаш саналарини текширинг. Давом этиш учун «Трансферни танлаш» тугмасини босинг.")],
        "hotel.details": [.init(title: "Сравните номера и условия", body: "Посмотрите фотографии, удобства и доступные номера. Перед добавлением проверьте питание, условия отмены и сумму за весь срок проживания."), .init(title: "Compare rooms and conditions", body: "View photos, amenities and rooms. Before adding a room, check meals, cancellation conditions and the price for the entire stay."), .init(title: "Xonalar va shartlarni solishtiring", body: "Rasmlar, qulayliklar va xonalarni ko‘ring. Xonani qo‘shishdan oldin ovqatlanish, bekor qilish shartlari va butun muddat narxini tekshiring."), .init(title: "Хоналар ва шартларни солиштиринг", body: "Расмлар, қулайликлар ва хоналарни кўринг. Хонани қўшишдан олдин овқатланиш, бекор қилиш шартлари ва бутун муддат нархини текширинг.")],
        "hotel.rate_details": [.init(title: "Проверьте условия номера", body: "Посмотрите условия отмены и возможные сборы, которые оплачиваются в отеле. Если вариант подходит, добавьте его в план умры."), .init(title: "Check the room conditions", body: "Review cancellation conditions and any fees payable at the hotel. If this option suits you, add it to your Umrah plan."), .init(title: "Xona shartlarini tekshiring", body: "Bekor qilish shartlari va mehmonxonada to‘lanadigan qo‘shimcha yig‘imlarni ko‘ring. Variant mos bo‘lsa, Umra rejangizga qo‘shing."), .init(title: "Хона шартларини текширинг", body: "Бекор қилиш шартлари ва меҳмонхонада тўланадиган қўшимча йиғимларни кўринг. Вариант мос бўлса, Умра режангизга қўшинг.")],
        "hotel.loading": [.init(title: "Дождитесь стоимости номеров", body: "Цены на выбранные даты ещё загружаются. Пока можно посмотреть фотографии и описание отеля."), .init(title: "Wait for room prices", body: "Prices for your dates are still loading. You can view the hotel’s photos and description while you wait."), .init(title: "Xona narxlarini kuting", body: "Tanlangan sanalar uchun narxlar hali yuklanmoqda. Kutish vaqtida mehmonxona rasmlari va tavsifini ko‘rishingiz mumkin."), .init(title: "Хона нархларини кутинг", body: "Танланган саналар учун нархлар ҳали юкланмоқда. Кутиш вақтида меҳмонхона расмлари ва тавсифини кўришингиз мумкин.")],
        "hotel.no_rates": [.init(title: "Проверьте другие даты", body: "API не вернул тарифы на выбранные даты. Измените даты проживания и дождитесь нового ответа."), .init(title: "Check other dates", body: "The API returned no rates for these dates. Change your stay dates and wait for the new results."), .init(title: "Boshqa sanalarni tekshiring", body: "API tanlangan sanalar uchun tariflarni qaytarmadi. Yashash sanalarini o‘zgartirib, yangi natijani kuting."), .init(title: "Бошқа саналарни текширинг", body: "API танланган саналар учун тарифларни қайтармади. Яшаш саналарини ўзгартириб, янги натижани кутинг.")],
        "hotel.rates_error": [.init(title: "Повторите загрузку цен", body: "Запрос цен завершился ошибкой. Нажмите «Повторить», чтобы снова запросить тарифы API."), .init(title: "Load prices again", body: "The price request failed. Tap “Retry” to request rates from the API again."), .init(title: "Narxlarni qayta yuklang", body: "Narx so‘rovi xato bilan tugadi. API tariflarini yana olish uchun «Qayta urinish» tugmasini bosing."), .init(title: "Нархларни қайта юкланг", body: "Нарх сўрови хато билан тугади. API тарифларини яна олиш учун «Қайта уриниш» тугмасини босинг.")],
        "hotel.saved": [.init(title: "Номер добавлен в план", body: "Вы сохранили выбранный вариант проживания. Это ещё не подтверждённое бронирование."), .init(title: "Room added to your plan", body: "You have saved your chosen accommodation. This is not yet a confirmed booking."), .init(title: "Xona rejangizga qo‘shildi", body: "Tanlagan turar joyingiz saqlandi. Bu hali tasdiqlangan bron emas."), .init(title: "Хона режангизга қўшилди", body: "Танлаган турар жойингиз сақланди. Бу ҳали тасдиқланган брон эмас.")],
        "transfer.default": [.init(title: "Выберите автомобиль для поездки", body: "Листайте автомобили и сравните места для пассажиров, багаж и изменение суммы. Раскройте верхнюю карточку, чтобы проверить маршрут трансфера."), .init(title: "Choose a car for your trip", body: "Swipe between cars and compare passenger space, luggage and price changes. Expand the summary above to check your transfer route."), .init(title: "Safar uchun avtomobil tanlang", body: "Avtomobillarni surib ko‘rib, yo‘lovchi joylari, bagaj va narx o‘zgarishini solishtiring. Transfer yo‘nalishini tekshirish uchun yuqoridagi kartani oching."), .init(title: "Сафар учун автомобил танланг", body: "Автомобилларни суриб кўриб, ёъловчи жойлари, багаж ва нарх ўзгаришини солиштиринг. Трансфер ёъналишини текшириш учун юқоридаги картани очинг.")],
        "transfer.train": [.init(title: "Выберите переезд между городами", body: "При желании добавьте поезд между Меккой и Мединой и проверьте число билетов. Автомобильные поездки до станции и после прибытия остаются частью трансфера."), .init(title: "Choose travel between cities", body: "You can add a train between Makkah and Madinah. Check ticket counts; car transfers to and from the stations remain included in your transfer route."), .init(title: "Shaharlararo safarni tanlang", body: "Makka va Madina orasidagi poyezdni qo‘shishingiz mumkin. Chiptalar sonini tekshiring; vokzalgacha va undan keyingi avtomobil qatnovlari transfer yo‘nalishida qoladi."), .init(title: "Шаҳарлараро сафарни танланг", body: "Макка ва Мадина орасидаги пойездни қўшишингиз мумкин. Чипталар сонини текширинг; вокзалгача ва ундан кейинги автомобил қатновлари трансфер ёъналишида қолади.")],
        "transfer.review": [.init(title: "Проверьте выбранные услуги", body: "Проверьте выбранный трансфер и поезд, если он добавлен. Чтобы скорректировать выбор, нажмите «Изменить услуги»."), .init(title: "Review your selected services", body: "Check your transfer and any added train tickets. Tap “Edit services” to change your selection."), .init(title: "Tanlangan xizmatlarni tekshiring", body: "Transfer va qo‘shilgan poyezd chiptalarini tekshiring. Tanlovni o‘zgartirish uchun «Xizmatlarni o‘zgartirish» tugmasini bosing."), .init(title: "Танланган хизматларни текширинг", body: "Трансфер ва қўшилган пойезд чипталарини текширинг. Танловни ўзгартириш учун «Хизматларни ўзгартириш» тугмасини босинг.")],
        "review.local": [.init(title: "Проверьте пакет перед бронированием", body: "Сверьте состав поездки и сумму за всех путешественников. Нажмите «Забронировать поездку», чтобы перейти к следующему этапу оформления."), .init(title: "Review your package before booking", body: "Check the trip details and total for all travelers. Tap “Book this trip” to continue with booking."), .init(title: "Bron qilishdan oldin paketni tekshiring", body: "Safar tarkibi va barcha yo‘lovchilar uchun jami narxni tekshiring. Davom etish uchun «Safarni bron qilish» tugmasini bosing."), .init(title: "Брон қилишдан олдин пакетни текширинг", body: "Сафар таркиби ва барча ёъловчилар учун жами нархни текширинг. Давом этиш учун «Сафарни брон қилиш» тугмасини босинг.")],
        "review.unpriced_flight": [.init(title: "Проверьте пакет перед бронированием", body: "Сверьте состав поездки и сумму за всех путешественников. Нажмите «Забронировать поездку», чтобы перейти к следующему этапу оформления."), .init(title: "Review your package before booking", body: "Check the trip details and total for all travelers. Tap “Book this trip” to continue with booking."), .init(title: "Bron qilishdan oldin paketni tekshiring", body: "Safar tarkibi va barcha yo‘lovchilar uchun jami narxni tekshiring. Davom etish uchun «Safarni bron qilish» tugmasini bosing."), .init(title: "Брон қилишдан олдин пакетни текширинг", body: "Сафар таркиби ва барча ёъловчилар учун жами нархни текширинг. Давом этиш учун «Сафарни брон қилиш» тугмасини босинг.")],
        "request.contact": [.init(title: "Оставьте контакт для ответа", body: "Укажите имя, фамилию и телефон для связи. Затем передайте данные для проверки выбранной поездки."), .init(title: "Leave your contact details", body: "Enter your first name, last name and phone number. Then send a request to check your chosen trip."), .init(title: "Aloqa ma’lumotlarini qoldiring", body: "Ism, familiya va telefon raqamingizni kiriting. Keyin tanlangan safarni tekshirish uchun ma’lumot yuboring."), .init(title: "Алоқа маълумотларини қолдиринг", body: "Исм, фамилия ва телефон рақамингизни киритинг. Кейин танланган сафарни текшириш учун маълумот юборинг.")],
        "request.sending": [.init(title: "Данные отправляются", body: "Дождитесь результата отправки. Подтверждение появится на этой странице."), .init(title: "Sending your request", body: "Wait for the result. Confirmation will appear on this page."), .init(title: "Ma’lumotlar yuborilmoqda", body: "Natijani kuting. Tasdiq shu sahifada paydo bo‘ladi."), .init(title: "Маълумотлар юборилмоқда", body: "Натижани кутинг. Тасдиқ шу саҳифада пайдо бўлади.")],
        "request.sent": [.init(title: "Данные получены", body: "Сохраните номер обращения. С вами свяжутся после проверки наличия; сейчас оплата не требуется."), .init(title: "Request received", body: "Keep your request number. You will be contacted after availability is checked; payment is not required now."), .init(title: "Ma’lumotlar qabul qilindi", body: "Murojaat raqamini saqlang. Mavjudlik tekshirilgach, siz bilan bog‘lanishadi; hozir to‘lov talab qilinmaydi."), .init(title: "Маълумотлар қабул қилинди", body: "Мурожаат рақамини сақланг. Мавжудлик текширилгач, сиз билан боғланишади; ҳозир тўлов талаб қилинмайди.")],
        "request.error": [.init(title: "Проверьте результат отправки", body: "Данные не удалось отправить. Проверьте сообщение об ошибке и попробуйте снова; если сомневаетесь, обратитесь в поддержку."), .init(title: "Check the submission result", body: "The request could not be sent. Check the error message and try again; contact support if you are unsure."), .init(title: "Yuborish natijasini tekshiring", body: "Ma’lumotlarni yuborib bo‘lmadi. Xato xabarini tekshirib, yana urinib ko‘ring; shubha bo‘lsa, yordam xizmatiga murojaat qiling."), .init(title: "Юбориш натижасини текширинг", body: "Маълумотларни юбориб бўлмади. Хато хабарини текшириб, яна уриниб кўринг; шубҳа бўлса, ёрдам хизматига мурожаат қилинг.")],
        "legacy.trip": [.init(title: "Задайте параметры поездки", body: "Проверьте маршрут, даты, пассажиров и категорию пакета. Если показан выбор перелётов, выберите рейсы туда и обратно, затем переходите к отелям."), .init(title: "Set your trip details", body: "Check your route, dates, travelers and package category. If flight selection is shown, select both flights before continuing to hotels."), .init(title: "Safar parametrlarini belgilang", body: "Yo‘nalish, sanalar, yo‘lovchilar va paket toifasini tekshiring. Reys tanlovi ko‘rsatilgan bo‘lsa, mehmonxonalarga o‘tishdan oldin ikkala reysni tanlang."), .init(title: "Сафар параметрларини белгиланг", body: "Ёъналиш, саналар, ёъловчилар ва пакет тоифасини текширинг. Рейс танлови кўрсатилган бўлса, меҳмонхоналарга ўтишдан олдин иккала рейсни танланг.")],
        "legacy.hotel": [.init(title: "Выберите отели по маршруту", body: "Выберите отель в Мекке и, если она включена в поездку, в Медине. Проверьте номер и доступные настройки проживания перед продолжением."), .init(title: "Choose hotels for your route", body: "Choose a hotel in Makkah and in Madinah if it is part of your trip. Check rooms and available accommodation settings before continuing."), .init(title: "Yo‘nalish bo‘yicha mehmonxona tanlang", body: "Makkada va safaringizga kiritilgan bo‘lsa, Madinada mehmonxona tanlang. Davom etishdan oldin xona va mavjud joylashuv sozlamalarini tekshiring."), .init(title: "Ёъналиш бўйича меҳмонхона танланг", body: "Маккада ва сафарингизга киритилган бўлса, Мадинада меҳмонхона танланг. Давом этишдан олдин хона ва мавжуд жойлашув созламаларини текширинг.")],
        "legacy.final": [.init(title: "Проверьте пакет перед бронированием", body: "Сверьте состав поездки и сумму за всех путешественников. Нажмите «Забронировать поездку», чтобы перейти к следующему этапу оформления."), .init(title: "Review your package before booking", body: "Check the trip details and total for all travelers. Tap “Book this trip” to continue with booking."), .init(title: "Bron qilishdan oldin paketni tekshiring", body: "Safar tarkibi va barcha yo‘lovchilar uchun jami narxni tekshiring. Davom etish uchun «Safarni bron qilish» tugmasini bosing."), .init(title: "Брон қилишдан олдин пакетни текширинг", body: "Сафар таркиби ва барча ёъловчилар учун жами нархни текширинг. Давом этиш учун «Сафарни брон қилиш» тугмасини босинг.")],
        "legacy.recalculate": [.init(title: "Обновите расчёт поездки", body: "Нажмите «Повторить расчёт», чтобы проверить стоимость выбранного пакета. Продолжить оформление можно после успешного расчёта."), .init(title: "Update your trip price", body: "Tap “Retry pricing” to check the cost of your selected package. You can continue after pricing succeeds."), .init(title: "Safar narxini yangilang", body: "Tanlangan paket narxini tekshirish uchun «Qayta hisoblash» tugmasini bosing. Hisoblash muvaffaqiyatli tugagach, davom etishingiz mumkin."), .init(title: "Сафар нархини янгиланг", body: "Танланган пакет нархини текшириш учун «Қайта ҳисоблаш» тугмасини босинг. Ҳисоблаш муваффақиятли тугагач, давом этишингиз мумкин.")],
        "care.request": [.init(title: "Расскажите, какую поездку хотите", body: "Укажите даты или удобный месяц, состав группы, маршрут и пожелания. Оставьте контакты и отправьте запрос, чтобы команда помогла подобрать поездку."), .init(title: "Tell us about your trip", body: "Enter dates or a preferred month, your group, route and wishes. Leave your contacts and send a request so the team can help plan your trip."), .init(title: "Safaringiz haqida aytib bering", body: "Sanalar yoki qulay oy, guruh, yo‘nalish va istaklaringizni kiriting. Jamoa safarni tanlashda yordam berishi uchun aloqa ma’lumotlarini qoldirib, ariza yuboring."), .init(title: "Сафарингиз ҳақида айтиб беринг", body: "Саналар ёки қулай ой, гуруҳ, ёъналиш ва истакларингизни киритинг. Жамоа сафарни танлашда ёрдам бериши учун алоқа маълумотларини қолдириб, ариза юборинг.")],
        "hotel.package_no_rates": [.init(title: "Посмотрите другой отель", body: "API не вернул тарифы этого отеля на даты поездки. Вернитесь к списку и выберите другой отель."), .init(title: "Try another hotel", body: "The API returned no rates for this hotel on your trip dates. Return to the list and choose another hotel."), .init(title: "Boshqa mehmonxonani ko‘ring", body: "API safar sanalari uchun bu mehmonxona tariflarini qaytarmadi. Ro‘yxatga qaytib, boshqa mehmonxonani tanlang."), .init(title: "Бошқа меҳмонхонани кўринг", body: "API сафар саналари учун бу меҳмонхона тарифларини қайтармади. Рўйхатга қайтиб, бошқа меҳмонхонани танланг.")],
        "transfer.confirm": [.init(title: "Подтвердите выбранный трансфер", body: "Проверьте автомобиль, маршрут и добавленные билеты на поезд. Подтвердите выбор нижней кнопкой, чтобы перейти к итогу поездки."), .init(title: "Confirm your transfer", body: "Check your car, route and added train tickets. Confirm using the button below to continue to your trip review."), .init(title: "Transferni tasdiqlang", body: "Avtomobil, yo‘nalish va qo‘shilgan poyezd chiptalarini tekshiring. Safar yakuniga o‘tish uchun pastdagi tugma bilan tasdiqlang."), .init(title: "Трансферни тасдиқланг", body: "Автомобил, ёъналиш ва қўшилган пойезд чипталарини текширинг. Сафар якунига ўтиш учун пастдаги тугма билан тасдиқланг.")],
    ]
}

struct IumrahHelpContext: Equatable { let key: String; var extraKey: String? = nil }
private struct IumrahHelpContextKey: PreferenceKey {
    static var defaultValue: IumrahHelpContext? = nil
    static func reduce(value: inout IumrahHelpContext?, nextValue: () -> IumrahHelpContext?) {
        if let next = nextValue() { value = next }
    }
}
private struct HelpInHeaderKey: EnvironmentKey { static let defaultValue = false }
private struct ShowPageHelpKey: EnvironmentKey { static let defaultValue: () -> Void = {} }
extension EnvironmentValues {
    var iumrahHelpInHeader: Bool {
        get { self[HelpInHeaderKey.self] }
        set { self[HelpInHeaderKey.self] = newValue }
    }
    var iumrahShowPageHelp: () -> Void {
        get { self[ShowPageHelpKey.self] }
        set { self[ShowPageHelpKey.self] = newValue }
    }
}
enum IumrahHelpLabel {
    static func title(_ language: AppSettingsStore.Language) -> String {
        switch language {
        case .russian: return "Что делать здесь?"
        case .uzbek: return "Bu yerda nima qilish kerak?"
        case .uzbekCyrillic: return "Бу ерда нима қилиш керак?"
        default: return "What can I do here?"
        }
    }
}
struct IumrahPageHelpButton: View {
    @Environment(\.iumrahShowPageHelp) private var show
    @EnvironmentObject private var settings: AppSettingsStore
    var inSystemToolbar = false

    init(inSystemToolbar: Bool = false) { self.inSystemToolbar = inSystemToolbar }

    @ViewBuilder var body: some View {
        if inSystemToolbar {
            Button(action: show) { Image(systemName: "questionmark") }
                .accessibilityLabel(IumrahHelpLabel.title(settings.language))
        } else {
            IumrahGlassIconButton(systemName: "questionmark", size: 48, fontSize: 19,
                accessibilityLabel: IumrahHelpLabel.title(settings.language), action: show)
        }
    }
}
struct IumrahTypedHelpText: View {
    let copy: IumrahPageHelp.Copy
    var extra: String? = nil
    var onComplete: () -> Void = {}
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @State private var visible = ""
    private var full: String { copy.body + (extra.map { "\n\n" + $0 } ?? "") }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(copy.title).font(IumrahType.bold(22, relativeTo: .title2))
            ZStack(alignment: .topLeading) {
                // Reserve the final text height: typing must never shake the page.
                Text(full).hidden().accessibilityHidden(true)
                Text(visible).accessibilityLabel(full)
            }.font(IumrahType.regular(17, relativeTo: .body))
        }.fixedSize(horizontal: false, vertical: true)
            .task(id: full) {
                visible = ""
                if reduceMotion || voiceOver { visible = full; onComplete(); return }
                let letters = Array(full)
                for end in stride(from: 1, through: letters.count, by: 3) {
                    guard !Task.isCancelled else { return }
                    visible = String(letters.prefix(min(end + 2, letters.count)))
                    do { try await Task.sleep(for: .milliseconds(18)) } catch { return }
                }
                visible = full
                onComplete()
            }
    }
}
struct IumrahPageHelpCard: View {
    @EnvironmentObject private var settings: AppSettingsStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.iumrahHelpInHeader) private var headerMode
    @AppStorage("iumrah.autoPageHelp") private var automaticPageHelp = true
    @State private var expanded = true
    let key: String
    var extraKey: String? = nil
    init(_ key: String, extraKey: String? = nil) { self.key = key; self.extraKey = extraKey }
    var body: some View {
        if headerMode {
            Color.clear.frame(height: 0)
                .preference(key: IumrahHelpContextKey.self, value: .init(key: key, extraKey: extraKey))
                .accessibilityHidden(true)
        } else if let copy = IumrahPageHelp.text(key, language: settings.language) {
            VStack(alignment: .leading, spacing: 12) {
                Button {
                    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.25)) { expanded.toggle() }
                } label: {
                    HStack {
                        Text(IumrahHelpLabel.title(settings.language)).font(IumrahType.bold(17, relativeTo: .headline))
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.down").rotationEffect(.degrees(expanded ? 180 : 0))
                    }.frame(minHeight: 44).contentShape(Rectangle())
                }.buttonStyle(.plain)
                if expanded {
                    IumrahTypedHelpText(copy: copy, extra: extraKey.flatMap { IumrahPageHelp.text($0, language: settings.language)?.body })
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }.foregroundStyle(Color.iumrahInk).padding(18)
                .modifier(IumrahAnimatedSearchBorder(guidance: true))
                .onAppear { expanded = automaticPageHelp }
                .onChange(of: automaticPageHelp) { _, enabled in if !enabled { expanded = false } }
        }
    }
}
struct IumrahHelpOverlayHost: ViewModifier {
    let enabled: Bool
    var explicitContext: IumrahHelpContext? = nil
    var autoOnContextChange = false
    @EnvironmentObject private var settings: AppSettingsStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @AppStorage("iumrah.autoPageHelp") private var automaticPageHelp = true
    @State private var context: IumrahHelpContext?
    @State private var showing = false
    @State private var automaticShown = false
    @State private var closeTask: Task<Void, Never>?
    func body(content: Content) -> some View {
        content
            .environment(\.iumrahHelpInHeader, enabled)
            .environment(\.iumrahShowPageHelp, { present() })
            .onPreferenceChange(IumrahHelpContextKey.self) { value in
                guard explicitContext == nil else { return }
                updateContext(value)
            }
            .onAppear { if let explicitContext { updateContext(explicitContext) } }
            .onChange(of: explicitContext) { _, value in updateContext(value) }
            .overlay(alignment: .top) {
                if enabled && showing, let context,
                   let copy = IumrahPageHelp.text(context.key, language: settings.language) {
                    GeometryReader { viewport in
                        ZStack(alignment: .topTrailing) {
                            Color.black.opacity(0.30).ignoresSafeArea()
                                .onTapGesture { dismiss() }
                                .accessibilityLabel(IumrahHelpLabel.title(settings.language))
                                .accessibilityAddTraits(.isButton)
                            ScrollView {
                                VStack(alignment: .leading, spacing: 14) {
                                    Text(IumrahHelpLabel.title(settings.language)).font(.headline)
                                    IumrahTypedHelpText(copy: copy, extra: context.extraKey.flatMap { IumrahPageHelp.text($0, language: settings.language)?.body }) {
                                        scheduleDismiss()
                                    }.id(context.key + (context.extraKey ?? ""))
                                }.foregroundStyle(Color.iumrahInk).padding(22)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .modifier(IumrahAnimatedSearchBorder(guidance: true))
                            }.fixedSize(horizontal: false, vertical: true)
                                .frame(maxHeight: viewport.size.height * 0.75)
                                .padding(.horizontal, 18)
                                .padding(.top, max(12, viewport.safeAreaInsets.top) + 52)
                                .transition(.scale(scale: 0.08, anchor: .topTrailing).combined(with: .opacity))
                        }
                    }.zIndex(100)
                }
            }
            .onChange(of: enabled) { _, active in
                automaticShown = false
                dismiss()
                if active && context != nil && automaticPageHelp { automaticShown = true; present() }
            }
            .onChange(of: automaticPageHelp) { _, enabled in
                if !enabled { automaticShown = true; dismiss() }
            }
            .onDisappear { closeTask?.cancel(); showing = false; automaticShown = false }
    }
    private func updateContext(_ value: IumrahHelpContext?) {
        let changed = context?.key != value?.key || context?.extraKey != value?.extraKey
        context = value
        guard enabled, value != nil else { dismiss(); return }
        if automaticPageHelp && (!automaticShown || (changed && autoOnContextChange)) {
            automaticShown = true
            present()
        } else if changed && showing {
            closeTask?.cancel()
            scheduleDismiss()
        }
    }
    private func present() {
        closeTask?.cancel()
        withAnimation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.88)) { showing = true }
    }
    private func dismiss() {
        closeTask?.cancel()
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { showing = false }
    }
    private func scheduleDismiss() {
        guard !voiceOver else { return }
        closeTask?.cancel()
        closeTask = Task { @MainActor in
            do { try await Task.sleep(for: .milliseconds(2500)) } catch { return }
            guard !Task.isCancelled else { return }
            dismiss()
        }
    }
}
