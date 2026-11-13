// Ported from iumrah-web-main 5.zip: app/api/admin/bookings/[id]/documents/[documentId]/route.ts
import { requestEnv, backendFetch } from "../../../../../../../runtime.js";
import { readCookie, STAFF_SESSION_COOKIE, verifyStaffSessionToken } from "../../../../../../../lib/staff-auth.js";
import { ensureBookingSchema, getBookingDb, getPassportBucket } from "../../../../../../../lib/booking-store.js";
export const dynamic = "force-dynamic";
export async function GET(request, { params }) {
    const token = readCookie(request.headers.get("cookie"), STAFF_SESSION_COOKIE);
    const session = await verifyStaffSessionToken(token);
    if (!session)
        return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
    const { id, documentId } = await params;
    const numericId = Number(documentId);
    if (!/^IUM-\d{4}-[A-Z2-9]{7}$/.test(id) || !Number.isInteger(numericId) || numericId <= 0)
        return new Response("Not found", { status: 404 });
    const db = getBookingDb();
    const bucket = getPassportBucket();
    if (!db || !bucket)
        return new Response("Storage unavailable", { status: 503 });
    try {
        await ensureBookingSchema(db);
        const row = await db.prepare("SELECT r2_key, file_name, content_type FROM booking_documents WHERE booking_id = ? AND id = ? LIMIT 1")
            .bind(id, numericId).first();
        if (!row)
            return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
        const object = await bucket.get(row.r2_key);
        if (!object)
            return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
        const filename = String(row.file_name || "passport").replace(/[\r\n"]/g, "_");
        return new Response(object.body, {
            headers: {
                "Content-Type": row.content_type || object.httpMetadata?.contentType || "application/octet-stream",
                "Content-Disposition": `inline; filename="${filename}"`,
                "Cache-Control": "private, no-store, max-age=0",
                "X-Content-Type-Options": "nosniff",
            },
        });
    }
    catch (error) {
        console.error("admin-booking-document-read-failed", error);
        return new Response("Document unavailable", { status: 500, headers: { "Cache-Control": "no-store" } });
    }
}
