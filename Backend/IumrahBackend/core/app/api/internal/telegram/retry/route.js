// Ported from iumrah-web-main 5.zip: app/api/internal/telegram/retry/route.ts
import { requestEnv, backendFetch } from "../../../../../runtime.js";
import { NextResponse } from "../../../../../runtime.js";
import { ensureBookingSchema, getBookingDb, isBookingStatus } from "../../../../../lib/booking-store.js";
import { deliverTelegramNotice, ensureTelegramBookingSchema } from "../../../../../lib/telegram-booking.js";
import { getCloudflareContext } from "../../../../../runtime.js";
export const dynamic = "force-dynamic";
// Optional secure cron endpoint (every 1-5 minutes) for transient Telegram/network failures.
// Never expose the retry secret to clients. Does NOT send messages to unconsented users.
export async function POST(request) {
    let secret = "";
    try {
        secret = getCloudflareContext().env.IUMRAH_TELEGRAM_RETRY_SECRET || "";
    }
    catch {
        secret = requestEnv().IUMRAH_TELEGRAM_RETRY_SECRET || "";
    }
    if (!secret || secret.length < 24 || request.headers.get("authorization") !== `Bearer ${secret}`)
        return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const db = getBookingDb();
    if (!db)
        return NextResponse.json({ error: "BOOKING_DB_NOT_CONFIGURED" }, { status: 503 });
    try {
        await ensureBookingSchema(db);
        await ensureTelegramBookingSchema(db);
        const pending = await db.prepare(`SELECT o.booking_id, o.status
      FROM booking_telegram_outbox o
      JOIN booking_telegram_subscriptions s ON s.booking_id = o.booking_id AND s.disabled_at IS NULL
      WHERE o.delivered_at IS NULL AND o.attempts < 8
      ORDER BY o.created_at ASC LIMIT 25`).all();
        let delivered = 0;
        for (const row of pending.results) {
            if (isBookingStatus(row.status) && await deliverTelegramNotice(db, row.booking_id, row.status))
                delivered += 1;
        }
        return NextResponse.json({ processed: pending.results.length, delivered }, { headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        console.error("telegram-notice-retry-failed", error);
        return NextResponse.json({ error: "NOTIFICATION_RETRY_FAILED" }, { status: 500 });
    }
}
