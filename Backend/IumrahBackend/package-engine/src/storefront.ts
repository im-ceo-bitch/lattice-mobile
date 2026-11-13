import type { D1Like } from "./d1";
import { ensureCuratedFlightSchema } from "./curated-flights";

type StorefrontLeg = {
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
};

type StorefrontItinerary = {
  id: string;
  observed_at: string;
  legs: unknown[];
  bags?: { carry_on?: number | null; checked?: number | null } | null;
};

type CuratedRow = {
  id: string;
  outbound_origin: string;
  outbound_destination: string;
  inbound_origin: string | null;
  inbound_destination: string | null;
  outbound_date: string;
  inbound_date: string | null;
  itinerary_json: string;
  total_fare: number;
  per_traveler_fare: number;
  currency: string;
  traveler_count: number;
  observed_at: string;
  priority: number;
};

type PublicOption = {
  id: string;
  kind: "open_jaw" | "one_way";
  priority: number;
  currency: string;
  travelerCount: number;
  totalFare: number;
  perTravelerFare: number;
  observedAt: string;
  outbound: StorefrontLeg;
  inbound: StorefrontLeg | null;
  baggage: { carryOn: number | null; checked: number | null } | null;
};

function responseJSON(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function parseJSON<T>(value: string): T | null {
  try { return JSON.parse(value) as T; }
  catch { return null; }
}

function validOrigin(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStorefrontLeg(raw: unknown): StorefrontLeg | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const origin = safeString(value.origin).toUpperCase();
  const destination = safeString(value.destination).toUpperCase();
  const departureAt = safeString(value.departure_at);
  const arrivalAt = safeString(value.arrival_at);
  const duration = Number(value.duration_minutes);
  const stops = Number(value.stops);
  if (!validOrigin(origin) || !validOrigin(destination) || origin === destination) return null;
  if (!departureAt || !arrivalAt || !Number.isFinite(Date.parse(departureAt)) || !Number.isFinite(Date.parse(arrivalAt))) return null;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(stops) || stops < 0) return null;
  return {
    airline: safeString(value.airline) || safeString(value.airline_code) || "Airline",
    flight_number: safeString(value.flight_number),
    airline_code: safeString(value.airline_code).toUpperCase(),
    origin,
    destination,
    departure_at: departureAt,
    arrival_at: arrivalAt,
    duration_minutes: Math.round(duration),
    stops,
    cabin_class: safeString(value.cabin_class) || "economy",
  };
}

function mapRow(row: CuratedRow): PublicOption | null {
  const itinerary = parseJSON<StorefrontItinerary>(row.itinerary_json);
  if (!itinerary || !Array.isArray(itinerary.legs) || itinerary.legs.length < 1 || itinerary.legs.length > 2) return null;
  const outbound = normalizeStorefrontLeg(itinerary.legs[0]);
  const inbound = itinerary.legs[1] == null ? null : normalizeStorefrontLeg(itinerary.legs[1]);
  if (!outbound || (itinerary.legs.length > 1 && !inbound) || outbound.stops !== 0 || (inbound && inbound.stops !== 0)) return null;

  const totalFare = Number(row.total_fare);
  const perTravelerFare = Number(row.per_traveler_fare);
  const travelerCount = Number(row.traveler_count);
  if (!Number.isFinite(totalFare) || totalFare <= 0 || !Number.isFinite(perTravelerFare) || perTravelerFare <= 0) return null;
  if (!Number.isInteger(travelerCount) || travelerCount < 1) return null;

  return {
    id: row.id,
    kind: inbound ? "open_jaw" : "one_way",
    priority: Number(row.priority) || 100,
    currency: row.currency,
    travelerCount,
    totalFare,
    perTravelerFare,
    observedAt: row.observed_at,
    outbound,
    inbound,
    baggage: itinerary.bags ? {
      carryOn: itinerary.bags.carry_on ?? null,
      checked: itinerary.bags.checked ?? null,
    } : null,
  };
}

function routeIsExactOpenJaw(option: PublicOption, origin: string): boolean {
  return option.outbound.origin === origin &&
    option.outbound.destination === "MED" &&
    option.inbound?.origin === "JED" &&
    option.inbound.destination === origin;
}

function chooseBaseline(options: PublicOption[], origin: string) {
  const exactPairs = options
    .filter((option) => option.currency.toUpperCase() === "USD" && routeIsExactOpenJaw(option, origin))
    .sort((a, b) => a.priority - b.priority || a.perTravelerFare - b.perTravelerFare || a.outbound.departure_at.localeCompare(b.outbound.departure_at));

  const paired = exactPairs[0];
  if (paired?.inbound) {
    return {
      mode: "published_open_jaw",
      travelers: 2,
      currency: "USD",
      perTravelerFareUsd: paired.perTravelerFare,
      totalFareUsd: paired.perTravelerFare * 2,
      outboundOfferID: paired.id,
      inboundOfferID: paired.id,
      outbound: paired.outbound,
      inbound: paired.inbound,
      observedAt: paired.observedAt,
    };
  }

  const outboundOptions = options
    .filter((option) => option.kind === "one_way" && option.currency.toUpperCase() === "USD" && option.outbound.origin === origin && option.outbound.destination === "MED")
    .sort((a, b) => a.priority - b.priority || a.perTravelerFare - b.perTravelerFare || a.outbound.departure_at.localeCompare(b.outbound.departure_at));
  const inboundOptions = options
    .filter((option) => option.kind === "one_way" && option.currency.toUpperCase() === "USD" && option.outbound.origin === "JED" && option.outbound.destination === origin)
    .sort((a, b) => a.priority - b.priority || a.perTravelerFare - b.perTravelerFare || a.outbound.departure_at.localeCompare(b.outbound.departure_at));

  // Storefront prices are intentionally date-independent. The pilgrim has not
  // chosen travel dates on this screen yet, so we select the best currently
  // published direct leg in each direction independently. Exact dates are
  // resolved later in the dated package builder. This keeps hotel cards priced
  // whenever Business has at least one TAS→MED and one JED→TAS publication.
  const outbound = outboundOptions[0];
  const inbound = inboundOptions[0];
  if (!outbound || !inbound) return null;

  const perTravelerFareUsd = outbound.perTravelerFare + inbound.perTravelerFare;
  return {
    mode: "combined_published_one_way",
    travelers: 2,
    currency: "USD",
    perTravelerFareUsd,
    totalFareUsd: perTravelerFareUsd * 2,
    outboundOfferID: outbound.id,
    inboundOfferID: inbound.id,
    outbound: outbound.outbound,
    inbound: inbound.outbound,
    observedAt: outbound.observedAt > inbound.observedAt ? outbound.observedAt : inbound.observedAt,
  };
}

export async function publicStorefrontFlightBoard(url: URL, db: D1Like | undefined): Promise<Response> {
  if (!db) return responseJSON({ ok: false, error: "HOTELS_DB_NOT_CONFIGURED" }, 503);
  await ensureCuratedFlightSchema(db);

  const origin = (url.searchParams.get("origin") ?? "TAS").trim().toUpperCase();
  if (!validOrigin(origin)) return responseJSON({ ok: false, error: "INVALID_ORIGIN" }, 400);

  const today = new Date().toISOString().slice(0, 10);
  // The Flights storefront is a public catalogue, not a route-specific search.
  // Return every future staff-published direct Umrah product across departure
  // cities. `origin` is used only to choose the hotel-card baseline price below.
  // Generator screens apply their own exact route criteria client-side.
  const result = await db.prepare(`SELECT id, outbound_origin, outbound_destination,
      inbound_origin, inbound_destination, outbound_date, inbound_date, itinerary_json,
      total_fare, per_traveler_fare, currency, traveler_count, observed_at, priority
    FROM curated_flight_offers
    WHERE published = 1
      AND outbound_date >= ?
      AND (
        (inbound_origin IS NULL AND (
          outbound_destination IN ('MED','JED') OR outbound_origin IN ('MED','JED')
        )) OR
        (inbound_origin IS NOT NULL AND
          outbound_destination IN ('MED','JED') AND inbound_origin IN ('MED','JED'))
      )
    ORDER BY priority ASC, outbound_date ASC, per_traveler_fare ASC
    LIMIT 300`)
    .bind(today)
    .all<CuratedRow>();

  const options = (result.results ?? []).map(mapRow).filter((value): value is PublicOption => value !== null);
  const baseline = chooseBaseline(options, origin);

  return responseJSON({
    ok: true,
    origin,
    generatedAt: new Date().toISOString(),
    baseline,
    options,
  });
}

export function appleAppSiteAssociation(): Response {
  const body = {
    applinks: {
      details: [{
        appIDs: ["HVT4U96286.com.iumrah.app", "2DQ678JTNG.com.iumrah.app"],
        components: [
          { "/": "/h/*", comment: "Open public iumrah hotel links in the iOS app without exposing supplier identifiers." },
          { "/": "/hotel/*", comment: "Backward compatibility for hotel links shared by older beta builds." },
        ],
      }],
    },
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}

export function hotelWebFallback(url: URL): Response {
  // Universal Links are the primary path. The custom URL scheme button is a
  // deterministic fallback for Safari, same-domain navigation and devices that
  // still have an older AASA snapshot cached by Apple's CDN.
  const match = url.pathname.match(/^\/h\/([^/]+)$/);
  const publicToken = match ? decodeURIComponent(match[1]) : "";
  const appURL = publicToken ? `iumrahapp://hotel/${encodeURIComponent(publicToken)}` : "";
  const button = appURL
    ? `<a class="open" href="${appURL}">Open in iumrah</a>`
    : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>iumrah Hotels</title>
<meta name="description" content="Open this hotel in iumrah to see its curated stay details and current Umrah package price.">
<style>
:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f5f5f7;color:#111;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;display:grid;place-items:center;padding:24px}
main{width:min(520px,100%);background:#fff;border:1px solid rgba(0,0,0,.06);border-radius:32px;padding:30px;box-shadow:0 18px 56px rgba(0,0,0,.07)}
h1{font-size:34px;line-height:1.05;letter-spacing:-1.2px;margin:0 0 12px}p{font-size:17px;line-height:1.45;color:#6e6e73;margin:0 0 24px}.open{display:flex;align-items:center;justify-content:center;min-height:54px;border-radius:18px;background:#111;color:#fff;text-decoration:none;font-size:17px;font-weight:650}.hint{font-size:13px;margin:14px 2px 0;color:#8e8e93}
@media(prefers-color-scheme:dark){body{background:#000;color:#f5f5f7}main{background:#1c1c1e;border-color:rgba(255,255,255,.08)}p,.hint{color:#98989d}.open{background:#fff;color:#111}}
</style></head><body><main><h1>iumrah Hotels</h1><p id="copy">Open this hotel in the iumrah app to see its stay details and current Umrah package price.</p>${button}<p class="hint" id="hint">If the app did not open automatically, tap the button above.</p></main>
<script>
(function(){var l=(navigator.language||'en').toLowerCase(),copy=document.getElementById('copy'),hint=document.getElementById('hint'),open=document.querySelector('.open');
var t=l.indexOf('uz-cyrl')===0||l.indexOf('uz-cyrl')>=0?['Бу меҳмонхонани iumrah иловасида очиб, тафсилотлар ва амалдаги Умра пакети нархини кўринг.','iumrah иловасида очиш','Илова автоматик очилмаса, юқоридаги тугмани босинг.']:l.indexOf('uz')===0?['Bu mehmonxonani iumrah ilovasida ochib, tafsilotlar va amaldagi Umra paketi narxini ko‘ring.','iumrah ilovasida ochish','Ilova avtomatik ochilmasa, yuqoridagi tugmani bosing.']:l.indexOf('tr')===0?['Konaklama ayrıntılarını ve güncel Umre paket fiyatını görmek için bu oteli iumrah uygulamasında açın.','iumrah’da aç','Uygulama otomatik olarak açılmazsa yukarıdaki düğmeye dokunun.']:l.indexOf('id')===0?['Buka hotel ini di aplikasi iumrah untuk melihat detail menginap dan harga paket Umrah terbaru.','Buka di iumrah','Jika aplikasi tidak terbuka otomatis, ketuk tombol di atas.']:l.indexOf('ru')===0?['Откройте этот отель в приложении iumrah, чтобы увидеть детали и актуальную цену пакета Умры.','Открыть в iumrah','Если приложение не открылось автоматически, нажмите кнопку выше.']:['Open this hotel in the iumrah app to see its stay details and current Umrah package price.','Open in iumrah','If the app did not open automatically, tap the button above.'];
document.documentElement.lang=l.indexOf('uz-cyrl')===0?'uz-Cyrl':l.split('-')[0];copy.textContent=t[0];hint.textContent=t[2];if(open)open.textContent=t[1];})();
</script></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}

