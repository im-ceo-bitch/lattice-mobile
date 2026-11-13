// Ported from iumrah-web-main 5.zip: lib/telegram-booking.ts
import { requestEnv, backendFetch } from "../runtime.js";
/** Telegram Login (OIDC) + per-booking notifications. No iumrah account is required.
 * Only the Telegram user verified with Telegram's public signing keys can subscribe.
 * The shared Telegram bot token must remain a Cloudflare secret, never a client value.
 */
import { getCloudflareContext } from "../runtime.js";
function env() {
    try {
        return getCloudflareContext().env;
    }
    catch {
        return requestEnv();
    }
}
export function telegramConfiguration() {
    const e = env();
    const clientId = (e.TELEGRAM_LOGIN_CLIENT_ID || "").trim();
    const botToken = (e.IUMRAH_TELEGRAM_BOT_TOKEN || "").trim();
    return { clientId, botToken, configured: /^\d{4,20}$/.test(clientId) && /^\d+:[\w-]{25,}$/.test(botToken) };
}
let schemaPromise = null;
export async function ensureTelegramBookingSchema(db) {
    if (!schemaPromise)
        schemaPromise = db.batch([
            db.prepare(`CREATE TABLE IF NOT EXISTS telegram_booking_consents (
      ticket_hash TEXT PRIMARY KEY, telegram_id TEXT NOT NULL, telegram_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT
    )`),
            db.prepare(`CREATE TABLE IF NOT EXISTS booking_telegram_subscriptions (
      booking_id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL, telegram_name TEXT NOT NULL DEFAULT '',
      connected_at TEXT NOT NULL, disabled_at TEXT,
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
    )`),
            db.prepare(`CREATE TABLE IF NOT EXISTS booking_telegram_outbox (
      booking_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
      delivered_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (booking_id, status),
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
    )`),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_booking_tg_outbox_due ON booking_telegram_outbox(delivered_at, attempts, created_at)"),
        ]).then(() => { }).catch((error) => { schemaPromise = null; throw error; });
    await schemaPromise;
}
export function randomSecret() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function sha256(value) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function parseBase64Url(value) {
    if (!/^[A-Za-z0-9_-]+$/.test(value))
        throw new Error("TOKEN_ENCODING_INVALID");
    const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
    return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}
function record(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function jsonPart(raw) {
    const parsed = JSON.parse(new TextDecoder().decode(parseBase64Url(raw)));
    if (!record(parsed))
        throw new Error("TOKEN_INVALID");
    return parsed;
}
export async function verifyTelegramToken(rawToken, expectedNonce) {
    const clientId = telegramConfiguration().clientId;
    if (!/^\d{4,20}$/.test(clientId) || rawToken.length > 8192 || !expectedNonce)
        throw new Error("TOKEN_INVALID");
    const parts = rawToken.split(".");
    if (parts.length !== 3)
        throw new Error("TOKEN_INVALID");
    const header = jsonPart(parts[0]), claims = jsonPart(parts[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string")
        throw new Error("TOKEN_ALGORITHM_UNSUPPORTED");
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== "https://oauth.telegram.org" || !(claims.aud === clientId || Array.isArray(claims.aud) && claims.aud.includes(clientId)) ||
        typeof claims.exp !== "number" || claims.exp <= now - 30 || typeof claims.iat !== "number" || claims.iat > now + 60 ||
        claims.iat < now - 900 || claims.nonce !== expectedNonce)
        throw new Error("TOKEN_CLAIMS_INVALID");
    const userId = String(claims.id ?? claims.sub ?? "");
    if (!/^\d{1,20}$/.test(userId) || typeof claims.sub !== "string" || !claims.sub)
        throw new Error("TOKEN_USER_INVALID");
    const response = await backendFetch("https://oauth.telegram.org/.well-known/jwks.json", {
        signal: AbortSignal.timeout(5000), headers: { accept: "application/json" },
        cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (!response.ok)
        throw new Error("TELEGRAM_KEY_UNAVAILABLE");
    const keys = await response.json();
    if (!record(keys) || !Array.isArray(keys.keys))
        throw new Error("TELEGRAM_KEY_INVALID");
    const jwk = keys.keys.find((item) => record(item) && item.kid === header.kid && item.kty === "RSA" && (!item.alg || item.alg === "RS256"));
    if (!jwk || !record(jwk))
        throw new Error("TELEGRAM_KEY_NOT_FOUND");
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, parseBase64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!valid)
        throw new Error("TELEGRAM_SIGNATURE_INVALID");
    return { id: userId, username: typeof claims.preferred_username === "string" ? claims.preferred_username.slice(0, 64) : "" };
}
export async function findValidConsent(db, ticket) {
    if (!/^[a-f0-9]{64}$/.test(ticket))
        return null;
    await ensureTelegramBookingSchema(db);
    const ticketHash = await sha256(ticket);
    const row = await db.prepare("SELECT telegram_id, telegram_name FROM telegram_booking_consents WHERE ticket_hash = ? AND used_at IS NULL AND expires_at > ? LIMIT 1")
        .bind(ticketHash, new Date().toISOString()).first();
    return row ? { ticketHash, telegramId: row.telegram_id, username: row.telegram_name } : null;
}
export function consentStatements(db, bookingId, ticketHash, now) {
    // Atomic transaction with the booking INSERT; one-time ticket cannot subscribe multiple bookings.
    return [
        db.prepare(`INSERT INTO booking_telegram_subscriptions(booking_id, telegram_id, telegram_name, connected_at)
      SELECT ?, telegram_id, telegram_name, ? FROM telegram_booking_consents
      WHERE ticket_hash = ? AND used_at IS NULL AND expires_at > ?`)
            .bind(bookingId, now, ticketHash, now),
        db.prepare("UPDATE telegram_booking_consents SET used_at = ? WHERE ticket_hash = ? AND used_at IS NULL")
            .bind(now, ticketHash),
    ];
}
export async function queueTelegramNotice(db, bookingId, status) {
    await ensureTelegramBookingSchema(db);
    await db.prepare(`INSERT OR IGNORE INTO booking_telegram_outbox(booking_id, status, created_at)
    SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM booking_telegram_subscriptions WHERE booking_id = ? AND disabled_at IS NULL)`)
        .bind(bookingId, status, new Date().toISOString(), bookingId).run();
}
const notices = {
    ru: { AVAILABILITY_CHECK: "Бронирование создано. Проверяем доступность.", PAYMENT_PENDING: "Проверка завершена. Ожидается оплата.", BOOKING_CONFIRMED: "Бронирование подтверждено.", READY_TO_TRAVEL: "Поездка готова. Проверьте документы в iumrah.", COMPLETED: "Поездка завершена. Спасибо, что выбрали iumrah." },
    en: { AVAILABILITY_CHECK: "Booking created. Checking availability.", PAYMENT_PENDING: "Availability checked. Awaiting payment.", BOOKING_CONFIRMED: "Your booking is confirmed.", READY_TO_TRAVEL: "Your trip is ready. Check your documents in iumrah.", COMPLETED: "Trip completed. Thank you for choosing iumrah." },
    uz: { AVAILABILITY_CHECK: "Bron yaratildi. Mavjudlik tekshirilmoqda.", PAYMENT_PENDING: "Tekshiruv tugadi. To‘lov kutilmoqda.", BOOKING_CONFIRMED: "Broningiz tasdiqlandi.", READY_TO_TRAVEL: "Safaringiz tayyor. Hujjatlarni iumrah’da tekshiring.", COMPLETED: "Safar yakunlandi. iumrah’ni tanlaganingiz uchun rahmat." },
    "uz-cyrl": { AVAILABILITY_CHECK: "Брон яратилди. Мавжудлик текширилмоқда.", PAYMENT_PENDING: "Текширув тугади. Тўлов кутилмоқда.", BOOKING_CONFIRMED: "Бронингиз тасдиқланди.", READY_TO_TRAVEL: "Сафарингиз тайёр. Ҳужжатларни iumrah’да текширинг.", COMPLETED: "Сафар якунланди. iumrah’ни танлаганингиз учун раҳмат." },
    tr: { AVAILABILITY_CHECK: "Rezervasyon oluşturuldu. Müsaitlik kontrol ediliyor.", PAYMENT_PENDING: "Kontrol tamamlandı. Ödeme bekleniyor.", BOOKING_CONFIRMED: "Rezervasyonunuz onaylandı.", READY_TO_TRAVEL: "Seyahatiniz hazır. Belgelerinizi iumrah üzerinden kontrol edin.", COMPLETED: "Seyahat tamamlandı. iumrah’ı tercih ettiğiniz için teşekkürler." },
    id: { AVAILABILITY_CHECK: "Pemesanan dibuat. Ketersediaan sedang diperiksa.", PAYMENT_PENDING: "Pemeriksaan selesai. Menunggu pembayaran.", BOOKING_CONFIRMED: "Pemesanan Anda telah dikonfirmasi.", READY_TO_TRAVEL: "Perjalanan Anda sudah siap. Periksa dokumen di iumrah.", COMPLETED: "Perjalanan selesai. Terima kasih telah memilih iumrah." },
    ms: { AVAILABILITY_CHECK: "Tempahan dibuat. Ketersediaan sedang disemak.", PAYMENT_PENDING: "Semakan selesai. Menunggu pembayaran.", BOOKING_CONFIRMED: "Tempahan anda telah disahkan.", READY_TO_TRAVEL: "Perjalanan anda sudah tersedia. Semak dokumen di iumrah.", COMPLETED: "Perjalanan selesai. Terima kasih kerana memilih iumrah." },
};
function noticeText(bookingId, status, lang) {
    const label = (notices[lang.toLowerCase()] || notices.en)[status] || notices.en[status] || status;
    const details = { ru: "Подробности", en: "Details", uz: "Batafsil", "uz-cyrl": "Батафсил", tr: "Ayrıntılar", id: "Rincian", ms: "Butiran" };
    return `✈️ IUMRAH · ${bookingId}\n\n${label}\n\n${details[lang.toLowerCase()] || "Details"}: https://iumrah.app/booking`;
}
export async function deliverTelegramNotice(db, bookingId, status) {
    const { botToken } = telegramConfiguration();
    if (!botToken)
        return false;
    await ensureTelegramBookingSchema(db);
    const row = await db.prepare(`SELECT s.telegram_id, b.lang, o.delivered_at, o.attempts
    FROM booking_telegram_subscriptions s JOIN bookings b ON b.id = s.booking_id
    JOIN booking_telegram_outbox o ON o.booking_id = s.booking_id AND o.status = ?
    WHERE s.booking_id = ? AND s.disabled_at IS NULL LIMIT 1`)
        .bind(status, bookingId).first();
    if (!row || row.delivered_at || row.attempts >= 8)
        return Boolean(row?.delivered_at);
    // Claim before sending: reduces concurrent duplicate notifications. Any failed claim
    // stays pending for a later retry; successful send is marked delivered.
    const claim = await db.prepare(`UPDATE booking_telegram_outbox SET attempts = attempts + 1 WHERE booking_id = ? AND status = ? AND delivered_at IS NULL AND attempts = ?`)
        .bind(bookingId, status, row.attempts).run();
    if (claim?.meta?.changes === 0)
        return false;
    try {
        const response = await backendFetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(6500),
            body: JSON.stringify({ chat_id: row.telegram_id, text: noticeText(bookingId, status, row.lang), disable_web_page_preview: true }),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !record(result) || result.ok !== true) {
            // Blocked / denied direct message access is not retriable until permission is granted again.
            const errorCode = `HTTP_${response.status}`;
            const forbidden = response.status === 403 || response.status === 400;
            await db.prepare("UPDATE booking_telegram_outbox SET last_error = ? WHERE booking_id = ? AND status = ?")
                .bind(errorCode, bookingId, status).run();
            if (forbidden)
                await db.prepare("UPDATE booking_telegram_subscriptions SET disabled_at = ? WHERE booking_id = ?")
                    .bind(new Date().toISOString(), bookingId).run();
            return false;
        }
        await db.prepare("UPDATE booking_telegram_outbox SET delivered_at = ?, last_error = '' WHERE booking_id = ? AND status = ?")
            .bind(new Date().toISOString(), bookingId, status).run();
        return true;
    }
    catch (error) {
        console.error("telegram-notice-send-failed", { bookingId, status, reason: error instanceof Error ? error.name : "unknown" });
        await db.prepare("UPDATE booking_telegram_outbox SET last_error = 'NETWORK_ERROR' WHERE booking_id = ? AND status = ?")
            .bind(bookingId, status).run().catch(() => { });
        return false;
    }
}
