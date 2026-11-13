import { resolveNuiteePackageHotels, type NuiteePackageRoom } from "./nuitee-hotels";
import type { Env } from "./env";
import { readFlightSearchCache, type NormalizedFlightSearch } from "./flight-cache";
import { resolveServerHotelPricing } from "./hotel-costs";
import { calculatePackageQuote, calculateStorefrontPreviewQuote, type PackageTier, type ServerQuoteInput, type TripType, type TransferVehicle, type VerifiedJourneyFare } from "./pricing";
import { sealPricingSnapshot } from "./quote-audit";
import { deriveAuthoritativeStayPlan, type StayPolicy, type VerifiedFlightSchedule } from "./itinerary-planner";

type QuoteRequest = {
  nuiteeRooms?: NuiteePackageRoom[];
  tier?: unknown;
  tripType?: unknown;
  includeMadinah?: unknown;
  travelers?: { adults?: unknown; children?: unknown; infants?: unknown; rooms?: unknown };
  meals?: { makkahLunch?: unknown; makkahDinner?: unknown; madinahDinner?: unknown };
  transferVehicle?: unknown;
  haramain?: { enabled?: unknown; fareClass?: unknown; ticketCount?: unknown };
  flight?: {
    providerItineraryId?: unknown;
    cabinClass?: unknown;
    infantsInSeat?: unknown;
    infantsOnLap?: unknown;
    legs?: Array<{ origin?: unknown; destination?: unknown; departureDate?: unknown }>;
  };
  hotels?: {
    makkah?: { hotelId?: unknown; roomId?: unknown; nights?: unknown };
    madinah?: { hotelId?: unknown; roomId?: unknown; nights?: unknown } | null;
  };
  stayPolicy?: unknown;
};

type CuratedRow = {
  id: string;
  per_traveler_fare: number | string;
  currency: string;
  observed_at: string;
  published: number | string;
  itinerary_json: string;
};

type CachedItinerary = {
  id?: string;
  ignav_id?: string;
  source_name?: string;
  observed_at?: string;
  fare_scope?: string;
  price?: { amount?: number; currency?: string; status?: string };
  legs?: Array<{ origin?: string; destination?: string; departure_at?: string; arrival_at?: string }>;
};

const IATA = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function int(value: unknown, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error("INVALID_NUMBER");
  return n;
}

function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("INVALID_BOOLEAN");
  return value;
}

function text(value: unknown, max = 180): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseTier(value: unknown): PackageTier {
  const tier = text(value, 20) as PackageTier;
  if (!["economy", "standard", "comfort", "luxury"].includes(tier)) throw new Error("INVALID_TIER");
  return tier;
}

function parseTripType(value: unknown): TripType {
  const tripType = text(value, 20) as TripType;
  if (tripType !== "roundTrip" && tripType !== "oneWay") throw new Error("INVALID_TRIP_TYPE");
  return tripType;
}

function parseTransfer(value: unknown): TransferVehicle {
  if (value === null || value === undefined || value === "") return null;
  const vehicle = text(value, 20) as Exclude<TransferVehicle, null>;
  if (!["malibu", "carnival", "yukon"].includes(vehicle)) throw new Error("INVALID_TRANSFER_VEHICLE");
  return vehicle;
}

function parseHotel(value: QuoteRequest["hotels"] extends infer T ? any : never, label: string) {
  if (!value || typeof value !== "object") throw new Error(`${label}_HOTEL_REQUIRED`);
  const hotelId = text(value.hotelId, 180);
  const roomId = text(value.roomId, 180) || null;
  const nights = int(value.nights, 1, 90);
  if (!hotelId) throw new Error(`${label}_HOTEL_REQUIRED`);
  return { hotelId, roomId, nights };
}

async function resolveCuratedFare(providerItineraryId: string, travelerCount: number, env: Env): Promise<VerifiedJourneyFare> {
  if (!env.HOTELS_DB) throw new Error("HOTELS_DB_NOT_CONFIGURED");
  const raw = providerItineraryId.slice("curated:".length);
  const ids = raw.split("+").map((id) => id.trim()).filter(Boolean);
  if (ids.length < 1 || ids.length > 2) throw new Error("CURATED_FLIGHT_NOT_FOUND");
  const rows: CuratedRow[] = [];
  for (const id of ids) {
    const row = await env.HOTELS_DB.prepare(
      `SELECT id,per_traveler_fare,currency,observed_at,published,itinerary_json
       FROM curated_flight_offers WHERE id=?1 AND published=1 LIMIT 1`,
    ).bind(id).first<CuratedRow>();
    if (!row) throw new Error("CURATED_FLIGHT_NOT_FOUND");
    rows.push(row);
  }
  const currencies = new Set(rows.map((row) => String(row.currency ?? "").toUpperCase()));
  if (currencies.size !== 1 || !currencies.has("USD")) throw new Error("FLIGHT_CURRENCY_UNSUPPORTED");
  const perTraveler = rows.reduce((sum, row) => sum + Number(row.per_traveler_fare ?? 0), 0);
  if (!Number.isFinite(perTraveler) || perTraveler <= 0) throw new Error("INVALID_FLIGHT_FARE");
  let travelDate = "";
  try {
    const itinerary = JSON.parse(rows[0].itinerary_json || "{}") as { legs?: Array<{ departure_at?: string }> };
    travelDate = String(itinerary.legs?.[0]?.departure_at ?? "").slice(0, 10);
  } catch { /* validated below */ }
  if (!DATE.test(travelDate)) throw new Error("INVALID_FLIGHT_DATE");
  const observedAt = rows.map((row) => row.observed_at).sort().at(-1) ?? new Date().toISOString();
  const total = Math.round(perTraveler * travelerCount * 100) / 100;
  return {
    candidateId: providerItineraryId,
    amount: total,
    currency: "USD",
    fareScope: "totalParty",
    providerId: "iumrah Published",
    observedAt,
    travelDate,
    normalizedGroupUsd: total,
  };
}


type AviasalesIdentity = {
  mode: "ow" | "rt" | "pair";
  returnOrigin: string;
  returnDestination: string;
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string | null;
  airlineCode: string | null;
  flightNumber: string | null;
  returnAirlineCode: string | null;
  returnFlightNumber: string | null;
};

type AviasalesDataRow = {
  origin?: string;
  destination?: string;
  price?: number;
  airline?: string;
  flight_number?: string | number;
  departure_at?: string;
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
};

type AviasalesPricesEnvelope = {
  success?: boolean;
  data?: AviasalesDataRow[];
  currency?: string;
};

type ResolvedAviasalesSelection = {
  outbound: { origin: string; destination: string; departureAt: string; arrivalAt: string };
  inbound: { origin: string; destination: string; departureAt: string; arrivalAt: string } | null;
  perTravelerUsd: number;
  observedAt: string;
};

function cleanFlightToken(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function nullableIdentityToken(value: string): string | null {
  const clean = cleanFlightToken(value);
  return clean && clean !== "-" ? clean : null;
}

function parseAviasalesIdentity(providerItineraryId: string): AviasalesIdentity {
  const parts = providerItineraryId.split(":");
  if (![10,12].includes(parts.length) || parts[0] !== "aviasales") throw new Error("AVIASALES_IDENTITY_INVALID");
  const mode = parts[1] as AviasalesIdentity["mode"];
  if (!(["ow", "rt", "pair"] as string[]).includes(mode)) throw new Error("AVIASALES_IDENTITY_INVALID");
  const origin = parts[2].toUpperCase();
  const destination = parts[3].toUpperCase();
  const departureDate = parts[4];
  const returnDate = parts[5] === "-" ? null : parts[5];
  if (!IATA.test(origin) || !IATA.test(destination) || origin === destination || !DATE.test(departureDate)) {
    throw new Error("AVIASALES_IDENTITY_INVALID");
  }
  if (returnDate && !DATE.test(returnDate)) throw new Error("AVIASALES_IDENTITY_INVALID");
  if (mode !== "ow" && !returnDate) throw new Error("AVIASALES_RETURN_REQUIRED");
  const returnOrigin = parts.length === 12 ? parts[10].toUpperCase() : destination;
  const returnDestination = parts.length === 12 ? parts[11].toUpperCase() : origin;
  if (!IATA.test(returnOrigin) || returnDestination !== origin || returnOrigin === returnDestination || (parts.length===12 && mode!=="pair")) throw new Error("AVIASALES_IDENTITY_INVALID");
  return {
    returnOrigin, returnDestination,
    mode,
    origin,
    destination,
    departureDate,
    returnDate,
    airlineCode: nullableIdentityToken(parts[6]),
    flightNumber: nullableIdentityToken(parts[7]),
    returnAirlineCode: nullableIdentityToken(parts[8]),
    returnFlightNumber: nullableIdentityToken(parts[9]),
  };
}

function travelpayoutsDateURL(identity: AviasalesIdentity, origin: string, destination: string, day: string, returnDay: string | null): URL {
  const url = new URL("https://api.travelpayouts.com/aviasales/v3/prices_for_dates");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  url.searchParams.set("departure_at", day);
  url.searchParams.set("currency", "usd");
  url.searchParams.set("sorting", "price");
  url.searchParams.set("unique", "false");
  url.searchParams.set("direct", "false");
  url.searchParams.set("one_way", returnDay ? "false" : "true");
  url.searchParams.set("limit", "100");
  url.searchParams.set("page", "1");
  if (returnDay) url.searchParams.set("return_at", returnDay);
  return url;
}

async function fetchAviasalesRows(url: URL, env: Env): Promise<AviasalesDataRow[]> {
  const token = env.TRAVELPAYOUTS_API_TOKEN?.trim();
  if (!token) throw new Error("TRAVELPAYOUTS_API_TOKEN_NOT_CONFIGURED");
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Access-Token": token,
      "User-Agent": "iumrah-package-engine/flight-first-v1",
    },
  });
  if (!response.ok) throw new Error(`TRAVELPAYOUTS_${response.status}`);
  const payload = await response.json() as AviasalesPricesEnvelope;
  if (payload.success === false) throw new Error("AVIASALES_DATA_ERROR");
  return Array.isArray(payload.data) ? payload.data : [];
}

function rowMatchesFlight(row: AviasalesDataRow, airlineCode: string | null, flightNumber: string | null): boolean {
  const rowAirline = cleanFlightToken(row.airline);
  const rowFlight = cleanFlightToken(row.flight_number);
  if (airlineCode && rowAirline && rowAirline !== airlineCode) return false;
  if (flightNumber && rowFlight && rowFlight !== flightNumber && `${rowAirline}${rowFlight}` !== flightNumber) return false;
  return true;
}

function rowDepartureDay(row: AviasalesDataRow): string {
  return String(row.departure_at ?? "").slice(0, 10);
}

function addMinutes(iso: string, minutes: number): string {
  const value = Date.parse(iso);
  // Missing flight duration is not evidence for a one-hour flight. An equal
  // departure/arrival timestamp is rejected by schedule normalization later.
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
  return Number.isFinite(value) ? new Date(value + safeMinutes * 60_000).toISOString() : iso;
}

function sameFlightInstant(a: string, b: string): boolean {
  const left = Date.parse(a);
  const right = Date.parse(b);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 60_000;
}

function pickAviasalesRow(
  rows: AviasalesDataRow[],
  day: string,
  airlineCode: string | null,
  flightNumber: string | null,
): AviasalesDataRow | null {
  const exact = rows.filter((row) => rowDepartureDay(row) === day && Number(row.price ?? 0) > 0);
  const identity = exact.filter((row) => rowMatchesFlight(row, airlineCode, flightNumber));
  // A flight's price may change; its carrier/number must not change without
  // the traveler explicitly choosing a new fare.
  const candidates = airlineCode || flightNumber ? identity : exact;
  return candidates.sort((a, b) => Number(a.price ?? 0) - Number(b.price ?? 0))[0] ?? null;
}

function pickAviasalesReturnRow(
  rows: AviasalesDataRow[],
  day: string,
  departureAt: string,
  airlineCode: string | null,
  flightNumber: string | null,
): AviasalesDataRow | null {
  const sameDay = rows.filter((row) => rowDepartureDay(row) === day && Number(row.price ?? 0) > 0);
  const exactTime = sameDay.filter((row) => sameFlightInstant(String(row.departure_at ?? ""), departureAt));
  // Only accept a matching carrier/number when provided, or matching exact
  // departure timestamp otherwise. Never attach an arbitrary same-day flight.
  const exactIdentity = exactTime.filter((row) => rowMatchesFlight(row, airlineCode, flightNumber));
  return exactIdentity[0] ?? null;
}

export async function resolveAviasalesSelection(providerItineraryId: string, env: Env): Promise<ResolvedAviasalesSelection> {
  const identity = parseAviasalesIdentity(providerItineraryId);
  const observedAt = new Date().toISOString();

  if (identity.mode === "rt") {
    const rows = await fetchAviasalesRows(
      travelpayoutsDateURL(identity, identity.origin, identity.destination, identity.departureDate, identity.returnDate),
      env,
    );
    const row = pickAviasalesRow(
      rows.filter((candidate) => String(candidate.return_at ?? "").slice(0, 10) === identity.returnDate),
      identity.departureDate,
      identity.airlineCode,
      identity.flightNumber,
    );
    if (!row) throw new Error("AVIASALES_FARE_NOT_FOUND");
    const perTravelerUsd = Number(row.price ?? 0);
    if (!Number.isFinite(perTravelerUsd) || perTravelerUsd <= 0) throw new Error("INVALID_FLIGHT_FARE");
    const departureAt = String(row.departure_at ?? "");
    const returnAt = String(row.return_at ?? "");
    if (!Number.isFinite(Date.parse(departureAt)) || !Number.isFinite(Date.parse(returnAt))) {
      throw new Error("AVIASALES_SCHEDULE_UNAVAILABLE");
    }

    // Travelpayouts' round-trip Data row commonly identifies the outbound flight
    // but omits the reverse carrier/flight number. Re-resolve the reverse one-way
    // inventory by the exact return timestamp and selected identity. This prevents
    // the package quote from silently treating the outbound carrier as the return.
    let reverse: AviasalesDataRow | null = null;
    try {
      const reverseRows = await fetchAviasalesRows(
        travelpayoutsDateURL(identity, identity.destination, identity.origin, identity.returnDate!, null),
        env,
      );
      reverse = pickAviasalesReturnRow(
        reverseRows,
        identity.returnDate!,
        returnAt,
        identity.returnAirlineCode,
        identity.returnFlightNumber,
      );
    } catch {
      // Reverse one-way cached inventory is supplemental: the round-trip row
      // itself still carries the full RT fare + dated return leg.
    }
    if ((identity.returnAirlineCode || identity.returnFlightNumber) && !reverse) {
      // The user chose a *named* return flight but it could not be verified.
      throw new Error("AVIASALES_RETURN_IDENTITY_UNVERIFIED");
    }
    const verifiedReturnAt = String(reverse?.departure_at ?? returnAt);
    if (!Number.isFinite(Date.parse(verifiedReturnAt))) throw new Error("AVIASALES_SCHEDULE_UNAVAILABLE");

    return {
      outbound: {
        origin: identity.origin,
        destination: identity.destination,
        departureAt,
        arrivalAt: addMinutes(departureAt, Number(row.duration_to ?? row.duration ?? 0)),
      },
      inbound: {
        origin: identity.destination,
        destination: identity.origin,
        departureAt: verifiedReturnAt,
        arrivalAt: addMinutes(verifiedReturnAt, Number(reverse?.duration_to ?? reverse?.duration ?? row.duration_back ?? 0)),
      },
      perTravelerUsd,
      observedAt,
    };
  }

  const outboundRows = await fetchAviasalesRows(
    travelpayoutsDateURL(identity, identity.origin, identity.destination, identity.departureDate, null),
    env,
  );
  const outbound = pickAviasalesRow(outboundRows, identity.departureDate, identity.airlineCode, identity.flightNumber);
  if (!outbound) throw new Error("AVIASALES_OUTBOUND_NOT_FOUND");
  const outboundPrice = Number(outbound.price ?? 0);
  const outboundAt = String(outbound.departure_at ?? "");
  if (!Number.isFinite(outboundPrice) || outboundPrice <= 0 || !Number.isFinite(Date.parse(outboundAt))) {
    throw new Error("INVALID_FLIGHT_FARE");
  }

  if (identity.mode === "ow") {
    return {
      outbound: {
        origin: identity.origin,
        destination: identity.destination,
        departureAt: outboundAt,
        arrivalAt: addMinutes(outboundAt, Number(outbound.duration_to ?? outbound.duration ?? 0)),
      },
      inbound: null,
      perTravelerUsd: outboundPrice,
      observedAt,
    };
  }

  const returnDate = identity.returnDate!;
  const returnRows = await fetchAviasalesRows(
    travelpayoutsDateURL(identity, identity.returnOrigin, identity.returnDestination, returnDate, null),
    env,
  );
  const inbound = pickAviasalesRow(returnRows, returnDate, identity.returnAirlineCode, identity.returnFlightNumber);
  if (!inbound) throw new Error("AVIASALES_RETURN_NOT_FOUND");
  const inboundPrice = Number(inbound.price ?? 0);
  const inboundAt = String(inbound.departure_at ?? "");
  if (!Number.isFinite(inboundPrice) || inboundPrice <= 0 || !Number.isFinite(Date.parse(inboundAt))) {
    throw new Error("INVALID_FLIGHT_FARE");
  }
  return {
    outbound: {
      origin: identity.origin,
      destination: identity.destination,
      departureAt: outboundAt,
      arrivalAt: addMinutes(outboundAt, Number(outbound.duration_to ?? outbound.duration ?? 0)),
    },
    inbound: {
      origin: identity.returnOrigin,
      destination: identity.returnDestination,
      departureAt: inboundAt,
      arrivalAt: addMinutes(inboundAt, Number(inbound.duration_to ?? inbound.duration ?? 0)),
    },
    perTravelerUsd: outboundPrice + inboundPrice,
    observedAt,
  };
}

async function resolveAviasalesFare(providerItineraryId: string, travelerCount: number, env: Env): Promise<VerifiedJourneyFare> {
  const resolved = await resolveAviasalesSelection(providerItineraryId, env);
  const total = Math.round(resolved.perTravelerUsd * travelerCount * 100) / 100;
  return {
    candidateId: providerItineraryId,
    amount: total,
    currency: "USD",
    fareScope: "totalParty",
    providerId: "Aviasales Data",
    observedAt: resolved.observedAt,
    travelDate: resolved.outbound.departureAt.slice(0, 10),
    normalizedGroupUsd: total,
  };
}

async function resolveIgnavFare(request: QuoteRequest, travelers: { adults: number; children: number; infants: number }, env: Env): Promise<VerifiedJourneyFare> {
  if (!env.HOTELS_DB) throw new Error("HOTELS_DB_NOT_CONFIGURED");
  const flight = request.flight;
  if (!flight) throw new Error("FLIGHT_REQUIRED");
  const providerItineraryId = text(flight.providerItineraryId, 220);
  if (!providerItineraryId) throw new Error("FLIGHT_REQUIRED");
  const legs = Array.isArray(flight.legs) ? flight.legs : [];
  if (legs.length < 1 || legs.length > 2) throw new Error("INVALID_FLIGHT_LEGS");
  const normalizedLegs = legs.map((leg) => {
    const origin = text(leg.origin, 3).toUpperCase();
    const destination = text(leg.destination, 3).toUpperCase();
    const departure_date = text(leg.departureDate, 10);
    if (!IATA.test(origin) || !IATA.test(destination) || origin === destination || !DATE.test(departure_date)) throw new Error("INVALID_FLIGHT_LEG");
    return { origin, destination, departure_date };
  });
  const cabin = text(flight.cabinClass, 30) || "economy";
  if (!["economy", "premium_economy", "business", "first"].includes(cabin)) throw new Error("INVALID_CABIN");
  const infantsInSeat = int(flight.infantsInSeat ?? 0, 0, 8);
  const infantsOnLap = int(flight.infantsOnLap ?? 0, 0, 8);
  if (infantsInSeat + infantsOnLap !== travelers.infants || infantsOnLap > travelers.adults) throw new Error("INVALID_INFANT_SPLIT");

  const cacheSearch: NormalizedFlightSearch = {
    legs: normalizedLegs,
    adults: travelers.adults,
    children: travelers.children,
    infants_in_seat: infantsInSeat,
    infants_on_lap: infantsOnLap,
    cabin_class: cabin,
    allow_self_transfer: true,
    market: "US",
  };
  const cached = await readFlightSearchCache(env.HOTELS_DB, cacheSearch);
  if (!cached) throw new Error("FLIGHT_FARE_EXPIRED");
  const itineraries = Array.isArray(cached.itineraries) ? cached.itineraries as CachedItinerary[] : [];
  const itinerary = itineraries.find((item) => item.id === providerItineraryId || item.ignav_id === providerItineraryId);
  if (!itinerary) throw new Error("FLIGHT_FARE_NOT_FOUND");
  const amount = Number(itinerary.price?.amount ?? 0);
  const currency = String(itinerary.price?.currency ?? "").toUpperCase();
  const status = String(itinerary.price?.status ?? "").toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0 || currency !== "USD" || status !== "verified") throw new Error("INVALID_FLIGHT_FARE");
  const observedAt = text(itinerary.observed_at ?? (cached as any).observed_at, 64) || new Date().toISOString();
  return {
    candidateId: providerItineraryId,
    amount: Math.round(amount * 100) / 100,
    currency: "USD",
    fareScope: itinerary.fare_scope === "perPassenger" ? "perPassenger" : "totalParty",
    providerId: text(itinerary.source_name, 100) || "Ignav",
    observedAt,
    travelDate: normalizedLegs[0].departure_date,
    normalizedGroupUsd: Math.round(amount * 100) / 100,
  };
}

/** Independent one-way tickets may use different suppliers. Resolve both on the
 * server; never split a published return fare or accept client display prices. */
export async function resolveMixedSelection(providerID: string, travelerCount: number, env: Env) {
  const ids = providerID.slice("mixed:".length).split("~");
  if (!providerID.startsWith("mixed:") || ids.length !== 2 ||
      ids.filter(id => id.startsWith("curated:")).length !== 1 ||
      ids.filter(id => id.startsWith("aviasales:")).length !== 1) throw new Error("MIXED_IDENTITY_INVALID");
  const legs = await Promise.all(ids.map(async id => {
    if (id.startsWith("curated:")) {
      if (!/^curated:[A-Za-z0-9_-]+$/.test(id)) throw new Error("MIXED_IDENTITY_INVALID");
      const schedule = await resolveCuratedSchedule(id, env);
      if (!schedule || schedule.inbound) throw new Error("MIXED_REQUIRES_ONE_WAY_FARES");
      const fare = await resolveCuratedFare(id, travelerCount, env);
      return {leg:schedule.outbound, amount:fare.normalizedGroupUsd};
    }
    if (parseAviasalesIdentity(id).mode !== "ow") throw new Error("MIXED_REQUIRES_ONE_WAY_FARES");
    const selection = await resolveAviasalesSelection(id, env);
    return {leg:selection.outbound, amount:selection.perTravelerUsd * travelerCount};
  }));
  if (legs[1].leg.destination !== legs[0].leg.origin ||
      !["JED","MED"].includes(legs[0].leg.destination) || !["JED","MED"].includes(legs[1].leg.origin) ||
      Date.parse(legs[1].leg.departureAt) <= Date.parse(legs[0].leg.arrivalAt)) throw new Error("MIXED_ROUTE_MISMATCH");
  const total = Math.round(legs.reduce((sum,item)=>sum+item.amount,0)*100)/100;
  const fare: VerifiedJourneyFare = { candidateId:providerID, amount:total, normalizedGroupUsd:total,
    currency:"USD", fareScope:"totalParty", providerId:"iumrah Published + Aviasales",
    observedAt:new Date().toISOString(), travelDate:legs[0].leg.departureAt.slice(0,10) };
  return {fare, schedule:{outbound:legs[0].leg,inbound:legs[1].leg}};
}

async function resolveJourneyFare(request: QuoteRequest, travelerCount: number, travelers: { adults: number; children: number; infants: number }, env: Env) {
  const providerID = text(request.flight?.providerItineraryId, 220);
  if (providerID.startsWith("curated:")) return resolveCuratedFare(providerID, travelerCount, env);
  if (providerID.startsWith("aviasales:")) return resolveAviasalesFare(providerID, travelerCount, env);
  return resolveIgnavFare(request, travelers, env);
}

type ScheduleLeg = { origin?: string; destination?: string; departure_at?: string; arrival_at?: string };

function normalizedScheduleLeg(value: ScheduleLeg | undefined): VerifiedFlightSchedule["outbound"] | null {
  if (!value) return null;
  const origin = text(value.origin, 3).toUpperCase();
  const destination = text(value.destination, 3).toUpperCase();
  const departureAt = text(value.departure_at, 64);
  const arrivalAt = text(value.arrival_at, 64);
  if (!IATA.test(origin) || !IATA.test(destination) || origin === destination) return null;
  if (!Number.isFinite(Date.parse(departureAt)) || !Number.isFinite(Date.parse(arrivalAt)) || Date.parse(departureAt) >= Date.parse(arrivalAt)) return null;
  return { origin, destination, departureAt, arrivalAt };
}

async function resolveCuratedSchedule(providerItineraryId: string, env: Env): Promise<VerifiedFlightSchedule | null> {
  if (!env.HOTELS_DB) return null;
  const raw = providerItineraryId.slice("curated:".length);
  const ids = raw.split("+").map((id) => id.trim()).filter(Boolean);
  if (ids.length < 1 || ids.length > 2) return null;
  const allLegs: ScheduleLeg[] = [];
  for (const id of ids) {
    const row = await env.HOTELS_DB.prepare(
      "SELECT itinerary_json FROM curated_flight_offers WHERE id=?1 AND published=1 LIMIT 1",
    ).bind(id).first<{ itinerary_json: string }>();
    if (!row) return null;
    try {
      const itinerary = JSON.parse(row.itinerary_json || "{}") as { legs?: ScheduleLeg[] };
      const legs = Array.isArray(itinerary.legs) ? itinerary.legs : [];
      if (ids.length === 1) allLegs.push(...legs.slice(0, 2));
      else if (legs[0]) allLegs.push(legs[0]);
    } catch { return null; }
  }
  const outbound = normalizedScheduleLeg(allLegs[0]);
  if (!outbound) return null;
  const inbound = normalizedScheduleLeg(allLegs[1]);
  return { outbound, inbound };
}

async function resolveAviasalesSchedule(providerItineraryId: string, env: Env): Promise<VerifiedFlightSchedule | null> {
  const resolved = await resolveAviasalesSelection(providerItineraryId, env);
  return {
    outbound: resolved.outbound,
    inbound: resolved.inbound ?? undefined,
  };
}

async function resolveIgnavSchedule(request: QuoteRequest, travelers: { adults: number; children: number; infants: number }, env: Env): Promise<VerifiedFlightSchedule | null> {
  if (!env.HOTELS_DB || !request.flight) return null;
  const providerItineraryId = text(request.flight.providerItineraryId, 220);
  const legs = Array.isArray(request.flight.legs) ? request.flight.legs : [];
  if (!providerItineraryId || legs.length < 1 || legs.length > 2) return null;
  const normalizedLegs = legs.map((leg) => ({
    origin: text(leg.origin, 3).toUpperCase(),
    destination: text(leg.destination, 3).toUpperCase(),
    departure_date: text(leg.departureDate, 10),
  }));
  if (normalizedLegs.some((leg) => !IATA.test(leg.origin) || !IATA.test(leg.destination) || !DATE.test(leg.departure_date))) return null;
  const cabin = text(request.flight.cabinClass, 30) || "economy";
  const infantsInSeat = int(request.flight.infantsInSeat ?? 0, 0, 8);
  const infantsOnLap = int(request.flight.infantsOnLap ?? 0, 0, 8);
  const cached = await readFlightSearchCache(env.HOTELS_DB, {
    legs: normalizedLegs, adults: travelers.adults, children: travelers.children,
    infants_in_seat: infantsInSeat, infants_on_lap: infantsOnLap, cabin_class: cabin,
    allow_self_transfer: true, market: "US",
  });
  if (!cached) return null;
  const itineraries = Array.isArray(cached.itineraries) ? cached.itineraries as CachedItinerary[] : [];
  const itinerary = itineraries.find((item) => item.id === providerItineraryId || item.ignav_id === providerItineraryId);
  const scheduleLegs = Array.isArray(itinerary?.legs) ? itinerary!.legs! : [];
  const outbound = normalizedScheduleLeg(scheduleLegs[0]);
  if (!outbound) return null;
  return { outbound, inbound: normalizedScheduleLeg(scheduleLegs[1]) };
}

async function resolveJourneySchedule(request: QuoteRequest, travelers: { adults: number; children: number; infants: number }, env: Env): Promise<VerifiedFlightSchedule | null> {
  try {
    const providerID = text(request.flight?.providerItineraryId, 220);
    if (providerID.startsWith("curated:")) return await resolveCuratedSchedule(providerID, env);
    if (providerID.startsWith("aviasales:")) return await resolveAviasalesSchedule(providerID, env);
    return await resolveIgnavSchedule(request, travelers, env);
  } catch {
    // Schedule enrichment must never make an otherwise valid quote unavailable.
    // In that case the engine preserves the selected night count and marks it fallback.
    return null;
  }
}

function parseStayPolicy(value: unknown): StayPolicy {
  return text(value, 24) === "hotelFirst" ? "hotelFirst" : "balanced";
}

export async function generatePackageQuote(request: Request, env: Env): Promise<Response> {
  let raw: QuoteRequest;
  try { raw = await request.json() as QuoteRequest; }
  catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }

  try {
    let tier = parseTier(raw.tier);
    const tripType = parseTripType(raw.tripType);
    const includeMadinah = bool(raw.includeMadinah);
    const adults = int(raw.travelers?.adults, 1, 9);
    const children = int(raw.travelers?.children ?? 0, 0, 8);
    const infants = int(raw.travelers?.infants ?? 0, 0, 8);
    const rooms = int(raw.travelers?.rooms, 1, 9);
    const travelerCount = adults + children + infants;
    if (travelerCount > 9) throw new Error("INVALID_TRAVELERS");

    if (raw.nuiteeRooms && text(raw.flight?.providerItineraryId,220).startsWith("aviasales:") && (children>0 || infants>0)) throw new Error("AVIASALES_PARTY_FARE_UNAVAILABLE");
    if (raw.nuiteeRooms && text(raw.flight?.providerItineraryId,220).startsWith("aviasales:")) {
      const identity=parseAviasalesIdentity(text(raw.flight?.providerItineraryId,220));
      const legs=raw.flight?.legs ?? [];
      if (legs[0]?.origin!==identity.origin || legs[0]?.destination!==identity.destination || legs[0]?.departureDate!==identity.departureDate || legs[1]?.origin!==identity.returnOrigin || legs[1]?.destination!==identity.returnDestination || legs[1]?.departureDate!==identity.returnDate) throw new Error("AVIASALES_ROUTE_MISMATCH");
    }
    const flightLegCount = Array.isArray(raw.flight?.legs) ? raw.flight!.legs!.length : 0;
    if (tripType === "roundTrip" && flightLegCount !== 2) throw new Error("ROUND_TRIP_REQUIRES_TWO_LEGS");
    if (tripType === "oneWay" && flightLegCount !== 1 && !text(raw.flight?.providerItineraryId, 220).startsWith("curated:")) throw new Error("ONE_WAY_REQUIRES_ONE_LEG");

    const makkahRequest = parseHotel(raw.hotels?.makkah, "MAKKAH");
    const madinahRequest = includeMadinah ? parseHotel(raw.hotels?.madinah, "MADINAH") : null;
    const providerID = text(raw.flight?.providerItineraryId,220);
    const mixed = providerID.startsWith("mixed:")
      ? await resolveMixedSelection(providerID, travelerCount, env) : null;
    if (mixed) {
      if (children > 0 || infants > 0) throw new Error("AVIASALES_PARTY_FARE_UNAVAILABLE");
      const selected = raw.flight?.legs ?? [];
      [mixed.schedule.outbound,mixed.schedule.inbound].forEach((leg,index)=>{
        if (selected[index]?.origin !== leg.origin || selected[index]?.destination !== leg.destination ||
            selected[index]?.departureDate !== leg.departureAt.slice(0,10)) throw new Error("MIXED_ROUTE_MISMATCH");
      });
    }
    const [journeyFare, verifiedSchedule] = mixed ? [mixed.fare,mixed.schedule] : await Promise.all([
      resolveJourneyFare(raw, travelerCount, { adults, children, infants }, env),
      resolveJourneySchedule(raw, { adults, children, infants }, env),
    ]);
    const stayPlan = deriveAuthoritativeStayPlan({
      includeMadinah,
      requestedMakkahNights: makkahRequest.nights,
      requestedMadinahNights: madinahRequest?.nights ?? 0,
      stayPolicy: parseStayPolicy(raw.stayPolicy),
      schedule: verifiedSchedule,
    });
    const nuitee = raw.nuiteeRooms ? await resolveNuiteePackageHotels(env, raw.nuiteeRooms, {adults,children,infants,rooms}, includeMadinah) : null;
    if (nuitee) {
      tier = nuitee.tier;
      if (nuitee.makkah.hotelId !== makkahRequest.hotelId || (nuitee.madinah?.hotelId ?? "") !== (madinahRequest?.hotelId ?? "")) throw new Error("NUITEE_CITY_SELECTION_MISMATCH");
      const first = nuitee.rooms.find(r=>r.city==="makkah")!;
      const second = nuitee.rooms.find(r=>r.city==="madinah");
      const stays = [first,second].filter((r): r is NuiteePackageRoom => !!r).sort((a,b)=>a.checkin.localeCompare(b.checkin));
      if (second && stays[0].checkout !== stays[1].checkin) throw new Error("NUITEE_STAY_GAP_OR_OVERLAP");
      const departureDay = String(raw.flight?.legs?.[0]?.departureDate ?? "");
      const returnDay = String(raw.flight?.legs?.[1]?.departureDate ?? "");
      if (!DATE.test(departureDay) || !DATE.test(returnDay) || stays[0].checkin < departureDay || stays[stays.length-1].checkout !== returnDay) throw new Error("NUITEE_STAY_OUTSIDE_FLIGHTS");
      const firstAirport = String(raw.flight?.legs?.[0]?.destination ?? "");
      if (includeMadinah && stays[0].city !== (firstAirport === "MED" ? "madinah" : "makkah")) throw new Error("NUITEE_CITY_ORDER_MISMATCH");
      // Preserve the actual supplier reservations selected by the traveler. Do
      // not silently add a hotel night or move a room offer onto different dates.
      stayPlan.source = "selectedSupplierStays";
      stayPlan.makkahCheckIn=first.checkin; stayPlan.makkahCheckOut=first.checkout;
      stayPlan.madinahCheckIn=second?.checkin ?? null; stayPlan.madinahCheckOut=second?.checkout ?? null;
      stayPlan.makkahNights=nuitee.makkah.nights; stayPlan.madinahNights=nuitee.madinah?.nights ?? 0;
      stayPlan.totalNights=stayPlan.makkahNights+stayPlan.madinahNights; stayPlan.totalDays=stayPlan.totalNights+1;
      stayPlan.firstCity=stays[0].city === "makkah" ? "Makkah" : "Madinah";
      stayPlan.lastCity=stays[stays.length-1].city === "makkah" ? "Makkah" : "Madinah";

    }
    const [makkahHotel, madinahHotel] = nuitee ? [nuitee.makkah,nuitee.madinah] : await Promise.all([
      resolveServerHotelPricing(env.HOTELS_DB, makkahRequest.hotelId, makkahRequest.roomId, stayPlan.makkahNights),
      madinahRequest ? resolveServerHotelPricing(env.HOTELS_DB, madinahRequest.hotelId, madinahRequest.roomId, stayPlan.madinahNights) : Promise.resolve(null),
    ]);

    const fareClass = text(raw.haramain?.fareClass, 20) === "business" ? "business" : "economy";
    const quoteInput: ServerQuoteInput = {
      tier,
      tripType,
      includeMadinah,
      travelers: { adults, children, infants, rooms },
      meals: {
        makkahLunch: raw.meals?.makkahLunch === true,
        makkahDinner: raw.meals?.makkahDinner === true,
        madinahDinner: raw.meals?.madinahDinner === true,
      },
      hotelMealComponents: nuitee?.mealComponents,
      transferVehicle: parseTransfer(raw.transferVehicle),
      includeHaramainTrain: includeMadinah && raw.haramain?.enabled === true,
      haramainFareClass: fareClass,
      haramainTicketCount: int(raw.haramain?.ticketCount ?? (adults + children), 0, 9),
      journeyFare,
      makkahHotel,
      madinahHotel,
    };
    const calculated = calculatePackageQuote(quoteInput);
    if (nuitee) {
      calculated.snapshot.nuiteeRooms = nuitee.rooms;
      calculated.snapshot.bookingAllowed = nuitee.bookingAllowed;
      calculated.snapshot.supplierMode = nuitee.supplierMode;
      calculated.snapshot.supplierReservationConfirmed = false;
      if (nuitee.supplierMode === "sandbox") {
        for (const component of calculated.snapshot.components) {
          if (component.code === "makkah_hotel" || component.code === "madinah_hotel") component.label += " · Sandbox";
        }
      }
    }
    const quoteProof = await sealPricingSnapshot(calculated.snapshot, env);

    // Confidential supplier components, markup and estimated profit intentionally
    // never leave the Worker. The sealed proof is opaque to iOS/Android/Web and is
    // opened only after a real booking exists.
    return json({
      ok: true,
      quote: {
        totalPackagePrice: calculated.totalPackagePrice,
        pricePerPerson: calculated.pricePerPerson,
        currency: calculated.currency,
        isEstimated: calculated.isEstimated,
        quoteId: calculated.quoteId,
        quoteProof,
        bookingAllowed: nuitee?.bookingAllowed ?? true,
        resolvedTier: tier,
        stayPlan,
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PACKAGE_QUOTE_FAILED";
    const notFound = ["HOTEL_NOT_FOUND", "CURATED_FLIGHT_NOT_FOUND", "FLIGHT_FARE_NOT_FOUND"].includes(code);
    const conflict = ["FLIGHT_FARE_EXPIRED", "HOTEL_PRICE_UNAVAILABLE", "HOTEL_ROOM_MISMATCH"].includes(code);
    return json({ ok: false, error: code }, notFound ? 404 : conflict ? 409 : code.endsWith("_NOT_CONFIGURED") || code === "QUOTE_SEAL_NOT_CONFIGURED" ? 503 : 400);
  }
}


type StorefrontQuoteRequest = {
  tier?: unknown;
  travelers?: unknown;
  rooms?: unknown;
  hotelId?: unknown;
  hotelNights?: unknown;
  flight?: {
    outboundOfferId?: unknown;
    inboundOfferId?: unknown;
    outboundOrigin?: unknown;
    outboundDestination?: unknown;
    outboundDate?: unknown;
    inboundOrigin?: unknown;
    inboundDestination?: unknown;
    inboundDate?: unknown;
  };
};

type CalendarFareRow = { min_per_traveler_fare: number | string; currency: string; observed_at: string };

async function calendarOneWayFare(
  env: Env,
  originValue: unknown,
  destinationValue: unknown,
  dateValue: unknown,
  travelers: number,
): Promise<{ fare: number; observedAt: string }> {
  if (!env.HOTELS_DB) throw new Error("HOTELS_DB_NOT_CONFIGURED");
  const origin = text(originValue, 3).toUpperCase();
  const destination = text(destinationValue, 3).toUpperCase();
  const departureDate = text(dateValue, 10);
  if (!IATA.test(origin) || !IATA.test(destination) || origin === destination || !DATE.test(departureDate)) {
    throw new Error("INVALID_STOREFRONT_FLIGHT");
  }
  const signature = `a${travelers}-c0-s0-l0`;
  const row = await env.HOTELS_DB.prepare(
    `SELECT min_per_traveler_fare,currency,observed_at
     FROM flight_calendar_fares
     WHERE outbound_origin=?1 AND outbound_destination=?2
       AND COALESCE(inbound_origin,'')='' AND COALESCE(inbound_destination,'')=''
       AND passenger_signature=?3 AND cabin_class='economy'
       AND outbound_date=?4 AND currency='USD'
     ORDER BY observed_at DESC LIMIT 1`,
  ).bind(origin, destination, signature, departureDate).first<CalendarFareRow>();
  const fare = Number(row?.min_per_traveler_fare ?? 0);
  if (!row || !Number.isFinite(fare) || fare <= 0) throw new Error("STOREFRONT_FLIGHT_FARE_NOT_FOUND");
  return { fare, observedAt: String(row.observed_at || new Date().toISOString()) };
}

async function resolveStorefrontFare(raw: StorefrontQuoteRequest, travelers: number, env: Env): Promise<{ perTraveler: number; observedAt: string }> {
  const outboundID = text(raw.flight?.outboundOfferId, 180);
  const inboundID = text(raw.flight?.inboundOfferId, 180);
  if (outboundID && inboundID) {
    try {
      const providerID = outboundID === inboundID ? `curated:${outboundID}` : `curated:${outboundID}+${inboundID}`;
      const fare = await resolveCuratedFare(providerID, travelers, env);
      return { perTraveler: fare.normalizedGroupUsd / travelers, observedAt: fare.observedAt };
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (!['CURATED_FLIGHT_NOT_FOUND','INVALID_FLIGHT_DATE'].includes(code)) throw error;
    }
  }

  const [outbound, inbound] = await Promise.all([
    calendarOneWayFare(env, raw.flight?.outboundOrigin, raw.flight?.outboundDestination, raw.flight?.outboundDate, travelers),
    calendarOneWayFare(env, raw.flight?.inboundOrigin, raw.flight?.inboundDestination, raw.flight?.inboundDate, travelers),
  ]);
  return {
    perTraveler: Math.round((outbound.fare + inbound.fare) * 100) / 100,
    observedAt: outbound.observedAt > inbound.observedAt ? outbound.observedAt : inbound.observedAt,
  };
}

export async function generateStorefrontPackageQuote(request: Request, env: Env): Promise<Response> {
  let raw: StorefrontQuoteRequest;
  try { raw = await request.json() as StorefrontQuoteRequest; }
  catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }

  try {
    const tier = parseTier(raw.tier);
    const travelers = int(raw.travelers ?? 2, 1, 9);
    const rooms = int(raw.rooms ?? 1, 1, 9);
    const hotelId = text(raw.hotelId, 180);
    const hotelNights = int(raw.hotelNights, 1, 30);
    if (!hotelId) throw new Error("HOTEL_REQUIRED");
    const [fare, hotel] = await Promise.all([
      resolveStorefrontFare(raw, travelers, env),
      resolveServerHotelPricing(env.HOTELS_DB, hotelId, null, hotelNights),
    ]);
    const quote = calculateStorefrontPreviewQuote({
      tier,
      travelers,
      rooms,
      flightFarePerTravelerUsd: fare.perTraveler,
      hotelNightlyUsd: hotel.amountUsd,
      hotelNights,
    });
    return json({ ok: true, quote });
  } catch (error) {
    const code = error instanceof Error ? error.message : "STOREFRONT_QUOTE_FAILED";
    const notFound = code.endsWith("_NOT_FOUND") || code === "HOTEL_NOT_FOUND";
    const conflict = code === "HOTEL_PRICE_UNAVAILABLE";
    return json({ ok: false, error: code }, notFound ? 404 : conflict ? 409 : code.endsWith("_NOT_CONFIGURED") ? 503 : 400);
  }
}
