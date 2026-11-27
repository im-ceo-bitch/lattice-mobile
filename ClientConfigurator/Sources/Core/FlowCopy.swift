import Foundation

enum FlowCopy {
    enum Key {
        case hotelStageEyebrow
        case hotelStageTitle
        case hotelStageBody
        case makkahStay
        case madinahStay
        case primaryHotel
        case viewHotel
        case changeHotel
        case chooseHotel
        case continueToFlights
        case hotelSelectionTitleMakkah
        case hotelSelectionTitleMadinah
        case hotelSelectionBody
        case selected
        case roomOptional
        case selectedRoom
        case hotelDetails
        case amenities
        case roomsPrepared
        case roomsPreparedBody
        case roomsLoading
        case roomsError
        case doubleRoomBody
        case tripleRoomBody
        case quadrupleRoomBody
        case madinahHotelRequired
        case hotelRooms
        case hotelRoomsBody
        case chooseRoom
        case roomChosen
        case done
        case finalEyebrow
        case finalTitle
        case finalBody
        case includedTitle
        case outboundFlight
        case returnFlight
        case makkahHotel
        case madinahHotel
        case fullTransfer
        case ziyaratMakkah
        case ziyaratMadinah
        case careSupport
        case guide
        case visa
        case meals
        case esim
        case included
        case noPaymentTitle
        case noPaymentBody
        case bookPackage
        case bookingSuccessTitle
        case bookingSuccessBody
        case home
        case openBooking
        case stepOfFour
        case bookingRemovedLocally
    }

    static func text(_ key: Key, _ language: AppSettingsStore.Language) -> String {
        switch language {
        case .russian: return ru(key)
        case .arabic: return ArabicLocalization.phrase(en(key))
        case .indonesian, .malay, .english: return en(key)
        case .turkish: return TurkishLocalization.phrase(en(key))
        case .uzbek: return uz(key)
        case .uzbekCyrillic: return uzCyr(key)
        }
    }

    private static func ru(_ key: Key) -> String {
        switch key {
        case .hotelStageEyebrow: return "ВАШИ ОТЕЛИ"
        case .hotelStageTitle: return "Отели для вашей поездки"
        case .hotelStageBody: return "iumrah уже подобрал основные варианты. Проверьте Мекку и Медину — любой отель можно заменить до бронирования."
        case .makkahStay: return "Отель в Мекке"
        case .madinahStay: return "Отель в Медине"
        case .primaryHotel: return "Primary Hotel"
        case .viewHotel: return "Посмотреть отель"
        case .changeHotel: return "Изменить отель"
        case .chooseHotel: return "Выбрать отель"
        case .continueToFlights: return "Продолжить к перелётам"
        case .hotelSelectionTitleMakkah: return "Выберите отель в Мекке"
        case .hotelSelectionTitleMadinah: return "Выберите отель в Медине"
        case .hotelSelectionBody: return "Мы показываем подходящие варианты вашей категории. Откройте отель, посмотрите детали и выберите номер."
        case .selected: return "Выбран"
        case .roomOptional: return "Номер можно уточнить сейчас или позже"
        case .selectedRoom: return "Выбранный номер"
        case .hotelDetails: return "Об отеле"
        case .amenities: return "Удобства"
        case .roomsPrepared: return "Рекомендуемый выбор комнаты"
        case .roomsPreparedBody: return "Понятные категории, подготовленные iumrah для быстрого выбора."
        case .roomsLoading: return "Загружаем категории номеров…"
        case .roomsError: return "Не удалось загрузить категории номеров. Реальные номера отеля доступны ниже."
        case .doubleRoomBody: return "Комфортный вариант для двух гостей."
        case .tripleRoomBody: return "Больше пространства для семьи или трёх гостей."
        case .quadrupleRoomBody: return "Практичный семейный вариант для большой компании."
        case .madinahHotelRequired: return "Сначала выберите отель в Медине — он входит в ваш маршрут."
        case .hotelRooms: return "Комнаты этого отеля"
        case .hotelRoomsBody: return "Реальные варианты комнат из каталога отеля — с фотографиями, вместимостью и кроватями."
        case .chooseRoom: return "Выбрать этот номер"
        case .roomChosen: return "Выбрано"
        case .done: return "Готово"
        case .finalEyebrow: return "ВАША УМРА"
        case .finalTitle: return "Проверьте пакет перед бронированием"
        case .finalBody: return "Вся поездка собрана в один пакет — перелёты, отели, трансферы и поддержка iumrah."
        case .includedTitle: return "В ваш пакет входит"
        case .outboundFlight: return "Перелёт туда"
        case .returnFlight: return "Перелёт обратно"
        case .makkahHotel: return "Отель в Мекке"
        case .madinahHotel: return "Отель в Медине"
        case .fullTransfer: return "Полный трансфер по маршруту"
        case .ziyaratMakkah: return "Зиярат в Мекке"
        case .ziyaratMadinah: return "Зиярат в Медине"
        case .careSupport: return "iumrah Care · поддержка на всех этапах"
        case .guide: return "Гид и сопровождение"
        case .visa: return "Виза"
        case .meals: return "Питание"
        case .esim: return "eSIM для поездки"
        case .included: return "Включено"
        case .noPaymentTitle: return "Сейчас вы ничего не оплачиваете"
        case .noPaymentBody: return "После подтверждения и оплаты система автоматически запускает оформление выбранных перелётов, отелей, трансферов и услуг как одной связанной поездки."
        case .bookPackage: return "Забронировать мою Умру"
        case .bookingSuccessTitle: return "Поездка создана"
        case .bookingSuccessBody: return "Пакет сохранён как единая поездка. После оплаты система автоматически запустит оформление выбранных компонентов, а статус и обновления будут появляться в приложении."
        case .home: return "На главный экран"
        case .openBooking: return "Открыть бронирование"
        case .stepOfFour: return "Шаг"
        case .bookingRemovedLocally: return "Бронирование удалено с этого устройства"
        }
    }

    private static func en(_ key: Key) -> String {
        switch key {
        case .hotelStageEyebrow: return "YOUR HOTELS"
        case .hotelStageTitle: return "Hotels for your journey"
        case .hotelStageBody: return "iumrah has already selected the primary options. Review Makkah and Madinah — either hotel can be changed before booking."
        case .makkahStay: return "Makkah hotel"
        case .madinahStay: return "Madinah hotel"
        case .primaryHotel: return "Primary Hotel"
        case .viewHotel: return "View hotel"
        case .changeHotel: return "Change hotel"
        case .chooseHotel: return "Choose hotel"
        case .continueToFlights: return "Continue to flights"
        case .hotelSelectionTitleMakkah: return "Choose a hotel in Makkah"
        case .hotelSelectionTitleMadinah: return "Choose a hotel in Madinah"
        case .hotelSelectionBody: return "We show options that fit your selected class. Open a hotel, review the details and choose a room."
        case .selected: return "Selected"
        case .roomOptional: return "You can refine the room now or later"
        case .selectedRoom: return "Selected room"
        case .hotelDetails: return "Hotel details"
        case .amenities: return "Amenities"
        case .roomsPrepared: return "Recommended room choice"
        case .roomsPreparedBody: return "Clear room categories prepared by iumrah for a quick choice."
        case .roomsLoading: return "Loading room categories…"
        case .roomsError: return "Room categories could not be loaded. Real hotel rooms are still available below."
        case .doubleRoomBody: return "A comfortable option for two guests."
        case .tripleRoomBody: return "More space for a family or three guests."
        case .quadrupleRoomBody: return "A practical family option for a larger group."
        case .madinahHotelRequired: return "Choose your Madinah hotel first — it is part of this journey."
        case .hotelRooms: return "Rooms at this hotel"
        case .hotelRoomsBody: return "Real room options from the hotel catalogue, with photos, capacity and beds."
        case .chooseRoom: return "Choose this room"
        case .roomChosen: return "Selected"
        case .done: return "Done"
        case .finalEyebrow: return "YOUR UMRAH"
        case .finalTitle: return "Review your package before booking"
        case .finalBody: return "Your whole journey is collected into one package — flights, hotels, transfers and iumrah support."
        case .includedTitle: return "Your package includes"
        case .outboundFlight: return "Outbound flight"
        case .returnFlight: return "Return flight"
        case .makkahHotel: return "Makkah hotel"
        case .madinahHotel: return "Madinah hotel"
        case .fullTransfer: return "Full route transfer"
        case .ziyaratMakkah: return "Makkah Ziyarat"
        case .ziyaratMadinah: return "Madinah Ziyarat"
        case .careSupport: return "iumrah Care · support throughout your journey"
        case .guide: return "Guide and assistance"
        case .visa: return "Visa"
        case .meals: return "Meals"
        case .esim: return "Travel eSIM"
        case .included: return "Included"
        case .noPaymentTitle: return "You are not paying anything yet"
        case .noPaymentBody: return "After confirmation and payment, the system automatically starts arranging the selected flights, hotels, transfers and services as one connected journey."
        case .bookPackage: return "Book my Umrah"
        case .bookingSuccessTitle: return "Your journey is created"
        case .bookingSuccessBody: return "Your package is saved as one connected journey. After payment, the system will automatically start arranging the selected components, with status and updates shown in the app."
        case .home: return "Go to Home"
        case .openBooking: return "Open booking"
        case .stepOfFour: return "Step"
        case .bookingRemovedLocally: return "Booking removed from this device"
        }
    }

    private static func uz(_ key: Key) -> String {
        switch key {
        case .hotelStageEyebrow: return "MEHMONXONALARINGIZ"
        case .hotelStageTitle: return "Safaringiz uchun mehmonxonalar"
        case .hotelStageBody: return "iumrah asosiy variantlarni tanlab bo‘ldi. Makka va Madinani tekshiring — bron qilishdan oldin har ikkisini almashtirish mumkin."
        case .makkahStay: return "Makkadagi mehmonxona"
        case .madinahStay: return "Madinadagi mehmonxona"
        case .primaryHotel: return "Primary Hotel"
        case .viewHotel: return "Mehmonxonani ko‘rish"
        case .changeHotel: return "Mehmonxonani o‘zgartirish"
        case .chooseHotel: return "Mehmonxonani tanlash"
        case .continueToFlights: return "Parvozlarga o‘tish"
        case .hotelSelectionTitleMakkah: return "Makkadagi mehmonxonani tanlang"
        case .hotelSelectionTitleMadinah: return "Madinadagi mehmonxonani tanlang"
        case .hotelSelectionBody: return "Tanlangan darajangizga mos variantlarni ko‘rsatamiz. Mehmonxonani oching, tafsilotlarni ko‘ring va xonani tanlang."
        case .selected: return "Tanlangan"
        case .roomOptional: return "Xonani hozir yoki keyinroq aniqlashtirishingiz mumkin"
        case .selectedRoom: return "Tanlangan xona"
        case .hotelDetails: return "Mehmonxona haqida"
        case .amenities: return "Qulayliklar"
        case .roomsPrepared: return "Tavsiya etilgan xona tanlovi"
        case .roomsPreparedBody: return "Tez tanlash uchun iumrah tayyorlagan tushunarli xona kategoriyalari."
        case .roomsLoading: return "Xona toifalari yuklanmoqda…"
        case .roomsError: return "Xona toifalarini yuklab bo‘lmadi. Mehmonxonaning haqiqiy xonalari quyida mavjud."
        case .doubleRoomBody: return "Ikki mehmon uchun qulay variant."
        case .tripleRoomBody: return "Oila yoki uch mehmon uchun ko‘proq joy."
        case .quadrupleRoomBody: return "Kattaroq oila uchun qulay variant."
        case .madinahHotelRequired: return "Avval Madinadagi mehmonxonani tanlang — u safaringizga kiradi."
        case .hotelRooms: return "Ushbu mehmonxona xonalari"
        case .hotelRoomsBody: return "Mehmonxona katalogidagi haqiqiy xonalar — fotosuratlar, sig‘im va yotoqlar bilan."
        case .chooseRoom: return "Bu xonani tanlash"
        case .roomChosen: return "Tanlangan"
        case .done: return "Tayyor"
        case .finalEyebrow: return "SIZNING UMRANGIZ"
        case .finalTitle: return "Bron qilishdan oldin paketni tekshiring"
        case .finalBody: return "Butun safaringiz bitta paketda — parvozlar, mehmonxonalar, transferlar va iumrah yordami."
        case .includedTitle: return "Paketingizga kiradi"
        case .outboundFlight: return "Borish parvozi"
        case .returnFlight: return "Qaytish parvozi"
        case .makkahHotel: return "Makkadagi mehmonxona"
        case .madinahHotel: return "Madinadagi mehmonxona"
        case .fullTransfer: return "To‘liq marshrut transferi"
        case .ziyaratMakkah: return "Makkadagi ziyorat"
        case .ziyaratMadinah: return "Madinadagi ziyorat"
        case .careSupport: return "iumrah Care · safarning barcha bosqichlarida yordam"
        case .guide: return "Gid va hamrohlik"
        case .visa: return "Viza"
        case .meals: return "Ovqatlanish"
        case .esim: return "Safar uchun eSIM"
        case .included: return "Kiritilgan"
        case .noPaymentTitle: return "Hozircha hech narsa to‘lamaysiz"
        case .noPaymentBody: return "Tasdiq va to‘lovdan so‘ng tizim tanlangan reyslar, mehmonxonalar, transferlar va xizmatlarni bitta bog‘langan safar sifatida avtomatik rasmiylashtirishni boshlaydi."
        case .bookPackage: return "Umramni bron qilish"
        case .bookingSuccessTitle: return "Safaringiz yaratildi"
        case .bookingSuccessBody: return "Paket bitta bog‘langan safar sifatida saqlandi. To‘lovdan so‘ng tizim tanlangan qismlarni avtomatik rasmiylashtirishni boshlaydi, holat va yangiliklar ilovada ko‘rinadi."
        case .home: return "Asosiy ekranga"
        case .openBooking: return "Bronni ochish"
        case .stepOfFour: return "Qadam"
        case .bookingRemovedLocally: return "Bron ushbu qurilmadan o‘chirildi"
        }
    }

    private static func uzCyr(_ key: Key) -> String {
        switch key {
        case .hotelStageEyebrow: return "МЕҲМОНХОНАЛАРИНГИЗ"
        case .hotelStageTitle: return "Сафарингиз учун меҳмонхоналар"
        case .hotelStageBody: return "iumrah асосий вариантларни танлаб бўлди. Макка ва Мадинани текширинг — брон қилишдан олдин ҳар иккисини алмаштириш мумкин."
        case .makkahStay: return "Маккадаги меҳмонхона"
        case .madinahStay: return "Мадинадаги меҳмонхона"
        case .primaryHotel: return "Primary Hotel"
        case .viewHotel: return "Меҳмонхонани кўриш"
        case .changeHotel: return "Меҳмонхонани ўзгартириш"
        case .chooseHotel: return "Меҳмонхонани танлаш"
        case .continueToFlights: return "Парвозларга ўтиш"
        case .hotelSelectionTitleMakkah: return "Маккадаги меҳмонхонани танланг"
        case .hotelSelectionTitleMadinah: return "Мадинадаги меҳмонхонани танланг"
        case .hotelSelectionBody: return "Танланган даражангизга мос вариантларни кўрсатамиз. Меҳмонхонани очинг, тафсилотларни кўринг ва хонани танланг."
        case .selected: return "Танланган"
        case .roomOptional: return "Хонани ҳозир ёки кейинроқ аниқлаштиришингиз мумкин"
        case .selectedRoom: return "Танланган хона"
        case .hotelDetails: return "Меҳмонхона ҳақида"
        case .amenities: return "Қулайликлар"
        case .roomsPrepared: return "Тавсия этилган хона танлови"
        case .roomsPreparedBody: return "Тез танлаш учун iumrah тайёрлаган тушунарли хона категориялари."
        case .roomsLoading: return "Хона тоифалари юкланмоқда…"
        case .roomsError: return "Хона тоифаларини юклаб бўлмади. Меҳмонхонанинг ҳақиқий хоналари қуйида мавжуд."
        case .doubleRoomBody: return "Икки меҳмон учун қулай вариант."
        case .tripleRoomBody: return "Оила ёки уч меҳмон учун кўпроқ жой."
        case .quadrupleRoomBody: return "Каттароқ оила учун қулай вариант."
        case .madinahHotelRequired: return "Аввал Мадинадаги меҳмонхонани танланг — у сафарингизга киради."
        case .hotelRooms: return "Ушбу меҳмонхона хоналари"
        case .hotelRoomsBody: return "Меҳмонхона каталогидаги ҳақиқий хоналар — суратлар, сиғим ва ётоқлар билан."
        case .chooseRoom: return "Бу хонани танлаш"
        case .roomChosen: return "Танланган"
        case .done: return "Тайёр"
        case .finalEyebrow: return "СИЗНИНГ УМРАНГИЗ"
        case .finalTitle: return "Брон қилишдан олдин пакетни текширинг"
        case .finalBody: return "Бутун сафарингиз битта пакетда — парвозлар, меҳмонхоналар, трансферлар ва iumrah ёрдами."
        case .includedTitle: return "Пакетингизга киради"
        case .outboundFlight: return "Бориш парвози"
        case .returnFlight: return "Қайтиш парвози"
        case .makkahHotel: return "Маккадаги меҳмонхона"
        case .madinahHotel: return "Мадинадаги меҳмонхона"
        case .fullTransfer: return "Тўлиқ маршрут трансфери"
        case .ziyaratMakkah: return "Маккадаги зиёрат"
        case .ziyaratMadinah: return "Мадинадаги зиёрат"
        case .careSupport: return "iumrah Care · сафарнинг барча босқичларида ёрдам"
        case .guide: return "Гид ва ҳамроҳлик"
        case .visa: return "Виза"
        case .meals: return "Овқатланиш"
        case .esim: return "Сафар учун eSIM"
        case .included: return "Киритилган"
        case .noPaymentTitle: return "Ҳозирча ҳеч нарса тўламайсиз"
        case .noPaymentBody: return "Тасдиқ ва тўловдан сўнг тизим танланган рейслар, меҳмонхоналар, трансферлар ва хизматларни битта боғланган сафар сифатида автоматик расмийлаштиришни бошлайди."
        case .bookPackage: return "Умрамни брон қилиш"
        case .bookingSuccessTitle: return "Сафарингиз яратилди"
        case .bookingSuccessBody: return "Пакет битта боғланган сафар сифатида сақланди. Тўловдан сўнг тизим танланган қисмларни автоматик расмийлаштиришни бошлайди, ҳолат ва янгиликлар иловада кўринади."
        case .home: return "Асосий экранга"
        case .openBooking: return "Бронни очиш"
        case .stepOfFour: return "Қадам"
        case .bookingRemovedLocally: return "Брон ушбу қурилмадан ўчирилди"
        }
    }
}
