import type { D1Like } from "./d1";
import type { Env } from "./env";
import type { GeneratorPricingSnapshot } from "./pricing";
import { unsealPricingSnapshot } from "./quote-audit";

type BookingDB = D1Like;
type BookingRow = { id: string; payload_json: string };
type PricingTripRow = { id: string; pricing_snapshot_json: string | null };
type PendingPricingRow = { booking_id: string; quote_id: string; pricing_snapshot_json: string };

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function validBookingID(value: string) {
  return /^IUM-\d{4}-[A-Z2-9]{7}$/.test(value);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authorizedBooking(request: Request, id: string, db: BookingDB): Promise<BookingRow | null> {
  if (!validBookingID(id)) return null;
  const token = String(request.headers.get("x-booking-token") ?? "").trim();
  if (token.length < 24 || token.length > 128) return null;
  const hash = await sha256Hex(token);
  return db.prepare(
    "SELECT id,payload_json FROM bookings WHERE id=?1 AND access_token_hash=?2 LIMIT 1",
  ).bind(id, hash).first<BookingRow>();
}

function bookingObject(rawJSON: string): Record<string, any> {
  const raw = JSON.parse(rawJSON || "{}") as Record<string, any>;
  return raw.booking && typeof raw.booking === "object" ? raw.booking : raw;
}

function sameNumber(a: unknown, b: unknown, tolerance = 0.011) {
  const left = Number(a);
  const right = Number(b);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
}

export function assertBookingMatchesSnapshot(booking: Record<string, any>, snapshot: GeneratorPricingSnapshot) {
  if (snapshot.bookingAllowed === false) throw new Error("SANDBOX_QUOTE_NOT_BOOKABLE");
  if (!sameNumber(booking.totalUsd, snapshot.totals.publicTotalUsd)) throw new Error("BOOKING_QUOTE_TOTAL_MISMATCH");
  if (!sameNumber(booking.perPilgrimUsd, snapshot.totals.publicPricePerPilgrimUsd)) throw new Error("BOOKING_QUOTE_PER_PERSON_MISMATCH");
  if (String(booking.planId ?? booking.input?.preferredPlan ?? "") !== snapshot.context.tier) throw new Error("BOOKING_QUOTE_TIER_MISMATCH");

  const travelers = booking.input?.travelers ?? {};
  const expected = snapshot.context.travelers;
  for (const key of ["adults", "children", "infants", "rooms"] as const) {
    if (Number(travelers[key] ?? -1) !== Number(expected[key])) throw new Error("BOOKING_QUOTE_TRAVELERS_MISMATCH");
  }

  const selection = booking.selection ?? {};
  if (String(selection.makkahHotelId ?? "") !== snapshot.selectedPricingInputs.makkahHotel.hotelId) {
    throw new Error("BOOKING_QUOTE_MAKKAH_HOTEL_MISMATCH");
  }
  const expectedMadinah = snapshot.selectedPricingInputs.madinahHotel?.hotelId ?? "";
  if (String(selection.madinahHotelId ?? "") !== expectedMadinah) throw new Error("BOOKING_QUOTE_MADINAH_HOTEL_MISMATCH");

  const stay = booking.stay ?? {};
  if (Number(stay.makkahNights ?? -1) !== snapshot.selectedPricingInputs.makkahHotel.nights) {
    throw new Error("BOOKING_QUOTE_MAKKAH_NIGHTS_MISMATCH");
  }
  const expectedMadinahNights = snapshot.selectedPricingInputs.madinahHotel?.nights ?? 0;
  if (Number(stay.madinahNights ?? 0) !== expectedMadinahNights) {
    throw new Error("BOOKING_QUOTE_MADINAH_NIGHTS_MISMATCH");
  }

  const traceQuoteID = String(booking.generatorTrace?.quoteId ?? "");
  if (traceQuoteID && traceQuoteID !== snapshot.quoteId) throw new Error("BOOKING_QUOTE_ID_MISMATCH");
}

// Internal only: never expose the decrypted snapshot through a public route.
export async function verifyBookingQuote(booking: Record<string, any>, proof: unknown, env: Env): Promise<{quoteId:string; totalUsd:number; perPilgrimUsd:number}> {
  if (typeof proof !== "string" || !proof.trim() || proof.length > 80_000) throw new Error("QUOTE_PROOF_REQUIRED");
  // The canonical booking path requires the existing dedicated server sealing key.
  if (!String(env.PACKAGE_QUOTE_SEAL_KEY ?? "").trim()) throw new Error("QUOTE_SEAL_NOT_CONFIGURED");
  const snapshot = await unsealPricingSnapshot(proof, env);
  assertBookingMatchesSnapshot(booking, snapshot);
  if (String(booking.generatorTrace?.quoteId ?? "") !== snapshot.quoteId) throw new Error("BOOKING_QUOTE_ID_MISMATCH");
  if (Boolean(booking.input?.includeMadinah) !== snapshot.context.includeMadinah) throw new Error("BOOKING_QUOTE_SCOPE_MISMATCH");
  // New quotes bind the selected itinerary and dates, not just the displayed amount.
  const contract = snapshot.bookingContract;
  if (!contract) throw new Error("BOOKING_QUOTE_REFRESH_REQUIRED");
  const trace = booking.generatorTrace ?? {};
  const outbound = trace.outbound ?? {};
  const inbound = trace.inbound ?? {};
  const sameLeg = (actual: Record<string,any>, expected: {origin:string;destination:string;departureDate:string}) =>
    actual.origin === expected.origin && actual.destination === expected.destination &&
    String(actual.departureAt ?? "").slice(0,10) === expected.departureDate;
  // The client may serialize the time in UTC; use the verified route plus the
  // actual instant when the supplier provides it (otherwise fail closed on date).
  const matchesLeg = (actual: Record<string,any>, expected: typeof contract.legs[number], verified?: {origin:string;destination:string;departureAt:string;arrivalAt:string}|null) => {
    if (actual.origin !== expected.origin || actual.destination !== expected.destination) return false;
    if (verified && (verified.origin !== expected.origin || verified.destination !== expected.destination)) return false;
    if (verified && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(verified.departureAt) && Number.isFinite(Date.parse(verified.departureAt)) && Number.isFinite(Date.parse(actual.departureAt))) {
      return Math.abs(Date.parse(actual.departureAt)-Date.parse(verified.departureAt)) <= 60_000;
    }
    if (sameLeg(actual,expected)) return true;
    const airportZone = ["TAS","FEG","NMA","AZN","SKD","BHK","KSQ","TMJ","UGC","NCU"].includes(expected.origin) ? "Asia/Tashkent" : ["JED","MED","RUH","DMM"].includes(expected.origin) ? "Asia/Riyadh" : null;
    if (!airportZone || !Number.isFinite(Date.parse(actual.departureAt))) return false;
    const localDate = new Intl.DateTimeFormat("en-CA",{timeZone:airportZone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(actual.departureAt));
    return localDate === expected.departureDate;
  };
  if (!contract.legs[0] || !matchesLeg(outbound,contract.legs[0],contract.schedule?.outbound)) throw new Error("BOOKING_QUOTE_FLIGHT_MISMATCH");
  if (contract.legs.length === 2 && !matchesLeg(inbound,contract.legs[1],contract.schedule?.inbound)) throw new Error("BOOKING_QUOTE_FLIGHT_MISMATCH");
  if (booking.route?.originCode !== contract.legs[0].origin || booking.route?.outboundDestination !== contract.legs[0].destination || (contract.legs[1] && booking.route?.returnOrigin !== contract.legs[1].origin)) throw new Error("BOOKING_QUOTE_ROUTE_MISMATCH");
  // Exact selected room ids are part of the encrypted contract. Use the trace
  // because older public selection objects omit the room fields.
  for (const city of ["makkah", "madinah"] as const) {
    const expected = city === "makkah" ? contract.makkahRoomId : contract.madinahRoomId;
    if (expected && String(trace[city+"Hotel"]?.roomId ?? "") !== expected) throw new Error("BOOKING_QUOTE_ROOM_MISMATCH");
  }
  return {quoteId:snapshot.quoteId,totalUsd:snapshot.totals.publicTotalUsd,perPilgrimUsd:snapshot.totals.publicPricePerPilgrimUsd};
}

function parsedObject(value: string | null | undefined): Record<string, unknown> {
  if (!value || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function hasPricingReport(value: string | null | undefined) {
  return Object.keys(parsedObject(value)).length > 0;
}

let pendingPricingSchemaReady = false;

async function ensurePendingPricingSchema(db: D1Like) {
  if (pendingPricingSchemaReady) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS pending_package_pricing_reports (
    booking_id TEXT PRIMARY KEY NOT NULL,
    quote_id TEXT NOT NULL,
    pricing_version TEXT NOT NULL,
    pricing_snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_pending_package_pricing_reports_quote_id ON pending_package_pricing_reports(quote_id)",
  ).run();
  pendingPricingSchemaReady = true;
}

async function clearPendingPricingReport(db: D1Like, bookingID: string) {
  await db.prepare("DELETE FROM pending_package_pricing_reports WHERE booking_id=?1").bind(bookingID).run();
}

async function persistPendingPricingReport(db: D1Like, bookingID: string, snapshot: GeneratorPricingSnapshot) {
  const existing = await db.prepare(
    "SELECT booking_id,quote_id,pricing_snapshot_json FROM pending_package_pricing_reports WHERE booking_id=?1 LIMIT 1",
  ).bind(bookingID).first<PendingPricingRow>();
  if (existing && existing.quote_id !== snapshot.quoteId) throw new Error("PRICING_REPORT_PENDING_CONFLICT");

  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO pending_package_pricing_reports
       (booking_id,quote_id,pricing_version,pricing_snapshot_json,created_at,updated_at)
     VALUES (?1,?2,?3,?4,?5,?5)
     ON CONFLICT(booking_id) DO UPDATE SET
       pricing_version=excluded.pricing_version,
       pricing_snapshot_json=excluded.pricing_snapshot_json,
       updated_at=excluded.updated_at
     WHERE pending_package_pricing_reports.quote_id=excluded.quote_id`,
  ).bind(bookingID, snapshot.quoteId, snapshot.pricingVersion, JSON.stringify(snapshot), now).run();
}

async function attachOrQueuePricingReport(db: D1Like, bookingID: string, snapshot: GeneratorPricingSnapshot): Promise<"committed" | "pending" | "idempotent"> {
  // The repository ZIP applier intentionally protects .github/workflows, so a
  // code-only root update must remain deployable with the existing workflow.
  // Create the post-booking durability table lazily and idempotently here.
  // This function is reached only after a real token-authorized booking exists;
  // configurator previews still perform zero D1 writes.
  await ensurePendingPricingSchema(db);

  const trip = await db.prepare(
    "SELECT id,pricing_snapshot_json FROM pilgrim_trips WHERE booking_id=?1 LIMIT 1",
  ).bind(bookingID).first<PricingTripRow>();

  if (!trip) {
    await persistPendingPricingReport(db, bookingID, snapshot);
    return "pending";
  }

  if (hasPricingReport(trip.pricing_snapshot_json)) {
    const existing = parsedObject(trip.pricing_snapshot_json);
    if (String(existing.quoteId ?? "") === snapshot.quoteId) {
      await clearPendingPricingReport(db, bookingID);
      return "idempotent";
    }
    throw new Error("PRICING_REPORT_ALREADY_COMMITTED");
  }

  const now = new Date().toISOString();
  const result = await db.prepare(
    `UPDATE pilgrim_trips
     SET pricing_snapshot_json=?1, updated_at=?2
     WHERE id=?3
       AND (pricing_snapshot_json IS NULL OR TRIM(pricing_snapshot_json)='' OR TRIM(pricing_snapshot_json)='{}')`,
  ).bind(JSON.stringify(snapshot), now, trip.id).run();

  const changes = Number(result?.meta?.changes ?? 1);
  if (Number.isFinite(changes) && changes === 0) {
    const current = await db.prepare(
      "SELECT id,pricing_snapshot_json FROM pilgrim_trips WHERE id=?1 LIMIT 1",
    ).bind(trip.id).first<PricingTripRow>();
    const existing = parsedObject(current?.pricing_snapshot_json);
    if (String(existing.quoteId ?? "") !== snapshot.quoteId) throw new Error("PRICING_REPORT_ALREADY_COMMITTED");
  }

  await clearPendingPricingReport(db, bookingID);
  return "committed";
}

export async function commitPackageQuoteReport(request: Request, bookingID: string, env: Env): Promise<Response> {
  if (!env.BOOKINGS_DB) return json({ ok: false, error: "BOOKING_DB_NOT_CONFIGURED" }, 503);
  if (!env.HOTELS_DB) return json({ ok: false, error: "HOTELS_DB_NOT_CONFIGURED" }, 503);

  let payload: { quoteProof?: unknown };
  try { payload = await request.json() as { quoteProof?: unknown }; }
  catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }
  const quoteProof = String(payload.quoteProof ?? "").trim();
  if (!quoteProof || quoteProof.length > 80_000) return json({ ok: false, error: "QUOTE_PROOF_REQUIRED" }, 400);

  try {
    const booking = await authorizedBooking(request, bookingID, env.BOOKINGS_DB as BookingDB);
    if (!booking) return json({ ok: false, error: "BOOKING_NOT_FOUND" }, 404);

    const snapshot = await unsealPricingSnapshot(quoteProof, env);
    const bookingPayload = bookingObject(booking.payload_json);
    assertBookingMatchesSnapshot(bookingPayload, snapshot);

    // From this point the server owns durability. If Business has not created the
    // operational trip yet, persist the decrypted immutable report in a pending
    // post-booking row. Business consumes it as soon as the trip appears. Nothing
    // is written here before a real, token-authorized booking exists.
    const disposition = await attachOrQueuePricingReport(env.HOTELS_DB, bookingID, snapshot);
    const pending = disposition === "pending";
    return json({
      ok: true,
      bookingID,
      quoteId: snapshot.quoteId,
      pricingVersion: snapshot.pricingVersion,
      pending,
      disposition,
    }, pending ? 202 : 200);
  } catch (error) {
    const code = error instanceof Error ? error.message : "QUOTE_COMMIT_FAILED";
    const conflict = code === "QUOTE_EXPIRED"
      || code.startsWith("BOOKING_QUOTE_")
      || code === "PRICING_REPORT_PENDING_CONFLICT"
      || code === "PRICING_REPORT_ALREADY_COMMITTED";
    const status = conflict ? 409 : code === "INVALID_QUOTE_PROOF" ? 400 : 500;
    return json({ ok: false, error: code }, status);
  }
}
