/**
 * Public, read-only booking shares. No personal data or booking access token
 * is ever included in a share response. A public token is NOT an ownership grant.
 */
import type { Env } from "./env";

const BOOKING_ID = /^IUM-\d{4}-[A-Z2-9]{7}$/;
const SHARE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const VALID_STATES = new Set([
  "availability_check", "payment_pending", "booking_confirmed", "ready_to_travel",
  "in_trip", "completed", "cancelled",
]);
function publicStatus(raw: string) {
  const alias: Record<string, string> = {
    new: "availability_check", pending: "availability_check", requested: "availability_check",
    checking: "availability_check", availability_confirmed: "payment_pending",
    awaiting_payment: "payment_pending", pending_payment: "payment_pending",
    paid: "booking_confirmed", confirmed: "booking_confirmed", paid_confirmed: "booking_confirmed",
    payment_confirmed: "booking_confirmed", documents_ready: "ready_to_travel",
    ready: "ready_to_travel", traveling: "in_trip",
  };
  const value = alias[raw] ?? raw;
  return VALID_STATES.has(value) ? value : "unknown";
}
function publicVisaType(input: unknown): "tourist" | "tourist_multiple" | "umrah" | null {
  const value = text(input, 40).toLowerCase().replace(/[ -]/g,"_");
  if (["tourist_multiple", "multiple_entry_tourist", "tourist_multivisa"].includes(value)) return "tourist_multiple";
  if (["tourist", "tourism", "evisa"].includes(value)) return "tourist";
  if (["umrah", "umra"].includes(value)) return "umrah";
  return null;
}

interface ShareRow { booking_id: string; expires_at: string; revoked_at: string | null }
interface BookingRow { status: string; payload_json: string }
type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const object = (v: unknown): Obj => isObj(v) ? v : {};
const text = (v: unknown, cap = 130): string => typeof v === "string" ? v.trim().slice(0, cap) : "";
const isoDate = (v: unknown): string | null => typeof v === "string" && /^\d{4}-\d{2}-\d{2}(?:T[\d:.Z+-]+)?$/.test(v) ? v : null;
const positiveInt = (v: unknown): number | null => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 100 ? Number(v) : null;
const safeAirport = (v: unknown): string | null => /^[A-Z]{3}$/.test(text(v)) ? text(v) : null;
const safeFlightNumber = (v: unknown): string | null => {
  const candidate = Array.isArray(v) ? v.filter(item => typeof item === "string").join(" · ") : v;
  return /^[A-Z0-9 .·-]{2,80}$/i.test(text(candidate, 80)) ? text(candidate, 80) : null;
};
const safeName = (v: unknown): string | null => text(v, 100) || null;
function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" } });
}
function bytesHex(a: Uint8Array) { return Array.from(a, b => b.toString(16).padStart(2,"0")).join(""); }
async function sha256(value: string) { return bytesHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))); }
function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  // base64url with no padding, exactly 43 characters.
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
// Schema is installed by the unified backend deployment migration, never on each viewer request.
async function ownerBooking(request: Request, db: NonNullable<Env["BOOKINGS_DB"]>, hotelsDb: Env["HOTELS_DB"], bookingId: string): Promise<boolean> {
  if (!BOOKING_ID.test(bookingId)) return false;
  const token = request.headers.get("x-booking-token")?.trim() ?? "";
  if (token.length >= 24 && token.length <= 128) {
    const row = await db.prepare("SELECT id FROM bookings WHERE id=?1 AND access_token_hash=?2 LIMIT 1")
      .bind(bookingId, await sha256(token)).first<{ id: string }>();
    if (row) return true;
  }
  // Verify the account session against the same D1 ownership model used by
  // itinerary-planner. Do not make a network call to a public host or trust
  // a successful arbitrary GET response as evidence of ownership.
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (!/^Bearer\s+\S+$/i.test(authorization) || !hotelsDb) return false;
  const accountToken = authorization.replace(/^Bearer\s+/i, "").trim();
  if (accountToken.length < 16 || accountToken.length > 256) return false;
  const session = await hotelsDb.prepare(
    `SELECT pilgrim_id FROM iumrah_account_sessions
     WHERE token_hash=?1 AND revoked_at IS NULL AND expires_at>?2 LIMIT 1`,
  ).bind(await sha256(accountToken), new Date().toISOString()).first<{ pilgrim_id: number }>();
  const pilgrimId = Number(session?.pilgrim_id ?? 0);
  if (!Number.isSafeInteger(pilgrimId) || pilgrimId <= 0) return false;
  const linked = await hotelsDb.prepare(
    "SELECT booking_id FROM pilgrim_trips WHERE booking_id=?1 AND pilgrim_id=?2 LIMIT 1",
  ).bind(bookingId, pilgrimId).first<{ booking_id: string }>();
  if (!linked) return false;
  const row = await db.prepare("SELECT id FROM bookings WHERE id=?1 LIMIT 1").bind(bookingId).first<{ id: string }>();
  return Boolean(row);
}

/** Only explicitly whitelisted, public itinerary fields. Never spread a booking payload. */
export function publicBookingProjection(row: BookingRow) {
  let parsed: Obj = {};
  try { parsed = object(JSON.parse(row.payload_json)); } catch { /* absent data */ }
  const booking = object(parsed.booking ?? parsed);
  const input = object(booking.input);
  const stay = object(booking.stay);
  const hotels = object(booking.hotelNames);
  const customization = object(booking.customization);
  const trace = object(booking.generatorTrace);
  const route = object(booking.route);
  const select = object(booking.selection);
  const legacyMakkah = object(booking.hotelSelection);
  const legacyMadinah = object(booking.madinahHotelSelection);
  const legacy = object(booking.selectionDetails);
  // A booked flight is not necessarily ticketed. Publish readiness only when
  // a dedicated recorded issuance flag/status exists, never from route presence.
  // Status fields inside the original client payload are NOT sufficient proof
  // of issuance. Only the operational, published staff document ledger can
  // advance the public status. A customer must not be able to forge "visa ready".
  function leg(value: unknown) {
    const v = object(value);
    return {
      airline: safeName(v.airline), number: safeFlightNumber(v.flightNumbers ?? v.flightNumber),
      origin: safeAirport(v.origin), destination: safeAirport(v.destination),
      departureAt: isoDate(v.departureAt), arrivalAt: isoDate(v.arrivalAt),
    };
  }
  const rawStatus = text(row.status || booking.status, 50).toLowerCase();
  return {
    schemaVersion: 1,
    status: publicStatus(rawStatus),
    dates: { start: isoDate(input.startDate), end: isoDate(input.endDate) },
    route: { origin: safeAirport(route.originCode ?? input.originCode), arrival: safeAirport(route.outboundDestination), returnOrigin: safeAirport(route.returnOrigin) },
    hotels: [
      { city: "makkah", name: safeName(hotels.makkah || legacyMakkah.hotelName || object(trace.makkahHotel).hotelName || object(legacy.makkahHotel).name), room: safeName(object(trace.makkahHotel).roomName), checkin: isoDate(stay.makkahCheckIn), checkout: isoDate(stay.makkahCheckOut), nights: positiveInt(stay.makkahNights), hotelId: safeName(select.makkahHotelId) },
      { city: "madinah", name: safeName(hotels.madinah || legacyMadinah.hotelName || object(trace.madinahHotel).hotelName || object(legacy.madinahHotel).name), room: safeName(object(trace.madinahHotel).roomName), checkin: isoDate(stay.madinahCheckIn), checkout: isoDate(stay.madinahCheckOut), nights: positiveInt(stay.madinahNights), hotelId: safeName(select.madinahHotelId) },
    ].filter(h => h.name && h.nights !== 0),
    flights: { outbound: leg(trace.outbound), inbound: leg(trace.inbound) },
    services: {
      guide: customization.accompaniment === true,
      makkahZiyarat: customization.ziyaratMakkah === true,
      madinahZiyarat: customization.ziyaratMadinah === true,
      meals: customization.meals === true,
      esim: customization.esim === true,
    },
    documents: {
      visa: { status: "not_confirmed", type: null as "tourist" | "tourist_multiple" | "umrah" | null, generalRulesOnly: true },
      flightTickets: { status: "not_confirmed" },
    },
    permissions: { viewer: true, canManage: false, canPay: false, canEdit: false, canViewDocuments: false },
  };
}

/** Public operational overrides are explicit and never contain identifiers, PDFs, names or PNRs.
 * The canonical Business operations DB may be behind the booking snapshot; only
 * use records that were explicitly verified/published, and never infer a ready
 * visa from simply having selected the visa service. */
async function operationalProjection(hotelsDb: Env["HOTELS_DB"], bookingId: string, row: BookingRow, trip: ReturnType<typeof publicBookingProjection>) {
  if (!hotelsDb) return trip;
  const operation = await hotelsDb.prepare(
    "SELECT status FROM pilgrim_trips WHERE booking_id=?1 LIMIT 1",
  ).bind(bookingId).first<{status: string}>();
  if (operation?.status) trip.status = publicStatus(text(operation.status, 50).toLowerCase());

  // Apply verified staff flight amendments. Never include reservation or check-in references.
  const flightRows = await hotelsDb.prepare(
    `SELECT direction, airline_name, flight_number, departure_airport_iata, arrival_airport_iata,
            scheduled_departure_local, scheduled_arrival_local, verified_at
       FROM trip_flights WHERE booking_id=?1`,
  ).bind(bookingId).all<{
    direction: string; airline_name: string; flight_number: string;
    departure_airport_iata: string; arrival_airport_iata: string;
    scheduled_departure_local: string; scheduled_arrival_local: string; verified_at: string | null;
  }>();
  for (const flight of flightRows.results ?? []) {
    if (!flight.verified_at) continue;
    const leg = flight.direction === "outbound" ? trip.flights.outbound : flight.direction === "return" ? trip.flights.inbound : null;
    if (!leg) continue;
    leg.airline = safeName(flight.airline_name) || leg.airline;
    leg.number = safeFlightNumber(flight.flight_number) || leg.number;
    leg.origin = safeAirport(flight.departure_airport_iata) || leg.origin;
    leg.destination = safeAirport(flight.arrival_airport_iata) || leg.destination;
    leg.departureAt = isoDate(flight.scheduled_departure_local) || leg.departureAt;
    leg.arrivalAt = isoDate(flight.scheduled_arrival_local) || leg.arrivalAt;
  }

  // A ready status requires every booked person's required published visa/ticket slot.
  // We deliberately query only type/publication/slots, never content or object keys.
  const docRows = await hotelsDb.prepare(
    `SELECT d.document_kind AS kind, COALESCE(p.publication_status,'published') AS state,
            COALESCE(p.slots_json,'[]') AS slots
       FROM booking_travel_documents d
       LEFT JOIN booking_document_publication_v3 p
         ON p.document_id=d.id AND p.booking_id=d.booking_id
      WHERE d.booking_id=?1 AND d.document_kind IN ('visa','ticket')`,
  ).bind(bookingId).all<{kind: string; state: string; slots: string}>();
  const published = new Set<string>();
  for (const d of docRows.results ?? []) {
    if (d.state !== "published") continue;
    let slots: unknown = null;
    try { slots = JSON.parse(d.slots); } catch { /* invalid slots never indicate readiness */ }
    if (!Array.isArray(slots)) continue;
    for (const s of slots) if (typeof s === "string" && (d.kind === "visa" ? /^visa:[1-9]\d*$/.test(s) : /^ticket:(?:inbound|outbound):[1-9]\d*$/.test(s))) published.add(s);
  }
  // Occupancy is not exposed in the public response: consult canonical booking summary only.
  // Count from HOTELS_DB, which is also used for Business document requirements.
  const people = await hotelsDb.prepare("SELECT COUNT(*) AS n FROM booking_travelers WHERE booking_id=?1")
    .bind(bookingId).first<{n: number}>();
  const count = Number(people?.n ?? 0);
  if (Number.isInteger(count) && count > 0 && count <= 60) {
    const visa = Array.from({length:count},(_,i)=>`visa:${i+1}`).every(s=>published.has(s));
    const tickets = Array.from({length:count},(_,i)=>["outbound","inbound"].every(d=>published.has(`ticket:${d}:${i+1}`))).every(Boolean);
    trip.documents.visa.status = visa ? "ready" : "not_confirmed";
    if (visa) {
      try {
        const source = object(JSON.parse(row.payload_json));
        const booking = object(source.booking ?? source);
        const visaDetails = object(object(booking.documents).visa);
        trip.documents.visa.type = publicVisaType(visaDetails.type ?? booking.visaType);
      } catch { trip.documents.visa.type = null; }
    } else trip.documents.visa.type = null;
    trip.documents.flightTickets.status = tickets ? "ready" : "not_confirmed";
  } else {
    // Missing operational traveler data must not claim documents are ready.
    trip.documents.visa.status = "not_confirmed";
    trip.documents.visa.type = null;
    trip.documents.flightTickets.status = "not_confirmed";
  }
  return trip;
}

/** POST owner-verified create; DELETE owner-verified revoke all; GET public by token. */
export async function handleBookingShare(request: Request, env: Env, url: URL): Promise<Response> {
  const db = env.BOOKINGS_DB;
  if (!db || !env.HOTELS_DB) return response({ ok: false, error: "SHARING_UNAVAILABLE" }, 503);
  const match = /^\/api\/package\/booking\/(IUM-\d{4}-[A-Z2-9]{7})\/share$/.exec(url.pathname);
  const publicMatch = /^\/api\/package\/shares\/([A-Za-z0-9_-]{43})$/.exec(url.pathname);
  if (!match && !publicMatch) return response({ ok: false, error: "NOT_FOUND" }, 404);
  if (publicMatch && request.method !== "GET") return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (match && !["POST","DELETE"].includes(request.method)) return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    if (publicMatch) {
      const token = publicMatch[1];
      if (!SHARE_TOKEN.test(token)) return response({ ok: false, error: "NOT_FOUND" }, 404);
      const share = await db.prepare("SELECT booking_id,expires_at,revoked_at FROM booking_public_shares WHERE token_hash=?1 LIMIT 1")
        .bind(await sha256(token)).first<ShareRow>();
      if (!share || share.revoked_at || Date.parse(share.expires_at) <= Date.now()) return response({ ok: false, error: "LINK_UNAVAILABLE" }, 404);
      const booking = await db.prepare("SELECT status,payload_json FROM bookings WHERE id=?1 LIMIT 1")
        .bind(share.booking_id).first<BookingRow>();
      if (!booking) return response({ ok: false, error: "LINK_UNAVAILABLE" }, 404);
      const trip = await operationalProjection(env.HOTELS_DB, share.booking_id, booking, publicBookingProjection(booking));
      return response({ ok: true, trip });
    }
    const id = match![1];
    if (!await ownerBooking(request, db, env.HOTELS_DB, id)) return response({ ok: false, error: "NOT_FOUND" }, 404);
    if (request.method === "DELETE") {
      await db.prepare("UPDATE booking_public_shares SET revoked_at=?1 WHERE booking_id=?2 AND revoked_at IS NULL")
        .bind(new Date().toISOString(), id).run();
      return response({ ok: true, revoked: true });
    }
    const token = generateToken();
    const now = new Date();
    const expires = new Date(now.getTime() + 180 * 86400000);
    await db.prepare("INSERT INTO booking_public_shares (token_hash,booking_id,created_at,expires_at,revoked_at) VALUES (?1,?2,?3,?4,NULL)")
      .bind(await sha256(token), id, now.toISOString(), expires.toISOString()).run();
    return response({ ok: true, shareURL: `https://iumrah.app/s/${token}`, expiresAt: expires.toISOString(), permissions: "viewer" }, 201);
  } catch (err) {
    console.error("booking-public-share-failed", err);
    return response({ ok: false, error: "SHARING_UNAVAILABLE" }, 503);
  }
}
