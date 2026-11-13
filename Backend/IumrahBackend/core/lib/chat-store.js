// Ported from iumrah-web-main 5.zip: lib/chat-store.ts
import { requestEnv, backendFetch } from "../runtime.js";
import { ensureBookingSchema, getBookingDb, hashBookingToken, rowToSummary, } from "./booking-store.js";
let chatSchemaReady = null;
export async function ensureChatSchema(db) {
    await ensureBookingSchema(db);
    if (!chatSchemaReady) {
        chatSchemaReady = db.batch([
            db.prepare(`CREATE TABLE IF NOT EXISTS chat_threads (
        booking_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_message_at TEXT NOT NULL DEFAULT '',
        last_message_preview TEXT NOT NULL DEFAULT '',
        last_sender_type TEXT,
        pilgrim_last_read_at TEXT,
        staff_last_read_at TEXT,
        FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
      )`),
            db.prepare(`CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        booking_id TEXT NOT NULL,
        sender_type TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
      )`),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_chat_messages_booking_id ON chat_messages(booking_id, id DESC)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_chat_threads_updated ON chat_threads(updated_at DESC)"),
        ]).then(() => undefined).catch((error) => {
            chatSchemaReady = null;
            throw error;
        });
    }
    await chatSchemaReady;
}
export function getChatDb() {
    return getBookingDb();
}
export function validBookingId(id) {
    return /^IUM-\d{4}-[A-Z2-9]{7}$/.test(id);
}
export async function authorizePilgrimBooking(db, bookingId, token) {
    if (!validBookingId(bookingId) || token.length < 24 || token.length > 128)
        return null;
    const tokenHash = await hashBookingToken(token);
    return db.prepare(`SELECT id, status, created_at, updated_at, lang, plan_id, total_cents,
    per_pilgrim_cents, traveler_count, rooms, origin_code, outbound_destination, return_origin,
    start_date, end_date, flight_name, makkah_hotel, madinah_hotel
    FROM bookings WHERE id = ? AND access_token_hash = ? LIMIT 1`)
        .bind(bookingId, tokenHash)
        .first();
}
export async function ensureThread(db, bookingId, now = new Date().toISOString()) {
    await db.prepare(`INSERT INTO chat_threads (booking_id, created_at, updated_at)
    VALUES (?, ?, ?) ON CONFLICT(booking_id) DO NOTHING`).bind(bookingId, now, now).run();
}
export async function readMessages(db, bookingId, limit = 120) {
    const rows = await db.prepare(`SELECT id, booking_id, sender_type, sender_id, body, created_at
    FROM chat_messages WHERE booking_id = ? ORDER BY id DESC LIMIT ?`).bind(bookingId, limit).all();
    return rows.results.reverse().map((row) => ({
        id: Number(row.id ?? 0),
        bookingId: String(row.booking_id ?? bookingId),
        senderType: row.sender_type === "staff" ? "staff" : "pilgrim",
        senderId: String(row.sender_id ?? ""),
        body: String(row.body ?? ""),
        createdAt: String(row.created_at ?? ""),
    }));
}
export async function markRead(db, bookingId, reader, now = new Date().toISOString()) {
    const thread = await db.prepare(`SELECT last_message_at, last_sender_type, pilgrim_last_read_at, staff_last_read_at
    FROM chat_threads WHERE booking_id = ? LIMIT 1`).bind(bookingId).first();
    if (!thread)
        return;
    const lastSender = thread.last_sender_type === "staff" ? "staff" : thread.last_sender_type === "pilgrim" ? "pilgrim" : null;
    const lastMessageAt = String(thread.last_message_at ?? "");
    const lastReadAt = String(reader === "staff" ? thread.staff_last_read_at ?? "" : thread.pilgrim_last_read_at ?? "");
    if (!lastMessageAt || lastSender === reader || lastReadAt >= lastMessageAt)
        return;
    const column = reader === "staff" ? "staff_last_read_at" : "pilgrim_last_read_at";
    await db.prepare(`UPDATE chat_threads SET ${column} = ? WHERE booking_id = ?`).bind(now, bookingId).run();
}
export async function insertMessage(db, bookingId, senderType, senderId, body) {
    const now = new Date().toISOString();
    await ensureThread(db, bookingId, now);
    const recent = await db.prepare(`SELECT COUNT(*) AS count FROM chat_messages
    WHERE booking_id = ? AND sender_type = ? AND created_at >= ?`)
        .bind(bookingId, senderType, new Date(Date.now() - 60_000).toISOString())
        .first();
    if (Number(recent?.count ?? 0) >= 15)
        throw new Error("CHAT_RATE_LIMIT");
    const preview = body.replace(/\s+/g, " ").slice(0, 160);
    await db.batch([
        db.prepare(`INSERT INTO chat_messages (booking_id, sender_type, sender_id, body, created_at)
      VALUES (?, ?, ?, ?, ?)`).bind(bookingId, senderType, senderId, body, now),
        db.prepare(`UPDATE chat_threads SET updated_at = ?, last_message_at = ?, last_message_preview = ?, last_sender_type = ?
      WHERE booking_id = ?`).bind(now, now, preview, senderType, bookingId),
    ]);
    const row = await db.prepare(`SELECT id, booking_id, sender_type, sender_id, body, created_at
    FROM chat_messages WHERE booking_id = ? ORDER BY id DESC LIMIT 1`).bind(bookingId).first();
    return row ? {
        id: Number(row.id ?? 0), bookingId: String(row.booking_id ?? bookingId),
        senderType: row.sender_type === "staff" ? "staff" : "pilgrim",
        senderId: String(row.sender_id ?? ""), body: String(row.body ?? ""), createdAt: String(row.created_at ?? now),
    } : null;
}
export async function listChatThreads(db) {
    const rows = await db.prepare(`SELECT b.id, b.status, b.created_at, b.updated_at, b.lang, b.plan_id,
      b.total_cents, b.per_pilgrim_cents, b.traveler_count, b.rooms, b.origin_code,
      b.outbound_destination, b.return_origin, b.start_date, b.end_date, b.flight_name,
      b.makkah_hotel, b.madinah_hotel,
      t.last_message_at, t.last_message_preview, t.last_sender_type, t.staff_last_read_at
    FROM chat_threads t JOIN bookings b ON b.id = t.booking_id
    WHERE t.last_message_at != ''
    ORDER BY t.last_message_at DESC LIMIT 100`).all();
    return rows.results.map((row) => {
        const lastSenderType = row.last_sender_type === "staff" ? "staff" : row.last_sender_type === "pilgrim" ? "pilgrim" : null;
        const lastMessageAt = String(row.last_message_at ?? "");
        const staffLastReadAt = String(row.staff_last_read_at ?? "");
        return {
            booking: rowToSummary(row),
            lastMessageAt,
            lastMessagePreview: String(row.last_message_preview ?? ""),
            lastSenderType,
            unreadForStaff: lastSenderType === "pilgrim" && (!staffLastReadAt || staffLastReadAt < lastMessageAt),
        };
    });
}
