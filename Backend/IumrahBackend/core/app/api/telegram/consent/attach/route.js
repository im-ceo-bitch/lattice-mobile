// Ported from iumrah-web-main 5.zip: app/api/telegram/consent/attach/route.ts
import { requestEnv, backendFetch } from "../../../../../runtime.js";
import { NextResponse } from "../../../../../runtime.js";
import { ensureBookingSchema, getBookingDb, hashBookingToken, isBookingStatus } from "../../../../../lib/booking-store.js";
import { consentStatements, deliverTelegramNotice, ensureTelegramBookingSchema, findValidConsent, queueTelegramNotice } from "../../../../../lib/telegram-booking.js";
export const dynamic = "force-dynamic";
export async function GET(request) {
    const url = new URL(request.url);
    const bookingId = url.searchParams.get("bookingId") || "";
    const token = request.headers.get("x-booking-token")?.trim() || "";
    if (!/^IUM-\d{4}-[A-Z2-9]{7}$/.test(bookingId) || token.length < 24 || token.length > 128)
        return NextResponse.json({ error: "BOOKING_ACCESS_REQUIRED" }, { status: 401 });
    const db = getBookingDb();
    if (!db)
        return NextResponse.json({ error: "BOOKING_DB_NOT_CONFIGURED" }, { status: 503 });
    try {
        await ensureBookingSchema(db);
        await ensureTelegramBookingSchema(db);
        const row = await db.prepare(`SELECT s.telegram_name, s.disabled_at FROM bookings b
      LEFT JOIN booking_telegram_subscriptions s ON s.booking_id = b.id
      WHERE b.id = ? AND b.access_token_hash = ? LIMIT 1`)
            .bind(bookingId, await hashBookingToken(token)).first();
        if (!row)
            return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });
        return NextResponse.json({ connected: row.telegram_name !== null && row.disabled_at === null, username: row.telegram_name || "" }, { headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        console.error("telegram-connection-state-failed", error);
        return NextResponse.json({ error: "TELEGRAM_STATE_FAILED" }, { status: 500 });
    }
}
export async function POST(request) {
    const token = request.headers.get("x-booking-token")?.trim() || "";
    const body = await request.json().catch(() => null);
    const bookingId = typeof body?.bookingId === "string" ? body.bookingId : "";
    const ticket = typeof body?.ticket === "string" ? body.ticket : "";
    if (!/^IUM-\d{4}-[A-Z2-9]{7}$/.test(bookingId) || token.length < 24 || token.length > 128)
        return NextResponse.json({ error: "BOOKING_ACCESS_REQUIRED" }, { status: 401 });
    const db = getBookingDb();
    if (!db)
        return NextResponse.json({ error: "BOOKING_DB_NOT_CONFIGURED" }, { status: 503 });
    try {
        await ensureBookingSchema(db);
        await ensureTelegramBookingSchema(db);
        const row = await db.prepare("SELECT status FROM bookings WHERE id = ? AND access_token_hash = ? LIMIT 1")
            .bind(bookingId, await hashBookingToken(token)).first();
        if (!row)
            return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });
        const consent = await findValidConsent(db, ticket);
        if (!consent)
            return NextResponse.json({ error: "TELEGRAM_CONSENT_EXPIRED" }, { status: 400 });
        const now = new Date().toISOString();
        await db.batch([
            db.prepare("DELETE FROM booking_telegram_subscriptions WHERE booking_id = ?").bind(bookingId),
            ...consentStatements(db, bookingId, consent.ticketHash, now),
            db.prepare("DELETE FROM booking_telegram_outbox WHERE booking_id = ?").bind(bookingId),
        ]);
        const status = isBookingStatus(row.status) ? row.status : "AVAILABILITY_CHECK";
        await queueTelegramNotice(db, bookingId, status);
        const sent = await deliverTelegramNotice(db, bookingId, status);
        return NextResponse.json({ ok: true, sent }, { headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        console.error("telegram-booking-attach-failed", error);
        return NextResponse.json({ error: "TELEGRAM_ATTACH_FAILED" }, { status: 500 });
    }
}
export async function DELETE(request) {
    const bookingId = new URL(request.url).searchParams.get("bookingId") || "";
    const token = request.headers.get("x-booking-token")?.trim() || "";
    if (!/^IUM-\d{4}-[A-Z2-9]{7}$/.test(bookingId) || token.length < 24 || token.length > 128)
        return NextResponse.json({ error: "BOOKING_ACCESS_REQUIRED" }, { status: 401 });
    const db = getBookingDb();
    if (!db)
        return NextResponse.json({ error: "BOOKING_DB_NOT_CONFIGURED" }, { status: 503 });
    try {
        await ensureBookingSchema(db);
        await ensureTelegramBookingSchema(db);
        const row = await db.prepare("SELECT id FROM bookings WHERE id = ? AND access_token_hash = ? LIMIT 1")
            .bind(bookingId, await hashBookingToken(token)).first();
        if (!row)
            return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });
        await db.batch([
            db.prepare("UPDATE booking_telegram_subscriptions SET disabled_at = ? WHERE booking_id = ?")
                .bind(new Date().toISOString(), bookingId),
            db.prepare("DELETE FROM booking_telegram_outbox WHERE booking_id = ? AND delivered_at IS NULL").bind(bookingId),
            db.prepare("UPDATE booking_telegram_links SET used_at=? WHERE booking_id=? AND used_at IS NULL").bind(new Date().toISOString(),bookingId),
        ]);
        return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        console.error("telegram-notification-unsubscribe-failed", error);
        return NextResponse.json({ error: "TELEGRAM_DISCONNECT_FAILED" }, { status: 500 });
    }
}
