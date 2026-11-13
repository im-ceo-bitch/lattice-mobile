// Ported from iumrah-web-main 5.zip: lib/booking-store.ts
import { requestEnv, backendFetch } from "../runtime.js";
import { getCloudflareContext } from "../runtime.js";
export const bookingStatuses = [
    "AVAILABILITY_CHECK",
    "PAYMENT_PENDING",
    "BOOKING_CONFIRMED",
    "READY_TO_TRAVEL",
    "COMPLETED",
];
let schemaReady = null;
export function getPassportBucket() {
    try {
        const env = getCloudflareContext().env;
        return env.PASSPORTS ?? null;
    }
    catch {
        return null;
    }
}
export function getBookingDb() {
    try {
        const env = getCloudflareContext().env;
        return env.DB ?? null;
    }
    catch {
        return null;
    }
}
export async function ensureBookingSchema(db) {
    if (!schemaReady) {
        schemaReady = (async () => {
            await db.batch([
                db.prepare(`CREATE TABLE IF NOT EXISTS bookings (
          id TEXT PRIMARY KEY,
          access_token_hash TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          lang TEXT NOT NULL,
          plan_id TEXT NOT NULL,
          total_cents INTEGER NOT NULL,
          per_pilgrim_cents INTEGER NOT NULL,
          traveler_count INTEGER NOT NULL,
          rooms INTEGER NOT NULL,
          origin_code TEXT NOT NULL,
          outbound_destination TEXT NOT NULL,
          return_origin TEXT NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          flight_name TEXT NOT NULL DEFAULT '',
          makkah_hotel TEXT NOT NULL DEFAULT '',
          madinah_hotel TEXT NOT NULL DEFAULT '',
          payload_json TEXT NOT NULL,
          confirmed_at TEXT
        )`),
                db.prepare("CREATE INDEX IF NOT EXISTS idx_bookings_status_created ON bookings(status, created_at DESC)"),
                db.prepare("CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings(created_at DESC)"),
                db.prepare(`CREATE TABLE IF NOT EXISTS booking_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          booking_id TEXT NOT NULL,
          status TEXT NOT NULL,
          actor_type TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
        )`),
                db.prepare("CREATE INDEX IF NOT EXISTS idx_booking_events_booking ON booking_events(booking_id, created_at DESC)"),
                db.prepare(`CREATE TABLE IF NOT EXISTS booking_documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          booking_id TEXT NOT NULL,
          traveler_index INTEGER NOT NULL,
          kind TEXT NOT NULL,
          r2_key TEXT NOT NULL,
          file_name TEXT NOT NULL,
          content_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
        )`),
                db.prepare("CREATE INDEX IF NOT EXISTS idx_booking_documents_booking ON booking_documents(booking_id, traveler_index, id)"),
            ]);
        })().catch((error) => {
            schemaReady = null;
            throw error;
        });
    }
    await schemaReady;
}
function bytesToHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function hashBookingToken(token) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return bytesToHex(new Uint8Array(digest));
}
export function makeBookingToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    let binary = "";
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
export function makeBookingId(year) {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(7));
    let suffix = "";
    for (const byte of bytes)
        suffix += alphabet[byte % alphabet.length];
    return `IUM-${/^\d{4}$/.test(year) ? year : new Date().getUTCFullYear()}-${suffix}`;
}
export function isBookingStatus(value) {
    return typeof value === "string" && bookingStatuses.includes(value);
}
export function cents(value) {
    return Math.round(Math.max(0, value) * 100);
}
export function dollars(value) {
    return Math.max(0, value) / 100;
}
export function normalizeLanguage(value) {
    return value === "uz" || value === "uz-cyrl" || value === "en" || value === "tr" || value === "id" || value === "ms" ? value : "ru";
}
export function rowToSummary(row) {
    return {
        id: String(row.id ?? ""),
        status: isBookingStatus(row.status) ? row.status : "AVAILABILITY_CHECK",
        createdAt: String(row.created_at ?? ""),
        updatedAt: String(row.updated_at ?? row.created_at ?? ""),
        lang: normalizeLanguage(row.lang),
        planId: (row.plan_id === "standard" || row.plan_id === "comfort" || row.plan_id === "luxury" ? row.plan_id : "economy"),
        totalUsd: dollars(Number(row.total_cents ?? 0)),
        perPilgrimUsd: dollars(Number(row.per_pilgrim_cents ?? 0)),
        travelerCount: Number(row.traveler_count ?? 0),
        rooms: Number(row.rooms ?? 1),
        originCode: String(row.origin_code ?? ""),
        outboundDestination: row.outbound_destination === "MED" ? "MED" : "JED",
        returnOrigin: row.return_origin === "MED" ? "MED" : "JED",
        startDate: String(row.start_date ?? ""),
        endDate: String(row.end_date ?? ""),
        flightName: String(row.flight_name ?? ""),
        makkahHotel: String(row.makkah_hotel ?? ""),
        madinahHotel: String(row.madinah_hotel ?? ""),
    };
}
