import type { Env } from "./env";
import { acquireFlightSearchLock, readFlightSearchCache, releaseFlightSearchLock, storeFlightSearchCache, type NormalizedFlightSearch } from "./flight-cache";

const IGNAV_BASE_URL = "https://ignav.com/api";
const IATA_AIRPORT = /^[A-Z]{3}$/;
const IATA_AIRLINE = /^[A-Z0-9]{2}$/;
const FLIGHT_NUMBER = /^[0-9]{1,4}[A-Z]?$/;
const CURRENCY = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type TimeRange = {
  earliest_hour?: number;
  latest_hour?: number;
  arrival_earliest_hour?: number;
  arrival_latest_hour?: number;
};

type LegBody = {
  origin?: string;
  destination?: string;
  departure_date?: string;
  max_stops?: number | null;
  departure_time_range?: TimeRange | null;
};

type SearchBody = {
  legs?: LegBody[];
  adults?: number;
  children?: number;
  infants_in_seat?: number;
  infants_on_lap?: number;
  cabin_class?: "economy" | "premium_economy" | "business" | "first";
  min_carry_on_bags?: number | null;
  min_checked_bags?: number | null;
  max_price?: number | null;
  airlines_include?: string[] | null;
  airlines_exclude?: string[] | null;
  allow_self_transfer?: boolean;
  curation_mode?: "outbound_one_way" | "return_one_way" | "round_trip";
};

type IgnavPrice = { amount?: number; currency?: string; status?: string };
type IgnavBag = { carry_on?: number | null; checked?: number | null };
type IgnavSegment = {
  marketing_carrier_code?: string | null;
  flight_number?: string | null;
  operating_carrier_name?: string | null;
  departure_airport?: string;
  departure_time_local?: string;
  departure_timezone?: string | null;
  departure_time_utc?: string | null;
  arrival_airport?: string;
  arrival_time_local?: string;
  arrival_timezone?: string | null;
  arrival_time_utc?: string | null;
  duration_minutes?: number;
  aircraft?: string | null;
};
type IgnavLeg = { carrier?: string | null; duration_minutes?: number | null; segments?: IgnavSegment[] };
type IgnavItinerary = {
  price?: IgnavPrice;
  legs?: IgnavLeg[];
  outbound?: IgnavLeg;
  inbound?: IgnavLeg;
  cabin_class?: string | null;
  bags?: IgnavBag | null;
  requires_self_transfer?: boolean | null;
  ignav_id?: string;
};
type IgnavResponse = { itineraries?: IgnavItinerary[] };

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
});

function finiteInt(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || !Number.isInteger(value)) return undefined;
  const n = Number(value);
  return n >= min && n <= max ? n : undefined;
}

function normalizeAirlines(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 40) return undefined;
  const normalized = value.map((item) => String(item).trim().toUpperCase());
  if (normalized.some((code) => !IATA_AIRLINE.test(code))) return undefined;
  return [...new Set(normalized)];
}

function normalizeTimeRange(value: unknown): TimeRange | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const keys: (keyof TimeRange)[] = ["earliest_hour", "latest_hour", "arrival_earliest_hour", "arrival_latest_hour"];
  const result: TimeRange = {};
  for (const key of keys) {
    if (raw[key] === undefined || raw[key] === null) continue;
    const hour = finiteInt(raw[key], 0, 23);
    if (hour === undefined) return undefined;
    result[key] = hour;
  }
  if (result.earliest_hour !== undefined && result.latest_hour !== undefined && result.earliest_hour > result.latest_hour) return undefined;
  if (result.arrival_earliest_hour !== undefined && result.arrival_latest_hour !== undefined && result.arrival_earliest_hour > result.arrival_latest_hour) return undefined;
  return Object.keys(result).length ? result : undefined;
}

function normalizeRequestLeg(raw: LegBody) {
  const origin = String(raw.origin ?? "").trim().toUpperCase();
  const destination = String(raw.destination ?? "").trim().toUpperCase();
  const departureDate = String(raw.departure_date ?? "").trim();
  const maxStops = raw.max_stops === null || raw.max_stops === undefined ? undefined : finiteInt(raw.max_stops, 0, 2);
  const timeRange = normalizeTimeRange(raw.departure_time_range);

  if (!IATA_AIRPORT.test(origin) || !IATA_AIRPORT.test(destination) || origin === destination) throw new Error("INVALID_ROUTE");
  if (!DATE.test(departureDate)) throw new Error("INVALID_DATE");
  const parsedDate = new Date(`${departureDate}T00:00:00Z`);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== departureDate) throw new Error("INVALID_DATE");
  if (raw.max_stops !== undefined && raw.max_stops !== null && maxStops === undefined) throw new Error("INVALID_MAX_STOPS");
  if (raw.departure_time_range !== undefined && raw.departure_time_range !== null && timeRange === undefined) throw new Error("INVALID_TIME_RANGE");

  return {
    origin,
    destination,
    departure_date: departureDate,
    max_stops: maxStops,
    departure_time_range: timeRange,
  };
}

function validateSearchBody(raw: SearchBody) {
  if (!Array.isArray(raw.legs) || raw.legs.length < 1 || raw.legs.length > 2) throw new Error("INVALID_LEGS");
  const legs = raw.legs.map(normalizeRequestLeg);
  if (legs.length === 2 && legs[1].departure_date < legs[0].departure_date) throw new Error("INVALID_DATE_ORDER");

  const adults = finiteInt(raw.adults ?? 1, 1, 9);
  const children = finiteInt(raw.children ?? 0, 0, 8);
  const infantsInSeat = finiteInt(raw.infants_in_seat ?? 0, 0, 8);
  const infantsOnLap = finiteInt(raw.infants_on_lap ?? 0, 0, 8);
  if (adults === undefined || children === undefined || infantsInSeat === undefined || infantsOnLap === undefined) throw new Error("INVALID_PASSENGERS");
  if (adults + children + infantsInSeat + infantsOnLap > 9 || infantsOnLap > adults) throw new Error("INVALID_PASSENGERS");

  const cabin = raw.cabin_class ?? "economy";
  if (!["economy", "premium_economy", "business", "first"].includes(cabin)) throw new Error("INVALID_CABIN");
  const minCarryOn = raw.min_carry_on_bags === null || raw.min_carry_on_bags === undefined ? undefined : finiteInt(raw.min_carry_on_bags, 0, 9);
  const minChecked = raw.min_checked_bags === null || raw.min_checked_bags === undefined ? undefined : finiteInt(raw.min_checked_bags, 0, 9);
  const maxPrice = raw.max_price === null || raw.max_price === undefined ? undefined : finiteInt(raw.max_price, 1, 1_000_000);
  if (raw.min_carry_on_bags !== undefined && raw.min_carry_on_bags !== null && minCarryOn === undefined) throw new Error("INVALID_BAGS");
  if (raw.min_checked_bags !== undefined && raw.min_checked_bags !== null && minChecked === undefined) throw new Error("INVALID_BAGS");
  if (raw.max_price !== undefined && raw.max_price !== null && maxPrice === undefined) throw new Error("INVALID_MAX_PRICE");

  const include = normalizeAirlines(raw.airlines_include);
  const exclude = normalizeAirlines(raw.airlines_exclude);
  if (raw.airlines_include !== undefined && raw.airlines_include !== null && include === undefined) throw new Error("INVALID_AIRLINES_INCLUDE");
  if (raw.airlines_exclude !== undefined && raw.airlines_exclude !== null && exclude === undefined) throw new Error("INVALID_AIRLINES_EXCLUDE");
  if (include && exclude && include.some((code) => exclude.includes(code))) throw new Error("CONFLICTING_AIRLINE_FILTERS");
  if (raw.allow_self_transfer !== undefined && typeof raw.allow_self_transfer !== "boolean") throw new Error("INVALID_SELF_TRANSFER");

  return {
    legs: legs.map(({ origin, destination, departure_date }) => ({
      origin,
      destination,
      departure_date,
      max_stops: undefined,
      departure_time_range: undefined,
    })),
    adults,
    children,
    infants_in_seat: infantsInSeat,
    infants_on_lap: infantsOnLap,
    cabin_class: cabin,
    // Search Ignav as broadly as possible. Price, airline, baggage, stop and
    // transfer preferences belong to the client-side result filters; sending
    // them upstream makes valid provider itineraries disappear permanently.
    allow_self_transfer: true,
    market: "US",
  };
}

function validateCurationSearchBody(raw: SearchBody) {
  // Reuse the production validation contract, but keep the provider filters that
  // the customer search intentionally strips. This endpoint is staff-only and is
  // used to curate a small set of nonstop/date recommendations, so narrowing the
  // provider request is desirable and cannot poison the general customer cache.
  const base = validateSearchBody(raw);
  const legs = (raw.legs ?? []).map(normalizeRequestLeg);
  const include = normalizeAirlines(raw.airlines_include);
  const exclude = normalizeAirlines(raw.airlines_exclude);
  const curationMode = raw.curation_mode ?? (legs.length === 1 ? "outbound_one_way" : "round_trip");
  if (!["outbound_one_way", "return_one_way", "round_trip"].includes(curationMode)) throw new Error("INVALID_CURATION_MODE");
  if (curationMode === "round_trip" && legs.length !== 2) throw new Error("INVALID_CURATION_LEGS");
  if (curationMode !== "round_trip" && legs.length !== 1) throw new Error("INVALID_CURATION_LEGS");
  return {
    ...base,
    legs,
    min_carry_on_bags: raw.min_carry_on_bags == null ? undefined : finiteInt(raw.min_carry_on_bags, 0, 9),
    min_checked_bags: raw.min_checked_bags == null ? undefined : finiteInt(raw.min_checked_bags, 0, 9),
    max_price: raw.max_price == null ? undefined : finiteInt(raw.max_price, 1, 1_000_000),
    airlines_include: include,
    airlines_exclude: exclude,
    allow_self_transfer: raw.allow_self_transfer ?? false,
    market: "US",
    curation_mode: curationMode as "outbound_one_way" | "return_one_way" | "round_trip",
  };
}

async function fetchIgnav(apiKey: string, body: Record<string, unknown>, endpoint = "/fares/search") {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${IGNAV_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: unknown = null;
      try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
      if (response.ok) return payload as IgnavResponse;

      const retryable = response.status === 424 || response.status === 503;
      if (!retryable || attempt === 2) {
        const upstreamCode = typeof payload === "object" && payload !== null
          ? String((payload as any)?.error?.code ?? `HTTP_${response.status}`)
          : `HTTP_${response.status}`;
        const error = new Error(`IGNAV_${upstreamCode}`) as Error & { status?: number; retryable?: boolean };
        error.status = response.status;
        error.retryable = false;
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    } catch (error) {
      lastError = error;
      const nonRetryable = typeof error === "object" && error !== null && (error as { retryable?: boolean }).retryable === false;
      if (nonRetryable || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error("IGNAV_REQUEST_FAILED");
}

function safeTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 16) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function zonedLocalInstant(value: unknown, timeZone: unknown): string | null {
  if (typeof value !== "string" || typeof timeZone !== "string") return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  if (!match) return null;
  const target = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
    millisecond: Number((match[7] ?? "0").padEnd(3, "0")),
  };
  const targetUTC = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second, target.millisecond);
  if (!Number.isFinite(targetUTC)) return null;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone.trim(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return null;
  }

  const wallClockUTC = (date: Date): number | null => {
    const parts = Object.fromEntries(
      formatter.formatToParts(date)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)])
    ) as Record<string, number>;
    if (![parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second].every(Number.isFinite)) return null;
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, target.millisecond);
  };

  // Resolve the IANA offset iteratively. The second pass covers DST boundaries;
  // the final equality check rejects nonexistent/ambiguous malformed wall times.
  let instant = targetUTC;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rendered = wallClockUTC(new Date(instant));
    if (rendered === null) return null;
    instant += targetUTC - rendered;
  }
  const result = new Date(instant);
  return wallClockUTC(result) === targetUTC ? result.toISOString() : null;
}

function normalizedInstant(primary: unknown, fallback: unknown, fallbackTimeZone: unknown): string | null {
  const primaryValue = safeTimestamp(primary);
  if (primaryValue) return primaryValue;
  return zonedLocalInstant(fallback, fallbackTimeZone);
}

function normalizeResponseLeg(leg: IgnavLeg | undefined, expected: ReturnType<typeof normalizeRequestLeg>, cabin: string) {
  const segments = Array.isArray(leg?.segments) ? leg!.segments! : [];
  if (segments.length === 0 || segments.length > 8) return null;
  const normalizedSegments = segments.map((segment) => {
    const airlineCode = String(segment.marketing_carrier_code ?? "").trim().toUpperCase();
    const number = String(segment.flight_number ?? "").trim().toUpperCase().replace(/^\D+/, "");
    const origin = String(segment.departure_airport ?? "").trim().toUpperCase();
    const destination = String(segment.arrival_airport ?? "").trim().toUpperCase();
    const departureLocal = safeTimestamp(segment.departure_time_local);
    const arrivalLocal = safeTimestamp(segment.arrival_time_local);
    const departureUTC = normalizedInstant(segment.departure_time_utc, segment.departure_time_local, segment.departure_timezone);
    const arrivalUTC = normalizedInstant(segment.arrival_time_utc, segment.arrival_time_local, segment.arrival_timezone);
    if (!IATA_AIRPORT.test(origin) || !IATA_AIRPORT.test(destination) || origin === destination) return null;
    if (!departureUTC || !arrivalUTC || Date.parse(departureUTC) >= Date.parse(arrivalUTC)) return null;
    const suppliedDuration = Number(segment.duration_minutes ?? 0);
    const duration = Number.isFinite(suppliedDuration) && suppliedDuration > 0
      ? suppliedDuration
      : Math.round((Date.parse(arrivalUTC) - Date.parse(departureUTC)) / 60_000);
    if (duration <= 0 || duration > 48 * 60) return null;
    return {
      marketing_carrier_code: IATA_AIRLINE.test(airlineCode) ? airlineCode : "",
      flight_number: FLIGHT_NUMBER.test(number) ? number : "",
      operating_carrier_name: typeof segment.operating_carrier_name === "string" ? segment.operating_carrier_name.trim() || null : null,
      departure_airport: origin,
      departure_time_local: departureLocal ?? departureUTC,
      departure_timezone: typeof segment.departure_timezone === "string" ? segment.departure_timezone : null,
      departure_time_utc: departureUTC,
      arrival_airport: destination,
      arrival_time_local: arrivalLocal ?? arrivalUTC,
      arrival_timezone: typeof segment.arrival_timezone === "string" ? segment.arrival_timezone : null,
      arrival_time_utc: arrivalUTC,
      duration_minutes: duration,
      aircraft: typeof segment.aircraft === "string" ? segment.aircraft.trim() || null : null,
    };
  });
  if (normalizedSegments.some((segment) => segment === null)) return null;
  const safeSegments = normalizedSegments as NonNullable<(typeof normalizedSegments)[number]>[];
  if (safeSegments[0].departure_airport !== expected.origin || safeSegments.at(-1)?.arrival_airport !== expected.destination) return null;
  if (!safeSegments[0].departure_time_local.startsWith(expected.departure_date) && !safeSegments[0].departure_time_utc.startsWith(expected.departure_date)) return null;
  for (let index = 1; index < safeSegments.length; index += 1) {
    if (safeSegments[index - 1].arrival_airport !== safeSegments[index].departure_airport) return null;
    if (Date.parse(safeSegments[index].departure_time_utc) < Date.parse(safeSegments[index - 1].arrival_time_utc)) return null;
  }
  const suppliedLegDuration = Number(leg?.duration_minutes ?? 0);
  const calculatedLegDuration = Math.round((Date.parse(safeSegments.at(-1)!.arrival_time_utc) - Date.parse(safeSegments[0].departure_time_utc)) / 60_000);
  const duration = Number.isFinite(suppliedLegDuration) && suppliedLegDuration > 0 ? suppliedLegDuration : calculatedLegDuration;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 96 * 60) return null;
  const primary = safeSegments[0];
  const exactFlightNumber = [primary.marketing_carrier_code, primary.flight_number].filter(Boolean).join(" ");
  return {
    airline: typeof leg?.carrier === "string" && leg.carrier.trim() ? leg.carrier.trim() : (primary.operating_carrier_name ?? primary.marketing_carrier_code),
    flight_number: exactFlightNumber,
    airline_code: primary.marketing_carrier_code,
    origin: expected.origin,
    destination: expected.destination,
    departure_at: primary.departure_time_utc,
    arrival_at: safeSegments.at(-1)!.arrival_time_utc,
    duration_minutes: duration,
    stops: safeSegments.length - 1,
    cabin_class: cabin,
    segments: safeSegments,
  };
}

function normalizeItinerary(
  itinerary: IgnavItinerary,
  request: { legs: ReturnType<typeof normalizeRequestLeg>[]; cabin_class: string },
  observedAt: string,
  index: number,
  requireVerified = true,
) {
  const price = itinerary.price;
  if (!price || typeof price.amount !== "number" || !Number.isFinite(price.amount) || price.amount <= 0) return null;
  // Customer-facing package pricing still requires a verified fare. Staff curation
  // is a discovery workflow, so it may inspect an unverified Ignav price hint and
  // decide manually whether that flight/date should be recommended.
  if (requireVerified && String(price.status || "").toLowerCase() !== "verified") return null;
  const currency = String(price.currency ?? "").toUpperCase();
  if (!CURRENCY.test(currency)) return null;
  const sourceID = typeof itinerary.ignav_id === "string" && itinerary.ignav_id.length >= 1 && itinerary.ignav_id.length <= 160
    ? itinerary.ignav_id
    : `fallback-${observedAt.replace(/[^0-9]/g, "")}-${index + 1}`;
  if (!Array.isArray(itinerary.legs) || itinerary.legs.length !== request.legs.length) return null;

  const legs = itinerary.legs.map((leg, index) => normalizeResponseLeg(leg, request.legs[index], typeof itinerary.cabin_class === "string" ? itinerary.cabin_class : request.cabin_class));
  if (legs.some((leg) => leg === null)) return null;
  const safeLegs = legs as NonNullable<(typeof legs)[number]>[];

  const bags = itinerary.bags && typeof itinerary.bags === "object" ? {
    carry_on: Number.isInteger(itinerary.bags.carry_on) && Number(itinerary.bags.carry_on) >= 0 ? Number(itinerary.bags.carry_on) : null,
    checked: Number.isInteger(itinerary.bags.checked) && Number(itinerary.bags.checked) >= 0 ? Number(itinerary.bags.checked) : null,
  } : null;

  return {
    id: sourceID,
    source: "ignav",
    source_name: "Ignav",
    observed_at: observedAt,
    // Ignav returns one price for the complete itinerary and passenger mix
    // submitted in this request. With two ordered legs this is the full
    // round-trip/open-jaw fare; the client must charge it exactly once.
    fare_scope: "total_party",
    price: { amount: price.amount, currency, status: String(price.status || "unverified") },
    legs: safeLegs,
    cabin_class: typeof itinerary.cabin_class === "string" ? itinerary.cabin_class : request.cabin_class,
    bags,
    requires_self_transfer: itinerary.requires_self_transfer ?? null,
    ignav_id: sourceID,
  };
}


function dedicatedOneWayItinerary(itinerary: IgnavItinerary): IgnavItinerary {
  if (Array.isArray(itinerary.legs) && itinerary.legs.length > 0) return itinerary;
  if (!itinerary.outbound) return itinerary;
  return { ...itinerary, legs: [itinerary.outbound] };
}

function dedicatedRoundTripItinerary(itinerary: IgnavItinerary): IgnavItinerary {
  if (Array.isArray(itinerary.legs) && itinerary.legs.length > 0) return itinerary;
  if (!itinerary.outbound || !itinerary.inbound) return itinerary;
  return { ...itinerary, legs: [itinerary.outbound, itinerary.inbound] };
}

function curationOneWayBody(
  leg: ReturnType<typeof normalizeRequestLeg>,
  body: ReturnType<typeof validateCurationSearchBody>,
  includeAirlines: boolean,
): Record<string, unknown> {
  return {
    origin: leg.origin,
    destination: leg.destination,
    departure_date: leg.departure_date,
    adults: body.adults,
    children: body.children,
    infants_in_seat: body.infants_in_seat,
    infants_on_lap: body.infants_on_lap,
    cabin_class: body.cabin_class,
    max_stops: leg.max_stops,
    departure_time_range: leg.departure_time_range,
    min_carry_on_bags: body.min_carry_on_bags,
    min_checked_bags: body.min_checked_bags,
    max_price: body.max_price,
    airlines_include: includeAirlines ? body.airlines_include : undefined,
    airlines_exclude: body.airlines_exclude,
    allow_self_transfer: body.allow_self_transfer,
    market: body.market,
  };
}

function curationRoundTripBody(
  outbound: ReturnType<typeof normalizeRequestLeg>,
  inbound: ReturnType<typeof normalizeRequestLeg>,
  body: ReturnType<typeof validateCurationSearchBody>,
  includeAirlines: boolean,
): Record<string, unknown> {
  return {
    origin: outbound.origin,
    destination: outbound.destination,
    departure_date: outbound.departure_date,
    return_date: inbound.departure_date,
    adults: body.adults,
    children: body.children,
    infants_in_seat: body.infants_in_seat,
    infants_on_lap: body.infants_on_lap,
    cabin_class: body.cabin_class,
    max_stops: outbound.max_stops,
    departure_time_range: outbound.departure_time_range,
    return_time_range: inbound.departure_time_range,
    min_carry_on_bags: body.min_carry_on_bags,
    min_checked_bags: body.min_checked_bags,
    max_price: body.max_price,
    airlines_include: includeAirlines ? body.airlines_include : undefined,
    airlines_exclude: body.airlines_exclude,
    allow_self_transfer: body.allow_self_transfer,
    market: body.market,
  };
}

type CurationOfferType = "one_way" | "round_trip" | "paired_one_way";
type CurationJourneyRole = "outbound" | "return" | "complete";

function annotateCurationItinerary<T extends Record<string, unknown>>(
  itinerary: T,
  offerType: CurationOfferType,
  journeyRole: CurationJourneyRole,
): T & { offer_type: CurationOfferType; journey_role: CurationJourneyRole } {
  return { ...itinerary, offer_type: offerType, journey_role: journeyRole };
}

function selectedAirlineMatch(
  itinerary: NonNullable<ReturnType<typeof normalizeItinerary>>,
  airlines: string[] | undefined,
): boolean {
  if (!airlines?.length) return true;
  const allowed = new Set(airlines);
  return itinerary.legs.every((leg) => allowed.has(leg.airline_code));
}

async function curationOneWayCandidates(
  env: Env,
  leg: ReturnType<typeof normalizeRequestLeg>,
  body: ReturnType<typeof validateCurationSearchBody>,
  observedAt: string,
  legIndex: number,
) {
  const requestShape = { legs: [leg], cabin_class: body.cabin_class };
  let successfulProviderRequests = 0;

  const search = async (includeAirlines: boolean) => {
    const upstream = await fetchIgnav(
      env.IGNAV_API_KEY!,
      curationOneWayBody(leg, body, includeAirlines),
      "/fares/one-way",
    );
    successfulProviderRequests += 1;
    const raw = upstream.itineraries ?? [];
    const normalized = raw
      .map((itinerary, index) => normalizeItinerary(
        dedicatedOneWayItinerary(itinerary),
        requestShape,
        observedAt,
        legIndex * 1_000 + index,
        false,
      ))
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .filter((itinerary) => itinerary.legs.every((item) => item.stops === 0))
      .filter((itinerary) => selectedAirlineMatch(itinerary, body.airlines_include))
      .sort((a, b) => a.price.amount - b.price.amount);
    return { rawCount: raw.length, normalized };
  };

  // Prefer Ignav's upstream airline filter. Some regional carriers occasionally
  // disappear from provider-filtered searches even though the same flight is
  // present in an unfiltered result. If that happens, retry once without
  // airlines_include and enforce the selected airlines locally.
  let result = await search(true);
  let usedBroadFallback = false;
  if (body.airlines_include?.length && result.normalized.length === 0) {
    result = await search(false);
    usedBroadFallback = true;
  }

  return {
    candidates: result.normalized,
    rawCount: result.rawCount,
    usedBroadFallback,
    successfulProviderRequests,
  };
}

async function curationRoundTripCandidates(
  env: Env,
  outbound: ReturnType<typeof normalizeRequestLeg>,
  inbound: ReturnType<typeof normalizeRequestLeg>,
  body: ReturnType<typeof validateCurationSearchBody>,
  observedAt: string,
) {
  const requestShape = { legs: [outbound, inbound], cabin_class: body.cabin_class };
  let successfulProviderRequests = 0;

  const search = async (includeAirlines: boolean) => {
    const upstream = await fetchIgnav(
      env.IGNAV_API_KEY!,
      curationRoundTripBody(outbound, inbound, body, includeAirlines),
      "/fares/round-trip",
    );
    successfulProviderRequests += 1;
    const raw = upstream.itineraries ?? [];
    const normalized = raw
      .map((itinerary, index) => normalizeItinerary(
        dedicatedRoundTripItinerary(itinerary),
        requestShape,
        observedAt,
        20_000 + index,
        false,
      ))
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .filter((itinerary) => itinerary.legs.every((item) => item.stops === 0))
      .filter((itinerary) => selectedAirlineMatch(itinerary, body.airlines_include))
      .map((itinerary) => annotateCurationItinerary(itinerary, "round_trip", "complete"))
      .sort((a, b) => a.price.amount - b.price.amount);
    return { rawCount: raw.length, normalized };
  };

  let result = await search(true);
  let usedBroadFallback = false;
  if (body.airlines_include?.length && result.normalized.length === 0) {
    result = await search(false);
    usedBroadFallback = true;
  }

  return {
    candidates: result.normalized,
    rawCount: result.rawCount,
    usedBroadFallback,
    successfulProviderRequests,
  };
}

function pairCuratedLegs(
  outbound: NonNullable<ReturnType<typeof normalizeItinerary>>[],
  inbound: NonNullable<ReturnType<typeof normalizeItinerary>>[],
  observedAt: string,
) {
  const outboundPool = outbound.slice(0, 12);
  const inboundPool = inbound.slice(0, 12);
  const pairs = [];

  for (const out of outboundPool) {
    for (const back of inboundPool) {
      if (out.price.currency !== back.price.currency) continue;
      const outStatus = String(out.price.status || "unverified").toLowerCase();
      const backStatus = String(back.price.status || "unverified").toLowerCase();
      const status = outStatus === "verified" && backStatus === "verified" ? "verified" : "unverified";
      const pairID = `pair-${out.id.slice(0, 68)}-${back.id.slice(0, 68)}`;
      pairs.push({
        id: pairID,
        source: "ignav",
        source_name: "Ignav",
        observed_at: observedAt,
        fare_scope: "total_party",
        price: {
          amount: out.price.amount + back.price.amount,
          currency: out.price.currency,
          status,
        },
        legs: [...out.legs, ...back.legs],
        cabin_class: out.cabin_class,
        bags: null,
        requires_self_transfer: false,
        ignav_id: pairID,
        offer_type: "paired_one_way" as const,
        journey_role: "complete" as const,
      });
    }
  }

  return pairs
    .sort((a, b) => a.price.amount - b.price.amount)
    .slice(0, 40);
}

async function recordSuccessfulIgnavRequest(env: Env, observedAt: string) {
  if (!env.HOTELS_DB) return;
  const period = observedAt.slice(0, 7);
  await env.HOTELS_DB.prepare(`CREATE TABLE IF NOT EXISTS ignav_api_usage_monthly (
    period TEXT PRIMARY KEY,
    successful_requests INTEGER NOT NULL DEFAULT 0,
    first_success_at TEXT,
    last_success_at TEXT,
    updated_at TEXT NOT NULL
  )`).run();
  await env.HOTELS_DB.prepare(`INSERT INTO ignav_api_usage_monthly (
    period, successful_requests, first_success_at, last_success_at, updated_at
  ) VALUES (?, 1, ?, ?, ?)
  ON CONFLICT(period) DO UPDATE SET
    successful_requests = successful_requests + 1,
    first_success_at = COALESCE(first_success_at, excluded.first_success_at),
    last_success_at = excluded.last_success_at,
    updated_at = excluded.updated_at`)
    .bind(period, observedAt, observedAt, observedAt).run();
}

export async function searchIgnavFlights(request: Request, env: Env): Promise<Response> {
  if (!env.IGNAV_API_KEY) return json({ ok: false, error: "FLIGHT_PROVIDER_NOT_CONFIGURED" }, 503);
  let raw: SearchBody;
  try { raw = (await request.json()) as SearchBody; }
  catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }

  let body: ReturnType<typeof validateSearchBody>;
  try { body = validateSearchBody(raw); }
  catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : "INVALID_REQUEST" }, 400); }

  const cacheBody = body as unknown as NormalizedFlightSearch;
  if (env.HOTELS_DB) {
    const cached = await readFlightSearchCache(env.HOTELS_DB, cacheBody).catch(() => null);
    if (cached) return json(cached);
  }

  let ownsLock = false;
  if (env.HOTELS_DB) {
    ownsLock = await acquireFlightSearchLock(env.HOTELS_DB, cacheBody).catch(() => false);
    if (!ownsLock) {
      // Another Worker is already buying this exact provider search. Give it a
      // short window to populate D1 instead of creating a duplicate paid request.
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const cached = await readFlightSearchCache(env.HOTELS_DB!, cacheBody).catch(() => null);
        if (cached) return json(cached);
      }
    }
  }

  try {
    const observedAt = new Date().toISOString();
    const upstream = await fetchIgnav(env.IGNAV_API_KEY, body as unknown as Record<string, unknown>);
    // Only a real upstream success consumes the provider budget. D1 cache hits
    // return before this line and therefore never increment usage.
    await recordSuccessfulIgnavRequest(env, observedAt).catch(() => undefined);
    const itineraries = (upstream.itineraries ?? [])
      .map((itinerary, index) => normalizeItinerary(itinerary, body, observedAt, index))
      .filter((value): value is NonNullable<typeof value> => value !== null);

    const payload = {
      ok: true,
      source: "ignav",
      observed_at: observedAt,
      legs: body.legs,
      itineraries,
      cache: { status: "miss", cached_at: observedAt, fresh_until: null, provider_observed_at: observedAt },
    };
    if (env.HOTELS_DB) {
      await storeFlightSearchCache(env.HOTELS_DB, cacheBody, payload, itineraries, observedAt).catch(() => undefined);
    }
    return json(payload);
  } catch (error) {
    const status = Number((error as any)?.status ?? 0);
    const retryable = status === 424 || status === 503 || status === 0;
    return json({ ok: false, error: "FLIGHT_SEARCH_UPSTREAM_FAILED", retryable, upstream_status: status || null }, retryable ? 503 : 502);
  } finally {
    if (ownsLock && env.HOTELS_DB) await releaseFlightSearchLock(env.HOTELS_DB, cacheBody).catch(() => undefined);
  }
}


export async function searchIgnavFlightsForCuration(request: Request, env: Env): Promise<Response> {
  if (!env.IGNAV_API_KEY) return json({ ok: false, error: "FLIGHT_PROVIDER_NOT_CONFIGURED" }, 503);
  let raw: SearchBody;
  try { raw = (await request.json()) as SearchBody; }
  catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }

  let body: ReturnType<typeof validateCurationSearchBody>;
  try { body = validateCurationSearchBody(raw); }
  catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : "INVALID_REQUEST" }, 400); }

  try {
    const observedAt = new Date().toISOString();

    if (body.curation_mode !== "round_trip") {
      const legResult = await curationOneWayCandidates(env, body.legs[0], body, observedAt, 0);
      for (let index = 0; index < legResult.successfulProviderRequests; index += 1) {
        await recordSuccessfulIgnavRequest(env, observedAt).catch(() => undefined);
      }
      const journeyRole: CurationJourneyRole = body.curation_mode === "return_one_way" ? "return" : "outbound";
      const itineraries = legResult.candidates
        .slice(0, 40)
        .map((itinerary) => annotateCurationItinerary(itinerary, "one_way", journeyRole));

      return json({
        ok: true,
        source: "ignav",
        observed_at: observedAt,
        legs: body.legs,
        itineraries,
        filters: {
          nonstop: body.legs.every((leg) => leg.max_stops === 0),
          airlines_include: body.airlines_include ?? [],
          allow_self_transfer: body.allow_self_transfer,
        },
        diagnostics: {
          mode: body.curation_mode,
          provider_requests: legResult.successfulProviderRequests,
          raw_itineraries_by_leg: [legResult.rawCount],
          usable_itineraries_by_leg: [legResult.candidates.length],
          broad_airline_fallback_by_leg: [legResult.usedBroadFallback],
          dedicated_round_trip_count: 0,
          paired_one_way_count: 0,
        },
      });
    }

    // Complete-trip curation always computes the independent one-way alternative.
    // When the return route is an exact reverse (TAS→JED + JED→TAS), we ALSO ask
    // Ignav's dedicated /fares/round-trip endpoint. Business can then compare the
    // provider's true return fare against our own one-way + return-way sum. For an
    // open-jaw route (TAS→JED + MED→TAS), a true round-trip fare does not exist,
    // so the system returns only the clearly-labelled paired one-way alternative.
    const outboundResult = await curationOneWayCandidates(env, body.legs[0], body, observedAt, 0);
    const inboundResult = await curationOneWayCandidates(env, body.legs[1], body, observedAt, 1);
    const paired = pairCuratedLegs(outboundResult.candidates, inboundResult.candidates, observedAt);

    const isExactReverse = body.legs[1].origin === body.legs[0].destination
      && body.legs[1].destination === body.legs[0].origin;
    const roundTripResult = isExactReverse
      ? await curationRoundTripCandidates(env, body.legs[0], body.legs[1], body, observedAt)
      : null;

    const providerRequestCount = outboundResult.successfulProviderRequests
      + inboundResult.successfulProviderRequests
      + (roundTripResult?.successfulProviderRequests ?? 0);
    for (let index = 0; index < providerRequestCount; index += 1) {
      await recordSuccessfulIgnavRequest(env, observedAt).catch(() => undefined);
    }

    const dedicatedRoundTrips = roundTripResult?.candidates ?? [];
    const itineraries = [...dedicatedRoundTrips, ...paired]
      .sort((a, b) => a.price.amount - b.price.amount)
      .slice(0, 50);

    return json({
      ok: true,
      source: "ignav",
      observed_at: observedAt,
      legs: body.legs,
      itineraries,
      filters: {
        nonstop: body.legs.every((leg) => leg.max_stops === 0),
        airlines_include: body.airlines_include ?? [],
        allow_self_transfer: body.allow_self_transfer,
      },
      diagnostics: {
        mode: isExactReverse ? "round_trip_compare" : "open_jaw_one_way_pairing",
        provider_requests: providerRequestCount,
        raw_itineraries_by_leg: [outboundResult.rawCount, inboundResult.rawCount],
        usable_itineraries_by_leg: [outboundResult.candidates.length, inboundResult.candidates.length],
        broad_airline_fallback_by_leg: [outboundResult.usedBroadFallback, inboundResult.usedBroadFallback],
        round_trip_available: isExactReverse,
        dedicated_round_trip_raw: roundTripResult?.rawCount ?? 0,
        dedicated_round_trip_count: dedicatedRoundTrips.length,
        round_trip_broad_airline_fallback: roundTripResult?.usedBroadFallback ?? false,
        paired_one_way_count: paired.length,
      },
    });
  } catch (error) {
    const status = Number((error as any)?.status ?? 0);
    const retryable = status === 424 || status === 503 || status === 0;
    return json({ ok: false, error: "FLIGHT_SEARCH_UPSTREAM_FAILED", retryable, upstream_status: status || null }, retryable ? 503 : 502);
  }
}

