// Ported from iumrah-web-main 5.zip: app/api/admin/chats/[id]/route.ts
import { requestEnv, backendFetch } from "../../../../../runtime.js";
import { NextResponse } from "../../../../../runtime.js";
import { readCookie, STAFF_SESSION_COOKIE, verifyStaffSessionToken } from "../../../../../lib/staff-auth.js";
import { ensureBookingSchema, rowToSummary } from "../../../../../lib/booking-store.js";
import { ensureChatSchema, ensureThread, getChatDb, insertMessage, markRead, readMessages, validBookingId } from "../../../../../lib/chat-store.js";
export const dynamic = "force-dynamic";
async function session(request) {
    return verifyStaffSessionToken(readCookie(request.headers.get("cookie"), STAFF_SESSION_COOKIE));
}
function bodyText(value) {
    if (!value || typeof value !== "object")
        return "";
    const raw = value.message;
    return typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim().slice(0, 2000) : "";
}
async function bookingRow(db, id) {
    return db.prepare(`SELECT id, status, created_at, updated_at, lang, plan_id, total_cents,
      per_pilgrim_cents, traveler_count, rooms, origin_code, outbound_destination, return_origin,
      start_date, end_date, flight_name, makkah_hotel, madinah_hotel
      FROM bookings WHERE id = ? LIMIT 1`).bind(id).first();
}
export async function GET(request, { params }) {
    const staff = await session(request);
    if (!staff)
        return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const { id } = await params;
    if (!validBookingId(id))
        return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });
    const db = getChatDb();
    if (!db)
        return NextResponse.json({ error: "CHAT_DB_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    try {
        await ensureChatSchema(db);
        const row = await bookingRow(db, id);
        if (!row)
            return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });
        await ensureThread(db, id);
        const messages = await readMessages(db, id);
        await markRead(db, id, "staff");
        return NextResponse.json({ booking: rowToSummary(row), messages }, { headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        console.error("admin-chat-read-failed", error);
        return NextResponse.json({ error: "CHAT_READ_FAILED" }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
}
export async function POST(request, { params }) {
    const staff = await session(request);
    if (!staff)
        return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const { id } = await params;
    if (!validBookingId(id))
        return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });
    let body;
    try {
        body = await request.json();
    }
    catch {
        return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    const message = bodyText(body);
    if (!message)
        return NextResponse.json({ error: "EMPTY_MESSAGE" }, { status: 400 });
    const db = getChatDb();
    if (!db)
        return NextResponse.json({ error: "CHAT_DB_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    try {
        await ensureBookingSchema(db);
        const row = await bookingRow(db, id);
        if (!row)
            return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });
        await ensureChatSchema(db);
        const created = await insertMessage(db, id, "staff", staff.sub, message);
        return NextResponse.json({ message: created }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        if (error instanceof Error && error.message === "CHAT_RATE_LIMIT")
            return NextResponse.json({ error: "RATE_LIMIT" }, { status: 429 });
        console.error("admin-chat-send-failed", error);
        return NextResponse.json({ error: "CHAT_SEND_FAILED" }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
}
