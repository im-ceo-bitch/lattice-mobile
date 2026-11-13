/** Nuitee Hotels V1 — server-only supplier adapter. No supplier keys leave this worker. */
import type { Env } from './env';
import { hotelLanguage, translateHotelText, uzbekCyrillic } from './hotel-localization';

type Json = Record<string, any>;
type Entry = { payload: string; expires_at: number; updated_at: number };
const BASE = 'https://api.liteapi.travel/v3.0';
const DAY = 86400;
const supportedCities: Record<string, string[]> = {
  makkah: ['Makkah', 'Mecca'],
  madinah: ['Medina', 'Madinah'],
};
const output = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const error = (code: string, status = 400) => output({ ok: false, error: code }, status);
function apiKey(env: Env): string | null { return env.NUITEE_API_KEY?.trim() || null; }
function isSandbox(env: Env): boolean { return (apiKey(env) || '').startsWith('sand_'); }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function dateParam(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(value + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}
function stayDates(inDate: string | null, outDate: string | null): boolean {
  if (!inDate || !outDate) return false;
  const a = Date.parse(inDate + 'T00:00:00Z'), b = Date.parse(outDate + 'T00:00:00Z');
  const today = Date.now() - DAY * 1000;
  return a >= today && b > a && b - a <= 28 * DAY * 1000 && a - Date.now() < 730 * DAY * 1000;
}
function defaultDates(): { checkin: string; checkout: string } {
  const today = new Date();
  const d1 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 10));
  const d2 = new Date(d1.getTime() + DAY * 1000);
  return { checkin: d1.toISOString().slice(0, 10), checkout: d2.toISOString().slice(0, 10) };
}
function plain(value: unknown): string {
  return text(value).replace(/<\/?[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim();
}
function safeImages(values: unknown): string[] {
  return Array.isArray(values) ? [...new Set(values.map(v => text(typeof v === 'string' ? v : v?.url)))]
    .filter(s => /^https:\/\//i.test(s)) : [];
}
function priceOf(v: any): number | null {
  if (Array.isArray(v)) return v.length ? priceOf(v[0]) : null;
  if (v && typeof v === 'object') return num(v.amount ?? v.value ?? v.total);
  return num(v);
}
async function provider(env: Env, path: string, params?: URLSearchParams, data?: unknown): Promise<Json> {
  const key = apiKey(env);
  if (!key) throw new Error('NUITEE_NOT_CONFIGURED');
  const url = `${path.startsWith('/rates/') ? 'https://book.liteapi.travel/v3.0' : BASE}${path}${params ? `?${params}` : ''}`;
  // Shared across isolates via D1: respect provider backoff rather than retrying
  // once per visible card/user. Static cache reads still work during cooldown.
  const cooldown = await read(env, 'provider:cooldown:v1');
  if (cooldown?.fresh) throw new Error('NUITEE_RATE_LIMIT');
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method: data ? 'POST' : 'GET', headers: {
        'X-API-Key': key, 'accept': 'application/json', ...(data ? { 'content-type': 'application/json' } : {}),
      }, body: data ? JSON.stringify(data) : undefined,
      signal: path.startsWith('/hotels/') || path.startsWith('/rates/') ? undefined : AbortSignal.timeout(22000),
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    console.warn(JSON.stringify({event: 'nuitee_request', path, code: timeout ? 'timeout' : 'network', durationMs: Date.now() - started}));
    throw new Error(timeout ? 'NUITEE_TIMEOUT' : 'NUITEE_NETWORK');
  }
  const json: Json = await response.json().catch(() => ({}));
  const supplierCode = String(json?.error?.code ?? '');
  // Log only diagnostic metadata, never keys, request bodies or guest details.
  console.info(JSON.stringify({event: 'nuitee_request', path, status: response.status,
    supplierCode: supplierCode || null, durationMs: Date.now() - started,
    returned: Array.isArray(json.data) ? json.data.length : null}));
  if (response.status === 429 || supplierCode === '4290') {
    const retry = response.headers.get('retry-after');
    const seconds = retry && /^\d+$/.test(retry) ? Number(retry)
      : retry ? Math.ceil((Date.parse(retry) - Date.now()) / 1000) : 60;
    await save(env, 'provider:cooldown:v1', true, Math.max(1, Math.min(3600, Number.isFinite(seconds) ? seconds : 60)));
    throw new Error('NUITEE_RATE_LIMIT');
  }
  if (supplierCode === '2001' && path.startsWith('/hotels/')) return {data: []};
  if (supplierCode === '4011') throw new Error('NUITEE_SUPPLIER_TIMEOUT');
  if (!response.ok) throw new Error(`NUITEE_HTTP_${response.status}${supplierCode ? `_CODE_${supplierCode.replace(/[^0-9]/g, '')}` : ''}`);
  if (json?.error) throw new Error(`NUITEE_PROVIDER_${supplierCode.replace(/[^0-9]/g, '') || 'ERROR'}`);
  if (!('data' in json)) throw new Error('NUITEE_INVALID_RESPONSE');
  return json;
}
async function ensure(env: Env): Promise<void> {
  if (!env.HOTELS_DB) throw new Error('HOTELS_DB_NOT_CONFIGURED');
  await env.HOTELS_DB.prepare(`CREATE TABLE IF NOT EXISTS nuitee_hotel_cache (
    key TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  )`).run();
}
async function read(env: Env, key: string): Promise<{ data: any; fresh: boolean; updatedAt: number } | null> {
  if (!env.HOTELS_DB) return null;
  const r = await env.HOTELS_DB.prepare('SELECT payload, expires_at, updated_at FROM nuitee_hotel_cache WHERE key = ?1')
    .bind(key).first<Entry>();
  if (!r) return null;
  try { return { data: JSON.parse(r.payload), fresh: r.expires_at > Date.now(), updatedAt: r.updated_at }; }
  catch { return null; }
}
async function save(env: Env, key: string, data: unknown, ttl: number) {
  if (!env.HOTELS_DB) return;
  const now = Date.now();
  await env.HOTELS_DB.prepare(`INSERT INTO nuitee_hotel_cache (key,payload,updated_at,expires_at)
    VALUES (?1,?2,?3,?4) ON CONFLICT(key) DO UPDATE SET
    payload=excluded.payload, updated_at=excluded.updated_at, expires_at=excluded.expires_at`)
    .bind(key, JSON.stringify(data), now, now + ttl * 1000).run();
}
function hotelItem(raw: Json): Json | null {
  const id = text(raw.id), name = text(raw.name);
  if (!id || !name || raw.deletedAt) return null;
  const previewImages = safeImages(raw.hotelImages ?? raw.images);
  const cover = text(raw.thumbnail || raw.main_photo);
  if (cover.startsWith('https://') && !previewImages.includes(cover)) previewImages.unshift(cover);
  return {
    id, name, city: text(raw.city), address: text(raw.address), stars: num(raw.stars ?? raw.starRating),
    previewImages: previewImages.slice(0, 3),
    rating: num(raw.rating), reviewCount: num(raw.reviewCount),
    coverImageURL: cover || null,
    latitude: num(raw.latitude ?? raw.location?.latitude), longitude: num(raw.longitude ?? raw.location?.longitude),
  };
}
async function catalog(env: Env, city: 'makkah' | 'madinah') {
  const key = `catalog:v1:${city}`;
  const cached = await read(env, key);
  if (cached?.fresh) return { items: cached.data as Json[], stale: false };
  try {
    let selected: Json[] = [];
    for (const name of supportedCities[city]) {
      const p = new URLSearchParams({ countryCode: 'SA', cityName: name, limit: '350', offset: '0' });
      const result = await provider(env, '/data/hotels', p);
      const list = (Array.isArray(result.data) ? result.data : []).map(hotelItem).filter(Boolean) as Json[];
      if (list.length > selected.length) selected = list;
      if (selected.length >= 150) break;
    }
    // Explicit cap; exclude bare properties without a meaningful name. No fabricated entries.
    // Keep different star classes visible even when the provider returns more
    // luxury properties than the 150-card V1 limit.
    selected.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    const groups = [5, 4, 3, 2, 1].map(star => selected.filter(h =>
      Math.max(1, Math.min(5, Math.round(h.stars ?? 0))) === star));
    const balanced: Json[] = [];
    for (const group of groups) balanced.push(...group.slice(0, 30));
    const seen = new Set(balanced.map(h => h.id));
    const remaining = selected.filter(h => !seen.has(h.id));
    const items = [...balanced, ...remaining].slice(0, 150)
      .sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0) || (b.rating ?? 0) - (a.rating ?? 0));
    if (!items.length) throw new Error('NUITEE_CATALOG_EMPTY');
    await save(env, key, items, 7 * DAY);
    return { items, stale: false };
  } catch (e) {
    if (cached) return { items: cached.data as Json[], stale: true };
    throw e;
  }
}
async function minimums(env: Env, city: 'makkah' | 'madinah', hotels: Json[], checkin: string, checkout: string, adults: number) {
  const key = `minimum:v2:${city}:${checkin}:${checkout}:${adults}:UZ:USD`;
  const cached = await read(env, key);
  if (cached?.fresh) return { values: cached.data as Json[], stale: false, updatedAt: cached.updatedAt };
  try {
    const ids = hotels.map(h => text(h.id)).filter(Boolean);
    if (!ids.length) return { values: [], stale: false, updatedAt: Date.now() };
    // Nuitee min-rates is a batch request. We never perform one request per card.
    const result = await provider(env, '/hotels/min-rates', undefined, {
      hotelIds: ids, checkin, checkout, currency: 'USD', guestNationality: 'UZ', occupancies: [{ adults }],
    });
    const values = Array.isArray(result.data) ? result.data.map((r: Json) => ({
      hotelId: text(r.hotelId), price: priceOf(r.price), currency: 'USD', offerId: text(r.offerId),
    })).filter((r: Json) => r.hotelId && r.price !== null) : [];
    await save(env, key, values, values.length ? 15 * 60 : 2 * 60);
    return { values, stale: false, updatedAt: Date.now() };
  } catch (e) {
    if (cached && Date.now() - cached.updatedAt < 6 * 3600 * 1000) return { values: cached.data as Json[], stale: true, updatedAt: cached.updatedAt, rateError: e instanceof Error ? e.message : 'RATES_UNAVAILABLE' };
    throw e;
  }
}
function normalizedDetail(raw: Json, summary: Json) {
  const photos = safeImages(raw.hotelImages);
  const first = text(raw.main_photo);
  if (first.startsWith('https://') && !photos.includes(first)) photos.unshift(first);
  const rooms = Array.isArray(raw.rooms) ? raw.rooms.map((r: Json) => ({
    id: String(r.id ?? ''), name: plain(r.roomName ?? r.name), description: plain(r.description),
    maxOccupancy: num(r.maxOccupancy), images: safeImages(r.photos),
    amenities: Array.isArray(r.roomAmenities) ? r.roomAmenities.map((a: any) => plain(a.name ?? a)).filter(Boolean) : [],
  })) : [];
  return {
    ...summary, name: text(raw.name) || summary.name, address: text(raw.address) || summary.address,
    description: plain(raw.hotelDescription), importantInformation: plain(raw.hotelImportantInformation),
    images: photos, rooms,
    amenities: Array.isArray(raw.hotelFacilities) ? raw.hotelFacilities.map((x: any) => plain(typeof x === 'string' ? x : x.name)).filter(Boolean) : [],
    policies: Array.isArray(raw.policies) ? raw.policies.map((x: Json) => ({ title: plain(x.name), description: plain(x.description) })).filter((x: any) => x.title || x.description) : [],
    checkin: plain(raw.checkinCheckoutTimes?.checkin ?? raw.checkin),
    checkout: plain(raw.checkinCheckoutTimes?.checkout ?? raw.checkout),
    latitude: num(raw.latitude ?? raw.location?.latitude) ?? summary.latitude,
    longitude: num(raw.longitude ?? raw.location?.longitude) ?? summary.longitude,
  };
}
function normalizedRates(result: Json, hotelId: string) {
  const item = (Array.isArray(result.data) ? result.data : []).find((x: Json) => x.hotelId === hotelId);
  const offers: Json[] = [];
  for (const type of item?.roomTypes ?? []) {
    for (const rate of type.rates ?? []) {
      const cancellation = rate.cancellationPolicies || type.cancellationPolicies || {};
      const retail = rate.retailRate || {};
      const total = priceOf(retail.total);
      if (total === null || total <= 0) continue;
      const policyInfos = Array.isArray(cancellation.cancelPolicyInfos) ? cancellation.cancelPolicyInfos : [];
      const chargeOnArrival = Array.isArray(retail.taxesAndFees)
        ? retail.taxesAndFees.filter((t: Json) => t.included === false).map((t: Json) => ({ amount: priceOf(t.amount ?? t.total), currency: text(t.currency) || 'USD' })) : [];
      offers.push({
        offerId: text(type.offerId || rate.offerId), roomId: String(rate.mappedRoomId ?? ''),
        roomName: plain(rate.name || type.name || 'Room'), mealPlan: plain(rate.boardName || rate.boardType || ''),
        price: total, currency: text((Array.isArray(retail.total) ? retail.total[0]?.currency : retail.total?.currency)) || 'USD',
        refundable: text(cancellation.refundableTag) === 'RFN',
        cancellationTag: text(cancellation.refundableTag),
        cancellationDescription: plain(cancellation.description || cancellation.name),
        cancellationDeadlines: policyInfos.map((i: Json) => ({
          until: text(i.cancelTime), amount: priceOf(i.amount ?? i.fee ?? i.penaltyAmount),
        })), chargeOnArrival,
      });
    }
  }
  return offers.sort((a,b) => a.price - b.price);
}
async function listing(url: URL, env: Env) {
  const city = (url.searchParams.get('city') || '').toLowerCase();
  if (city !== 'makkah' && city !== 'madinah') return error('INVALID_CITY');
  const rawIn = url.searchParams.get('checkin'), rawOut = url.searchParams.get('checkout');
  if ((rawIn && !dateParam(rawIn)) || (rawOut && !dateParam(rawOut))) return error('INVALID_DATES');
  const inDate = dateParam(rawIn) || defaultDates().checkin;
  const outDate = dateParam(rawOut) || defaultDates().checkout;
  if (!stayDates(inDate, outDate)) return error('INVALID_DATES');
  const adults = Math.floor(Number(url.searchParams.get('adults') || 2));
  if (!Number.isInteger(adults) || adults < 1 || adults > 8) return error('INVALID_OCCUPANCY');
  const c = await catalog(env, city);
  let rates: Awaited<ReturnType<typeof minimums>> | undefined;
  let rateError: string | null = null;
  try {
    if (url.searchParams.get('catalogOnly') !== '1') {
      rates = await minimums(env, city, c.items, inDate, outDate, adults);
      rateError = rates.rateError ?? null;
    }
  }
  catch (e) { rateError = e instanceof Error ? e.message : 'RATES_UNAVAILABLE'; }
  const indexed = new Map<string, Json>((rates?.values ?? []).map((x: Json): [string, Json] => [x.hotelId, x]));
  return output({ ok: true, provider: 'nuitee', sandbox: isSandbox(env),
    city, checkin: inDate, checkout: outDate, adults, priceType: 'room_total', currency: 'USD',
    hotelCatalogStale: c.stale, pricesStale: Boolean(rates?.stale), pricesUpdatedAt: rates?.updatedAt ?? null, rateError,
    hotels: c.items.map(h => ({ ...h, minimumRate: indexed.get(h.id) ?? null,
      rateStatus: indexed.has(h.id) ? (rates?.stale ? 'cached' : 'available')
        : rateError ? 'provider_error' : url.searchParams.get('catalogOnly') === '1' ? 'not_requested' : 'no_availability' })),
  });
}
async function isListedHotel(env: Env, id: string): Promise<boolean> {
  for (const city of ['makkah', 'madinah']) {
    const c = await read(env, `catalog:v1:${city}`);
    if (Array.isArray(c?.data) && c.data.some((h: Json) => h.id === id)) return true;
  }
  return false;
}

async function detail(url: URL, env: Env) {
  const id = text(url.searchParams.get('hotelId'));
  const language = hotelLanguage(url.searchParams.get('language'));
  if (!/^lp[a-zA-Z0-9]{1,50}$/.test(id)) return error('INVALID_HOTEL_ID');
  if (!await isListedHotel(env, id)) return error('HOTEL_NOT_IN_CATALOG', 404);
  const cacheKey = language === 'en' ? `detail:v1:${id}` : `detail:v3:${id}:${language}`;
  const cached = await read(env, cacheKey);
  if (cached?.fresh) return output({ok:true,sandbox:isSandbox(env),hotel:cached.data});
  try {
    let h: Json;
    if (language !== 'en' && env.HOTEL_TRANSLATION_API_KEY) {
      // Reuse the English static snapshot so translating never changes factual fields.
      const englishURL = new URL(url); englishURL.searchParams.set('language','en');
      const response = await detail(englishURL, env);
      const english = await response.json() as Json;
      if (!english.hotel) throw new Error('NUITEE_HOTEL_NOT_FOUND');
      h = await translateHotelText(env, english.hotel, language);
    } else {
      const supplierLanguage = language === 'uz-cyrl' ? 'uz' : language;
      const raw = (await provider(env, '/data/hotel', new URLSearchParams({hotelId:id,language:supplierLanguage}))).data;
      if (!raw?.id) throw new Error('NUITEE_HOTEL_NOT_FOUND');
      h = normalizedDetail(raw, hotelItem(raw) || {id,name:text(raw.name),city:text(raw.city)});
      if (language === 'uz-cyrl') {
        // Native provider Uzbek is Latin. Transform text only, not identifiers/URLs.
        h.description = uzbekCyrillic(h.description);
        h.importantInformation = uzbekCyrillic(h.importantInformation);
        h.amenities = h.amenities.map(uzbekCyrillic);
        h.policies = h.policies.map((p:Json)=>({...p,title:uzbekCyrillic(p.title),description:uzbekCyrillic(p.description)}));
        h.rooms = h.rooms.map((r:Json)=>({...r,name:uzbekCyrillic(r.name),description:uzbekCyrillic(r.description),amenities:r.amenities.map(uzbekCyrillic)}));
      }
    }
    await save(env,cacheKey,h,7 * DAY);
    return output({ok:true,sandbox:isSandbox(env),hotel:h});
  } catch (e) {
    if (cached) return output({ok:true,sandbox:isSandbox(env),stale:true,hotel:cached.data});
    // Translation failure must not hide the hotel or corrupt the English cache.
    if (language !== 'en' && env.HOTEL_TRANSLATION_API_KEY) {
      return detail(url, {...env, HOTEL_TRANSLATION_API_KEY: undefined});
    }
    if (language !== 'en') {
      const englishURL = new URL(url); englishURL.searchParams.set('language','en');
      return detail(englishURL,env);
    }
    throw e;
  }
}
async function localizedRates(env: Env, offers: Json[], language: string, key: string): Promise<Json[]> {
  if (language === 'en' || !env.HOTEL_TRANSLATION_API_KEY) return offers;
  const cached = await read(env, `${key}:text:${language}`);
  // Translation cache holds strings only; never restore stale prices/offer IDs.
  const signature = JSON.stringify(offers.map(r=>[r.roomName,r.mealPlan,r.cancellationDescription]));
  if (cached?.fresh && cached.data.signature === signature) {
    return offers.map((rate,i)=>({...rate,...cached.data.text[i]}));
  }
  try {
    const localized = (await translateHotelText(env,{rates:offers},language)).rates;
    const text = localized.map((rate:Json)=>({roomName:rate.roomName,mealPlan:rate.mealPlan,cancellationDescription:rate.cancellationDescription}));
    await save(env,`${key}:text:${language}`,{signature,text},7 * DAY);
    return offers.map((rate,i)=>({...rate,...text[i]}));
  } catch { return offers; }
}
async function rates(request: Request, env: Env) {
  const body = await request.json().catch(() => null) as Json | null;
  if (!body || !/^lp[a-zA-Z0-9]{1,50}$/.test(text(body.hotelId))) return error('INVALID_HOTEL_ID');
  const checkin = dateParam(text(body.checkin)), checkout = dateParam(text(body.checkout));
  if (!stayDates(checkin, checkout)) return error('INVALID_DATES');
  const language = hotelLanguage(body.language);
  const adults = Number(body.adults);
  if (!Number.isInteger(adults) || adults < 1 || adults > 8) return error('INVALID_OCCUPANCY');
  const children = body.children ?? [];
  if (!Array.isArray(children) || children.length > 8 || children.some((age: unknown) => !Number.isInteger(age) || Number(age) < 0 || Number(age) > 17)) return error('INVALID_CHILD_AGES');
  const id = text(body.hotelId);
  if (!await isListedHotel(env, id)) return error('HOTEL_NOT_IN_CATALOG', 404);
  const key = `rates:v2:${id}:${checkin}:${checkout}:${adults}:${children.join(",")}:UZ:USD`;
  const cached = await read(env, key);
  // Detail prices are limited to 10 min. NEVER use a stale rate as a bookable offer.
  if (cached?.fresh && body.forceRefresh !== true) return output({ ok: true, sandbox: isSandbox(env), checkin, checkout, adults, rates: await localizedRates(env,cached.data,language,key), cached: true });
  const response = await provider(env, '/hotels/rates', undefined, {
    hotelIds: [id], checkin, checkout, occupancies: [{ adults, children }],
    currency: 'USD', guestNationality: 'UZ', roomMapping: true,
    maxRatesPerHotel: 50,
  });
  const offers = normalizedRates(response, id);
  await save(env, key, offers, 10 * 60);
  return output({ ok: true, sandbox: isSandbox(env), checkin, checkout, adults, rates: await localizedRates(env,offers,language,key), cached: false });
}
const activeRequests = new WeakMap<object, Map<string, Promise<Response>>>();
async function coalesced(env: Env, key: string, work: () => Promise<Response>): Promise<Response> {
  let active = activeRequests.get(env.HOTELS_DB!);
  if (!active) { active = new Map(); activeRequests.set(env.HOTELS_DB!, active); }
  let running = active.get(key);
  if (!running) {
    running = work();
    active.set(key, running);
  }
  try { return (await running).clone(); }
  finally { if (active.get(key) === running) active.delete(key); }
}
export async function handleNuiteeHotelRequest(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.HOTELS_DB) return error('HOTELS_DB_NOT_CONFIGURED', 503);
  try {
    await ensure(env);
    if (url.pathname === '/api/package/nuitee/hotels' && request.method === 'GET') return await coalesced(env, url.pathname + url.search, () => listing(url, env));
    if (url.pathname === '/api/package/nuitee/hotel' && request.method === 'GET') return await coalesced(env, url.pathname + url.search, () => detail(url, env));
    if (url.pathname === '/api/package/nuitee/rates' && request.method === 'POST') return await rates(request, env);
    return error('NOT_FOUND', 404);
  } catch (e) {
    const code = e instanceof Error ? e.message : 'NUITEE_UNAVAILABLE';
    return error(code.startsWith('NUITEE_') ? code : 'NUITEE_UNAVAILABLE', code === 'NUITEE_NOT_CONFIGURED' ? 503 : code === 'NUITEE_RATE_LIMIT' ? 429 : 502);
  }
}

/** Scheduled two-city refresh; never clears a last-known-good cache on provider errors. */
export async function refreshNuiteeHotelCatalog(env: Env, refreshPrices = true): Promise<void> {
  if (!env.HOTELS_DB || !apiKey(env)) return;
  await ensure(env);
  const { checkin, checkout } = defaultDates();
  for (const city of ['makkah', 'madinah'] as const) {
    try {
      const lastRefresh = await read(env, `scheduled:v2:${city}:${refreshPrices}`);
      if (lastRefresh?.fresh) continue;
      const result = await catalog(env, city);
      // Warm a bounded number of missing photo/details snapshots per cron run.
      // Persist URLs/gallery metadata in D1; image bytes use the iOS disk cache.
      let warmed = 0;
      for (const hotel of result.items) {
        const snapshot = await read(env, `detail:v1:${hotel.id}`);
        if (snapshot?.fresh) {
          hotel.previewImages = safeImages(snapshot.data.images).slice(0, 3);
          hotel.coverImageURL = hotel.previewImages[0] || hotel.coverImageURL;
          continue;
        }
        if (warmed >= 4) continue;
        warmed += 1;
        try {
          const raw = (await provider(env, '/data/hotel', new URLSearchParams({hotelId: hotel.id}))).data;
          if (!raw?.id) continue;
          const enriched = normalizedDetail(raw, hotel);
          await save(env, `detail:v1:${hotel.id}`, enriched, 7 * DAY);
          hotel.previewImages = enriched.images.slice(0, 3);
          hotel.coverImageURL = enriched.images[0] || hotel.coverImageURL;
        } catch { break; }
      }
      // Keep the original static expiry: photo enrichment must not prevent refresh.
      if (!result.stale) {
        await env.HOTELS_DB.prepare('UPDATE nuitee_hotel_cache SET payload = ?1 WHERE key = ?2')
          .bind(JSON.stringify(result.items), `catalog:v1:${city}`).run();
      }
      if (refreshPrices) await minimums(env, city, result.items, checkin, checkout, 2);
      await save(env, `scheduled:v2:${city}:${refreshPrices}`, true, 15 * 60);
    } catch {
      // The next scheduled run or an on-demand request will retry.
      // Existing hotel and price snapshots remain intact.
    }
  }
}


export type NuiteePackageRoom = {
  id: string; city: "makkah" | "madinah"; hotelId: string; offerId: string; roomId: string;
  checkin: string; checkout: string; adults: number; children: number[];
  prebookId?: string;
};
export function packageTierForStars(stars: number): "economy" | "standard" | "luxury" {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new Error("HOTEL_STARS_REQUIRED");
  return stars <= 2 ? "economy" : stars <= 4 ? "standard" : "luxury";
}

/** Prices/stars are read from supplier and server catalogue, never accepted from iOS. */
export async function resolveNuiteePackageHotels(env: Env, values: NuiteePackageRoom[], travelers: {adults:number;children:number;infants:number;rooms:number}, includeMadinah: boolean) {
  if (!Array.isArray(values) || values.length !== travelers.rooms * (includeMadinah ? 2 : 1)) throw new Error("NUITEE_ROOM_SELECTION_INCOMPLETE");
  await ensure(env);
  const cities = includeMadinah ? ["makkah", "madinah"] : ["makkah"];
  const result: Record<string, import("./pricing").PricingHotelInput> = {};
  const selected: NuiteePackageRoom[] = [];
  let highestStars = 0;
  const verifiedOffers = new Map<string, Json>();
  for (const city of cities) {
    const rooms = values.filter(room => room?.city === city);
    if (rooms.length !== travelers.rooms || new Set(rooms.map(x => x.id)).size !== rooms.length) throw new Error("NUITEE_ROOM_SELECTION_INCOMPLETE");
    if (new Set(rooms.map(x => x.hotelId)).size !== 1 || new Set(rooms.map(x => x.checkin + ":" + x.checkout)).size !== 1) throw new Error("NUITEE_CITY_SELECTION_MISMATCH");
    if (rooms.reduce((n,r)=>n+Number(r.adults),0) !== travelers.adults || rooms.reduce((n,r)=>n+(Array.isArray(r.children)?r.children.length:0),0) !== travelers.children+travelers.infants) throw new Error("NUITEE_OCCUPANCY_MISMATCH");
    const catalog = await read(env, `catalog:v1:${city}`);
    const hotel = Array.isArray(catalog?.data) ? catalog!.data.find((h:Json)=>h.id===rooms[0].hotelId) : null;
    if (!hotel) throw new Error("HOTEL_NOT_IN_CATALOG");
    const stars = Math.round(Number(hotel.stars)); packageTierForStars(stars); highestStars = Math.max(highestStars, stars);
    let total = 0;
    for (const room of rooms) {
      if (!room.offerId || typeof room.offerId !== "string" || room.offerId.length > 20000 || typeof room.roomId !== "string" || !Number.isInteger(room.adults) || room.adults < 1 || room.adults > 8 || !Array.isArray(room.children) || room.children.some(age=>!Number.isInteger(age) || age<0 || age>17) || !dateParam(room.checkin) || !dateParam(room.checkout) || !stayDates(room.checkin,room.checkout)) throw new Error("NUITEE_INVALID_SELECTED_RATE");
      // Bind an opaque offer to server-observed hotel/dates/occupancy before
      // prebooking it. Re-searching creates new offer IDs and is not validation.
      const anchorKey = `rates:v2:${room.hotelId}:${room.checkin}:${room.checkout}:${room.adults}:${room.children.join(",")}:UZ:USD`;
      const anchor = await read(env, anchorKey);
      const original = Array.isArray(anchor?.data) ? anchor!.data.find((r:Json)=>r.offerId===room.offerId && r.roomId===room.roomId) : null;
      if (!original) throw new Error("NUITEE_SELECTED_RATE_EXPIRED");
      let current = verifiedOffers.get(room.offerId);
      if (!current) {
        const response = await provider(env, '/rates/prebook', undefined, {offerId:room.offerId,usePaymentSdk:false});
        current = response.data;
        if (!current || !current.prebookId || current.hotelId!==room.hotelId || current.currency!=="USD" || !Number.isFinite(current.price) || current.price<=0) throw new Error("NUITEE_RATE_RECHECK_FAILED");
        if (current.cancellationChanged || current.boardChanged) throw new Error("NUITEE_RATE_TERMS_CHANGED");
        verifiedOffers.set(room.offerId,current);
      }
      total += current.price;
      selected.push({id:room.id,city:room.city,hotelId:room.hotelId,offerId:room.offerId,roomId:room.roomId,checkin:room.checkin,checkout:room.checkout,adults:room.adults,children:[...room.children],prebookId:current.prebookId});
    }
    const nights = Math.round((Date.parse(rooms[0].checkout)-Date.parse(rooms[0].checkin))/86400000);
    result[city] = {hotelId:rooms[0].hotelId, roomId:rooms[0].roomId, amountUsd:total/nights/travelers.rooms, unit:"perRoomNight", nights, pricingMode:"nuiteeRevalidated"};
  }
  return {makkah:result.makkah, madinah:result.madinah ?? null, tier:packageTierForStars(highestStars), rooms:selected, bookingAllowed:!isSandbox(env)};
}
