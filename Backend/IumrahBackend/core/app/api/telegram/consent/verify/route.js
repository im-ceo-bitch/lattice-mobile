// Ported from iumrah-web-main 5.zip: app/api/telegram/consent/verify/route.ts
import { requestEnv, backendFetch } from "../../../../../runtime.js";
import { NextResponse } from "../../../../../runtime.js";
import { ensureBookingSchema, getBookingDb } from "../../../../../lib/booking-store.js";
import { ensureTelegramBookingSchema, randomSecret, sha256, verifyTelegramToken, telegramConfiguration } from "../../../../../lib/telegram-booking.js";
export const dynamic = "force-dynamic";
export async function POST(request) {
    if (!telegramConfiguration().configured)
        return NextResponse.json({ error: "TELEGRAM_NOT_CONFIGURED" }, { status: 503 });
    const nonce = request.cookies.get("iumrah_tg_nonce")?.value || "";
    if (!/^[a-f0-9]{64}$/.test(nonce))
        return NextResponse.json({ error: "TELEGRAM_AUTH_EXPIRED" }, { status: 400 });
    const body = await request.json().catch(() => null);
    const idToken = typeof body === "object" && body && "idToken" in body ? body.idToken : null;
    if (typeof idToken !== "string" || idToken.length > 8192)
        return NextResponse.json({ error: "TELEGRAM_AUTH_INVALID" }, { status: 400 });
    try {
        const identity = await verifyTelegramToken(idToken, nonce);
        const db = getBookingDb();
        if (!db)
            return NextResponse.json({ error: "BOOKING_DB_NOT_CONFIGURED" }, { status: 503 });
        await ensureBookingSchema(db);
        await ensureTelegramBookingSchema(db);
        const ticket = randomSecret();
        const ticketHash = await sha256(ticket);
        const now = new Date();
        await db.prepare("INSERT INTO telegram_booking_consents (ticket_hash, telegram_id, telegram_name, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
            .bind(ticketHash, identity.id, identity.username, now.toISOString(), new Date(now.getTime() + 15 * 60_000).toISOString()).run();
        const response = NextResponse.json({ ok: true, ticket, username: identity.username }, { headers: { "Cache-Control": "no-store" } });
        response.cookies.set("iumrah_tg_nonce", "", { maxAge: 0, path: "/api/telegram/consent", httpOnly: true, sameSite: "lax", secure: requestEnv().NODE_ENV === "production" });
        return response;
    }
    catch (error) {
        console.warn("telegram-login-verification-failed", error instanceof Error ? error.message : "unknown");
        return NextResponse.json({ error: "TELEGRAM_AUTH_FAILED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
}
