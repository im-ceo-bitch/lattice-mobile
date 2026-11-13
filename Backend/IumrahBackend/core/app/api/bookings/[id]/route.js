// Ported from iumrah-web-main 5.zip: app/api/bookings/[id]/route.ts
import { requestEnv, backendFetch } from "../../../../runtime.js";
import { NextResponse } from "../../../../runtime.js";
import { ensureBookingSchema, getBookingDb, hashBookingToken, isBookingStatus } from "../../../../lib/booking-store.js";
export const dynamic = "force-dynamic";
function string(value, max = 180) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function parseProfile(value) {
    if (!value || typeof value !== "object")
        return undefined;
    const record = value;
    const firstName = string(record.firstName, 120);
    const lastName = string(record.lastName, 120);
    const phone = string(record.phone, 60);
    const telegram = string(record.telegram, 120);
    const whatsapp = string(record.whatsapp, 100);
    if (!firstName && !lastName && !phone && !telegram && !whatsapp)
        return undefined;
    return { firstName, lastName, phone, telegram, whatsapp };
}
async function readBooking(id, token) {
    if (!/^IUM-\d{4}-[A-Z2-9]{7}$/.test(id) || token.length < 24 || token.length > 128)
        return null;
    const db = getBookingDb();
    if (!db)
        return { error: "BOOKING_DB_NOT_CONFIGURED" };
    await ensureBookingSchema(db);
    const tokenHash = await hashBookingToken(token);
    const row = await db.prepare("SELECT status, created_at, updated_at, payload_json FROM bookings WHERE id = ? AND access_token_hash = ? LIMIT 1")
        .bind(id, tokenHash)
        .first();
    if (!row)
        return { error: "BOOKING_NOT_FOUND" };
    return { db, row, tokenHash };
}
export async function GET(request, { params }) {
    const { id } = await params;
    const token = request.headers.get("x-booking-token")?.trim() ?? "";
    try {
        const result = await readBooking(id, token);
        if (!result)
            return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
        if ("error" in result) {
            const status = result.error === "BOOKING_DB_NOT_CONFIGURED" ? 503 : 404;
            return NextResponse.json({ error: result.error }, { status, headers: { "Cache-Control": "no-store" } });
        }
        const payload = JSON.parse(result.row.payload_json);
        const booking = {
            ...payload,
            id,
            status: isBookingStatus(result.row.status) ? result.row.status : "AVAILABILITY_CHECK",
            createdAt: result.row.created_at,
            updatedAt: result.row.updated_at,
        };
        return NextResponse.json({ booking }, { headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        console.error("booking-read-failed", error);
        return NextResponse.json({ error: "BOOKING_READ_FAILED" }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
}
export async function PATCH(request, { params }) {
    const { id } = await params;
    const token = request.headers.get("x-booking-token")?.trim() ?? "";
    const db = getBookingDb();
    if (!db)
        return NextResponse.json({ error: "BOOKING_DB_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    try {
        const result = await readBooking(id, token);
        if (!result || "error" in result) {
            const errorCode = result && "error" in result ? result.error : "BOOKING_NOT_FOUND";
            const status = errorCode === "BOOKING_DB_NOT_CONFIGURED" ? 503 : 404;
            return NextResponse.json({ error: errorCode }, { status, headers: { "Cache-Control": "no-store" } });
        }
        const body = await request.json().catch(() => null);
        const nextProfile = parseProfile(body?.profile);
        if (!nextProfile)
            return NextResponse.json({ error: "PROFILE_INVALID" }, { status: 400, headers: { "Cache-Control": "no-store" } });
        const payload = JSON.parse(result.row.payload_json);
        payload.pilgrimProfile = nextProfile;
        const now = new Date().toISOString();
        await result.db.batch([
            result.db.prepare("UPDATE bookings SET payload_json = ?, updated_at = ? WHERE id = ? AND access_token_hash = ?")
                .bind(JSON.stringify(payload), now, id, result.tokenHash),
            result.db.prepare("INSERT INTO booking_events (booking_id, status, actor_type, actor_id, note, created_at) VALUES (?, ?, 'system', 'web-booking-profile', ?, ?)")
                .bind(id, isBookingStatus(result.row.status) ? result.row.status : "AVAILABILITY_CHECK", "Pilgrim profile updated from web booking page.", now),
        ]);
        return NextResponse.json({
            ok: true,
            profile: nextProfile,
            booking: {
                ...payload,
                id,
                status: isBookingStatus(result.row.status) ? result.row.status : "AVAILABILITY_CHECK",
                createdAt: result.row.created_at,
                updatedAt: now,
            },
        }, { headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        console.error("booking-profile-update-failed", error);
        return NextResponse.json({ error: "BOOKING_UPDATE_FAILED" }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
}
