import type { Env } from "./env";

type PublicTripRow = {
  booking_id?: string | null;
  booking_number?: number | string | null;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  updated_at?: string | null;
};

type PublicPilgrimRow = {
  id: number | string;
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
};

const encoder = new TextEncoder();

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

function base64URL(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function constantTimeEqual(left: string, right: string) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (!a.length || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return {};
  try { return objectValue(JSON.parse(value)); } catch { return {}; }
}

function nestedObject(root: Record<string, unknown>, key: string) {
  return objectValue(root[key]);
}

function publicStatus(value: unknown) {
  const raw = cleanText(value, 60).toLowerCase();
  switch (raw) {
  case "new":
  case "availability_check": return "availability_check";
  case "payment_pending": return "payment_pending";
  case "paid":
  case "booking_confirmed": return "booking_confirmed";
  case "documents_ready":
  case "ready_to_travel": return "ready_to_travel";
  case "in_trip": return "in_trip";
  case "completed": return "completed";
  case "cancelled": return "cancelled";
  default: return raw || "availability_check";
  }
}

function bookingDisplayNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? `#${String(Math.trunc(number)).padStart(4, "0")}` : null;
}

function bookingPayloadRoot(payload: Record<string, unknown>) {
  const nested = objectValue(payload.booking);
  return Object.keys(nested).length ? nested : payload;
}

function tripPresentation(row: PublicTripRow, fallbackPayload?: Record<string, unknown>) {
  const source = bookingPayloadRoot(fallbackPayload ?? {});
  const input = nestedObject(source, "input");
  const route = nestedObject(source, "route");
  const hotelNames = nestedObject(source, "hotelNames");
  const generatorTrace = nestedObject(source, "generatorTrace");
  const outbound = nestedObject(generatorTrace, "outbound");
  const inbound = nestedObject(generatorTrace, "inbound");
  const generatorMakkah = nestedObject(generatorTrace, "makkahHotel");
  const generatorMadinah = nestedObject(generatorTrace, "madinahHotel");
  const hotelSelection = nestedObject(source, "hotelSelection");
  const madinahHotelSelection = nestedObject(source, "madinahHotelSelection");

  // Compatibility with older booking payloads that stored richer choices under selectionDetails.
  const selectionDetails = nestedObject(source, "selectionDetails");
  const legacyFlight = nestedObject(selectionDetails, "flight");
  const legacyMakkah = nestedObject(selectionDetails, "makkahHotel");
  const legacyMadinah = nestedObject(selectionDetails, "madinahHotel");

  const airline = cleanText(outbound.airline, 120)
    || cleanText(legacyFlight.airline, 120)
    || cleanText(source.flight, 180);
  const outboundOrigin = cleanText(outbound.origin, 12)
    || cleanText(legacyFlight.outboundOrigin, 12)
    || cleanText(route.originCode, 12)
    || cleanText(input.originCode, 12);
  const outboundDestination = cleanText(outbound.destination, 12)
    || cleanText(legacyFlight.outboundDestination, 12)
    || cleanText(route.outboundDestination, 12)
    || cleanText(input.arrivalAirportCode, 12);
  const returnOrigin = cleanText(inbound.origin, 12)
    || cleanText(legacyFlight.returnOrigin, 12)
    || cleanText(route.returnOrigin, 12);
  const returnDestination = cleanText(inbound.destination, 12)
    || cleanText(legacyFlight.returnDestination, 12)
    || outboundOrigin;
  const updatedAt = cleanText(row.updated_at, 80) || null;
  const status = publicStatus(row.status);

  return {
    bookingID: cleanText(row.booking_id, 100),
    bookingDisplayNumber: bookingDisplayNumber(row.booking_number),
    status,
    startDate: cleanText(row.start_date, 40) || cleanText(input.startDate, 40) || null,
    endDate: cleanText(row.end_date, 40) || cleanText(input.endDate, 40) || null,
    updatedAt,
    completedAt: status === "completed" ? updatedAt : null,
    route: {
      origin: outboundOrigin || null,
      destination: outboundDestination || null,
      returnOrigin: returnOrigin || null,
      returnDestination: returnDestination || null,
    },
    flight: {
      airline: airline || null,
      summary: cleanText(source.flight, 180) || airline || null,
      outboundAt: cleanText(outbound.departureAt, 40)
        || cleanText(legacyFlight.outboundDepartureAt, 40)
        || cleanText(legacyFlight.outboundDepartureTime, 40)
        || null,
      outboundArrivalAt: cleanText(outbound.arrivalAt, 40)
        || cleanText(legacyFlight.outboundArrivalAt, 40)
        || cleanText(legacyFlight.outboundArrivalTime, 40)
        || null,
      inboundAt: cleanText(inbound.departureAt, 40)
        || cleanText(legacyFlight.returnDepartureAt, 40)
        || cleanText(legacyFlight.returnDepartureTime, 40)
        || null,
      inboundArrivalAt: cleanText(inbound.arrivalAt, 40)
        || cleanText(legacyFlight.returnArrivalAt, 40)
        || cleanText(legacyFlight.returnArrivalTime, 40)
        || null,
    },
    hotels: {
      makkah: cleanText(hotelNames.makkah, 180)
        || cleanText(hotelSelection.hotelName, 180)
        || cleanText(generatorMakkah.hotelName, 180)
        || cleanText(legacyMakkah.name, 180)
        || null,
      madinah: cleanText(hotelNames.madinah, 180)
        || cleanText(madinahHotelSelection.hotelName, 180)
        || cleanText(generatorMadinah.hotelName, 180)
        || cleanText(legacyMadinah.name, 180)
        || null,
    },
  };
}

async function signingKey(env: Env) {
  const material = String(env.PACKAGE_QUOTE_SEAL_KEY ?? env.IGNAV_API_KEY ?? "").trim();
  if (!material) return null;
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`iumrah:public-identity:v1:${material}`));
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function signature(env: Env, pilgrimID: number) {
  const key = await signingKey(env);
  if (!key) return null;
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(`iumrah-id:v1:${pilgrimID}`));
  return base64URL(new Uint8Array(signed)).slice(0, 43);
}

export function formatIumrahID(value: number | string) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "00000000";
  const numeric = Number(digits);
  if (!Number.isSafeInteger(numeric) || numeric < 0) return digits.padStart(8, "0");
  return String(numeric).padStart(8, "0");
}

export async function publicIdentityURL(env: Env, pilgrimID: number) {
  const id = formatIumrahID(pilgrimID);
  const token = await signature(env, pilgrimID);
  const configuredOrigin = cleanText(env.IUMRAH_PUBLIC_ID_ORIGIN, 300).replace(/\/+$/, "");
  const origin = /^https:\/\/[^/]+$/i.test(configuredOrigin) ? configuredOrigin : "https://iumrah.app";
  return token ? `${origin}/id/${id}?v=${encodeURIComponent(token)}` : `${origin}/id/${id}`;
}

export async function handlePublicIdentityRequest(request: Request, env: Env, url: URL) {
  if (request.method !== "GET") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!env.HOTELS_DB) return json({ ok: false, error: "HOTELS_DB_NOT_CONFIGURED" }, 503);

  const match = url.pathname.match(/^\/api\/package\/public\/id\/(\d{6,8})$/);
  if (!match) return json({ ok: false, error: "NOT_FOUND" }, 404);
  const numericID = Number(match[1]);
  if (!Number.isSafeInteger(numericID) || numericID <= 0) return json({ ok: false, error: "IDENTITY_NOT_FOUND" }, 404);

  const supplied = cleanText(url.searchParams.get("v"), 100);
  const expected = await signature(env, numericID);
  if (!expected || !supplied || !constantTimeEqual(supplied, expected)) {
    return json({ ok: false, error: "IDENTITY_LINK_INVALID" }, 403);
  }

  const pilgrim = await env.HOTELS_DB.prepare(
    `SELECT id,first_name,last_name,display_name
     FROM pilgrims WHERE id=?1 LIMIT 1`,
  ).bind(numericID).first<PublicPilgrimRow>();
  if (!pilgrim) return json({ ok: false, error: "IDENTITY_NOT_FOUND" }, 404);

  // Keep this projection intentionally narrow: these fields are already part of the
  // canonical ClientTripSnapshot contract. Rich travel details come from BOOKINGS_DB,
  // so this public surface does not depend on optional Business schema columns.
  const result = await env.HOTELS_DB.prepare(
    `SELECT booking_id,booking_number,status,start_date,end_date,updated_at
     FROM pilgrim_trips WHERE pilgrim_id=?1 ORDER BY updated_at DESC LIMIT 20`,
  ).bind(numericID).all<PublicTripRow>();
  const rows = result.results ?? [];

  const trips = await Promise.all(rows.map(async (row) => {
    let bookingPayload: Record<string, unknown> | undefined;
    if (env.BOOKINGS_DB && row.booking_id) {
      const source = await env.BOOKINGS_DB.prepare("SELECT payload_json FROM bookings WHERE id=?1 LIMIT 1")
        .bind(row.booking_id).first<{ payload_json?: string | null }>().catch(() => null);
      bookingPayload = parseObject(source?.payload_json);
    }
    return tripPresentation(row, bookingPayload);
  }));

  const firstName = cleanText(pilgrim.first_name, 120);
  const lastName = cleanText(pilgrim.last_name, 120);
  const displayName = cleanText(pilgrim.display_name, 240) || [firstName, lastName].filter(Boolean).join(" ") || "Iumrah Pilgrim";

  return json({
    ok: true,
    identity: {
      iumrahID: formatIumrahID(pilgrim.id),
      displayName,
      verified: true,
    },
    trips,
  });
}
