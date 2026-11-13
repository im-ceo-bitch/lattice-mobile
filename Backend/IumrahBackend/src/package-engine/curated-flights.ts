import type { D1Like } from "./d1";

const IATA_AIRPORT = /^[A-Z]{3}$/;
const IATA_AIRLINE = /^[A-Z0-9]{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

type CuratedLeg = {
  airline: string;
  flight_number: string;
  airline_code: string;
  origin: string;
  destination: string;
  departure_at: string;
  arrival_at: string;
  duration_minutes: number;
  stops: number;
  cabin_class: string;
  segments?: unknown[];
};

type CuratedOfferType = "one_way" | "round_trip" | "paired_one_way";
type CuratedJourneyRole = "outbound" | "return" | "complete";

type CuratedItinerary = {
  id: string;
  source?: string;
  source_name?: string;
  observed_at: string;
  fare_scope?: string;
  price: { amount: number; currency: string; status?: string };
  legs: CuratedLeg[];
  cabin_class: string;
  bags?: { carry_on?: number | null; checked?: number | null } | null;
  requires_self_transfer?: boolean | null;
  ignav_id?: string;
  offer_type?: CuratedOfferType;
  journey_role?: CuratedJourneyRole;
};

type CuratedRow = {
  id: string;
  source_candidate_id: string;
  source_provider: string;
  outbound_origin: string;
  outbound_destination: string;
  inbound_origin: string | null;
  inbound_destination: string | null;
  outbound_date: string;
  inbound_date: string | null;
  cabin_class: string;
  airline_codes_json: string;
  airline_names_json: string;
  flight_numbers_json: string;
  itinerary_json: string;
  total_fare: number;
  per_traveler_fare: number;
  currency: string;
  traveler_count: number;
  observed_at: string;
  published: number;
  priority: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  offer_type: CuratedOfferType;
  journey_role: CuratedJourneyRole;
  fingerprint: string | null;
};

function json(value: unknown, status = 200, cacheControl = "no-store") {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
    },
  });
}

function safeText(value: unknown, max = 180): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function dateFromTimestamp(value: string): string {
  return value.slice(0, 10);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseJSON<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; }
  catch { return fallback; }
}

function normalizeLeg(raw: unknown): CuratedLeg | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const airlineCode = safeText(value.airline_code, 2).toUpperCase();
  const origin = safeText(value.origin, 3).toUpperCase();
  const destination = safeText(value.destination, 3).toUpperCase();
  const departureAt = safeText(value.departure_at, 64);
  const arrivalAt = safeText(value.arrival_at, 64);
  const duration = Number(value.duration_minutes);
  const stops = Number(value.stops);
  if (!IATA_AIRPORT.test(origin) || !IATA_AIRPORT.test(destination) || origin === destination) return null;
  if (!validTimestamp(departureAt) || !validTimestamp(arrivalAt) || Date.parse(departureAt) >= Date.parse(arrivalAt)) return null;
  if (!Number.isInteger(stops) || stops < 0 || stops > 7) return null;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 96 * 60) return null;
  return {
    airline: safeText(value.airline, 180) || airlineCode || "Airline",
    flight_number: safeText(value.flight_number, 80),
    airline_code: IATA_AIRLINE.test(airlineCode) ? airlineCode : "",
    origin,
    destination,
    departure_at: departureAt,
    arrival_at: arrivalAt,
    duration_minutes: Math.round(duration),
    stops,
    cabin_class: safeText(value.cabin_class, 40) || "economy",
    segments: Array.isArray(value.segments) ? value.segments.slice(0, 8) : undefined,
  };
}

function normalizeOfferType(value: unknown, legCount: number): CuratedOfferType {
  const raw = safeText(value, 40).toLowerCase();
  if (raw === "round_trip" || raw === "paired_one_way" || raw === "one_way") return raw;
  return legCount === 1 ? "one_way" : "paired_one_way";
}

function normalizeJourneyRole(value: unknown, offerType: CuratedOfferType): CuratedJourneyRole {
  const raw = safeText(value, 40).toLowerCase();
  if (raw === "outbound" || raw === "return" || raw === "complete") return raw;
  return offerType === "one_way" ? "outbound" : "complete";
}

function canonicalOfferType(itinerary: CuratedItinerary, stored?: unknown): CuratedOfferType {
  // Physical structure wins over legacy/default metadata. One leg cannot be a
  // paired product, even if an older D1 row was backfilled with paired_one_way.
  if (itinerary.legs.length === 1) return "one_way";
  return normalizeOfferType(stored ?? itinerary.offer_type, itinerary.legs.length);
}

function canonicalJourneyRole(itinerary: CuratedItinerary, offerType: CuratedOfferType, stored?: unknown): CuratedJourneyRole {
  if (offerType !== "one_way") return "complete";

  const leg = itinerary.legs[0];
  const originIsUmrahAirport = leg.origin === "JED" || leg.origin === "MED";
  const destinationIsUmrahAirport = leg.destination === "JED" || leg.destination === "MED";

  // For the public Umrah catalogue, the physical route is authoritative. This
  // also repairs rows that were incorrectly saved as outbound by the old default.
  if (!originIsUmrahAirport && destinationIsUmrahAirport) return "outbound";
  if (originIsUmrahAirport && !destinationIsUmrahAirport) return "return";

  const itineraryRole = safeText(itinerary.journey_role, 40).toLowerCase();
  if (itineraryRole === "outbound" || itineraryRole === "return") return itineraryRole;
  const storedRole = safeText(stored, 40).toLowerCase();
  if (storedRole === "outbound" || storedRole === "return") return storedRole;
  return "outbound";
}

function curatedFingerprint(itinerary: CuratedItinerary): string {
  const offerType = canonicalOfferType(itinerary, itinerary.offer_type);
  const journeyRole = canonicalJourneyRole(itinerary, offerType, itinerary.journey_role);
  const legs = itinerary.legs.map((leg) => [
    leg.airline_code.toUpperCase(),
    leg.flight_number.toUpperCase().replace(/\s+/g, ""),
    leg.origin.toUpperCase(),
    leg.destination.toUpperCase(),
    leg.departure_at,
    leg.arrival_at,
  ].join(":"));
  return [offerType, journeyRole, ...legs].join("|").slice(0, 1800);
}

function normalizeItinerary(raw: unknown): CuratedItinerary | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const rawPrice = value.price && typeof value.price === "object" ? value.price as Record<string, unknown> : null;
  const amount = Number(rawPrice?.amount);
  const currency = safeText(rawPrice?.currency, 3).toUpperCase();
  const status = safeText(rawPrice?.status, 40).toLowerCase();
  const legs = Array.isArray(value.legs) ? value.legs.map(normalizeLeg) : [];
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return null;
  if (!CURRENCY.test(currency) || (status && !["verified", "unverified"].includes(status))) return null;
  if (legs.length < 1 || legs.length > 2 || legs.some((item) => item === null)) return null;
  const safeLegs = legs as CuratedLeg[];
  if (safeLegs.some((leg) => leg.stops !== 0)) return null;
  const observedAt = safeText(value.observed_at, 64);
  if (!validTimestamp(observedAt)) return null;
  const id = safeText(value.id, 180) || safeText(value.ignav_id, 180);
  if (!id) return null;
  return {
    id,
    source: safeText(value.source, 40) || "ignav",
    source_name: safeText(value.source_name, 80) || "Ignav",
    observed_at: observedAt,
    fare_scope: safeText(value.fare_scope, 40) || "total_party",
    // A staff-published unverified Ignav hint is allowed only in this admin-curated layer.
    // The public recommendation endpoint still never exposes the amount.
    price: { amount, currency, status: status || "unverified" },
    legs: safeLegs,
    cabin_class: safeText(value.cabin_class, 40) || safeLegs[0].cabin_class || "economy",
    bags: value.bags && typeof value.bags === "object" ? value.bags as CuratedItinerary["bags"] : null,
    requires_self_transfer: typeof value.requires_self_transfer === "boolean" ? value.requires_self_transfer : null,
    ignav_id: safeText(value.ignav_id, 180) || id,
    offer_type: normalizeOfferType(value.offer_type, safeLegs.length),
    journey_role: normalizeJourneyRole(value.journey_role, normalizeOfferType(value.offer_type, safeLegs.length)),
  };
}

export async function ensureCuratedFlightSchema(db: D1Like): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS curated_flight_offers (
    id TEXT PRIMARY KEY,
    source_candidate_id TEXT NOT NULL,
    source_provider TEXT NOT NULL DEFAULT 'ignav',
    outbound_origin TEXT NOT NULL,
    outbound_destination TEXT NOT NULL,
    inbound_origin TEXT,
    inbound_destination TEXT,
    outbound_date TEXT NOT NULL,
    inbound_date TEXT,
    cabin_class TEXT NOT NULL DEFAULT 'economy',
    airline_codes_json TEXT NOT NULL DEFAULT '[]',
    airline_names_json TEXT NOT NULL DEFAULT '[]',
    flight_numbers_json TEXT NOT NULL DEFAULT '[]',
    itinerary_json TEXT NOT NULL,
    total_fare REAL NOT NULL,
    per_traveler_fare REAL NOT NULL,
    currency TEXT NOT NULL,
    traveler_count INTEGER NOT NULL,
    observed_at TEXT NOT NULL,
    published INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 100,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    offer_type TEXT NOT NULL DEFAULT 'paired_one_way',
    journey_role TEXT NOT NULL DEFAULT 'complete',
    fingerprint TEXT
  )`).run();
  // Existing installations predate offer typing and structural de-duplication.
  // D1 does not support ADD COLUMN IF NOT EXISTS, so the compatibility ALTERs
  // intentionally ignore the duplicate-column error after the first successful run.
  for (const statement of [
    `ALTER TABLE curated_flight_offers ADD COLUMN offer_type TEXT NOT NULL DEFAULT 'paired_one_way'`,
    `ALTER TABLE curated_flight_offers ADD COLUMN journey_role TEXT NOT NULL DEFAULT 'complete'`,
    `ALTER TABLE curated_flight_offers ADD COLUMN fingerprint TEXT`,
  ]) {
    try { await db.prepare(statement).run(); } catch { /* already present */ }
  }

  // Reconcile every existing row, not only rows with a missing fingerprint. Old
  // deployments could persist one-way return legs as outbound and one-leg offers
  // as paired_one_way; both states are invisible to parts of the customer UI.
  const backfill = await db.prepare(`SELECT id, itinerary_json, offer_type, journey_role, fingerprint
    FROM curated_flight_offers LIMIT 1000`)
    .all<{ id: string; itinerary_json: string; offer_type: CuratedOfferType; journey_role: CuratedJourneyRole; fingerprint: string | null }>();
  for (const row of backfill.results ?? []) {
    const itinerary = normalizeItinerary(parseJSON<unknown>(row.itinerary_json, null));
    if (!itinerary) continue;
    itinerary.offer_type = canonicalOfferType(itinerary, row.offer_type);
    itinerary.journey_role = canonicalJourneyRole(itinerary, itinerary.offer_type, row.journey_role);
    const fingerprint = curatedFingerprint(itinerary);
    if (row.offer_type === itinerary.offer_type && row.journey_role === itinerary.journey_role && row.fingerprint === fingerprint) continue;
    await db.prepare(`UPDATE curated_flight_offers SET offer_type=?, journey_role=?, fingerprint=? WHERE id=?`)
      .bind(itinerary.offer_type, itinerary.journey_role, fingerprint, row.id).run();
  }

  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_curated_flight_route_dates
    ON curated_flight_offers(outbound_origin, outbound_destination, inbound_origin, inbound_destination, outbound_date, inbound_date, published)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_curated_flight_public_rank
    ON curated_flight_offers(published, outbound_date, priority, per_traveler_fare)`).run();
}

function mapAdminRow(row: CuratedRow) {
  return {
    id: row.id,
    sourceCandidateID: row.source_candidate_id,
    sourceProvider: row.source_provider,
    outboundOrigin: row.outbound_origin,
    outboundDestination: row.outbound_destination,
    inboundOrigin: row.inbound_origin,
    inboundDestination: row.inbound_destination,
    outboundDate: row.outbound_date,
    inboundDate: row.inbound_date,
    cabinClass: row.cabin_class,
    airlineCodes: parseJSON<string[]>(row.airline_codes_json, []),
    airlineNames: parseJSON<string[]>(row.airline_names_json, []),
    flightNumbers: parseJSON<string[]>(row.flight_numbers_json, []),
    itinerary: parseJSON<CuratedItinerary | null>(row.itinerary_json, null),
    totalFare: Number(row.total_fare),
    perTravelerFare: Number(row.per_traveler_fare),
    currency: row.currency,
    travelerCount: Number(row.traveler_count),
    observedAt: row.observed_at,
    published: Number(row.published) === 1,
    priority: Number(row.priority),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    offerType: row.offer_type,
    journeyRole: row.journey_role,
    fingerprint: row.fingerprint,
  };
}

export async function listCuratedFlightsAdmin(db: D1Like | undefined): Promise<Response> {
  if (!db) return json({ ok: false, error: "HOTELS_DB_NOT_CONFIGURED" }, 503);
  await ensureCuratedFlightSchema(db);
  const today = new Date().toISOString().slice(0, 10);
  const result = await db.prepare(`SELECT * FROM curated_flight_offers
    WHERE outbound_date >= ?
    ORDER BY published DESC, priority ASC, outbound_date ASC, per_traveler_fare ASC
    LIMIT 300`).bind(today).all<CuratedRow>();
  return json({ ok: true, offers: (result.results ?? []).map(mapAdminRow) });
}

export async function saveCuratedFlightAdmin(request: Request, db: D1Like | undefined, createdBy?: string): Promise<Response> {
  if (!db) return json({ ok: false, error: "HOTELS_DB_NOT_CONFIGURED" }, 503);
  await ensureCuratedFlightSchema(db);
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload) return json({ ok: false, error: "INVALID_JSON" }, 400);
  const itinerary = normalizeItinerary(payload.itinerary);
  if (!itinerary) return json({ ok: false, error: "INVALID_CURATED_ITINERARY" }, 400);
  const offerType = normalizeOfferType(itinerary.offer_type, itinerary.legs.length);
  const journeyRole = normalizeJourneyRole(itinerary.journey_role, offerType);
  itinerary.offer_type = offerType;
  itinerary.journey_role = journeyRole;
  const fingerprint = curatedFingerprint(itinerary);
  const travelerCount = Number(payload.travelerCount);
  if (!Number.isInteger(travelerCount) || travelerCount < 1 || travelerCount > 9) return json({ ok: false, error: "INVALID_TRAVELER_COUNT" }, 400);
  const published = payload.published === undefined ? true : payload.published === true;
  const priorityRaw = Number(payload.priority ?? 100);
  const priority = Number.isFinite(priorityRaw) ? Math.max(0, Math.min(9999, Math.round(priorityRaw))) : 100;
  const outbound = itinerary.legs[0];
  const inbound = itinerary.legs[1] ?? null;
  const outboundDate = dateFromTimestamp(outbound.departure_at);
  const inboundDate = inbound ? dateFromTimestamp(inbound.departure_at) : null;
  if (!DATE.test(outboundDate) || (inboundDate !== null && !DATE.test(inboundDate))) return json({ ok: false, error: "INVALID_CURATED_DATE" }, 400);
  const airlineCodes = [...new Set(itinerary.legs.map((leg) => leg.airline_code).filter(Boolean))];
  const airlineNames = [...new Set(itinerary.legs.map((leg) => leg.airline).filter(Boolean))];
  const flightNumbers = itinerary.legs.map((leg) => leg.flight_number).filter(Boolean);
  const perTravelerFare = itinerary.price.amount / travelerCount;
  const now = new Date().toISOString();

  // Do not trust Ignav candidate IDs as the sole duplicate key: the provider may
  // return a fresh ID for the same physical flights on a later search. Structural
  // identity keeps one published row per product type + exact flight/date pair.
  const existing = await db.prepare(`SELECT id, created_at FROM curated_flight_offers
    WHERE fingerprint = ?
       OR (source_candidate_id = ? AND outbound_date = ? AND COALESCE(inbound_date,'') = COALESCE(?, ''))
    ORDER BY CASE WHEN fingerprint = ? THEN 0 ELSE 1 END
    LIMIT 1`).bind(fingerprint, itinerary.id, outboundDate, inboundDate, fingerprint)
    .first<{ id: string; created_at: string }>();
  const id = existing?.id ?? `curated-${crypto.randomUUID()}`;
  const createdAt = existing?.created_at ?? now;

  await db.prepare(`INSERT INTO curated_flight_offers (
    id, source_candidate_id, source_provider,
    outbound_origin, outbound_destination, inbound_origin, inbound_destination,
    outbound_date, inbound_date, cabin_class,
    airline_codes_json, airline_names_json, flight_numbers_json, itinerary_json,
    total_fare, per_traveler_fare, currency, traveler_count, observed_at,
    published, priority, created_by, created_at, updated_at,
    offer_type, journey_role, fingerprint
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    source_candidate_id=excluded.source_candidate_id,
    source_provider=excluded.source_provider,
    outbound_origin=excluded.outbound_origin,
    outbound_destination=excluded.outbound_destination,
    inbound_origin=excluded.inbound_origin,
    inbound_destination=excluded.inbound_destination,
    outbound_date=excluded.outbound_date,
    inbound_date=excluded.inbound_date,
    cabin_class=excluded.cabin_class,
    airline_codes_json=excluded.airline_codes_json,
    airline_names_json=excluded.airline_names_json,
    flight_numbers_json=excluded.flight_numbers_json,
    itinerary_json=excluded.itinerary_json,
    total_fare=excluded.total_fare,
    per_traveler_fare=excluded.per_traveler_fare,
    currency=excluded.currency,
    traveler_count=excluded.traveler_count,
    observed_at=excluded.observed_at,
    published=excluded.published,
    priority=excluded.priority,
    created_by=excluded.created_by,
    updated_at=excluded.updated_at,
    offer_type=excluded.offer_type,
    journey_role=excluded.journey_role,
    fingerprint=excluded.fingerprint`)
    .bind(
      id, itinerary.id, itinerary.source ?? "ignav",
      outbound.origin, outbound.destination, inbound?.origin ?? null, inbound?.destination ?? null,
      outboundDate, inboundDate, itinerary.cabin_class,
      JSON.stringify(airlineCodes), JSON.stringify(airlineNames), JSON.stringify(flightNumbers), JSON.stringify(itinerary),
      itinerary.price.amount, perTravelerFare, itinerary.price.currency, travelerCount, itinerary.observed_at,
      published ? 1 : 0, priority, safeText(createdBy, 180) || null, createdAt, now,
      offerType, journeyRole, fingerprint,
    ).run();

  const row = await db.prepare(`SELECT * FROM curated_flight_offers WHERE id=? LIMIT 1`).bind(id).first<CuratedRow>();
  return json({ ok: true, offer: row ? mapAdminRow(row) : null });
}

export async function deleteCuratedFlightAdmin(id: string, db: D1Like | undefined): Promise<Response> {
  if (!db) return json({ ok: false, error: "HOTELS_DB_NOT_CONFIGURED" }, 503);
  await ensureCuratedFlightSchema(db);
  const cleanID = safeText(id, 180);
  if (!cleanID) return json({ ok: false, error: "INVALID_CURATED_FLIGHT_ID" }, 400);
  await db.prepare(`DELETE FROM curated_flight_offers WHERE id=?`).bind(cleanID).run();
  return json({ ok: true, deletedID: cleanID });
}

function validAirportParam(url: URL, key: string, required = true): string | null {
  const value = url.searchParams.get(key)?.trim().toUpperCase() ?? "";
  if (!value && !required) return null;
  return IATA_AIRPORT.test(value) ? value : null;
}

export async function publicCuratedFlightRecommendations(url: URL, db: D1Like | undefined): Promise<Response> {
  if (!db) return json({ ok: false, error: "HOTELS_DB_NOT_CONFIGURED" }, 503);
  await ensureCuratedFlightSchema(db);

  const from = safeText(url.searchParams.get("from"), 10) || new Date().toISOString().slice(0, 10);
  const to = safeText(url.searchParams.get("to"), 10) || "9999-12-31";
  if (!DATE.test(from) || !DATE.test(to) || from > to) {
    return json({ ok: false, error: "INVALID_CURATED_RANGE" }, 400);
  }

  const umrahOrigin = validAirportParam(url, "umrah_origin", false);
  let result: { results?: CuratedRow[] };

  if (url.searchParams.has("umrah_origin")) {
    if (!umrahOrigin) return json({ ok: false, error: "INVALID_CURATED_ROUTE" }, 400);

    // Load every staff-published Umrah option connected to this departure city:
    // outbound one-ways, return one-ways, true provider round-trips and legacy
    // paired one-way offers. The app separates these products in its own UI.
    // Supplier prices remain server-only.
    result = await db.prepare(`SELECT * FROM curated_flight_offers
      WHERE published = 1
        AND outbound_date BETWEEN ? AND ?
        AND (
          (inbound_origin IS NULL AND outbound_origin = ? AND outbound_destination IN ('JED', 'MED'))
          OR (inbound_origin IS NULL AND outbound_origin IN ('JED', 'MED') AND outbound_destination = ?)
          OR (inbound_origin IS NOT NULL AND outbound_origin = ? AND inbound_destination = ?)
        )
      ORDER BY priority ASC, per_traveler_fare ASC, outbound_date ASC
      LIMIT 300`)
      .bind(from, to, umrahOrigin, umrahOrigin, umrahOrigin, umrahOrigin)
      .all<CuratedRow>();
  } else {
    const outboundOrigin = validAirportParam(url, "outbound_origin");
    const outboundDestination = validAirportParam(url, "outbound_destination");
    const inboundOrigin = validAirportParam(url, "inbound_origin", false);
    const inboundDestination = validAirportParam(url, "inbound_destination", false);
    if (!outboundOrigin || !outboundDestination || outboundOrigin === outboundDestination ||
        (url.searchParams.has("inbound_origin") && !inboundOrigin) ||
        (url.searchParams.has("inbound_destination") && !inboundDestination)) {
      return json({ ok: false, error: "INVALID_CURATED_ROUTE" }, 400);
    }

    result = await db.prepare(`SELECT * FROM curated_flight_offers
      WHERE published = 1
        AND outbound_origin = ? AND outbound_destination = ?
        AND COALESCE(inbound_origin,'') = COALESCE(?, '')
        AND COALESCE(inbound_destination,'') = COALESCE(?, '')
        AND outbound_date BETWEEN ? AND ?
      ORDER BY priority ASC, per_traveler_fare ASC, outbound_date ASC
      LIMIT 24`)
      .bind(outboundOrigin, outboundDestination, inboundOrigin, inboundDestination, from, to)
      .all<CuratedRow>();
  }

  const recommendations = (result.results ?? []).map((row) => {
    const itinerary = normalizeItinerary(parseJSON<unknown>(row.itinerary_json, null));
    if (!itinerary) return null;
    const offerType = canonicalOfferType(itinerary, row.offer_type);
    const journeyRole = canonicalJourneyRole(itinerary, offerType, row.journey_role);
    return {
      id: row.id,
      outboundDate: row.outbound_date,
      inboundDate: row.inbound_date,
      cabinClass: row.cabin_class,
      airlineCodes: parseJSON<string[]>(row.airline_codes_json, []),
      airlineNames: parseJSON<string[]>(row.airline_names_json, []),
      flightNumbers: parseJSON<string[]>(row.flight_numbers_json, []),
      observedAt: row.observed_at,
      outbound: itinerary.legs[0],
      inbound: itinerary.legs[1] ?? null,
      nonstop: itinerary.legs.every((leg) => leg.stops === 0),
      recommendationLabel: "iumrah recommends",
      offerType,
      journeyRole,
    };
  }).filter((value): value is NonNullable<typeof value> => value !== null);

  // Publishing in iumrah Business must become visible immediately. Do not keep
  // an earlier empty recommendation response in a CDN cache for several minutes.
  return json({ ok: true, recommendations, generatedAt: new Date().toISOString() }, 200, "no-store");
}

export async function curatedCalendarRows(
  db: D1Like,
  query: {
    outboundOrigin: string;
    outboundDestination: string;
    inboundOrigin: string | null;
    inboundDestination: string | null;
    cabinClass: string;
    travelerCount: number;
    from: string;
    to: string;
    selectedOutbound: string | null;
  },
): Promise<Array<{
  outbound_date: string;
  inbound_date: string | null;
  min_total_fare: number;
  min_per_traveler_fare: number;
  currency: string;
  observed_at: string;
}>> {
  await ensureCuratedFlightSchema(db);
  const result = await db.prepare(`SELECT outbound_date, inbound_date,
      per_traveler_fare * ? AS min_total_fare, per_traveler_fare AS min_per_traveler_fare,
      currency, observed_at
    FROM curated_flight_offers
    WHERE published = 1
      AND journey_role = 'complete'
      AND outbound_origin = ? AND outbound_destination = ?
      AND COALESCE(inbound_origin,'') = COALESCE(?, '')
      AND COALESCE(inbound_destination,'') = COALESCE(?, '')
      AND cabin_class = ?
      AND outbound_date BETWEEN ? AND ?
      AND (? IS NULL OR outbound_date = ?)
    ORDER BY outbound_date ASC, per_traveler_fare ASC`)
    .bind(
      query.travelerCount,
      query.outboundOrigin, query.outboundDestination, query.inboundOrigin, query.inboundDestination,
      query.cabinClass, query.from, query.to, query.selectedOutbound, query.selectedOutbound,
    ).all<{
      outbound_date: string;
      inbound_date: string | null;
      min_total_fare: number;
      min_per_traveler_fare: number;
      currency: string;
      observed_at: string;
    }>();
  return result.results ?? [];
}
type PublishedResolvePayload = {
  completeID?: unknown;
  outboundID?: unknown;
  returnID?: unknown;
  travelerCount?: unknown;
  origin?: unknown;
  outboundDestination?: unknown;
  returnOrigin?: unknown;
  returnDestination?: unknown;
};

function resolvedPublicLeg(leg: CuratedLeg, id: string) {
  return {
    id,
    airline: leg.airline,
    flightNumber: leg.flight_number,
    airlineCode: leg.airline_code || null,
    origin: leg.origin,
    destination: leg.destination,
    departureAt: leg.departure_at,
    arrivalAt: leg.arrival_at,
    durationMinutes: leg.duration_minutes,
    cabinClass: leg.cabin_class || null,
  };
}

function validExpectedAirport(value: unknown): string | null {
  const airport = safeText(value, 3).toUpperCase();
  return IATA_AIRPORT.test(airport) ? airport : null;
}

async function publishedRow(db: D1Like, id: string): Promise<CuratedRow | null> {
  return await db.prepare(`SELECT * FROM curated_flight_offers WHERE id=? AND published=1 LIMIT 1`)
    .bind(id).first<CuratedRow>();
}

/**
 * Resolves only an already-published recommendation. This is intentionally a D1-only
 * operation: it never calls Ignav and therefore cannot consume a provider search.
 * The public carousel still hides supplier fare amounts; the selected product is
 * resolved only when the client is ready to price the package.
 */
export async function resolvePublicCuratedFlightRecommendation(request: Request, db: D1Like | undefined): Promise<Response> {
  if (!db) return json({ ok: false, error: "HOTELS_DB_NOT_CONFIGURED" }, 503);
  await ensureCuratedFlightSchema(db);

  let payload: PublishedResolvePayload;
  try { payload = await request.json() as PublishedResolvePayload; }
  catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }

  const travelerCount = Number(payload.travelerCount);
  if (!Number.isInteger(travelerCount) || travelerCount < 1 || travelerCount > 9) {
    return json({ ok: false, error: "INVALID_TRAVELER_COUNT" }, 400);
  }

  const origin = validExpectedAirport(payload.origin);
  const outboundDestination = validExpectedAirport(payload.outboundDestination);
  const returnOrigin = validExpectedAirport(payload.returnOrigin);
  const returnDestination = validExpectedAirport(payload.returnDestination);
  if (!origin || !outboundDestination || !returnOrigin || !returnDestination || origin !== returnDestination) {
    return json({ ok: false, error: "INVALID_CURATED_ROUTE" }, 400);
  }

  const completeID = safeText(payload.completeID, 180);
  const outboundID = safeText(payload.outboundID, 180);
  const returnID = safeText(payload.returnID, 180);
  if (!completeID && (!outboundID || !returnID)) {
    return json({ ok: false, error: "INCOMPLETE_CURATED_SELECTION" }, 400);
  }

  let outboundLeg: CuratedLeg;
  let inboundLeg: CuratedLeg;
  let currency: string;
  let totalFare: number;
  let providerItineraryID: string;

  if (completeID) {
    const row = await publishedRow(db, completeID);
    if (!row) return json({ ok: false, error: "CURATED_FLIGHT_NOT_FOUND" }, 404);
    const itinerary = normalizeItinerary(parseJSON<unknown>(row.itinerary_json, null));
    if (!itinerary || itinerary.legs.length !== 2) return json({ ok: false, error: "INVALID_CURATED_ITINERARY" }, 409);
    outboundLeg = itinerary.legs[0];
    inboundLeg = itinerary.legs[1];
    currency = row.currency.toUpperCase();
    totalFare = row.per_traveler_fare * travelerCount;
    providerItineraryID = `curated:${row.id}`;
  } else {
    const [outboundRow, returnRow] = await Promise.all([
      publishedRow(db, outboundID),
      publishedRow(db, returnID),
    ]);
    if (!outboundRow || !returnRow) {
      return json({ ok: false, error: "CURATED_FLIGHT_NOT_FOUND" }, 404);
    }
    const outboundItinerary = normalizeItinerary(parseJSON<unknown>(outboundRow.itinerary_json, null));
    const returnItinerary = normalizeItinerary(parseJSON<unknown>(returnRow.itinerary_json, null));
    if (!outboundItinerary || !returnItinerary || outboundItinerary.legs.length !== 1 || returnItinerary.legs.length !== 1) {
      return json({ ok: false, error: "INVALID_CURATED_ITINERARY" }, 409);
    }
    const outboundType = canonicalOfferType(outboundItinerary, outboundRow.offer_type);
    const outboundRole = canonicalJourneyRole(outboundItinerary, outboundType, outboundRow.journey_role);
    const returnType = canonicalOfferType(returnItinerary, returnRow.offer_type);
    const returnRole = canonicalJourneyRole(returnItinerary, returnType, returnRow.journey_role);
    if (outboundType !== "one_way" || returnType !== "one_way" || outboundRole !== "outbound" || returnRole !== "return") {
      return json({ ok: false, error: "CURATED_FLIGHT_NOT_FOUND" }, 404);
    }
    if (outboundRow.currency.toUpperCase() !== returnRow.currency.toUpperCase()) {
      return json({ ok: false, error: "CURATED_CURRENCY_MISMATCH" }, 409);
    }
    outboundLeg = outboundItinerary.legs[0];
    inboundLeg = returnItinerary.legs[0];
    currency = outboundRow.currency.toUpperCase();
    totalFare = (outboundRow.per_traveler_fare + returnRow.per_traveler_fare) * travelerCount;
    providerItineraryID = `curated:${outboundRow.id}+${returnRow.id}`;
  }

  if (outboundLeg.origin !== origin || outboundLeg.destination !== outboundDestination ||
      inboundLeg.origin !== returnOrigin || inboundLeg.destination !== returnDestination ||
      Date.parse(inboundLeg.departure_at) <= Date.parse(outboundLeg.departure_at)) {
    return json({ ok: false, error: "CURATED_ROUTE_MISMATCH" }, 409);
  }
  if (!CURRENCY.test(currency) || !Number.isFinite(totalFare) || totalFare <= 0 || totalFare > 9_000_000) {
    return json({ ok: false, error: "INVALID_CURATED_FARE" }, 409);
  }

  const resolvedAt = new Date().toISOString();
  return json({
    ok: true,
    resolvedAt,
    currency,
    totalFare: Math.round(totalFare * 100) / 100,
    fareScope: "totalParty",
    providerItineraryID,
    sourceName: "iumrah Published",
    outbound: resolvedPublicLeg(outboundLeg, `${providerItineraryID}:outbound`),
    inbound: resolvedPublicLeg(inboundLeg, `${providerItineraryID}:inbound`),
  }, 200, "no-store");
}
