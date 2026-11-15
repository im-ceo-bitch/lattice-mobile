import { STATUS_ASSETS } from './status-assets.js';
import { MINI_ASSETS } from './mini-assets.js';
import { SUPPORT_ASSETS } from './support-assets.js';
import { bookingMiniV7HTML } from './mini-v7.js';
const I18N = {
    ru: {
        actions: { refresh: "Обновить статус", liveTimer: "Живой таймер", openIumrah: "Открыть iumrah", connectTelegram: "Подключить Telegram", callCare: "Позвонить iumrah Care" },
        generic: {
            booking: "Бронь", dates: "Даты", confirmation: "Подтверждение", stageExpired: "Срок этапа завершён", synced: "Статус синхронизирован с единой системой iumrah.",
            bookingNotLinkedTitle: "Бронь ещё не подключена", bookingNotLinkedBody: "Откройте свою бронь в iumrah и нажмите «Подключить Telegram». Ссылка действует 10 минут и связывает Telegram без пароля.",
            updateFailedTitle: "Не удалось обновить бронь", reconnectPrompt: "Откройте iumrah и переподключите Telegram.",
            linkExpiredTitle: "Ссылка больше не действует", linkExpiredBody: "Откройте бронь в iumrah и создайте новую ссылку «Подключить Telegram».",
            helpTitle: "iumrah Telegram", helpBody: "/status — статус бронирования\n/start — мои бронирования\n\nДля первой привязки используйте кнопку «Подключить Telegram» внутри iumrah.",
            linkSuccessTitle: "Telegram подключён к iumrah", linkSuccessBody: "Бронь %s привязана. Теперь изменения статуса будут приходить сюда автоматически.",
            callbackUpdated: "Статус обновлён", callbackRefreshFailed: "Не удалось обновить", callbackNotLinked: "Бронь не подключена"
        },
        lifecycle: { availability: "До максимального срока проверки", price_lock: "Цена зафиксирована ещё", payment_confirmation: "Проверка оплаты", documents: "Подготовка документов" },
        statuses: {
            newBooking: { title: "Новое бронирование", body: "Ваша бронь создана и передана в систему iumrah. Скоро начнётся автоматическая проверка рейсов, отелей и остальных компонентов поездки." },
            checking: { title: "Проверка наличия", body: "iumrah проверяет рейсы, отели и остальные компоненты вашей поездки." },
            paymentWaiting: { title: "Наличие подтверждено", body: "Можно переходить к оплате и заполнению данных паломников. Цена удерживается ограниченное время." },
            paymentReceived: { title: "Оплата получена", body: "Платёж уже получен и сейчас проходит подтверждение." },
            confirmed: { title: "Бронирование подтверждено", body: "Мы готовим документы и подтверждения по вашей поездке." },
            ready: { title: "Документы готовы", body: "Поездка готова. Основные документы и подтверждения уже собраны." },
            inTrip: { title: "Паломник в поездке", body: "Ваша поездка уже началась. Основные данные остаются доступны в iumrah." },
            completed: { title: "Завершено", body: "Бронирование завершено. Пусть Аллах примет вашу Умру." },
            fallbackTitle: "Статус бронирования"
        }
    },
    en: {
        actions: { refresh: "Refresh status", liveTimer: "Live timer", openIumrah: "Open iumrah", connectTelegram: "Connect Telegram", callCare: "Call iumrah Care" },
        generic: {
            booking: "Booking", dates: "Dates", confirmation: "Confirmation", stageExpired: "Stage time is over", synced: "Status is synced with the unified iumrah system.",
            bookingNotLinkedTitle: "No booking is linked yet", bookingNotLinkedBody: "Open your booking in iumrah and tap “Connect Telegram”. The link stays active for 10 minutes and links Telegram without a password.",
            updateFailedTitle: "Could not refresh booking", reconnectPrompt: "Open iumrah and reconnect Telegram.",
            linkExpiredTitle: "This link is no longer active", linkExpiredBody: "Open your booking in iumrah and create a new “Connect Telegram” link.",
            helpTitle: "iumrah Telegram", helpBody: "/status — booking status\n/start — my bookings\n\nFor the first link, use the “Connect Telegram” button inside iumrah.",
            linkSuccessTitle: "Telegram is connected to iumrah", linkSuccessBody: "Booking %s has been linked. Status updates will now arrive here automatically.",
            callbackUpdated: "Status refreshed", callbackRefreshFailed: "Refresh failed", callbackNotLinked: "Booking is not linked"
        },
        lifecycle: { availability: "Maximum availability window", price_lock: "Price is locked for", payment_confirmation: "Payment review", documents: "Preparing documents" },
        statuses: {
            newBooking: { title: "New booking", body: "Your booking has been created and sent to the iumrah system. Automatic verification of flights, hotels and the remaining trip components will begin shortly." },
            checking: { title: "Checking availability", body: "iumrah is checking flights, hotels and the remaining trip components." },
            paymentWaiting: { title: "Availability confirmed", body: "You can now proceed with payment and pilgrim details. The price is held for a limited time." },
            paymentReceived: { title: "Payment received", body: "Your payment has been received and is now being reviewed." },
            confirmed: { title: "Booking confirmed", body: "We are preparing your travel documents and confirmations." },
            ready: { title: "Documents ready", body: "Your trip is ready. Core documents and confirmations are already prepared." },
            inTrip: { title: "Pilgrim is in trip", body: "Your Umrah journey is already active. Core details remain available in iumrah." },
            completed: { title: "Completed", body: "This booking is completed. May Allah accept your Umrah." },
            fallbackTitle: "Booking status"
        }
    },
    uz: {
        actions: { refresh: "Statusni yangilash", liveTimer: "Jonli taymer", openIumrah: "iumrah'ni ochish", connectTelegram: "Telegram'ni ulash", callCare: "iumrah Care’ga qo‘ng‘iroq" },
        generic: {
            booking: "Bron", dates: "Sanalar", confirmation: "Tasdiq", stageExpired: "Bosqich muddati tugadi", synced: "Status iumrah yagona tizimi bilan sinxronlangan.",
            bookingNotLinkedTitle: "Bron hali ulanmagan", bookingNotLinkedBody: "Broningizni iumrah ichida oching va “Telegram'ni ulash” tugmasini bosing. Havola 10 daqiqa amal qiladi va Telegram'ni parolsiz bog'laydi.",
            updateFailedTitle: "Bronni yangilab bo‘lmadi", reconnectPrompt: "iumrah'ni ochib, Telegram'ni qayta ulang.",
            linkExpiredTitle: "Havola endi faol emas", linkExpiredBody: "iumrah ichida bronni oching va yangi “Telegram'ni ulash” havolasini yarating.",
            helpTitle: "iumrah Telegram", helpBody: "/status — bron holati\n/start — mening bronlarim\n\nBirinchi ulash uchun iumrah ichidagi “Telegram'ni ulash” tugmasidan foydalaning.",
            linkSuccessTitle: "Telegram iumrah'ga ulandi", linkSuccessBody: "%s broni ulandi. Endi status o'zgarishlari shu yerga avtomatik keladi.",
            callbackUpdated: "Status yangilandi", callbackRefreshFailed: "Yangilanmadi", callbackNotLinked: "Bron ulanmagan"
        },
        lifecycle: { availability: "Maksimal tekshiruv muddati", price_lock: "Narx yana shuncha vaqt ushlab turiladi", payment_confirmation: "To'lovni tekshirish", documents: "Hujjatlar tayyorlanmoqda" },
        statuses: {
            newBooking: { title: "Yangi bron", body: "Broningiz yaratildi va iumrah tizimiga yuborildi. Tez orada parvozlar, mehmonxonalar va safarning qolgan qismlari avtomatik tekshiriladi." },
            checking: { title: "Mavjudlik tekshirilmoqda", body: "iumrah parvozlar, mehmonxonalar va safarning qolgan qismlarini tekshirmoqda." },
            paymentWaiting: { title: "Mavjudlik tasdiqlandi", body: "Endi to'lov va ziyoratchilar ma'lumotlarini topshirishingiz mumkin. Narx cheklangan vaqtga ushlab turiladi." },
            paymentReceived: { title: "To'lov qabul qilindi", body: "To'lov qabul qilindi va hozir tasdiqlanmoqda." },
            confirmed: { title: "Bron tasdiqlandi", body: "Safaringiz bo'yicha hujjatlar va tasdiqlar tayyorlanmoqda." },
            ready: { title: "Hujjatlar tayyor", body: "Safar tayyor. Asosiy hujjatlar va tasdiqlar allaqachon tayyor." },
            inTrip: { title: "Ziyoratchi safarda", body: "Umra safaringiz boshlandi. Asosiy ma'lumotlar iumrah ichida mavjud." },
            completed: { title: "Yakunlandi", body: "Bron yakunlandi. Alloh Umrangizni qabul qilsin." },
            fallbackTitle: "Bron holati"
        }
    },
    uz_cyrl: {
        actions: { refresh: "Статусни янгилаш", liveTimer: "Жонли таймер", openIumrah: "iumrah'ни очиш", connectTelegram: "Telegram'ни улаш", callCare: "iumrah Care’га қўнғироқ" },
        generic: {
            booking: "Брон", dates: "Саналар", confirmation: "Тасдиқ", stageExpired: "Босқич муддати тугади", synced: "Статус iumrah ягона тизими билан синхронланган.",
            bookingNotLinkedTitle: "Брон ҳали уланмаган", bookingNotLinkedBody: "Бронингизни iumrah ичида очинг ва “Telegram'ни улаш” тугмасини босинг. Ҳавола 10 дақиқа амал қилади ва Telegram'ни паролсиз боғлайди.",
            updateFailedTitle: "Бронни янгилаб бўлмади", reconnectPrompt: "iumrah'ни очиб, Telegram'ни қайта уланг.",
            linkExpiredTitle: "Ҳавола энди фаол эмас", linkExpiredBody: "iumrah ичида бронни очинг ва янги “Telegram'ни улаш” ҳаволасини яратинг.",
            helpTitle: "iumrah Telegram", helpBody: "/status — брон ҳолати\n/start — менинг бронларим\n\nБиринчи улаш учун iumrah ичидаги “Telegram'ни улаш” тугмасидан фойдаланинг.",
            linkSuccessTitle: "Telegram iumrah'га уланди", linkSuccessBody: "%s брони уланди. Энди статус ўзгаришлари шу ерга автоматик келади.",
            callbackUpdated: "Статус янгиланди", callbackRefreshFailed: "Янгиланмади", callbackNotLinked: "Брон уланмаган"
        },
        lifecycle: { availability: "Максимал текширув муддати", price_lock: "Нарх яна шунча вақт ушлаб турилади", payment_confirmation: "Тўловни текшириш", documents: "Ҳужжатлар тайёрланмоқда" },
        statuses: {
            newBooking: { title: "Янги брон", body: "Бронингиз яратилди ва iumrah тизимига юборилди. Яқин орада парвозлар, меҳмонхоналар ва сафарнинг қолган қисмлари автоматик текширилади." },
            checking: { title: "Мавжудлик текширилмоқда", body: "iumrah парвозлар, меҳмонхоналар ва сафарнинг қолган қисмларини текширмоқда." },
            paymentWaiting: { title: "Мавжудлик тасдиқланди", body: "Энди тўлов ва зиёратчилар маълумотларини топширишингиз мумкин. Нарх чекланган вақтга ушлаб турилади." },
            paymentReceived: { title: "Тўлов қабул қилинди", body: "Тўлов қабул қилинди ва ҳозир тасдиқланмоқда." },
            confirmed: { title: "Брон тасдиқланди", body: "Сафарингиз бўйича ҳужжатлар ва тасдиқлар тайёрланмоқда." },
            ready: { title: "Ҳужжатлар тайёр", body: "Сафар тайёр. Асосий ҳужжатлар ва тасдиқлар аллақачон тайёр." },
            inTrip: { title: "Зиёратчи сафарда", body: "Умра сафарингиз бошланди. Асосий маълумотлар iumrah ичида мавжуд." },
            completed: { title: "Якунланди", body: "Брон якунланди. Аллоҳ Умрангизни қабул қилсин." },
            fallbackTitle: "Брон ҳолати"
        }
    }
};
const BOT_UX = {
    ru: {
        chooseLanguage: "Выберите язык iumrah Telegram",
        languageSaved: "Русский выбран",
        welcomeTitle: "iumrah — ваша поездка в Telegram",
        welcomeBody: "Отслеживайте статус бронирования, серверные таймеры и изменения поездки. Полное управление бронью доступно в Mini App.",
        pinnedTitle: "Отслеживание бронирования",
        pinnedBody: "Откройте Mini App, чтобы видеть актуальный статус, таймеры, отели, услуги и iumrah Care.",
        openMini: "Открыть Mini App",
        status: "Статус брони",
        support: "iumrah Care",
        liveSupport: "Живая поддержка",
        supportTitle: "iumrah Care",
        supportBody: "Поддержка по вашей поездке. Телефон: +998 50 889 88 45. Для управления поддержкой откройте Care в Mini App.",
        liveSupportTitle: "Живая поддержка",
        liveSupportBody: "Выберите, как вам удобнее связаться с iumrah по вашей брони.",
        liveSupportCallTitle: "Звонок в поддержку",
        liveSupportCallBody: "Нажмите кнопку ниже, и бот отправит вам контакт iumrah Care прямо в Telegram.",
        liveSupportWriteTitle: "Написать в Telegram",
        liveSupportWriteBody: "Если вам удобнее написать напрямую, откройте личный Telegram iumrah Care по кнопке ниже.",
        liveSupportCallAction: "Позвонить",
        liveSupportWriteAction: "Написать @saudiclub966",
        menuReady: "Меню готово. Mini App всегда доступно кнопкой ниже.",
        website: "Открыть iumrah.app",
    },
    en: {
        chooseLanguage: "Choose your iumrah Telegram language",
        languageSaved: "English selected",
        welcomeTitle: "iumrah — your trip in Telegram",
        welcomeBody: "Track booking status, server timers and trip changes. Full booking management is available in the Mini App.",
        pinnedTitle: "Booking tracking",
        pinnedBody: "Open the Mini App to see live status, timers, hotels, services and iumrah Care.",
        openMini: "Open Mini App",
        status: "Booking status",
        support: "iumrah Care",
        liveSupport: "Live support",
        supportTitle: "iumrah Care",
        supportBody: "Support for your trip. Phone: +998 50 889 88 45. Open Care in the Mini App for full support controls.",
        liveSupportTitle: "Live support",
        liveSupportBody: "Choose the easiest way to contact iumrah about your booking.",
        liveSupportCallTitle: "Call support",
        liveSupportCallBody: "Tap the button below and the bot will send the iumrah Care contact directly into Telegram.",
        liveSupportWriteTitle: "Write in Telegram",
        liveSupportWriteBody: "If you prefer to write directly, open the personal Telegram contact using the button below.",
        liveSupportCallAction: "Call",
        liveSupportWriteAction: "Write to @saudiclub966",
        menuReady: "Menu is ready. The Mini App is always available from the button below.",
        website: "Open iumrah.app",
    },
    uz: {
        chooseLanguage: "iumrah Telegram tilini tanlang",
        languageSaved: "O‘zbek tili tanlandi",
        welcomeTitle: "iumrah — safaringiz Telegram ichida",
        welcomeBody: "Bron holati, server taymerlari va safardagi o‘zgarishlarni kuzating. Bronni to‘liq boshqarish Mini App ichida mavjud.",
        pinnedTitle: "Bronni kuzatish",
        pinnedBody: "Jonli status, taymerlar, mehmonxonalar, xizmatlar va iumrah Care uchun Mini App’ni oching.",
        openMini: "Mini App’ni ochish",
        status: "Bron holati",
        support: "iumrah Care",
        liveSupport: "Jonli yordam",
        supportTitle: "iumrah Care",
        supportBody: "Safaringiz bo‘yicha yordam. Telefon: +998 50 889 88 45. To‘liq yordam boshqaruvi uchun Mini App ichidagi Care bo‘limini oching.",
        liveSupportTitle: "Jonli yordam",
        liveSupportBody: "Broningiz bo‘yicha iumrah bilan bog‘lanishning qulay usulini tanlang.",
        liveSupportCallTitle: "Qo‘ng‘iroq qilish",
        liveSupportCallBody: "Pastdagi tugmani bosing — bot iumrah Care kontaktini to‘g‘ridan-to‘g‘ri Telegram’ga yuboradi.",
        liveSupportWriteTitle: "Telegram’da yozish",
        liveSupportWriteBody: "Agar to‘g‘ridan-to‘g‘ri yozmoqchi bo‘lsangiz, pastdagi tugma orqali shaxsiy Telegram’ni oching.",
        liveSupportCallAction: "Qo‘ng‘iroq qilish",
        liveSupportWriteAction: "@saudiclub966 ga yozish",
        menuReady: "Menyu tayyor. Mini App pastdagi tugma orqali doim ochiladi.",
        website: "iumrah.app’ni ochish",
    },
    uz_cyrl: {
        chooseLanguage: "iumrah Telegram тилини танланг",
        languageSaved: "Ўзбек тили танланди",
        welcomeTitle: "iumrah — сафарингиз Telegram ичида",
        welcomeBody: "Брон ҳолати, сервер таймерлари ва сафардаги ўзгаришларни кузатинг. Бронни тўлиқ бошқариш Mini App ичида мавжуд.",
        pinnedTitle: "Бронни кузатиш",
        pinnedBody: "Жонли статус, таймерлар, меҳмонхоналар, хизматлар ва iumrah Care учун Mini App’ни очинг.",
        openMini: "Mini App’ни очиш",
        status: "Брон ҳолати",
        support: "iumrah Care",
        liveSupport: "Жонли ёрдам",
        supportTitle: "iumrah Care",
        supportBody: "Сафарингиз бўйича ёрдам. Телефон: +998 50 889 88 45. Тўлиқ ёрдам бошқаруви учун Mini App ичидаги Care бўлимини очинг.",
        liveSupportTitle: "Жонли ёрдам",
        liveSupportBody: "Бронингиз бўйича iumrah билан боғланишнинг қулай усулини танланг.",
        liveSupportCallTitle: "Қўнғироқ қилиш",
        liveSupportCallBody: "Пастдаги тугмани босинг — бот iumrah Care контактини тўғридан‑тўғри Telegram’га юборади.",
        liveSupportWriteTitle: "Telegram’да ёзиш",
        liveSupportWriteBody: "Агар тўғридан‑тўғри ёзмоқчи бўлсангиз, пастдаги тугма орқали шахсий Telegram’ни очинг.",
        liveSupportCallAction: "Қўнғироқ қилиш",
        liveSupportWriteAction: "@saudiclub966 га ёзиш",
        menuReady: "Меню тайёр. Mini App пастдаги тугма орқали доим очилади.",
        website: "iumrah.app’ни очиш",
    },
};

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const MINI_INIT_MAX_AGE_SECONDS = 60 * 60;
const TELEGRAM_CONNECT_URL = "https://iumrah.app/telegram#telegram-connect";
const CARE_FALLBACK_PHONE = "+998508898845";
const LIVE_SUPPORT_TELEGRAM_USERNAME = "saudiclub966";
const LIVE_SUPPORT_TELEGRAM_URL = `https://t.me/${LIVE_SUPPORT_TELEGRAM_USERNAME}`;
const encoder = new TextEncoder();
function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
function escapeHtml(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}
export function normalizeLocale(value) {
    const raw = (value || '').trim().toLowerCase();
    if (!raw)
        return 'ru';
    if (raw.startsWith('en'))
        return 'en';
    if (["uzcyr", "uz-cyr", "uz_cyr", "uz-cyrl", "uz_cyrl", "uzcyrl", "uzkiril", "uz-kiril", "uz_kiril"].includes(raw))
        return 'uz_cyrl';
    if (raw.includes('cyr') || raw.includes('кирил'))
        return 'uz_cyrl';
    if (raw.startsWith('uz'))
        return 'uz';
    return 'ru';
}
function textFor(locale) {
    return I18N[locale] ?? I18N.ru;
}
function fmt(template, value) {
    return template.replace('%s', value);
}
function validBookingID(value) {
    return /^IUM-\d{4}-[A-Z2-9]{7}$/.test(value);
}
function clean(value, max = 256) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function nullableString(value) {
    const text = clean(value);
    return text || null;
}
function base64Url(bytes) {
    let binary = "";
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlToBytes(value) {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
        bytes[index] = binary.charCodeAt(index);
    return bytes;
}
function bytesToHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function encryptionKey(env) {
    const secret = clean(env.LINK_ENCRYPTION_KEY, 1024);
    if (secret.length < 24)
        throw new Error("LINK_ENCRYPTION_KEY_NOT_CONFIGURED");
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
    return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
export async function encryptSecret(env, value) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(env), encoder.encode(value));
    return { ciphertext: base64Url(new Uint8Array(encrypted)), iv: base64Url(iv) };
}
export async function decryptSecret(env, ciphertext, iv) {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlToBytes(iv) }, await encryptionKey(env), base64UrlToBytes(ciphertext));
    return new TextDecoder().decode(plain);
}
export function encodeStoredBookingCredential(kind, token) {
    return `${kind === "account" ? "a" : "b"}:${token}`;
}
export function decodeStoredBookingCredential(value) {
    const raw = value.trim();
    if (raw.startsWith("a:"))
        return { kind: "account", token: raw.slice(2) };
    if (raw.startsWith("b:"))
        return { kind: "booking", token: raw.slice(2) };
    // Backward compatibility for every booking linked before account-token support.
    return { kind: "booking", token: raw };
}
function applyStoredBookingCredential(headers, value) {
    const credential = decodeStoredBookingCredential(value);
    if (!credential.token)
        return;
    if (credential.kind === "account") {
        headers.set("authorization", `Bearer ${credential.token}`);
    }
    else {
        headers.set("x-booking-token", credential.token);
    }
}
function storedBookingCredentialHeaders(value, accept = "application/json") {
    const headers = new Headers({ accept });
    applyStoredBookingCredential(headers, value);
    return headers;
}
function telegramApi(env, method) {
    return `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
}
async function telegramCall(env, method, payload) {
    const response = await fetch(telegramApi(env, method), {
        method: "POST", redirect:"manual", signal:AbortSignal.timeout(10000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Telegram ${method} failed: HTTP ${response.status}`);
    const body = (await response.json());
    if (body?.ok !== true)
        throw new Error(`Telegram ${method} failed: HTTP ${response.status}`);
    return body.result;
}
async function sendMessage(env, chatId, text, replyMarkup) {
    return telegramCall(env, "sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        protect_content: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
}
async function editMessage(env, chatId, messageId, text, replyMarkup) {
    await telegramCall(env, "editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
}
async function sendPhotoMessage(env, chatId, photo, caption, replyMarkup) {
    return telegramCall(env, "sendPhoto", {
        chat_id: chatId,
        photo,
        caption,
        parse_mode: "HTML",
        protect_content: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
}
function telegramPhotoFilename(contentType) {
    if (contentType.includes('png'))
        return 'iumrah.png';
    if (contentType.includes('webp'))
        return 'iumrah.webp';
    return 'iumrah.jpg';
}
async function sendEmbeddedPhotoMessage(env, chatId, asset, caption, replyMarkup) {
    const media = await serveAsset(env,asset);
    if (!media.ok) return sendMessage(env,chatId,caption,replyMarkup);
    const buffer = await media.arrayBuffer();
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', new Blob([buffer], { type: asset.contentType }), telegramPhotoFilename(asset.contentType));
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
    form.append('protect_content', 'true');
    if (replyMarkup)
        form.append('reply_markup', JSON.stringify(replyMarkup));
    const response = await fetch(telegramApi(env, 'sendPhoto'), { method: 'POST', body: form, redirect:'manual',signal:AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Telegram sendPhoto failed: HTTP ${response.status}`);
    const body = (await response.json());
    if (body?.ok !== true || !body.result) {
        throw new Error(`Telegram sendPhoto failed: HTTP ${response.status}`);
    }
    return body.result;
}
async function answerCallback(env, callbackId, text) {
    await telegramCall(env, "answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text } : {}) });
}
function botUX(locale) {
    return BOT_UX[locale] ?? BOT_UX.ru;
}
function miniBaseURL(env, runtimeBaseURL) {
    return clean(runtimeBaseURL || env.PUBLIC_BASE_URL, 512).replace(/\/+$/, "");
}
async function ensureBotUXSchema(env) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS telegram_mini_preferences (
      telegram_user_id INTEGER PRIMARY KEY,
      language TEXT NOT NULL DEFAULT 'ru',
      pinned_message_id INTEGER,
      updated_at TEXT NOT NULL
    )`).run();
}
async function getUserPreference(env, telegramUserID) {
    await ensureBotUXSchema(env);
    return env.DB.prepare(`SELECT telegram_user_id, language, pinned_message_id, updated_at
     FROM telegram_mini_preferences WHERE telegram_user_id=? LIMIT 1`).bind(telegramUserID).first();
}
async function saveUserLocale(env, telegramUserID, locale) {
    await ensureBotUXSchema(env);
    await env.DB.prepare(`INSERT INTO telegram_mini_preferences(telegram_user_id, language, pinned_message_id, updated_at)
     VALUES (?, ?, NULL, ?)
     ON CONFLICT(telegram_user_id) DO UPDATE SET language=excluded.language, updated_at=excluded.updated_at`).bind(telegramUserID, locale, new Date().toISOString()).run();
    await env.DB.prepare(`UPDATE telegram_mini_credentials SET language=?, updated_at=? WHERE telegram_user_id=?`).bind(locale, new Date().toISOString(), telegramUserID).run();
}
async function savePinnedMessageID(env, telegramUserID, locale, messageID) {
    await ensureBotUXSchema(env);
    await env.DB.prepare(`INSERT INTO telegram_mini_preferences(telegram_user_id, language, pinned_message_id, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(telegram_user_id) DO UPDATE SET language=excluded.language, pinned_message_id=excluded.pinned_message_id, updated_at=excluded.updated_at`).bind(telegramUserID, locale, messageID, new Date().toISOString()).run();
}
function languageKeyboard(current) {
    const label = (locale, text) => `${current === locale ? "✓ " : ""}${text}`;
    return {
        inline_keyboard: [
            [
                { text: label("ru", "Русский"), callback_data: "lang:ru" },
                { text: label("en", "English"), callback_data: "lang:en" },
            ],
            [
                { text: label("uz", "O‘zbekcha"), callback_data: "lang:uz" },
                { text: label("uz_cyrl", "Ўзбекча"), callback_data: "lang:uz_cyrl" },
            ],
        ],
    };
}
function pinnedKeyboard(env, locale, runtimeBaseURL) {
    const copy = botUX(locale);
    const base = miniBaseURL(env, runtimeBaseURL);
    const rows = [];
    if (base)
        rows.push([{ text: copy.openMini, web_app: { url: `${base}/telegram/mini` } }]);
    rows.push([
        { text: copy.status, callback_data: "home:status" },
        { text: copy.support, callback_data: "home:support" },
    ]);
    rows.push([{ text: copy.liveSupport, callback_data: "home:live_support" }]);
    return { inline_keyboard: rows };
}
function persistentReplyKeyboard(env, locale, runtimeBaseURL) {
    const copy = botUX(locale);
    const base = miniBaseURL(env, runtimeBaseURL);
    const rows = [];
    if (base)
        rows.push([{ text: copy.openMini, web_app: { url: `${base}/telegram/mini` } }]);
    rows.push([{ text: copy.status }, { text: copy.support }]);
    rows.push([{ text: copy.liveSupport }]);
    return { keyboard: rows, resize_keyboard: true, is_persistent: true, input_field_placeholder: "iumrah" };
}
export async function setMiniAppMenuButton(env, chatID, locale, runtimeBaseURL) {
    const base = miniBaseURL(env, runtimeBaseURL);
    if (!base)
        return;
    const menuButton = { type: "web_app", text: botUX(locale).openMini, web_app: { url: `${base}/telegram/mini` } };
    try {
        // Per-chat Web App button.
        await telegramCall(env, "setChatMenuButton", {
            chat_id: chatID,
            menu_button: menuButton,
        });
        // Also keep the bot-wide default Web App menu configured. Telegram clients use
        // this default when rendering the bot's Open/Menu entry outside an active chat.
        await telegramCall(env, "setChatMenuButton", { menu_button: menuButton });
    }
    catch (error) {
        console.error("setChatMenuButton failed", chatID, "REQUEST_FAILED");
    }
}
async function sendLanguageSelector(env, chatID, current) {
    const copy = botUX(current ?? "ru");
    await sendMessage(env, chatID, `<b>${escapeHtml(copy.chooseLanguage)}</b>`, languageKeyboard(current));
}
async function ensurePinnedMiniAppMessage(env, chatID, telegramUserID, locale, runtimeBaseURL) {
    const copy = botUX(locale);
    const text = `<b>${escapeHtml(copy.pinnedTitle)}</b>\n\n${escapeHtml(copy.pinnedBody)}`;
    const pref = await getUserPreference(env, telegramUserID);
    const existing = Number(pref?.pinned_message_id || 0);
    if (existing > 0) {
        try {
            await editMessage(env, chatID, existing, text, pinnedKeyboard(env, locale, runtimeBaseURL));
            return;
        }
        catch (error) {
            console.error("edit pinned welcome failed", chatID, "REQUEST_FAILED");
        }
    }
    const message = await sendMessage(env, chatID, text, pinnedKeyboard(env, locale, runtimeBaseURL));
    await savePinnedMessageID(env, telegramUserID, locale, message.message_id);
    try {
        await telegramCall(env, "pinChatMessage", { chat_id: chatID, message_id: message.message_id, disable_notification: true });
    }
    catch (error) {
        console.error("pinChatMessage failed", chatID, "REQUEST_FAILED");
    }
}
async function sendBotHome(env, chatID, telegramUserID, locale, runtimeBaseURL, includeStatus = true) {
    const copy = botUX(locale);
    await setMiniAppMenuButton(env, chatID, locale, runtimeBaseURL);
    await ensurePinnedMiniAppMessage(env, chatID, telegramUserID, locale, runtimeBaseURL);
    await sendMessage(env, chatID, `<b>${escapeHtml(copy.welcomeTitle)}</b>\n\n${escapeHtml(copy.welcomeBody)}`, persistentReplyKeyboard(env, locale, runtimeBaseURL));
    if (includeStatus)
        await showBookings(env, chatID, telegramUserID, runtimeBaseURL, locale);
}
async function sendSupportHome(env, chatID, locale, runtimeBaseURL) {
    const copy = botUX(locale);
    const base = miniBaseURL(env, runtimeBaseURL);
    const rows = [];
    if (base)
        rows.push([{ text: copy.support, web_app: { url: `${base}/telegram/mini?tab=care` } }]);
    rows.push([{ text: copy.liveSupport, callback_data: "home:live_support" }]);
    rows.push([{ text: copy.website, url: "https://iumrah.app" }]);
    await sendEmbeddedPhotoMessage(env, chatID, SUPPORT_ASSETS.care, `<b>${escapeHtml(copy.supportTitle)}</b>

${escapeHtml(copy.supportBody)}`, { inline_keyboard: rows });
}
async function sendLiveSupportHome(env, chatID, locale, runtimeBaseURL) {
    const copy = botUX(locale);
    const callAsset = SUPPORT_ASSETS.call;
    const writeAsset = SUPPORT_ASSETS.telegram;
    await sendEmbeddedPhotoMessage(env, chatID, callAsset, `<b>${escapeHtml(copy.liveSupportCallTitle)}</b>

${escapeHtml(copy.liveSupportCallBody)}`, { inline_keyboard: [[{ text: copy.liveSupportCallAction, callback_data: 'live_support:call' }]] });
    await sendEmbeddedPhotoMessage(env, chatID, writeAsset, `<b>${escapeHtml(copy.liveSupportWriteTitle)}</b>

${escapeHtml(copy.liveSupportWriteBody)}`, { inline_keyboard: [[{ text: copy.liveSupportWriteAction, url: LIVE_SUPPORT_TELEGRAM_URL }]] });
}
function parseTripPayload(value) {
    if (!value || typeof value !== "object")
        return null;
    const root = value;
    const tripValue = root.trip;
    if (!tripValue || typeof tripValue !== "object")
        return null;
    const trip = tripValue;
    const bookingID = clean(trip.bookingID);
    const status = clean(trip.status);
    if (!bookingID || !status)
        return null;
    const number = typeof trip.bookingNumber === "number" && Number.isFinite(trip.bookingNumber) ? trip.bookingNumber : null;
    const parsed = {
        bookingID,
        bookingNumber: number,
        bookingDisplayNumber: nullableString(trip.bookingDisplayNumber),
        pilgrimID: nullableString(trip.pilgrimID),
        status,
        paymentStatus: nullableString(trip.paymentStatus),
        confirmationNumber: nullableString(trip.confirmationNumber),
        startDate: nullableString(trip.startDate),
        endDate: nullableString(trip.endDate),
        createdAt: nullableString(trip.createdAt),
        updatedAt: nullableString(trip.updatedAt),
        completedAt: nullableString(trip.completedAt),
        availabilityStartedAt: nullableString(trip.availabilityStartedAt),
        availabilityDeadlineAt: nullableString(trip.availabilityDeadlineAt),
        priceLockStartedAt: nullableString(trip.priceLockStartedAt),
        priceLockExpiresAt: nullableString(trip.priceLockExpiresAt),
        paymentReceivedAt: nullableString(trip.paymentReceivedAt),
        paymentConfirmationDeadlineAt: nullableString(trip.paymentConfirmationDeadlineAt),
        documentsStartedAt: nullableString(trip.documentsStartedAt),
        documentsDeadlineAt: nullableString(trip.documentsDeadlineAt),
    };
    const history = Array.isArray(root.statusHistory)
        ? root.statusHistory.flatMap((item) => {
            if (!item || typeof item !== "object")
                return [];
            const row = item;
            const newStatus = clean(row.newStatus);
            const createdAt = clean(row.createdAt);
            return newStatus && createdAt ? [{ oldStatus: nullableString(row.oldStatus), newStatus, createdAt }] : [];
        })
        : [];
    return { ok: root.ok === true, trip: parsed, statusHistory: history, assignment:root.assignment };
}
async function fetchTrip(env, bookingID, bookingToken) {
    const headers = storedBookingCredentialHeaders(bookingToken);
    // Canonical operational status comes directly from the iumrah server.
    try {
        const response = await env.dispatch(`${serverOrigin(env)}/api/catalog/hotels/client/trips/${encodeURIComponent(bookingID)}`, {
            method: "GET", headers, redirect: "manual",
        });
        if (response.ok) {
            const payload = parseTripPayload(await response.json());
            if (payload?.ok && payload.trip.bookingID === bookingID)
                return payload;
        }
        if (response.status === 404)
            throw new Error("BOOKING_NOT_FOUND");
        if (response.status === 401 || response.status === 403)
            throw new Error("BOOKING_AUTH_INVALID");
        console.error("direct operational trip lookup failed", bookingID, response.status);
    }
    catch (error) {
        if (error instanceof Error && (error.message === "BOOKING_NOT_FOUND" || error.message === "BOOKING_AUTH_INVALID"))
            throw error;
        console.error("direct operational trip request failed", bookingID, "REQUEST_FAILED");
    }
    throw new Error("BOOKING_REFRESH_FAILED");
}
function dateMs(value) {
    if (!value)
        return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
}
function transitionDate(history, status) {
    const target = status.trim().toLowerCase();
    const matches = (history ?? []).filter((item) => item.newStatus.trim().toLowerCase() === target);
    return matches.length ? matches[matches.length - 1].createdAt : null;
}
function deadline(explicit, start, seconds) {
    const explicitMs = dateMs(explicit);
    if (explicitMs !== null)
        return new Date(explicitMs).toISOString();
    const startMs = dateMs(start);
    return startMs === null ? null : new Date(startMs + seconds * 1000).toISOString();
}
function lifecycle(payload) {
    const trip = payload.trip;
    const status = trip.status.trim().toUpperCase();
    if (status === "NEW" || status === "AVAILABILITY_CHECK") {
        return {
            kind: "availability",
            deadlineAt: deadline(trip.availabilityDeadlineAt, trip.availabilityStartedAt || trip.createdAt, 6 * 60 * 60),
            title: "До максимального срока проверки",
        };
    }
    if (status === "PAYMENT_PENDING") {
        if (trip.paymentReceivedAt) {
            return {
                kind: "payment_confirmation",
                deadlineAt: deadline(trip.paymentConfirmationDeadlineAt, trip.paymentReceivedAt, 10 * 60),
                title: "Проверка оплаты",
            };
        }
        return {
            kind: "price_lock",
            deadlineAt: deadline(trip.priceLockExpiresAt, trip.priceLockStartedAt || transitionDate(payload.statusHistory, "payment_pending") || trip.updatedAt, 30 * 60),
            title: "Цена зафиксирована ещё",
        };
    }
    if (status === "PAID" || status === "BOOKING_CONFIRMED") {
        return {
            kind: "documents",
            deadlineAt: deadline(trip.documentsDeadlineAt, trip.documentsStartedAt || transitionDate(payload.statusHistory, "booking_confirmed") || trip.updatedAt, 24 * 60 * 60),
            title: "Подготовка документов",
        };
    }
    return { kind: "none", deadlineAt: null, title: "" };
}
function countdown(deadlineAt, now = Date.now()) {
    const end = dateMs(deadlineAt);
    if (end === null)
        return null;
    const total = Math.max(0, Math.floor((end - now) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return [hours, minutes, seconds].map((item) => String(item).padStart(2, "0")).join(":");
}
function bookingReference(trip) {
    if (trip.bookingDisplayNumber)
        return trip.bookingDisplayNumber;
    if (typeof trip.bookingNumber === "number")
        return `#${String(Math.trunc(trip.bookingNumber)).padStart(4, "0")}`;
    return trip.bookingID;
}
function statusImageKey(status) {
    switch (status.trim().toUpperCase()) {
        case "NEW":
            return "new";
        case "AVAILABILITY_CHECK":
            return "checking";
        case "PAYMENT_PENDING":
            return "payment_pending";
        case "PAID":
        case "BOOKING_CONFIRMED":
            return "paid";
        case "DOCUMENTS_READY":
        case "READY_TO_TRAVEL":
            return "docs";
        case "IN_TRIP":
            return "in_trip";
        case "COMPLETED":
            return "completed";
        default:
            return "new";
    }
}
function statusCopy(locale, status, paymentStatus) {
    const copy = textFor(locale).statuses;
    switch (status.trim().toUpperCase()) {
        case "NEW":
            return copy.newBooking;
        case "AVAILABILITY_CHECK":
            return copy.checking;
        case "PAYMENT_PENDING":
            if (paymentStatus && /received|review|checking|submitted/i.test(paymentStatus))
                return copy.paymentReceived;
            return copy.paymentWaiting;
        case "PAID":
        case "BOOKING_CONFIRMED":
            return copy.confirmed;
        case "DOCUMENTS_READY":
        case "READY_TO_TRAVEL":
            return copy.ready;
        case "IN_TRIP":
            return copy.inTrip;
        case "COMPLETED":
            return copy.completed;
        default:
            return { title: copy.fallbackTitle, body: `${copy.fallbackTitle}: ${status}` };
    }
}
function lifecycleTitle(locale, kind) {
    const labels = textFor(locale).lifecycle;
    switch (kind) {
        case "availability": return labels.availability;
        case "price_lock": return labels.price_lock;
        case "payment_confirmation": return labels.payment_confirmation;
        case "documents": return labels.documents;
        default: return "";
    }
}
function bookingRecoveryKeyboard(bookingID, locale) {
    const actions = textFor(locale).actions;
    return {
        inline_keyboard: [
            [{ text: actions.connectTelegram, url: TELEGRAM_CONNECT_URL }],
            [{ text: actions.callCare, callback_data: `care_call:${bookingID}` }],
            [{ text: botUX(locale).liveSupport, callback_data: "home:live_support" }],
        ],
    };
}
function bookingKeyboard(env, bookingID, locale, runtimeBaseURL) {
    const statusStrings = textFor(locale).actions;
    const ux = botUX(locale);
    const rows = [];
    const configuredBase = miniBaseURL(env, runtimeBaseURL);
    if (configuredBase) {
        rows.push([{ text: ux.openMini, web_app: { url: `${configuredBase}/telegram/mini?booking=${encodeURIComponent(bookingID)}` } }]);
        rows.push([
            { text: statusStrings.refresh, callback_data: `refresh:${bookingID}` },
            { text: ux.support, web_app: { url: `${configuredBase}/telegram/mini?booking=${encodeURIComponent(bookingID)}&tab=care` } },
        ]);
    }
    else {
        rows.push([{ text: statusStrings.refresh, callback_data: `refresh:${bookingID}` }]);
    }
    rows.push([{ text: ux.liveSupport, callback_data: "home:live_support" }]);
    rows.push([{ text: ux.website, url: "https://iumrah.app/account" }]);
    return { inline_keyboard: rows };
}
function bookingMessage(env, payload, locale) {
    const trip = payload.trip;
    const strings = textFor(locale);
    const phase = lifecycle(payload);
    const left = countdown(phase.deadlineAt);
    const copy = statusCopy(locale, trip.status, trip.paymentStatus);
    const lines = [
        `<b>${escapeHtml(copy.title)}</b>`,
        '',
        `${escapeHtml(strings.generic.booking)}: <code>${escapeHtml(bookingReference(trip))}</code>`,
        trip.startDate && trip.endDate ? `${escapeHtml(strings.generic.dates)}: ${escapeHtml(trip.startDate)} — ${escapeHtml(trip.endDate)}` : '',
        trip.confirmationNumber ? `${escapeHtml(strings.generic.confirmation)}: <code>${escapeHtml(trip.confirmationNumber)}</code>` : '',
        '',
        escapeHtml(copy.body),
    ].filter(Boolean);
    if (phase.kind !== 'none' && left) {
        const expired = dateMs(phase.deadlineAt) !== null && dateMs(phase.deadlineAt) <= Date.now();
        lines.push('', `<b>${escapeHtml(expired ? strings.generic.stageExpired : lifecycleTitle(locale, phase.kind))}</b>`, `<code>${left}</code>`);
    }
    lines.push('', `<i>${escapeHtml(strings.generic.synced)}</i>`);
    return lines.join('\n');
}
async function serveAsset(env,asset) {
    if(!asset || !env.assets) return new Response("Not found",{status:404});
    const res=await env.assets.fetch(new Request("https://assets.local"+asset.path));
    if(!res.ok) return new Response("Not found",{status:404});
    return new Response(res.body,{headers:{"content-type":asset.contentType,"cache-control":"public, max-age=86400","x-content-type-options":"nosniff"}});
}
async function sendBookingRecoveryMessage(env, chatId, bookingID, locale, runtimeBaseURL) {
    const strings = textFor(locale);
    const caption = `<b>${escapeHtml(strings.generic.updateFailedTitle)}</b>

<code>${escapeHtml(bookingID)}</code>
${escapeHtml(strings.generic.reconnectPrompt)}`;
    await sendEmbeddedPhotoMessage(env, chatId, SUPPORT_ASSETS.sync_error, caption, bookingRecoveryKeyboard(bookingID, locale));
}
async function sendStatusCard(env, chatId, payload, locale, runtimeBaseURL) {
    const caption = bookingMessage(env, payload, locale);
    const asset = STATUS_ASSETS[statusImageKey(payload.trip.status)];
    await sendEmbeddedPhotoMessage(env, chatId, asset, caption, bookingKeyboard(env, payload.trip.bookingID, locale, runtimeBaseURL));
}
async function linkedRowsForUser(env, userID) {
    const result = await env.DB.prepare(`SELECT telegram_user_id, chat_id, booking_id, booking_token_ciphertext, booking_token_iv, language,
            last_status, last_payment_status, last_confirmation_number, notifications_enabled
     FROM telegram_mini_active WHERE telegram_user_id=? ORDER BY updated_at DESC LIMIT 10`).bind(userID).all();
    return result.results ?? [];
}
function isDetachedBookingError(error) {
    return error instanceof Error && (error.message === 'BOOKING_NOT_FOUND' || error.message === 'BOOKING_AUTH_INVALID');
}
async function deleteTelegramBookingBinding(env, userID, bookingID) {
    await env.DB.prepare('DELETE FROM telegram_mini_credentials WHERE telegram_user_id=? AND booking_id=?').bind(userID, bookingID).run();
}
async function showBookings(env, chatId, userID, runtimeBaseURL, preferredLocale) {
    const rows = await linkedRowsForUser(env, userID);
    const locale = preferredLocale ?? normalizeLocale(rows[0]?.language || 'ru');
    const strings = textFor(locale);
    if (!rows.length) {
        await sendEmbeddedPhotoMessage(env, chatId, SUPPORT_ASSETS.booking_not_linked, `<b>${escapeHtml(strings.generic.bookingNotLinkedTitle)}</b>

${escapeHtml(strings.generic.bookingNotLinkedBody)}`, persistentReplyKeyboard(env, locale, runtimeBaseURL));
        return;
    }
    let successCount = 0;
    let firstFailure = null;
    let firstDetached = null;
    for (const row of rows.slice(0, 10)) {
        const rowLocale = preferredLocale ?? normalizeLocale(row.language || locale);
        try {
            const token = await decryptSecret(env, row.booking_token_ciphertext, row.booking_token_iv);
            const payload = await fetchTrip(env, row.booking_id, token);
            await sendStatusCard(env, chatId, payload, rowLocale, runtimeBaseURL);
            successCount += 1;
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            console.error('booking sync failed', row.booking_id, reason);
            if (isDetachedBookingError(error)) {
                if (!firstDetached)
                    firstDetached = { bookingID: row.booking_id, locale: rowLocale };
                await deleteTelegramBookingBinding(env, userID, row.booking_id);
                console.log('removed stale telegram booking binding', row.booking_id, reason);
                continue;
            }
            if (!firstFailure)
                firstFailure = { bookingID: row.booking_id, locale: rowLocale };
        }
    }
    // Never mix a valid live status card with stale/error cards from old bindings.
    if (successCount > 0)
        return;
    const failure = firstFailure ?? firstDetached;
    if (failure) {
        await sendBookingRecoveryMessage(env, chatId, failure.bookingID, failure.locale, runtimeBaseURL);
        return;
    }
    await sendEmbeddedPhotoMessage(env, chatId, SUPPORT_ASSETS.booking_not_linked, `<b>${escapeHtml(strings.generic.bookingNotLinkedTitle)}</b>

${escapeHtml(strings.generic.bookingNotLinkedBody)}`, persistentReplyKeyboard(env, locale, runtimeBaseURL));
}
async function refreshBooking(env, callback, bookingID, runtimeBaseURL) {
    const message = callback.message;
    if (!message)
        return;
    const row = await env.DB.prepare(`SELECT telegram_user_id, chat_id, booking_id, booking_token_ciphertext, booking_token_iv, language,
            last_status, last_payment_status, last_confirmation_number, notifications_enabled
     FROM telegram_mini_active WHERE telegram_user_id=? AND booking_id=? LIMIT 1`).bind(callback.from.id, bookingID).first();
    const locale = normalizeLocale(row?.language || callback.from.language_code || 'ru');
    const strings = textFor(locale);
    if (!row) {
        await answerCallback(env, callback.id, strings.generic.callbackNotLinked);
        return;
    }
    try {
        const token = await decryptSecret(env, row.booking_token_ciphertext, row.booking_token_iv);
        const payload = await fetchTrip(env, bookingID, token);
        await sendStatusCard(env, message.chat.id, payload, locale, runtimeBaseURL);
        await env.DB.prepare(`UPDATE telegram_mini_credentials SET last_status=?,last_payment_status=?,last_confirmation_number=?,updated_at=?
       WHERE telegram_user_id=? AND booking_id=?`).bind(payload.trip.status, payload.trip.paymentStatus ?? null, payload.trip.confirmationNumber ?? null, new Date().toISOString(), callback.from.id, bookingID).run();
        await answerCallback(env, callback.id, strings.generic.callbackUpdated);
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error("booking refresh failed", bookingID, reason);
        if (isDetachedBookingError(error)) {
            await deleteTelegramBookingBinding(env, callback.from.id, bookingID);
            console.log('removed stale telegram booking binding after refresh', bookingID, reason);
        }
        await answerCallback(env, callback.id, strings.generic.callbackRefreshFailed);
        await sendBookingRecoveryMessage(env, message.chat.id, bookingID, locale, runtimeBaseURL);
    }
}
async function handleCallback(env, callback, runtimeBaseURL) {
    const data = clean(callback.data, 128);
    const message = callback.message;
    const chatID = message?.chat.id;
    if (data.startsWith("lang:")) {
        if (!chatID)
            return;
        const raw = data.slice("lang:".length);
        const locale = ["ru", "en", "uz", "uz_cyrl"].includes(raw) ? raw : "ru";
        await saveUserLocale(env, callback.from.id, locale);
        await answerCallback(env, callback.id, botUX(locale).languageSaved);
        try {
            await editMessage(env, chatID, message.message_id, `<b>${escapeHtml(botUX(locale).languageSaved)}</b>`, languageKeyboard(locale));
        }
        catch { /* message may be too old or unchanged */ }
        await sendBotHome(env, chatID, callback.from.id, locale, runtimeBaseURL, true);
        return;
    }
    if (data === "home:status") {
        if (!chatID)
            return;
        const pref = await getUserPreference(env, callback.from.id);
        const locale = normalizeLocale(pref?.language || callback.from.language_code || "ru");
        await answerCallback(env, callback.id);
        await showBookings(env, chatID, callback.from.id, runtimeBaseURL, locale);
        return;
    }
    if (data === "home:support") {
        if (!chatID)
            return;
        const pref = await getUserPreference(env, callback.from.id);
        const locale = normalizeLocale(pref?.language || callback.from.language_code || "ru");
        await answerCallback(env, callback.id);
        await sendSupportHome(env, chatID, locale, runtimeBaseURL);
        return;
    }
    if (data === "home:live_support") {
        if (!chatID)
            return;
        const pref = await getUserPreference(env, callback.from.id);
        const locale = normalizeLocale(pref?.language || callback.from.language_code || "ru");
        await answerCallback(env, callback.id);
        await sendLiveSupportHome(env, chatID, locale, runtimeBaseURL);
        return;
    }
    if (data === "live_support:call") {
        if (!chatID)
            return;
        const pref = await getUserPreference(env, callback.from.id);
        const locale = normalizeLocale(pref?.language || callback.from.language_code || "ru");
        try {
            await sendCareContactCard(env, chatID);
            await answerCallback(env, callback.id);
        }
        catch (error) {
            console.error("live support call callback failed", "REQUEST_FAILED");
            await answerCallback(env, callback.id, textFor(locale).generic.callbackRefreshFailed);
        }
        return;
    }
    if (data.startsWith("care_call:")) {
        if (!chatID)
            return;
        const bookingID = data.slice("care_call:".length);
        const row = await env.DB.prepare(`SELECT telegram_user_id, chat_id, booking_id, booking_token_ciphertext, booking_token_iv, language,
              last_status, last_payment_status, last_confirmation_number, notifications_enabled
       FROM telegram_mini_active WHERE telegram_user_id=? AND booking_id=? LIMIT 1`).bind(callback.from.id, bookingID).first();
        try {
            await sendCareContactCard(env, chatID, row ?? undefined);
            await answerCallback(env, callback.id);
        }
        catch (error) {
            console.error("care contact callback failed", bookingID, "REQUEST_FAILED");
            await answerCallback(env, callback.id, textFor(normalizeLocale(row?.language || callback.from.language_code || "ru")).generic.callbackRefreshFailed);
        }
        return;
    }
    if (data.startsWith("refresh:")) {
        await refreshBooking(env, callback, data.slice("refresh:".length), runtimeBaseURL);
        return;
    }
    await answerCallback(env, callback.id);
}
async function handleMessage(env, message, runtimeBaseURL) {
    const text = message.text?.trim();
    if (!text || !message.from)
        return;
    const pref = await getUserPreference(env, message.from.id);
    const savedLocale = normalizeLocale(pref?.language || message.from.language_code || 'ru');
    const strings = textFor(savedLocale);
    const ux = botUX(savedLocale);
    const start = text.match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]+))?$/i);
    if (start) {
        const parameter = start[1] ?? '';
        if (parameter) {
            await sendMessage(env, message.chat.id, escapeHtml(strings.generic.linkExpiredBody));
            return;
        }
        await setMiniAppMenuButton(env,message.chat.id,savedLocale,runtimeBaseURL);
        await sendLanguageSelector(env, message.chat.id, pref ? savedLocale : undefined);
        return;
    }
    if (/^\/language(?:@\w+)?$/i.test(text)) {
        await sendLanguageSelector(env, message.chat.id, savedLocale);
        return;
    }
    if (/^\/(booking|status)(?:@\w+)?$/i.test(text) || text === ux.status || Object.values(BOT_UX).some(v => v.status === text)) {
        await showBookings(env, message.chat.id, message.from.id, runtimeBaseURL, savedLocale);
        return;
    }
    if (text === ux.support || Object.values(BOT_UX).some(v => v.support === text)) {
        await sendSupportHome(env, message.chat.id, savedLocale, runtimeBaseURL);
        return;
    }
    if (text === ux.liveSupport || Object.values(BOT_UX).some(v => v.liveSupport === text)) {
        await sendLiveSupportHome(env, message.chat.id, savedLocale, runtimeBaseURL);
        return;
    }
    if (/^\/help(?:@\w+)?$/i.test(text)) {
        await sendMessage(env, message.chat.id, `<b>${escapeHtml(strings.generic.helpTitle)}</b>\n\n${escapeHtml(strings.generic.helpBody)}\n/language — Language`, persistentReplyKeyboard(env, savedLocale, runtimeBaseURL));
        return;
    }
    await sendBotHome(env, message.chat.id, message.from.id, savedLocale, runtimeBaseURL, false);
}
export async function handleUpdate(env, update, runtimeBaseURL) {
    if (update.callback_query)
        return handleCallback(env, update.callback_query, runtimeBaseURL);
    if (update.message)
        return handleMessage(env, update.message, runtimeBaseURL);
}
async function hmac(keyBytes, value) {
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
async function validateTelegramInitData(env, initData) {
    if (!initData || initData.length > 8192)
        return null;
    const params = new URLSearchParams(initData);
    if (new Set([...params.keys()]).size !== [...params.keys()].length)
        return null;
    const expectedHash = params.get("hash")?.toLowerCase() ?? "";
    if (!/^[0-9a-f]{64}$/.test(expectedHash))
        return null;
    const entries = Array.from(params.entries()).filter(([key]) => key !== "hash").sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([key, value]) => `${key}=${value}`).join("\n");
    const secretKey = await hmac(encoder.encode("WebAppData"), env.TELEGRAM_BOT_TOKEN);
    const actualHash = bytesToHex(await hmac(secretKey, dataCheckString));
    let mismatch = 0;
    for (let i = 0; i < 64; i++)
        mismatch |= actualHash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
    if (mismatch)
        return null;
    const authDate = Number(params.get("auth_date") ?? 0);
    if (!Number.isFinite(authDate) || Math.abs(Date.now() / 1000 - authDate) > MINI_INIT_MAX_AGE_SECONDS)
        return null;
    const rawUser = params.get("user");
    if (!rawUser)
        return null;
    try {
        const user = JSON.parse(rawUser);
        return typeof user.id === "number" && Number.isSafeInteger(user.id) && user.id > 0 ? user : null;
    }
    catch {
        return null;
    }
}
function miniHTML() {
    return bookingMiniV7HTML();
}
function serverOrigin(env) {
    return "https://iumrah-backend.helloiumrah.workers.dev";
}
async function fetchServerJSON(env, path, bookingToken, init) {
    const headers = new Headers(init?.headers || {});
    headers.set("accept", "application/json");
    if (bookingToken)
        applyStoredBookingCredential(headers, bookingToken);
    if (init?.body && !headers.has("content-type"))
        headers.set("content-type", "application/json");
    try {
        const response = await env.dispatch(`${serverOrigin(env)}${path}`, { ...init, headers, redirect: "manual" });
        let body = null;
        try {
            body = await response.json();
        }
        catch {
            body = null;
        }
        return { status: response.status, body };
    }
    catch (error) {
        console.error("iumrah direct server request failed", path, "REQUEST_FAILED");
        return { status: 502, body: { error: "IUMRAH_SERVER_UNREACHABLE" } };
    }
}
async function miniBookingBundle(env, row) {
    try {
        const token = await decryptSecret(env, row.booking_token_ciphertext, row.booking_token_iv);
        const primary = await fetchServerJSON(env, `/api/catalog/hotels/client/trips/${encodeURIComponent(row.booking_id)}`, token);
        if (primary.status !== 200 || !primary.body?.booking)
            return null;
        const payload = await fetchTrip(env, row.booking_id, token);
        const optional = async (path) => {
            try {
                const result = await fetchServerJSON(env, path, token);
                return result.status === 200 ? result.body : null;
            }
            catch {
                return null;
            }
        };
        const makkahHotelID = clean(primary.body.booking?.hotelSelection?.hotelId, 128);
        const madinahHotelID = clean(primary.body.booking?.madinahHotelSelection?.hotelId, 128);
        const [checkout, itinerary, security, makkahHotel, madinahHotel] = await Promise.all([
            optional(`/api/catalog/hotels/client/trips/${encodeURIComponent(row.booking_id)}/checkout`),
            optional(`/api/catalog/hotels/client/trips/${encodeURIComponent(row.booking_id)}/itinerary`),
            optional(`/api/catalog/hotels/client/trips/${encodeURIComponent(row.booking_id)}/security`),
            makkahHotelID ? optional(`/api/catalog/hotels/${encodeURIComponent(makkahHotelID)}`) : Promise.resolve(null),
            madinahHotelID ? optional(`/api/catalog/hotels/${encodeURIComponent(madinahHotelID)}`) : Promise.resolve(null),
        ]);
        return {
            reference: bookingReference(payload.trip),
            booking: {...primary.body.booking,id:row.booking_id,bookingDisplayNumber:payload.trip.bookingDisplayNumber},
            trip: payload.trip,
            lifecycle: lifecycle(payload),
            guide: payload.assignment?.guide ?? null,
            checkout: checkout && checkout.ok !== false ? checkout : null,
            itinerary: Array.isArray(itinerary?.items) ? itinerary.items : [],
            security: security?.confirmation ?? null,
            hotelDetails: {
                makkah: makkahHotel && makkahHotel.ok !== false ? makkahHotel : null,
                madinah: madinahHotel && madinahHotel.ok !== false ? madinahHotel : null,
            },
        };
    }
    catch {
        return null;
    }
}
async function miniBootstrap(request, env) {
    let body;
    try {
        body = (await request.json());
    }
    catch {
        return json({ error: "INVALID_REQUEST" }, 400);
    }
    const user = await validateTelegramInitData(env, clean(body.initData, 8192));
    if (!user)
        return json({ error: "TELEGRAM_AUTH_FAILED" }, 401);
    const rows = await linkedRowsForUser(env, user.id);
    if (!rows.length)
        return json({ error: "BOOKING_NOT_LINKED" }, 404);
    const locale = normalizeLocale(rows[0]?.language || user.language_code || "ru");
    const bundles = [];
    for (const row of rows.slice(0, 10)) {
        const bundle = await miniBookingBundle(env, row);
        if (bundle)
            bundles.push(bundle);
    }
    if (!bundles.length)
        return json({ error: "BOOKING_REFRESH_FAILED" }, 502);
    let careProfile = null;
    try {
        const token = await decryptSecret(env, rows[0].booking_token_ciphertext, rows[0].booking_token_iv);
        const team = await fetchServerJSON(env, "/api/catalog/hotels/team", token);
        const members = Array.isArray(team.body?.members) ? team.body.members : [];
        careProfile = members.find((member) => member?.isOwner === true) || members[0] || null;
    }
    catch {
        careProfile = null;
    }
    return json({ ok: true, locale, bookings: bundles, careProfile });
}
async function miniHotelContext(request, env) {
    let body;
    try {
        body = (await request.json());
    }
    catch {
        return json({ error: "INVALID_REQUEST" }, 400);
    }
    const user = await validateTelegramInitData(env, clean(body.initData, 8192));
    if (!user)
        return json({ error: "TELEGRAM_AUTH_FAILED" }, 401);
    const bookingID = clean(body.bookingId, 64);
    if (!validBookingID(bookingID))
        return json({ error: "INVALID_BOOKING" }, 400);
    const row = await env.DB.prepare(`SELECT telegram_user_id, chat_id, booking_id, booking_token_ciphertext, booking_token_iv, language,
            last_status, last_payment_status, last_confirmation_number, notifications_enabled
     FROM telegram_mini_active WHERE telegram_user_id=? AND booking_id=? LIMIT 1`).bind(user.id, bookingID).first();
    if (!row)
        return json({ error: "BOOKING_NOT_LINKED" }, 404);
    const token = await decryptSecret(env, row.booking_token_ciphertext, row.booking_token_iv);
    try {
        await fetchTrip(env, bookingID, token);
    }
    catch {
        return json({ error: "BOOKING_ACCESS_UNAVAILABLE" }, 403);
    }
    return { user, row, token, body };
}
async function miniHotels(request, env) {
    const context = await miniHotelContext(request, env);
    if (context instanceof Response)
        return context;
    const role = clean(context.body.role, 16).toLowerCase();
    if (role !== "makkah" && role !== "madinah")
        return json({ error: "INVALID_HOTEL_ROLE" }, 400);
    const city = role === "madinah" ? "Madinah" : "Makkah";
    const result = await fetchServerJSON(env, `/api/catalog/hotels?city=${encodeURIComponent(city)}`, context.token);
    if (result.status < 200 || result.status >= 300)
        return json({ error: result.body?.error || `HOTEL_LIST_${result.status}` }, result.status || 502);
    return json({ ok: true, role, hotels: Array.isArray(result.body?.hotels) ? result.body.hotels : [] });
}
async function miniHotel(request, env) {
    const context = await miniHotelContext(request, env);
    if (context instanceof Response)
        return context;
    const hotelID = clean(context.body.hotelId, 128);
    if (!hotelID)
        return json({ error: "INVALID_HOTEL" }, 400);
    const [detail, categories] = await Promise.all([
        fetchServerJSON(env, `/api/catalog/hotels/${encodeURIComponent(hotelID)}`, context.token),
        fetchServerJSON(env, `/api/package/hotel/${encodeURIComponent(hotelID)}/room-categories`, context.token),
    ]);
    if (detail.status < 200 || detail.status >= 300 || !detail.body?.hotel)
        return json({ error: detail.body?.error || `HOTEL_DETAIL_${detail.status}` }, detail.status || 502);
    return json({ ok: true, hotel: detail.body.hotel, categories: Array.isArray(categories.body?.categories) ? categories.body.categories : [] });
}
async function miniAction(request, env) {
    let body;
    try {
        body = (await request.json());
    }
    catch {
        return json({ error: "INVALID_REQUEST" }, 400);
    }
    const user = await validateTelegramInitData(env, clean(body.initData, 8192));
    if (!user)
        return json({ error: "TELEGRAM_AUTH_FAILED" }, 401);
    const bookingID = clean(body.bookingId, 64);
    if (!validBookingID(bookingID))
        return json({ error: "INVALID_BOOKING" }, 400);
    const row = await env.DB.prepare(`SELECT telegram_user_id, chat_id, booking_id, booking_token_ciphertext, booking_token_iv, language,
            last_status, last_payment_status, last_confirmation_number, notifications_enabled
     FROM telegram_mini_active WHERE telegram_user_id=? AND booking_id=? LIMIT 1`).bind(user.id, bookingID).first();
    if (!row)
        return json({ error: "BOOKING_NOT_LINKED" }, 404);
    const token = await decryptSecret(env, row.booking_token_ciphertext, row.booking_token_iv);
    try {
        await fetchTrip(env, bookingID, token);
    }
    catch {
        return json({ error: "BOOKING_ACCESS_UNAVAILABLE" }, 403);
    }
    const action = clean(body.action, 64);
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
    let result;
    if (action === "contacts") {
        result = await fetchServerJSON(env, `/api/package/booking/${encodeURIComponent(bookingID)}/contact`, token, {
            method: "PATCH", body: JSON.stringify({ telegram: clean(payload.telegram, 128), whatsapp: clean(payload.whatsapp, 128) }),
        });
    }
    else if (action === "customization") {
        const out = {};
        for (const key of ["ziyaratMakkah", "ziyaratMadinah", "esim"])
            if (typeof payload[key] === "boolean")
                out[key] = payload[key];
        if (!Object.keys(out).length)
            return json({ error: "INVALID_CUSTOMIZATION" }, 400);
        result = await fetchServerJSON(env, `/api/package/booking/${encodeURIComponent(bookingID)}/customization`, token, { method: "PATCH", body: JSON.stringify(out) });
    }
    else if (action === "hotel") {
        const role = clean(payload.role, 16).toLowerCase();
        const hotelID = clean(payload.hotelId, 128);
        const roomID = clean(payload.roomId, 128);
        const categoryID = clean(payload.categoryId, 128);
        if ((role !== "makkah" && role !== "madinah") || !hotelID)
            return json({ error: "INVALID_HOTEL_SELECTION" }, 400);
        const detail = await fetchServerJSON(env, `/api/catalog/hotels/${encodeURIComponent(hotelID)}`, token);
        if (detail.status !== 200 || !detail.body?.hotel)
            return json({ error: detail.body?.error || "HOTEL_NOT_FOUND" }, detail.status || 404);
        const hotel = detail.body.hotel;
        const rooms = Array.isArray(hotel.rooms) ? hotel.rooms : [];
        const room = roomID ? rooms.find((item) => clean(item?.id, 128) === roomID) : null;
        let category = null;
        if (categoryID) {
            const categories = await fetchServerJSON(env, `/api/package/hotel/${encodeURIComponent(hotelID)}/room-categories`, token);
            category = Array.isArray(categories.body?.categories) ? categories.body.categories.find((item) => clean(item?.id, 128) === categoryID) : null;
            if (!category)
                return json({ error: "ROOM_CATEGORY_NOT_FOUND" }, 404);
        }
        if (roomID && !room)
            return json({ error: "ROOM_NOT_FOUND" }, 404);
        const images = Array.isArray(hotel.images) ? hotel.images : [];
        const cover = images.find((item) => item?.isCover === true)?.url || images[0]?.url || null;
        const updateBody = {
            role,
            hotelId: clean(hotel.id, 128),
            coverImageURL: cover,
            roomId: room ? clean(room.id, 128) || null : null,
            roomName: room ? clean(room.name, 256) || null : category ? clean(category.displayName, 256) || null : null,
            roomBeds: room ? clean(room.beds, 256) || null : category ? clean(category.bedConfiguration, 256) || null : null,
            roomSizeM2: room && typeof room.sizeM2 === "number" ? room.sizeM2 : null,
            roomMaxGuests: room && typeof room.maxGuests === "number" ? room.maxGuests : category && typeof category.maxGuests === "number" ? category.maxGuests : null,
            roomCategory: category ? clean(category.category, 32) || null : null,
            roomSource: category ? "iumrahPrimary" : room ? "hotelInventory" : null,
        };
        result = await fetchServerJSON(env, `/api/package/booking/${encodeURIComponent(bookingID)}`, token, { method: "PATCH", body: JSON.stringify(updateBody) });
    }
    else if (action === "delete") {
        const deleted = await fetchServerJSON(env, `/api/catalog/hotels/client/bookings/${encodeURIComponent(bookingID)}`, token, { method: "DELETE" });
        if (deleted.status < 200 || deleted.status >= 300)
            return json({ error: deleted.body?.error || "BOOKING_DELETE_FAILED" }, deleted.status);
        await env.DB.prepare("DELETE FROM telegram_mini_credentials WHERE telegram_user_id=? AND booking_id=?").bind(user.id, bookingID).run();
        result = deleted;
    }
    else {
        return json({ error: "UNSUPPORTED_ACTION" }, 400);
    }
    if (result.status < 200 || result.status >= 300)
        return json({ error: result.body?.error || `IUMRAH_ACTION_${result.status}` }, result.status || 502);
    return json({ ok: true, result: result.body });
}
async function sendCareContactCard(env, chatID, row) {
    let phone = CARE_FALLBACK_PHONE;
    if (row) {
        try {
            const token = await decryptSecret(env, row.booking_token_ciphertext, row.booking_token_iv);
            const team = await fetchServerJSON(env, "/api/catalog/hotels/team", token);
            const members = Array.isArray(team.body?.members) ? team.body.members : [];
            const care = members.find((member) => member?.isOwner === true) || members[0] || null;
            const candidate = clean(care?.phoneUZ || care?.phone || "", 64).replace(/[^0-9+]/g, "");
            if (candidate.length >= 7)
                phone = candidate;
        }
        catch (error) {
            console.error("care phone lookup failed; using fallback", row.booking_id, "REQUEST_FAILED");
        }
    }
    await telegramCall(env, "sendContact", {
        chat_id: chatID,
        phone_number: phone,
        first_name: "iumrah Care",
    });
    return phone;
}
async function miniCareCall(request, env) {
    const context = await miniHotelContext(request, env);
    if (context instanceof Response)
        return context;
    try {
        const phone = await sendCareContactCard(env, context.row.chat_id, context.row);
        return json({ ok: true, phone, deliveredToTelegram: true });
    }
    catch (error) {
        console.error("care contact delivery failed", "REQUEST_FAILED");
        return json({ error: "CARE_CALL_CONTACT_FAILED", phone: CARE_FALLBACK_PHONE }, 502);
    }
}
async function miniCareMessages(request, env) {
    const context = await miniHotelContext(request, env);
    if (context instanceof Response)
        return context;
    const bookingID = context.row.booking_id;
    const result = await fetchServerJSON(env, `/api/catalog/hotels/client/chats/${encodeURIComponent(bookingID)}/messages`, context.token);
    if (result.status < 200 || result.status >= 300)
        return json({ error: result.body?.error || `CARE_MESSAGES_${result.status}` }, result.status || 502);
    try {
        await fetchServerJSON(env, `/api/catalog/hotels/client/chats/${encodeURIComponent(bookingID)}/read`, context.token, {
            method: "POST", body: JSON.stringify({}),
        });
    }
    catch { /* read receipts are best-effort */ }
    return json({ ok: true, bookingID, messages: Array.isArray(result.body?.messages) ? result.body.messages : [] });
}
async function miniCareSend(request, env) {
    const context = await miniHotelContext(request, env);
    if (context instanceof Response)
        return context;
    const bookingID = context.row.booking_id;
    const body = clean(context.body.message, 4000);
    if (!body)
        return json({ error: "EMPTY_MESSAGE" }, 400);
    const result = await fetchServerJSON(env, `/api/catalog/hotels/client/chats/${encodeURIComponent(bookingID)}/messages`, context.token, {
        method: "POST",
        body: JSON.stringify({ body, clientMessageID: crypto.randomUUID() }),
    });
    if (result.status < 200 || result.status >= 300)
        return json({ error: result.body?.error || `CARE_SEND_${result.status}` }, result.status || 502);
    return json({ ok: true, message: result.body?.message ?? null });
}
function decodeBase64Payload(value) {
    try {
        const normalized = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
        const binary = atob(normalized);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1)
            bytes[i] = binary.charCodeAt(i);
        return bytes;
    }
    catch {
        return null;
    }
}
async function miniCarePhoto(request, env) {
    const context = await miniHotelContext(request, env);
    if (context instanceof Response)
        return context;
    const bookingID = context.row.booking_id;
    const raw = clean(context.body.dataBase64, 12_000_000);
    const bytes = decodeBase64Payload(raw);
    if (!bytes || bytes.byteLength < 16 || bytes.byteLength > 7_500_000)
        return json({ error: "INVALID_IMAGE" }, 400);
    const headers = storedBookingCredentialHeaders(context.token);
    headers.set("content-type", "image/jpeg");
    const response = await env.dispatch(new Request(`https://iumrah-backend.helloiumrah.workers.dev/api/catalog/hotels/client/chats/${encodeURIComponent(bookingID)}/attachments`, { method: "POST", headers, body: bytes, redirect: "manual" }));
    let body = null;
    try {
        body = await response.json();
    }
    catch {
        body = null;
    }
    if (!response.ok)
        return json({ error: body?.error || `CARE_PHOTO_${response.status}` }, response.status || 502);
    return json({ ok: true, message: body?.message ?? null });
}
function normalizedCareAttachmentPath(raw, bookingID, token) {
    try {
        const value = raw.trim();
        if (!value)
            return null;
        const url = value.startsWith("http://") || value.startsWith("https://") ? new URL(value) : new URL(value, "https://iumrah-backend.helloiumrah.workers.dev");
        const scope = decodeStoredBookingCredential(token).kind === "account" ? "account" : bookingID;
        const prefix = `/api/catalog/hotels/client/chats/${encodeURIComponent(scope)}/`;
        return url.pathname.startsWith(prefix + "media/") && !url.search && /^[a-zA-Z0-9_-]+$/.test(url.pathname.slice((prefix + "media/").length)) ? url.pathname : null;
    }
    catch {
        return null;
    }
}
async function miniCareAttachment(request, env) {
    const context = await miniHotelContext(request, env);
    if (context instanceof Response)
        return context;
    const bookingID = context.row.booking_id;
    const path = normalizedCareAttachmentPath(clean(context.body.path, 2048), bookingID, context.token);
    if (!path)
        return json({ error: "INVALID_ATTACHMENT" }, 400);
    const response = await env.dispatch(new Request(`https://iumrah-backend.helloiumrah.workers.dev${path}`, {
        method: "GET",
        headers: storedBookingCredentialHeaders(context.token, "image/*"),
        redirect: "manual",
    }));
    if (!response.ok)
        return json({ error: `CARE_ATTACHMENT_${response.status}` }, response.status || 502);
    const headers = new Headers();
    headers.set("content-type", response.headers.get("content-type") || "image/jpeg");
    headers.set("cache-control", "private, max-age=300");
    return new Response(response.body, { status: 200, headers });
}
async function miniSnapshot(request, env) {
    let body;
    try {
        body = (await request.json());
    }
    catch {
        return json({ error: "INVALID_REQUEST" }, 400);
    }
    const user = await validateTelegramInitData(env, clean(body.initData, 8192));
    if (!user)
        return json({ error: "TELEGRAM_AUTH_FAILED" }, 401);
    const bookingID = clean(body.bookingId, 64);
    if (!validBookingID(bookingID))
        return json({ error: "INVALID_BOOKING" }, 400);
    const row = await env.DB.prepare(`SELECT telegram_user_id, chat_id, booking_id, booking_token_ciphertext, booking_token_iv, language,
            last_status, last_payment_status, last_confirmation_number, notifications_enabled
     FROM telegram_mini_active WHERE telegram_user_id=? AND booking_id=? LIMIT 1`).bind(user.id, bookingID).first();
    if (!row)
        return json({ error: "BOOKING_NOT_LINKED" }, 404);
    try {
        const token = await decryptSecret(env, row.booking_token_ciphertext, row.booking_token_iv);
        const payload = await fetchTrip(env, bookingID, token);
        return json({
            ok: true,
            reference: bookingReference(payload.trip),
            trip: payload.trip,
            lifecycle: lifecycle(payload),
            copy: statusCopy(normalizeLocale(row.language || user.language_code || "ru"), payload.trip.status, payload.trip.paymentStatus),
        });
    }
    catch {
        return json({ error: "BOOKING_REFRESH_FAILED" }, 502);
    }
}
export async function miniFetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && /^\/telegram\/status-image\/[a-z_]+\.webp$/.test(path))
        return serveAsset(env,STATUS_ASSETS[path.split("/").pop().replace(/\.webp$/, "")]);
    if (request.method === "GET" && /^\/telegram\/support-image\/[a-z_]+\.(jpg|png)$/.test(path))
        return serveAsset(env,SUPPORT_ASSETS[path.split("/").pop().replace(/\.(jpg|png)$/, "")]);
    if (request.method === "GET" && /^\/telegram\/mini-asset\/[a-z0-9-]+\.(png|jpeg|jpg|ttf)$/.test(path))
        return serveAsset(env,MINI_ASSETS[path.split("/").pop().replace(/\.(png|jpeg|jpg|ttf)$/, "").replace(/-/g, "_")]);
    if (request.method === "GET" && path === "/telegram/mini")
        return new Response(miniHTML(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy":"default-src 'none'; script-src 'unsafe-inline' https://telegram.org; style-src 'unsafe-inline'; img-src https: data: blob:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'" } });
    if (request.method !== "POST")
        return json({ error: "NOT_FOUND" }, 404);
    const handlers = {
        "/telegram/mini/bootstrap": miniBootstrap, "/telegram/mini/hotels": miniHotels, "/telegram/mini/hotel": miniHotel, "/telegram/mini/action": miniAction,
        "/telegram/mini/care/call": miniCareCall, "/telegram/mini/care/messages": miniCareMessages, "/telegram/mini/care/send": miniCareSend, "/telegram/mini/care/photo": miniCarePhoto, "/telegram/mini/care/attachment": miniCareAttachment, "/telegram/mini/snapshot": miniSnapshot
    };
    const handler = handlers[path];
    return handler ? handler(request, env) : json({ error: "NOT_FOUND" }, 404);
}
