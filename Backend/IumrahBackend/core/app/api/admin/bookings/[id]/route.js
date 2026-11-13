// Ported from iumrah-web-main 5.zip: app/api/admin/bookings/[id]/route.ts
import { requestEnv, backendFetch } from "../../../../../runtime.js";
import { NextResponse } from "../../../../../runtime.js";
import { readCookie, STAFF_SESSION_COOKIE, verifyStaffSessionToken } from "../../../../../lib/staff-auth.js";
import { bookingStatuses, ensureBookingSchema, getBookingDb, isBookingStatus, rowToSummary, } from "../../../../../lib/booking-store.js";
import { deliverTelegramNotice, queueTelegramNotice } from "../../../../../lib/telegram-booking.js";
export const dynamic = "force-dynamic";
async function auth(request) {
    const token = readCookie(request.headers.get("cookie"), STAFF_SESSION_COOKIE);
    return verifyStaffSessionToken(token);
}
export async function GET(request, { params }) {
    const session = await auth(request);
    if (!session)
        return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const { id } = await params;
    const db = getBookingDb();
    if (!db)
        return NextResponse.json({ error: "BOOKING_DB_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    try {
        await ensureBookingSchema(db);
        const row = await db.prepare(`SELECT id, status, created_at, updated_at, lang, plan_id, total_cents,
      per_pilgrim_cents, traveler_count, rooms, origin_code, outbound_destination, return_origin,
      start_date, end_date, flight_name, makkah_hotel, madinah_hotel, payload_json
      FROM bookings WHERE id = ? LIMIT 1`).bind(id).first();
        if (!row)
            return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
        const eventRows = await db.prepare("SELECT id, status, actor_type, actor_id, note, created_at FROM booking_events WHERE booking_id = ? ORDER BY id DESC LIMIT 30")
            .bind(id).all();
        const events = eventRows.results.map((item) => ({
            id: Number(item.id ?? 0),
            status: isBookingStatus(item.status) ? item.status : "AVAILABILITY_CHECK",
            actorType: item.actor_type === "staff" ? "staff" : "system",
            actorId: String(item.actor_id ?? ""),
            note: String(item.note ?? ""),
            createdAt: String(item.created_at ?? ""),
        }));
        const payload = JSON.parse(String(row.payload_json ?? "{}"));
        const documentRows = await db.prepare("SELECT id, traveler_index, kind, file_name, content_type, size_bytes, created_at FROM booking_documents WHERE booking_id = ? ORDER BY traveler_index ASC, id ASC")
            .bind(id).all();
        const documents = documentRows.results.map((item) => ({
            id: Number(item.id ?? 0), bookingId: id, travelerIndex: Number(item.traveler_index ?? 0), kind: "passport",
            fileName: String(item.file_name ?? "passport"), contentType: String(item.content_type ?? "application/octet-stream"), sizeBytes: Number(item.size_bytes ?? 0), createdAt: String(item.created_at ?? ""),
            downloadUrl: `/api/admin/bookings/${encodeURIComponent(id)}/documents/${Number(item.id ?? 0)}`,
        }));
        return NextResponse.json({ booking: rowToSummary(row), payload, events, documents }, { headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        console.error("admin-booking-read-failed", error);
        return NextResponse.json({ error: "BOOKING_READ_FAILED" }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
}
export async function PATCH(request, { params }) {
    const session = await auth(request);
    if (!session)
        return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const { id } = await params;
    let body;
    try {
        body = await request.json();
    }
    catch {
        return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    const requested = body && typeof body === "object" ? body.status : undefined;
    if (!isBookingStatus(requested))
        return NextResponse.json({ error: "INVALID_STATUS" }, { status: 400 });
    const db = getBookingDb();
    if (!db)
        return NextResponse.json({ error: "BOOKING_DB_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    try {
        await ensureBookingSchema(db);
        const current = await db.prepare("SELECT status FROM bookings WHERE id = ? LIMIT 1").bind(id).first();
        if (!current || !isBookingStatus(current.status))
            return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });
        const currentIndex = bookingStatuses.indexOf(current.status);
        const nextIndex = bookingStatuses.indexOf(requested);
        if (nextIndex !== currentIndex + 1)
            return NextResponse.json({ error: "INVALID_TRANSITION", current: current.status }, { status: 409 });
        const now = new Date().toISOString();
        const confirmedAt = requested === "PAYMENT_PENDING" ? now : null;
        await db.batch([
            db.prepare("UPDATE bookings SET status = ?, updated_at = ?, confirmed_at = COALESCE(?, confirmed_at) WHERE id = ?")
                .bind(requested, now, confirmedAt, id),
            db.prepare("INSERT INTO booking_events (booking_id, status, actor_type, actor_id, note, created_at) VALUES (?, ?, 'staff', ?, ?, ?)")
                .bind(id, requested, session.sub, `Status moved to ${requested}`, now),
        ]);
        // A notification is attached to the committed status change, not to a UI action.
        try {
            await queueTelegramNotice(db, id, requested);
            await deliverTelegramNotice(db, id, requested);
        }
        catch (noticeError) {
            console.error("telegram-booking-status-notice-failed", noticeError);
        }
        return NextResponse.json({ ok: true, status: requested, updatedAt: now }, { headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        console.error("admin-booking-status-failed", error);
        return NextResponse.json({ error: "STATUS_UPDATE_FAILED" }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
}
