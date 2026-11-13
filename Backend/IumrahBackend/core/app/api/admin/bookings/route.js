// Ported from iumrah-web-main 5.zip: app/api/admin/bookings/route.ts
import { requestEnv, backendFetch } from "../../../../runtime.js";
import { NextResponse } from "../../../../runtime.js";
import { readCookie, STAFF_SESSION_COOKIE, verifyStaffSessionToken } from "../../../../lib/staff-auth.js";
import { ensureBookingSchema, getBookingDb, rowToSummary } from "../../../../lib/booking-store.js";
export const dynamic = "force-dynamic";
export async function GET(request) {
    const token = readCookie(request.headers.get("cookie"), STAFF_SESSION_COOKIE);
    const session = await verifyStaffSessionToken(token);
    if (!session)
        return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const db = getBookingDb();
    if (!db)
        return NextResponse.json({ error: "BOOKING_DB_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    try {
        await ensureBookingSchema(db);
        const rows = await db.prepare(`SELECT id, status, created_at, updated_at, lang, plan_id, total_cents,
      per_pilgrim_cents, traveler_count, rooms, origin_code, outbound_destination, return_origin,
      start_date, end_date, flight_name, makkah_hotel, madinah_hotel
      FROM bookings ORDER BY created_at DESC LIMIT 100`).all();
        const bookings = rows.results.map(rowToSummary);
        return NextResponse.json({ bookings }, { headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        console.error("admin-bookings-list-failed", error);
        return NextResponse.json({ error: "BOOKINGS_LIST_FAILED" }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
}
