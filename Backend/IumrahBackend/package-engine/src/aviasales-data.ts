import type { Env } from "./env";

const API_ORIGIN = "https://api.travelpayouts.com";
const AVIASALES_ORIGIN = "https://www.aviasales.com";

function json(value: unknown, status = 200, cacheControl = "no-store") {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
    },
  });
}

function normalizedIata(raw: string | null): string | null {
  const value = (raw ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : null;
}

function normalizedDate(raw: string | null): string | null {
  const value = (raw ?? "").trim();
  return /^\d{4}-\d{2}(?:-\d{2})?$/.test(value) ? value : null;
}

function normalizedCurrency(raw: string | null): string {
  const value = (raw ?? "usd").trim().toLowerCase();
  return /^[a-z]{3}$/.test(value) ? value : "usd";
}

function boolParam(raw: string | null, fallback = false): boolean {
  if (raw == null) return fallback;
  return raw === "true" || raw === "1";
}

function intParam(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function fullAviasalesURL(path: unknown): string | null {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  try {
    // REST Data API commonly returns /search/... while some data methods return
    // /TAS0910JED1-style codes. Support both without producing /search/search/.
    if (path.startsWith("/search/")) {
      return new URL(path, AVIASALES_ORIGIN).toString();
    }
    return new URL(`/search/${path.replace(/^\/+/, "")}`, AVIASALES_ORIGIN).toString();
  } catch {
    return null;
  }
}

type AviasalesOffer = {
  origin?: string;
  destination?: string;
  origin_airport?: string;
  destination_airport?: string;
  price?: number;
  airline?: string;
  flight_number?: string | number;
  departure_at?: string;
  arrival_at?: string;
  return_at?: string;
  return_airline?: string;
  return_airline_code?: string;
  airline_back?: string;
  return_flight_number?: string | number;
  flight_number_back?: string | number;
  transfers?: number;
  return_transfers?: number;
  duration?: number;
  duration_to?: number;
  duration_back?: number;
  link?: string;
};

type PricesEnvelope = {
  success?: boolean;
  data?: AviasalesOffer[];
  currency?: string;
  error?: string | null;
};

type GroupedEnvelope = {
  success?: boolean;
  data?: Record<string, AviasalesOffer>;
  currency?: string;
  error?: string | null;
};

function offerID(item: AviasalesOffer, index: number): string {
  const parts = [
    item.origin,
    item.destination,
    item.departure_at,
    item.return_at,
    item.airline,
    item.flight_number,
    item.price,
    index,
  ].map((value) => String(value ?? ""));
  return parts.join("|");
}

function normalizeOffer(item: AviasalesOffer, index: number) {
  const duration = Number(item.duration_to ?? item.duration ?? 0);
  return {
    id: offerID(item, index),
    origin: String(item.origin ?? "").toUpperCase(),
    destination: String(item.destination ?? "").toUpperCase(),
    originAirport: String(item.origin_airport ?? item.origin ?? "").toUpperCase(),
    destinationAirport: String(item.destination_airport ?? item.destination ?? "").toUpperCase(),
    price: Number(item.price ?? 0),
    airlineCode: String(item.airline ?? "").toUpperCase(),
    flightNumber: item.flight_number == null ? "" : String(item.flight_number),
    departureAt: String(item.departure_at ?? ""),
    arrivalAt: typeof item.arrival_at === "string" && item.arrival_at.trim() ? item.arrival_at : null,
    returnAt: typeof item.return_at === "string" && item.return_at.length > 0 ? item.return_at : null,
    returnAirlineCode: String(item.return_airline_code ?? item.return_airline ?? item.airline_back ?? "").toUpperCase() || null,
    returnFlightNumber: item.return_flight_number == null && item.flight_number_back == null
      ? null
      : String(item.return_flight_number ?? item.flight_number_back),
    transfers: Math.max(0, Number(item.transfers ?? 0)),
    returnTransfers: item.return_transfers == null ? null : Math.max(0, Number(item.return_transfers)),
    durationMinutes: Math.max(0, duration),
    returnDurationMinutes: item.duration_back == null ? null : Math.max(0, Number(item.duration_back)),
    bookingUrl: fullAviasalesURL(item.link),
  };
}


async function hydrateReturnIdentities(items: AviasalesOffer[], token: string, currency: string): Promise<AviasalesOffer[]> {
  const cache = new Map<string, AviasalesOffer[]>();
  const output: AviasalesOffer[] = [];

  for (const original of items) {
    const item = { ...original };
    const hasReturn = typeof item.return_at === "string" && item.return_at.length > 0;
    const currentAirline = String(item.return_airline_code ?? item.return_airline ?? item.airline_back ?? "").trim();
    const currentNumber = item.return_flight_number ?? item.flight_number_back;
    if (!hasReturn || (currentAirline && currentNumber != null)) {
      output.push(item);
      continue;
    }

    const origin = normalizedIata(String(item.destination ?? ""));
    const destination = normalizedIata(String(item.origin ?? ""));
    const day = String(item.return_at ?? "").slice(0, 10);
    if (!origin || !destination || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      output.push(item);
      continue;
    }

    const key = `${origin}|${destination}|${day}`;
    let rows = cache.get(key);
    if (!rows) {
      try {
        const reverse = new URL("/aviasales/v3/prices_for_dates", API_ORIGIN);
        reverse.searchParams.set("origin", origin);
        reverse.searchParams.set("destination", destination);
        reverse.searchParams.set("departure_at", day);
        reverse.searchParams.set("currency", currency);
        reverse.searchParams.set("sorting", "price");
        reverse.searchParams.set("unique", "false");
        reverse.searchParams.set("direct", "false");
        reverse.searchParams.set("one_way", "true");
        reverse.searchParams.set("limit", "100");
        reverse.searchParams.set("page", "1");
        const payload = await travelpayoutsJSON<PricesEnvelope>(reverse, token);
        rows = payload.data ?? [];
      } catch {
        rows = [];
      }
      cache.set(key, rows);
    }

    const targetTime = String(item.return_at ?? "");
    const targetInstant = Date.parse(targetTime);
    const exact = rows.find((candidate) => {
      const candidateInstant = Date.parse(String(candidate.departure_at ?? ""));
      // The same instant can be represented in UTC or with an airport offset;
      // compare instants, not unnormalized ISO strings or just flight dates.
      return Number.isFinite(targetInstant) && Number.isFinite(candidateInstant) &&
        Math.abs(candidateInstant - targetInstant) < 60_000;
    });
    // The Data API return timestamp may be all it gives us. A same-day
    // reverse fare belongs to an unrelated itinerary unless its timestamp
    // matches; never invent a carrier/flight number to fill the UI.
    const match = exact;
    if (match) {
      item.return_airline_code = String(match.airline ?? "").toUpperCase() || undefined;
      item.return_flight_number = match.flight_number;
      if (item.duration_back == null) item.duration_back = Number(match.duration_to ?? match.duration ?? 0);
      if (item.return_transfers == null) item.return_transfers = Number(match.transfers ?? 0);
    }
    output.push(item);
  }

  return output;
}

async function travelpayoutsJSON<T>(url: URL, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Access-Token": token,
      "User-Agent": "iumrah-package-engine/aviasales-data-v1",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`TRAVELPAYOUTS_${response.status}${body ? `: ${body.slice(0, 220)}` : ""}`);
  }
  return await response.json() as T;
}

export async function publicAviasalesData(url: URL, env: Env): Promise<Response> {
  const token = env.TRAVELPAYOUTS_API_TOKEN?.trim();
  if (!token) {
    return json({ ok: false, error: "TRAVELPAYOUTS_API_TOKEN is not configured" }, 503);
  }

  const origin = normalizedIata(url.searchParams.get("origin"));
  const destination = normalizedIata(url.searchParams.get("destination"));
  const departure = normalizedDate(url.searchParams.get("departure"));
  const returnAt = normalizedDate(url.searchParams.get("return"));
  const view = (url.searchParams.get("view") ?? "offers").trim().toLowerCase();
  const currency = normalizedCurrency(url.searchParams.get("currency"));
  const direct = boolParam(url.searchParams.get("direct"), false);
  const fresh = boolParam(url.searchParams.get("fresh"), false);
  const edgeTTL = fresh ? "no-store" : "public, max-age=300, s-maxage=900";

  if (!origin || !destination || !departure) {
    return json({ ok: false, error: "origin, destination and departure are required" }, 400);
  }
  if (origin === destination) {
    return json({ ok: false, error: "origin and destination must differ" }, 400);
  }

  try {
    if (view === "calendar") {
      const upstream = new URL("/aviasales/v3/grouped_prices", API_ORIGIN);
      upstream.searchParams.set("origin", origin);
      upstream.searchParams.set("destination", destination);
      upstream.searchParams.set("currency", currency);
      upstream.searchParams.set("departure_at", departure);
      upstream.searchParams.set("group_by", "departure_at");
      upstream.searchParams.set("direct", direct ? "true" : "false");
      if (returnAt) upstream.searchParams.set("return_at", returnAt);

      const payload = await travelpayoutsJSON<GroupedEnvelope>(upstream, token);
      if (payload.success === false) {
        return json({ ok: false, error: payload.error ?? "AVIASALES_DATA_ERROR" }, 502);
      }

      // grouped_prices may supply only the YYYY-MM-DD map key and a cached fare.
      // Do not discard such days merely because flight-level departure_at is
      // absent: the date and USD price are still valid *calendar observations*.
      // The iOS client must not promote a date-only observation to a bookable flight.
      const byDate = new Map<string, ReturnType<typeof normalizeOffer> & { date: string }>();
      for (const [date, item] of Object.entries(payload.data ?? {})) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        if (!date.startsWith(departure)) continue;
        const row = normalizeOffer(item, byDate.size);
        if (!(row.price > 0)) continue;
        const normalized = { ...row, date, origin: row.origin || origin, destination: row.destination || destination };
        const existing = byDate.get(date);
        if (!existing || existing.price > normalized.price) byDate.set(date, normalized);
      }

      // Supply genuinely observed date-specific Data API fares when grouped_prices
      // has sparse months. No extrapolation, invented dates or synthetic fares.
      if (byDate.size < 15) {
        try {
          const monthly = new URL("/aviasales/v3/prices_for_dates", API_ORIGIN);
          monthly.searchParams.set("origin", origin);
          monthly.searchParams.set("destination", destination);
          monthly.searchParams.set("departure_at", departure);
          monthly.searchParams.set("currency", currency);
          monthly.searchParams.set("sorting", "price");
          monthly.searchParams.set("unique", "false");
          monthly.searchParams.set("one_way", "true");
          monthly.searchParams.set("direct", direct ? "true" : "false");
          monthly.searchParams.set("limit", "100");
          const response = await travelpayoutsJSON<PricesEnvelope>(monthly, token);
          for (const item of response.data ?? []) {
            const day = String(item.departure_at ?? "").slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !day.startsWith(departure)) continue;
            const normalized = normalizeOffer(item, byDate.size);
            if (!(normalized.price > 0)) continue;
            const row = { ...normalized, date: day, origin: normalized.origin || origin, destination: normalized.destination || destination };
            const existing = byDate.get(day);
            if (!existing || existing.price > row.price) byDate.set(day, row);
          }
        } catch {
          // A partial upstream outage must not erase a valid grouped_prices month.
        }
      }
      const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

      return json({
        ok: true,
        source: "aviasales-data",
        sourceFreshness: "recent-search-cache",
        generatedAt: new Date().toISOString(),
        currency: payload.currency ?? currency,
        query: { origin, destination, departure, return: returnAt, direct },
        days: rows,
      }, 200, edgeTTL);
    }

    if (view !== "offers" && view !== "direct") {
      return json({ ok: false, error: "Unsupported view" }, 400);
    }

    const upstream = new URL("/aviasales/v3/prices_for_dates", API_ORIGIN);
    upstream.searchParams.set("origin", origin);
    upstream.searchParams.set("destination", destination);
    upstream.searchParams.set("departure_at", departure);
    upstream.searchParams.set("currency", currency);
    upstream.searchParams.set("sorting", "price");
    upstream.searchParams.set("unique", "false");
    upstream.searchParams.set("direct", view === "direct" || direct ? "true" : "false");
    upstream.searchParams.set("one_way", returnAt ? "false" : "true");
    upstream.searchParams.set("limit", String(intParam(url.searchParams.get("limit"), 30, 1, 100)));
    upstream.searchParams.set("page", String(intParam(url.searchParams.get("page"), 1, 1, 1000)));
    if (returnAt) upstream.searchParams.set("return_at", returnAt);

    const payload = await travelpayoutsJSON<PricesEnvelope>(upstream, token);
    if (payload.success === false) {
      return json({ ok: false, error: payload.error ?? "AVIASALES_DATA_ERROR" }, 502);
    }

    // Cached round-trip rows report a single airline/number and number of stops,
    // not the individual connected flight segments. Never join an unrelated
    // reverse one-way ticket by departure time and call it the return carrier.
    const rows = (payload.data ?? [])
      .map((item, index) => normalizeOffer(item, index))
      .filter((item) => item.price > 0 && item.departureAt.length > 0)
      .sort((a, b) => a.price - b.price);

    return json({
      ok: true,
      source: "aviasales-data",
      sourceFreshness: "recent-search-cache",
      generatedAt: new Date().toISOString(),
      currency: payload.currency ?? currency,
      query: { origin, destination, departure, return: returnAt, direct: view === "direct" || direct },
      offers: rows,
    }, 200, edgeTTL);
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "AVIASALES_DATA_REQUEST_FAILED",
    }, 502);
  }
}
