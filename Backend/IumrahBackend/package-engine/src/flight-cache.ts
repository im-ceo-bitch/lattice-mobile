import type { D1Like } from "./d1";
import { curatedCalendarRows } from "./curated-flights";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const SEARCH_CACHE_TTL_SECONDS = 12 * 60 * 60;
const LOCK_TTL_SECONDS = 35;

type NormalizedLeg = { origin: string; destination: string; departure_date: string };
export type NormalizedFlightSearch = {
  legs: NormalizedLeg[];
  adults: number;
  children: number;
  infants_in_seat: number;
  infants_on_lap: number;
  cabin_class: string;
  allow_self_transfer: boolean;
  market: string;
};

type CachedSearchRow = {
  response_json: string;
  provider_observed_at: string;
  cached_at: string;
  fresh_until: string;
};

type CalendarRow = {
  outbound_date: string;
  inbound_date: string | null;
  min_total_fare: number;
  min_per_traveler_fare: number;
  currency: string;
  observed_at: string;
};

function dayUTC(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function stableSearchIdentity(body: NormalizedFlightSearch): string {
  return JSON.stringify({
    legs: body.legs.map((leg) => ({ origin: leg.origin, destination: leg.destination, departure_date: leg.departure_date })),
    adults: body.adults,
    children: body.children,
    infants_in_seat: body.infants_in_seat,
    infants_on_lap: body.infants_on_lap,
    cabin_class: body.cabin_class,
    allow_self_transfer: body.allow_self_transfer,
    market: body.market,
  });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function flightSearchCacheKey(body: NormalizedFlightSearch): Promise<string> {
  return sha256(stableSearchIdentity(body));
}

function passengerSignature(body: NormalizedFlightSearch): string {
  return `a${body.adults}-c${body.children}-s${body.infants_in_seat}-l${body.infants_on_lap}`;
}

function routeFields(body: NormalizedFlightSearch) {
  const outbound = body.legs[0];
  const inbound = body.legs[1] ?? null;
  return {
    outboundOrigin: outbound.origin,
    outboundDestination: outbound.destination,
    outboundDate: outbound.departure_date,
    inboundOrigin: inbound?.origin ?? null,
    inboundDestination: inbound?.destination ?? null,
    inboundDate: inbound?.departure_date ?? null,
  };
}

export async function ensureFlightCacheSchema(db: D1Like): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS flight_search_cache (
    cache_key TEXT PRIMARY KEY,
    request_json TEXT NOT NULL,
    response_json TEXT NOT NULL,
    outbound_origin TEXT NOT NULL,
    outbound_destination TEXT NOT NULL,
    outbound_date TEXT NOT NULL,
    inbound_origin TEXT,
    inbound_destination TEXT,
    inbound_date TEXT,
    passenger_signature TEXT NOT NULL,
    cabin_class TEXT NOT NULL,
    provider_observed_at TEXT NOT NULL,
    cached_at TEXT NOT NULL,
    fresh_until TEXT NOT NULL,
    delete_after TEXT NOT NULL
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_flight_search_cache_dates
    ON flight_search_cache(outbound_date, fresh_until)`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS flight_calendar_fares (
    calendar_key TEXT PRIMARY KEY,
    outbound_origin TEXT NOT NULL,
    outbound_destination TEXT NOT NULL,
    inbound_origin TEXT,
    inbound_destination TEXT,
    passenger_signature TEXT NOT NULL,
    cabin_class TEXT NOT NULL,
    outbound_date TEXT NOT NULL,
    inbound_date TEXT,
    min_total_fare REAL NOT NULL,
    min_per_traveler_fare REAL NOT NULL,
    currency TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    delete_after TEXT NOT NULL
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_flight_calendar_route
    ON flight_calendar_fares(outbound_origin, outbound_destination, inbound_origin, inbound_destination, passenger_signature, cabin_class, outbound_date)`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS flight_search_locks (
    cache_key TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL
  )`).run();
}

export async function cleanupExpiredFlightCache(db: D1Like, now = new Date()): Promise<void> {
  await ensureFlightCacheSchema(db);
  const today = dayUTC(now);
  const nowISO = now.toISOString();
  await db.prepare(`DELETE FROM flight_search_cache WHERE fresh_until <= ? OR outbound_date < ?`).bind(nowISO, today).run();
  await db.prepare(`DELETE FROM flight_calendar_fares WHERE delete_after < ? OR outbound_date < ?`).bind(today, today).run();
  await db.prepare(`DELETE FROM flight_search_locks WHERE expires_at <= ?`).bind(nowISO).run();
}

export async function readFlightSearchCache(db: D1Like, body: NormalizedFlightSearch, now = new Date()): Promise<Record<string, unknown> | null> {
  await ensureFlightCacheSchema(db);
  const key = await flightSearchCacheKey(body);
  const row = await db.prepare(`SELECT response_json, provider_observed_at, cached_at, fresh_until
    FROM flight_search_cache
    WHERE cache_key = ? AND fresh_until > ? AND outbound_date >= ?
    LIMIT 1`)
    .bind(key, now.toISOString(), dayUTC(now))
    .first<CachedSearchRow>();
  if (!row) return null;
  try {
    const payload = JSON.parse(row.response_json) as Record<string, unknown>;
    return {
      ...payload,
      cache: {
        status: "hit",
        cached_at: row.cached_at,
        fresh_until: row.fresh_until,
        provider_observed_at: row.provider_observed_at,
      },
    };
  } catch {
    await db.prepare(`DELETE FROM flight_search_cache WHERE cache_key = ?`).bind(key).run();
    return null;
  }
}

export async function storeFlightSearchCache(
  db: D1Like,
  body: NormalizedFlightSearch,
  responsePayload: Record<string, unknown>,
  itineraries: Array<{ price?: { amount?: number; currency?: string } }>,
  observedAt: string,
  now = new Date(),
): Promise<void> {
  await ensureFlightCacheSchema(db);
  const key = await flightSearchCacheKey(body);
  const route = routeFields(body);
  const cachedAt = now.toISOString();
  const freshUntil = new Date(now.getTime() + SEARCH_CACHE_TTL_SECONDS * 1000).toISOString();
  const deleteAfter = route.outboundDate;
  const requestJSON = stableSearchIdentity(body);
  const responseJSON = JSON.stringify(responsePayload);

  await db.prepare(`INSERT INTO flight_search_cache (
    cache_key, request_json, response_json,
    outbound_origin, outbound_destination, outbound_date,
    inbound_origin, inbound_destination, inbound_date,
    passenger_signature, cabin_class,
    provider_observed_at, cached_at, fresh_until, delete_after
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(cache_key) DO UPDATE SET
    response_json = excluded.response_json,
    provider_observed_at = excluded.provider_observed_at,
    cached_at = excluded.cached_at,
    fresh_until = excluded.fresh_until,
    delete_after = excluded.delete_after`)
    .bind(
      key, requestJSON, responseJSON,
      route.outboundOrigin, route.outboundDestination, route.outboundDate,
      route.inboundOrigin, route.inboundDestination, route.inboundDate,
      passengerSignature(body), body.cabin_class,
      observedAt, cachedAt, freshUntil, deleteAfter,
    ).run();

  const travelerCount = body.adults + body.children + body.infants_in_seat + body.infants_on_lap;
  const valid = itineraries
    .map((item) => ({ amount: Number(item.price?.amount ?? 0), currency: String(item.price?.currency ?? "").toUpperCase() }))
    .filter((item) => Number.isFinite(item.amount) && item.amount > 0 && /^[A-Z]{3}$/.test(item.currency));
  if (!valid.length || travelerCount < 1) return;

  // Market=US normally makes all returned fares USD. If an upstream response ever
  // contains more than one currency, persist each search only when a single currency
  // is internally comparable; otherwise skip the calendar observation rather than
  // publishing a mathematically invalid minimum.
  const currencies = [...new Set(valid.map((item) => item.currency))];
  if (currencies.length !== 1) return;
  const currency = currencies[0];
  const minTotalFare = Math.min(...valid.map((item) => item.amount));
  const minPerTravelerFare = minTotalFare / travelerCount;
  const calendarKey = await sha256([
    route.outboundOrigin, route.outboundDestination,
    route.inboundOrigin ?? "", route.inboundDestination ?? "",
    passengerSignature(body), body.cabin_class,
    route.outboundDate, route.inboundDate ?? "", currency,
  ].join("|"));

  await db.prepare(`INSERT INTO flight_calendar_fares (
    calendar_key, outbound_origin, outbound_destination, inbound_origin, inbound_destination,
    passenger_signature, cabin_class, outbound_date, inbound_date,
    min_total_fare, min_per_traveler_fare, currency, observed_at, updated_at, delete_after
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(calendar_key) DO UPDATE SET
    -- Keep the latest observed minimum for this exact date pair, not the
    -- historical all-time low. A later real search may legitimately show a
    -- higher fare and the calendar must not advertise an expired bargain.
    min_total_fare = excluded.min_total_fare,
    min_per_traveler_fare = excluded.min_per_traveler_fare,
    currency = excluded.currency,
    observed_at = excluded.observed_at,
    updated_at = excluded.updated_at,
    delete_after = excluded.delete_after`)
    .bind(
      calendarKey,
      route.outboundOrigin, route.outboundDestination, route.inboundOrigin, route.inboundDestination,
      passengerSignature(body), body.cabin_class, route.outboundDate, route.inboundDate,
      minTotalFare, minPerTravelerFare, currency, observedAt, cachedAt, deleteAfter,
    ).run();
}

export async function acquireFlightSearchLock(db: D1Like, body: NormalizedFlightSearch, now = new Date()): Promise<boolean> {
  await ensureFlightCacheSchema(db);
  const key = await flightSearchCacheKey(body);
  const nowISO = now.toISOString();
  await db.prepare(`DELETE FROM flight_search_locks WHERE cache_key = ? AND expires_at <= ?`).bind(key, nowISO).run();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_SECONDS * 1000).toISOString();
  const result = await db.prepare(`INSERT OR IGNORE INTO flight_search_locks (cache_key, expires_at) VALUES (?, ?)`).bind(key, expiresAt).run();
  return Number((result.meta as any)?.changes ?? 0) > 0;
}

export async function releaseFlightSearchLock(db: D1Like, body: NormalizedFlightSearch): Promise<void> {
  const key = await flightSearchCacheKey(body);
  await db.prepare(`DELETE FROM flight_search_locks WHERE cache_key = ?`).bind(key).run();
}

function validIATA(value: string | null): value is string {
  return Boolean(value && /^[A-Z]{3}$/.test(value));
}

function boundedInt(value: string | null, min: number, max: number): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return number >= min && number <= max ? number : null;
}

export async function flightCalendarResponse(url: URL, db: D1Like | undefined): Promise<Response> {
  if (!db) return new Response(JSON.stringify({ ok: false, error: "FLIGHT_CACHE_NOT_CONFIGURED" }), { status: 503, headers: { "content-type": "application/json" } });
  await ensureFlightCacheSchema(db);
  await cleanupExpiredFlightCache(db).catch(() => undefined);

  const outboundOrigin = url.searchParams.get("outbound_origin")?.trim().toUpperCase() ?? null;
  const outboundDestination = url.searchParams.get("outbound_destination")?.trim().toUpperCase() ?? null;
  const inboundOriginRaw = url.searchParams.get("inbound_origin")?.trim().toUpperCase() ?? null;
  const inboundDestinationRaw = url.searchParams.get("inbound_destination")?.trim().toUpperCase() ?? null;
  const adults = boundedInt(url.searchParams.get("adults"), 1, 9);
  const children = boundedInt(url.searchParams.get("children") ?? "0", 0, 8);
  const infantsInSeat = boundedInt(url.searchParams.get("infants_in_seat") ?? "0", 0, 8);
  const infantsOnLap = boundedInt(url.searchParams.get("infants_on_lap") ?? "0", 0, 8);
  const cabin = (url.searchParams.get("cabin_class") ?? "economy").trim().toLowerCase();
  const from = url.searchParams.get("from")?.trim() ?? "";
  const to = url.searchParams.get("to")?.trim() ?? "";
  const selectedOutbound = url.searchParams.get("selected_outbound")?.trim() ?? null;

  const fromTime = DATE.test(from) ? Date.parse(`${from}T00:00:00Z`) : NaN;
  const toTime = DATE.test(to) ? Date.parse(`${to}T00:00:00Z`) : NaN;
  const rangeDays = Number.isFinite(fromTime) && Number.isFinite(toTime) ? Math.round((toTime - fromTime) / 86_400_000) : Number.POSITIVE_INFINITY;
  if (!validIATA(outboundOrigin) || !validIATA(outboundDestination) || outboundOrigin === outboundDestination ||
      (inboundOriginRaw !== null && !validIATA(inboundOriginRaw)) ||
      (inboundDestinationRaw !== null && !validIATA(inboundDestinationRaw)) ||
      adults === null || children === null || infantsInSeat === null || infantsOnLap === null ||
      adults + children + infantsInSeat + infantsOnLap > 9 || infantsOnLap > adults ||
      !["economy", "premium_economy", "business", "first"].includes(cabin) ||
      !DATE.test(from) || !DATE.test(to) || from > to || rangeDays < 0 || rangeDays > 370 ||
      (selectedOutbound !== null && (!DATE.test(selectedOutbound) || selectedOutbound < from || selectedOutbound > to))) {
    return new Response(JSON.stringify({ ok: false, error: "INVALID_CALENDAR_QUERY" }), { status: 400, headers: { "content-type": "application/json" } });
  }

  const signature = `a${adults}-c${children}-s${infantsInSeat}-l${infantsOnLap}`;
  const rows = await db.prepare(`SELECT outbound_date, inbound_date, min_total_fare, min_per_traveler_fare, currency, observed_at
    FROM flight_calendar_fares
    WHERE outbound_origin = ? AND outbound_destination = ?
      AND COALESCE(inbound_origin, '') = COALESCE(?, '')
      AND COALESCE(inbound_destination, '') = COALESCE(?, '')
      AND passenger_signature = ? AND cabin_class = ?
      AND outbound_date BETWEEN ? AND ?
      AND (? IS NULL OR outbound_date = ?)
    ORDER BY outbound_date ASC, min_per_traveler_fare ASC`)
    .bind(
      outboundOrigin, outboundDestination, inboundOriginRaw, inboundDestinationRaw,
      signature, cabin, from, to, selectedOutbound, selectedOutbound,
    ).all<CalendarRow>();

  const curatedRows = await curatedCalendarRows(db, {
    outboundOrigin,
    outboundDestination,
    inboundOrigin: inboundOriginRaw,
    inboundDestination: inboundDestinationRaw,
    cabinClass: cabin,
    travelerCount: adults + children + infantsInSeat + infantsOnLap,
    from,
    to,
    selectedOutbound,
  }).catch(() => []);

  // Automatic observations continue to reflect the latest live customer search.
  // Staff-curated offers are merged only for calendar ranking so an approved,
  // lower verified fare can win for a date pair without contaminating the normal
  // provider search cache. The client UI may choose not to render the amount.
  const values: CalendarRow[] = [...(rows.results ?? []), ...curatedRows];
  const bestByOutbound = new Map<string, CalendarRow>();
  for (const row of values) {
    const existing = bestByOutbound.get(row.outbound_date);
    if (!existing || row.min_per_traveler_fare < existing.min_per_traveler_fare) bestByOutbound.set(row.outbound_date, row);
  }
  const suggestions = [...values]
    .sort((a, b) => a.min_per_traveler_fare - b.min_per_traveler_fare || a.outbound_date.localeCompare(b.outbound_date))
    .slice(0, 6);

  return new Response(JSON.stringify({
    ok: true,
    route: {
      outbound_origin: outboundOrigin,
      outbound_destination: outboundDestination,
      inbound_origin: inboundOriginRaw,
      inbound_destination: inboundDestinationRaw,
    },
    passenger_signature: signature,
    cabin_class: cabin,
    prices: [...bestByOutbound.values()],
    observations: values,
    suggestions,
    generated_at: new Date().toISOString(),
  }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" },
  });
}
