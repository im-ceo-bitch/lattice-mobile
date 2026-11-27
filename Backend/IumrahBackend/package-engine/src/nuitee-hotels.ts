import { hotelMealUnit, supplierMealInclusions, type HotelMealChoices } from "./pricing";
/** Nuitee Hotels V1 — server-only supplier adapter. No supplier keys leave this worker. */
import type { Env } from './env';
import { localizeKnownAmenities, hotelLanguage, translateHotelText, uzbekCyrillic } from './hotel-localization';

type Json = Record<string, any>;
type Entry = { payload: string; expires_at: number; updated_at: number };
type Cached = { data: any; fresh: boolean; updatedAt: number };
type CatalogResult = {items: Json[]; stale: boolean};
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
  if (supplierCode === '2001' && path.startsWith('/hotels/')) return {data: [], explicitUnavailable:true};
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
/** One D1 query per <=80 keys instead of 80 Worker subrequests for each price page. */
async function readMany(env: Env, keys: string[]): Promise<Map<string, Cached>> {
  const found = new Map<string, Cached>();
  if (!env.HOTELS_DB || !keys.length) return found;
  const unique = [...new Set(keys)];
  for (let start=0; start<unique.length; start+=80) {
    const chunk=unique.slice(start,start+80);
    const statement=env.HOTELS_DB.prepare(`SELECT key,payload,expires_at,updated_at FROM nuitee_hotel_cache WHERE key IN (${chunk.map(()=>'?').join(',')})`).bind(...chunk);
    // Some local test adapters support only first(). Real D1 always supports all().
    if (typeof statement.all !== 'function') {
      for (const key of chunk) {const value=await read(env,key);if(value)found.set(key,value);}
      continue;
    }
    const result=await statement.all<Entry & {key:string}>();
    for(const row of result.results ?? []) {
      try { found.set(row.key,{data:JSON.parse(row.payload),fresh:row.expires_at>Date.now(),updatedAt:row.updated_at}); } catch { /* invalid cache row */ }
    }
  }
  return found;
}
async function save(env: Env, key: string, data: unknown, ttl: number) {
  if (!env.HOTELS_DB) return;
  const now = Date.now();
  await env.HOTELS_DB.prepare(`INSERT INTO nuitee_hotel_cache (key,payload,updated_at,expires_at)
    VALUES (?1,?2,?3,?4) ON CONFLICT(key) DO UPDATE SET
    payload=excluded.payload, updated_at=excluded.updated_at, expires_at=excluded.expires_at`)
    .bind(key, JSON.stringify(data), now, now + ttl * 1000).run();
}
async function saveMany(env:Env, values:Array<{key:string;data:unknown;ttl:number}>) {
  if(!env.HOTELS_DB || !values.length)return;
  const db=env.HOTELS_DB as typeof env.HOTELS_DB & {batch?: (statements:import('./d1').D1PreparedStatementLike[])=>Promise<unknown[]>};
  if(typeof db.batch !== 'function') { for(const v of values)await save(env,v.key,v.data,v.ttl);return; }
  const now=Date.now();
  for(let start=0;start<values.length;start+=40) {
    const statements=values.slice(start,start+40).map(v=>db.prepare(`INSERT INTO nuitee_hotel_cache (key,payload,updated_at,expires_at) VALUES (?1,?2,?3,?4) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at,expires_at=excluded.expires_at`).bind(v.key,JSON.stringify(v.data),now,now+v.ttl*1000));
    await db.batch(statements);
  }
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
// v3 is a verified complete city snapshot. Earlier versions may be truncated;
// they remain readable for old saved offers but never suppress a fresh sync.
const catalogueFlights = new WeakMap<object, Map<string,Promise<CatalogResult>>>();
async function cachedCatalog(env: Env, city: string) {
  const current=await read(env, `catalog:v3:${city}`);
  if(current)return current;
  const old=await read(env,`catalog:partial:v3:${city}`) ?? await read(env,`catalog:v2:${city}`) ?? await read(env,`catalog:v1:${city}`);
  return old ? {...old,fresh:false} : null;
}
async function catalog(env: Env, city: 'makkah' | 'madinah', force=false): Promise<CatalogResult> {
  const db=env.HOTELS_DB!;
  let running=catalogueFlights.get(db);
  if(!running){running=new Map();catalogueFlights.set(db,running);}
  const existing=running.get(city);
  if(existing)return existing;
  const task=fetchCatalog(env,city,force);
  running.set(city,task);
  try{return await task;}finally{if(running.get(city)===task)running.delete(city);}
}
async function fetchCatalog(env:Env,city:'makkah'|'madinah',force:boolean):Promise<CatalogResult>{
  const key=`catalog:v3:${city}`;
  const cached=await read(env,key);
  if(cached?.fresh && !force)return {items:cached.data as Json[],stale:false};
  const previous=cached ?? await cachedCatalog(env,city);
  const selected=new Map<string,Json>();
  const supplierIDs=new Set<string>();
  const sources:Json[]=[];
  try{
    const limit=200;
    for(const name of supportedCities[city]){
      const rawIDs=new Set<string>();let offset=0;let reportedTotal:number|null=null;let pages=0;
      for(let page=0;page<50;page++){
        const params=new URLSearchParams({countryCode:'SA',cityName:name,limit:String(limit),offset:String(offset)});
        const result=await provider(env,'/data/hotels',params);
        if(!Array.isArray(result.data))throw new Error('NUITEE_INVALID_CATALOG');
        const raw=result.data as Json[];pages++;
        const total=num(result.total ?? result.pagination?.total ?? result.meta?.total);
        if(total!==null)reportedTotal=total;
        if(!raw.length){if(reportedTotal!==null && offset<reportedTotal)throw new Error('NUITEE_CATALOG_INCOMPLETE');break;}
        let advanced=false;
        for(const record of raw){
          const id=text(record.id);
          if(id&&!rawIDs.has(id)){rawIDs.add(id);supplierIDs.add(id);advanced=true;}
          const item=hotelItem(record);
          if(item&&!selected.has(item.id))selected.set(item.id,item);
        }
        // A repeated page is not proof of end-of-catalogue. Never cache it as complete.
        if(!advanced)throw new Error('NUITEE_CATALOG_REPEATED_PAGE');
        offset+=raw.length;
        if(reportedTotal!==null && reportedTotal>=raw.length && offset>=reportedTotal)break;
        if(page===49)throw new Error('NUITEE_CATALOG_PAGE_LIMIT');
      }
      if(reportedTotal!==null && rawIDs.size<reportedTotal)throw new Error('NUITEE_CATALOG_INCOMPLETE');
      sources.push({name,pages,received:rawIDs.size,reportedTotal});
    }
    const items=[...selected.values()].sort((a,b)=>(b.stars??0)-(a.stars??0)||(b.rating??0)-(a.rating??0)||a.id.localeCompare(b.id));
    if(!items.length)throw new Error('NUITEE_CATALOG_EMPTY');
    await save(env,key,items,7*DAY);
    await save(env,`catalog:coverage:v3:${city}`,{complete:true,supplierUnique:supplierIDs.size,stored:items.length,unknownStars:items.filter(h=>!h.stars||h.stars>5).length,sources,syncedAt:Date.now()},30*DAY);
    return {items,stale:false};
  }catch(e){
    const code=e instanceof Error?e.message:'NUITEE_CATALOG_UNAVAILABLE';
    await save(env,`catalog:attempt:v3:${city}`,{complete:false,code,supplierUnique:supplierIDs.size,sources,attemptedAt:Date.now()},DAY);
    if(previous)return {items:previous.data as Json[],stale:true};
    // If no complete snapshot exists, don't claim a partial download is complete.
    // Keep any verified rows usable as an explicitly stale last-known snapshot.
    if(selected.size){const items=[...selected.values()];await save(env,`catalog:partial:v3:${city}`,items,DAY);return {items,stale:true};}
    throw e;
  }
}
async function minimums(env: Env, city: 'makkah' | 'madinah', hotels: Json[], checkin: string, checkout: string, adults: number, children: number[] = []) {
  // Cache by exact ID set, not merely city/dates: page 2 must not reuse page 1 prices.
  const key = `minimum:v2:${city}:${checkin}:${checkout}:${adults}${children.length ? `:children:${children.join(",")}` : ""}:UZ:USD:${hotels.map(h => text(h.id)).sort().join(',')}`;
  const cached = await read(env, key);
  if (cached?.fresh && Array.isArray(cached.data) && hotels.every(h => cached.data.some((r: Json) => r.hotelId === h.id && r.price > 0))) return { values: cached.data as Json[], stale: false, updatedAt: cached.updatedAt };
  try {
    const ids = hotels.map(h => text(h.id)).filter(Boolean);
    if (!ids.length) return { values: [], stale: false, updatedAt: Date.now() };
    // Nuitee min-rates is a batch request. We never perform one request per card.
    const result = await provider(env, '/hotels/min-rates', undefined, {
      hotelIds: ids, checkin, checkout, currency: 'USD', guestNationality: 'UZ', occupancies: [{ adults, ...(children.length ? {children} : {}) }], timeout: 30,
    });
    if (!Array.isArray(result.data)) throw new Error('NUITEE_INVALID_MINIMUMS');
    const values = Array.isArray(result.data) ? result.data.map((r: Json) => ({
      hotelId: text(r.hotelId), price: priceOf(r.price), currency: 'USD', offerId: text(r.offerId),
    })).filter((r: Json) => ids.includes(r.hotelId) && r.price !== null && r.price > 0) : [];
    if (values.length) await save(env, key, values, 15 * 60);
    return { values, stale: false, updatedAt: Date.now(), explicitUnavailable: result.explicitUnavailable === true };
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
      // For this single-room request an offer-level total is also valid.
      const rawTotal = retail.total ?? ((type.rates ?? []).length === 1 ? type.offerRetailRate : undefined);
      const total = priceOf(rawTotal);
      if (total === null || total <= 0) continue;
      const policyInfos = Array.isArray(cancellation.cancelPolicyInfos) ? cancellation.cancelPolicyInfos : [];
      const chargeOnArrival = Array.isArray(retail.taxesAndFees)
        ? retail.taxesAndFees.filter((t: Json) => t.included === false).map((t: Json) => ({ amount: priceOf(t.amount ?? t.total), currency: text(t.currency) || 'USD' })) : [];
      offers.push({
        offerId: text(type.offerId || rate.offerId), roomId: String(rate.mappedRoomId ?? ''),
        roomName: plain(rate.name || type.name || 'Room'), mealPlan: plain(rate.boardName || rate.boardType || ''),
        includedMeals: supplierMealInclusions(rate.boardName || rate.boardType),
        price: total, currency: text((Array.isArray(rawTotal) ? rawTotal[0]?.currency : rawTotal?.currency)) || 'USD',
        refundable: text(cancellation.refundableTag) === 'RFN',
        cancellationTag: text(cancellation.refundableTag),
        cancellationDescription: plain(cancellation.description || cancellation.name),
        cancellationDeadlines: policyInfos.map((i: Json) => ({
          until: text(i.cancelTime), amount: priceOf(i.amount ?? i.fee ?? i.penaltyAmount),
        })), chargeOnArrival,
      });
    }
  }
  return offers.filter(o => o.offerId && o.currency.toUpperCase() === "USD").sort((a,b) => a.price - b.price);
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
  const rawChildren = url.searchParams.get("children") ?? "";
  if (rawChildren && !/^\d{1,2}(,\d{1,2})*$/.test(rawChildren)) return error("INVALID_CHILD_AGES");
  const children = rawChildren ? rawChildren.split(",").map(Number) : [];
  if (children.length > 8 || children.some(age => !Number.isInteger(age) || age < 0 || age > 17)) return error("INVALID_CHILD_AGES");
  const paged = url.searchParams.has('offset') || url.searchParams.has('pageSize') || url.searchParams.has('stars') || url.searchParams.has('query') || url.searchParams.has('hotelIds');
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const pageSize = Number(url.searchParams.get('pageSize') ?? 12);
  const stars = Number(url.searchParams.get('stars') ?? 0);
  if (paged && (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isInteger(stars) || stars < 0 || stars > 5)) return error('INVALID_HOTEL_PAGE');
  const query = text(url.searchParams.get('query')).toLowerCase();
  const hotelIds = url.searchParams.has('hotelIds') ? new Set((url.searchParams.get('hotelIds') ?? '').split(',').filter(Boolean)) : null;
  const cachedStatic = url.searchParams.get('ratesOnly') === '1' ? await cachedCatalog(env, city) : null;
  const c = cachedStatic ? {items: cachedStatic.data as Json[], stale: !cachedStatic.fresh} : await catalog(env, city);
  const filtered = c.items.filter(h => (!stars || !Number.isFinite(Number(h.stars)) || Number(h.stars) <= 0 || Number(h.stars) > 5 || Math.round(Number(h.stars)) === stars) &&
    (!hotelIds || hotelIds.has(h.id)) && (!query || `${h.name ?? ''} ${h.address ?? ''}`.toLowerCase().includes(query)));
  const items = paged ? filtered.slice(offset, offset + pageSize) : filtered;
  let rateError: string | null = null, pricesStale = false, pricesUpdatedAt: number | null = null;
  const indexed = new Map<string, Json>();
  const catalogOnly = url.searchParams.get('catalogOnly') === '1';
  const ratesOnly = !catalogOnly && url.searchParams.get('ratesOnly') === '1';
  const explicitUnavailable = new Set<string>();
  if (!catalogOnly) {
    // Legacy full-city requests remain supported; never send an oversized batch.
    for (let start = 0; start < items.length; start += 200) {
      try {
        const batch = items.slice(start, start + 200);
        const scope = `minimum:property:v1:${city}:${inDate}:${outDate}:${adults}${children.length ? `:children:${children.join(",")}` : ""}:UZ:USD:`;
        const missing: Json[] = [];
        if (ratesOnly) {
          // Reuse positive per-property rates across different stars/search/favorite filters.
          const detailKey=(id:string)=>`rates:v2:${id}:${inDate}:${outDate}:${adults}:${children.join(",")}:UZ:USD`;
          const cachedRows=await readMany(env,batch.flatMap(h=>[scope+h.id,detailKey(h.id)]));
          for (const hotel of batch) {
            const entry = cachedRows.get(scope + hotel.id);
            if (entry?.fresh && entry.data?.price > 0) {
              indexed.set(hotel.id, entry.data);
              pricesUpdatedAt = pricesUpdatedAt === null ? entry.updatedAt : Math.min(pricesUpdatedAt, entry.updatedAt);
            } else {
              const detailEntry = cachedRows.get(detailKey(hotel.id));
              const best = detailEntry?.fresh && Array.isArray(detailEntry.data)
                ? detailEntry.data.filter((r: Json) => r.currency === 'USD' && r.price > 0 && r.offerId).sort((a: Json,b: Json) => a.price-b.price)[0] : null;
              if (best && detailEntry) {
                indexed.set(hotel.id, {hotelId:hotel.id,price:best.price,currency:'USD',offerId:best.offerId});
                pricesUpdatedAt = pricesUpdatedAt === null ? detailEntry.updatedAt : Math.min(pricesUpdatedAt, detailEntry.updatedAt);
              } else missing.push(hotel);
            }
          }
        } else missing.push(...batch);
        if (!missing.length) continue;
        const rates = await minimums(env, city, missing, inDate, outDate, adults, children);
        pricesStale ||= rates.stale;
        pricesUpdatedAt = pricesUpdatedAt === null ? rates.updatedAt : Math.min(pricesUpdatedAt, rates.updatedAt);
        rateError ||= rates.rateError ?? null;
        const writes:Array<{key:string;data:unknown;ttl:number}>=[];
        for (const value of rates.values) {
          indexed.set(value.hotelId, value);
          if (ratesOnly && !rates.stale && value.price > 0) {
            // Do not extend the original supplier TTL on cache hits.
            const remaining = Math.floor((rates.updatedAt + 15 * 60 * 1000 - Date.now()) / 1000);
            if (remaining > 0) writes.push({key:scope+value.hotelId,data:value,ttl:remaining});
          }
        }
        await saveMany(env,writes);
        if (rates.explicitUnavailable && missing.length === 1) explicitUnavailable.add(missing[0].id);
        // min-rates can return a partial answer. One bounded batch of the full
        // search endpoint verifies only the missing IDs, not one request per card.
        if (paged && !rates.rateError && !(rates.explicitUnavailable && missing.length === 1)) {
          const unresolved = missing.filter(h => !indexed.has(h.id));
          if (unresolved.length) {
            const full = await provider(env, '/hotels/rates', undefined, {
              hotelIds: unresolved.map(h => h.id), checkin: inDate, checkout: outDate,
              currency: 'USD', guestNationality: 'UZ', occupancies: [{adults, ...(children.length ? {children} : {})}],
              roomMapping: false, maxRatesPerHotel: 1, timeout: 30,
            });
            if (!Array.isArray(full.data)) throw new Error('NUITEE_INVALID_RATES');
            const recovered:Array<{key:string;data:unknown;ttl:number}>=[];
            for (const hotel of unresolved) {
              const best = normalizedRates(full, hotel.id)[0];
              if (best) {
                const value = {hotelId:hotel.id, price:best.price, currency:'USD', offerId:best.offerId};
                indexed.set(hotel.id,value);
                recovered.push({key:scope+hotel.id,data:value,ttl:15*60});
              } else if (full.explicitUnavailable && unresolved.length === 1) explicitUnavailable.add(hotel.id);
            }
            await saveMany(env,recovered);
          }
        }
      } catch (e) { rateError ||= e instanceof Error ? e.message : 'RATES_UNAVAILABLE'; }
    }
  }
  return output({ ok: true, provider: 'nuitee', sandbox: isSandbox(env),
    city, checkin: inDate, checkout: outDate, adults, priceType: 'room_total', currency: 'USD',
    hotelCatalogStale: c.stale, pricesStale, pricesUpdatedAt, rateError,
    total: filtered.length, nextOffset: paged && offset + items.length < filtered.length ? offset + items.length : null,
    hotels: items.map(h => ({ ...(ratesOnly ? {id:h.id} : h), minimumRate: indexed.get(h.id) ?? null,
      rateStatus: indexed.has(h.id) ? (pricesStale ? 'cached' : 'available')
        : rateError ? 'provider_error' : catalogOnly ? 'not_requested' : explicitUnavailable.has(h.id) ? 'no_availability' : 'not_returned' })),
  });
}
async function isListedHotel(env: Env, id: string): Promise<boolean> {
  for (const city of ['makkah', 'madinah']) {
    const c = await cachedCatalog(env, city);
    if (Array.isArray(c?.data) && c.data.some((h: Json) => h.id === id)) return true;
  }
  return false;
}

async function detail(url: URL, env: Env): Promise<Response> {
  const id = text(url.searchParams.get('hotelId'));
  const language = hotelLanguage(url.searchParams.get('language'));
  if (!/^lp[a-zA-Z0-9]{1,50}$/.test(id)) return error('INVALID_HOTEL_ID');
  if (!await isListedHotel(env, id)) return error('HOTEL_NOT_IN_CATALOG', 404);
  const cacheKey = language === 'en' ? `detail:v1:${id}` : `detail:v5:${id}:${language}`;
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
      h = localizeKnownAmenities(h, language === 'uz-cyrl' ? 'uz' : language);
      if (language === 'uz-cyrl') {
        // Native provider Uzbek is Latin. Transform text only, not identifiers/URLs.
        h.description = uzbekCyrillic(h.description);
        h.importantInformation = uzbekCyrillic(h.importantInformation);
        h.amenities = h.amenities.map(uzbekCyrillic);
        h.policies = h.policies.map((p:Json)=>({...p,title:uzbekCyrillic(p.title),description:uzbekCyrillic(p.description)}));
        h.rooms = h.rooms.map((r:Json)=>({...r,name:uzbekCyrillic(r.name),description:uzbekCyrillic(r.description),amenities:r.amenities.map(uzbekCyrillic)}));
      }
    }
    h = localizeKnownAmenities(h, language);
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
      const response = await detail(englishURL,env);
      const body = await response.json() as Json;
      if (body.hotel) body.hotel = localizeKnownAmenities(body.hotel,language);
      return output(body, response.status);
    }
    throw e;
  }
}
async function localizedRates(env: Env, offers: Json[], language: string, key: string): Promise<Json[]> {
  offers = offers.map(rate=>({...rate,includedMeals:supplierMealInclusions(rate.mealPlan)}));
  const fallback = () => localizeKnownAmenities({rates:offers},language).rates;
  if (language === 'en' || !env.HOTEL_TRANSLATION_API_KEY) return fallback();
  const cached = await read(env, `${key}:text:v2:${language}`);
  // Translation cache holds strings only; never restore stale prices/offer IDs.
  const signature = JSON.stringify(offers.map(r=>[r.roomName,r.mealPlan,r.cancellationDescription]));
  if (cached?.fresh && cached.data.signature === signature) {
    return localizeKnownAmenities({rates:offers.map((rate,i)=>({...rate,...cached.data.text[i]}))},language).rates;
  }
  try {
    const localized = (await translateHotelText(env,{rates:offers},language)).rates;
    const text = localized.map((rate:Json)=>({roomName:rate.roomName,mealPlan:rate.mealPlan,cancellationDescription:rate.cancellationDescription}));
    await save(env,`${key}:text:v2:${language}`,{signature,text},7 * DAY);
    return localizeKnownAmenities({rates:offers.map((rate,i)=>({...rate,...text[i]}))},language).rates;
  } catch { return fallback(); }
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
  if (cached?.fresh && Array.isArray(cached.data) && cached.data.length && body.forceRefresh !== true) return output({ ok: true, sandbox: isSandbox(env), checkin, checkout, adults, rates: await localizedRates(env,cached.data,language,key), cached: true, availabilityConfirmed: true });
  const response = await provider(env, '/hotels/rates', undefined, {
    hotelIds: [id], checkin, checkout, occupancies: [{ adults, children }],
    currency: 'USD', guestNationality: 'UZ', roomMapping: true,
    maxRatesPerHotel: 50, timeout: 30,
  });
  const offers = normalizedRates(response, id);
  if (!Array.isArray(response.data)) throw new Error('NUITEE_INVALID_RATES');
  // Never cache an empty or malformed response as a successful room search.
  if (offers.length) {
    await save(env, key, offers, 10 * 60);
    if (isSandbox(env)) {
      // A sandbox price is used only for an internal request. Preserve the actual
      // observed selection across fresh searches that rotate the supplier offer IDs.
      const historical = await read(env, `${key}:sandbox-quote:v1`);
      const cutoff = Date.now() - DAY * 1000;
      const values = new Map<string, Json>();
      for (const row of (Array.isArray(historical?.data) ? historical!.data : [])) {
        if (Number(row.observedAt) >= cutoff) values.set(JSON.stringify([row.offerId,row.roomId]), row);
      }
      // Preserve an existing cached offer too, including caches created before this deployment.
      if (cached && Date.now()-cached.updatedAt < DAY*1000 && Array.isArray(cached.data)) {
        for (const row of cached.data) {
          const id = JSON.stringify([row.offerId,row.roomId]);
          if (!values.has(id)) values.set(id,{...row,observedAt:cached.updatedAt});
        }
      }
      for (const row of offers) values.set(JSON.stringify([row.offerId,row.roomId]), {...row,observedAt:Date.now()});
      await save(env, `${key}:sandbox-quote:v1`, [...values.values()].sort((a,b)=>b.observedAt-a.observedAt).slice(0,500), DAY);
    }
  }
  return output({ ok: true, sandbox: isSandbox(env), checkin, checkout, adults,
    rates: await localizedRates(env,offers,language,key), cached: false,
    availabilityConfirmed: offers.length > 0 || response.explicitUnavailable === true });
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
/** Reviews are fetched only for an opened hotel, in small locale-specific pages. */
async function reviews(url: URL, env: Env): Promise<Response> {
  const id = text(url.searchParams.get('hotelId'));
  if (!/^lp[a-zA-Z0-9]{1,50}$/.test(id)) return error('INVALID_HOTEL_ID');
  const offset = Number(url.searchParams.get('offset') ?? 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 5000) return error('INVALID_OFFSET');
  if (!await isListedHotel(env,id)) return error('HOTEL_NOT_IN_CATALOG',404);
  const language = hotelLanguage(url.searchParams.get('language'));
  const key = `reviews:v1:${id}:${language}:${offset}`;
  const cached = await read(env,key);
  if (cached?.fresh) return output({...cached.data,cached:true});
  try {
    const params = new URLSearchParams({hotelId:id,limit:'10',offset:String(offset)});
    if (language !== 'en') params.set('language',language === 'uz-cyrl' ? 'uz' : language);
    const raw = await provider(env,'/data/reviews',params);
    if (!Array.isArray(raw.data)) throw new Error('NUITEE_REVIEWS_INVALID');
    const items = raw.data.slice(0,10).map((item:Json,index:number)=>{
      const convert = (value:unknown) => language === 'uz-cyrl' ? uzbekCyrillic(plain(value)) : plain(value);
      const score = num(item.averageScore);
      return {id:String(item.reviewId ?? `${id}:${offset+index}`),name:plain(item.name),country:plain(item.country),
        date:plain(item.date),rating:score !== null && score <= 10 ? score : null,
        headline:convert(item.headline),pros:convert(item.pros),cons:convert(item.cons),
        source:plain(item.source),language:text(item.language)};
    });
    const total = num(raw.total);
    const nextOffset = offset + raw.data.length;
    const body = {ok:true,reviews:items,total,nextOffset:raw.data.length >= 10 && (total === null || nextOffset < total) && nextOffset <= 5000 ? nextOffset : null,stale:false};
    await save(env,key,body,DAY);
    return output(body);
  } catch(e) {
    if (cached) return output({...cached.data,stale:true});
    throw e;
  }
}

export async function handleNuiteeHotelRequest(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.HOTELS_DB) return error('HOTELS_DB_NOT_CONFIGURED', 503);
  try {
    await ensure(env);
    if (url.pathname === '/api/package/nuitee/hotels' && request.method === 'GET') return await coalesced(env, url.pathname + url.search, () => listing(url, env));
    if (url.pathname === '/api/package/nuitee/hotel' && request.method === 'GET') return await coalesced(env, url.pathname + url.search, () => detail(url, env));
    if (url.pathname === '/api/package/nuitee/reviews' && request.method === 'GET') return await coalesced(env,url.pathname + url.search,()=>reviews(url,env));
    if (url.pathname === '/api/package/nuitee/rates' && request.method === 'POST') {
      // Coalesce exact room searches from the catalogue recovery and hotel detail.
      // Force-refresh and language are deliberately separate response identities.
      const body = await request.clone().json().catch(() => null) as Json | null;
      if (!body || typeof body.hotelId !== 'string' || !/^lp[a-zA-Z0-9]{1,50}$/.test(body.hotelId)) return await rates(request, env);
      const key = JSON.stringify([body.hotelId, body.checkin, body.checkout, body.adults, body.children ?? [], hotelLanguage(body.language), body.forceRefresh === true]);
      if (key.length > 1024) return await rates(request, env);
      return await coalesced(env, 'room-rates:' + key, () => rates(request, env));
    }
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
      const snapshotVersion=await read(env,`catalog:v3:${city}`);
      // Warm a bounded number of missing photo/details snapshots per cron run.
      // Persist URLs/gallery metadata in D1; image bytes use the iOS disk cache.
      let warmed = 0;
      const snapshots=await readMany(env,result.items.map(h=>`detail:v1:${h.id}`));
      for (const hotel of result.items) {
        const snapshot = snapshots.get(`detail:v1:${hotel.id}`);
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
      if (!result.stale && snapshotVersion) {
        await env.HOTELS_DB.prepare('UPDATE nuitee_hotel_cache SET payload = ?1 WHERE key = ?2 AND updated_at = ?3')
          .bind(JSON.stringify(result.items), `catalog:v3:${city}`, snapshotVersion.updatedAt).run();
      }
      if (refreshPrices && result.items.length) {
        // Warm a rotating segment, not the same first 12 hotels. On-demand pricing
        // always covers the full requested city for the exact dates and guests.
        const cursorKey=`catalog:warm-cursor:v3:${city}`;
        const cursor=await read(env,cursorKey);
        const start=Math.max(0,Number(cursor?.data)||0)%result.items.length;
        const batch=result.items.slice(start,start+40);
        const url=new URL('https://iumrah.internal/api/package/nuitee/hotels');
        url.search=new URLSearchParams({city,checkin,checkout,adults:'2',hotelIds:batch.map(h=>h.id).join(','),pageSize:String(batch.length),ratesOnly:'1'}).toString();
        const response=await listing(url,env);const payload=await response.json() as Json;
        if(!payload.rateError)await save(env,cursorKey,(start+batch.length)%result.items.length,365*DAY);
      }
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
  meals?: HotelMealChoices;
  includedMeals?: HotelMealChoices;
  tariffSource?: "sandbox" | "production";
  stars?: number;
  supplierReservationConfirmed?: boolean;
};
export function packageTierForStars(stars: number): "economy" | "standard" | "luxury" {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new Error("HOTEL_STARS_REQUIRED");
  return stars <= 2 ? "economy" : stars <= 4 ? "standard" : "luxury";
}

/** Prices/stars are read from supplier and server catalogue, never accepted from iOS. */
export async function resolveNuiteePackageHotels(env: Env, values: NuiteePackageRoom[], travelers: {adults:number;children:number;infants:number;rooms:number}, includeMadinah: boolean, estimateSelectedCities = false) {
  const expectedCities = includeMadinah ? ["makkah", "madinah"] : ["makkah"];
  const cities = estimateSelectedCities && Array.isArray(values) ? expectedCities.filter(city=>values.some(room=>room?.city===city)) : expectedCities;
  if (!Array.isArray(values) || !cities.length || values.length !== travelers.rooms * cities.length) throw new Error("NUITEE_ROOM_SELECTION_INCOMPLETE");
  await ensure(env);
  const result: Record<string, import("./pricing").PricingHotelInput> = {};
  const selected: NuiteePackageRoom[] = [];
  let highestStars = 0;
  const mealComponents: Array<{code:string;label:string;supplierCostUsd:number}> = [];
  const verifiedOffers = new Map<string, Json>();
  let partyAges: string | undefined;
  for (const city of cities) {
    const rooms = values.filter(room => room?.city === city);
    if (rooms.length !== travelers.rooms || new Set(rooms.map(x => x.id)).size !== rooms.length) throw new Error("NUITEE_ROOM_SELECTION_INCOMPLETE");
    if (new Set(rooms.map(x => x.hotelId)).size !== 1 || new Set(rooms.map(x => x.checkin + ":" + x.checkout)).size !== 1) throw new Error("NUITEE_CITY_SELECTION_MISMATCH");
    if (rooms.reduce((n,r)=>n+Number(r.adults),0) !== travelers.adults || rooms.reduce((n,r)=>n+(Array.isArray(r.children)?r.children.length:0),0) !== travelers.children+travelers.infants) throw new Error("NUITEE_OCCUPANCY_MISMATCH");
    const ages = rooms.flatMap(room => Array.isArray(room.children) ? room.children : []);
    if (ages.some(age => !Number.isInteger(age) || age < 0 || age > 17) ||
        ages.filter(age => age >= 2).length !== travelers.children || ages.filter(age => age < 2).length !== travelers.infants) throw new Error("NUITEE_OCCUPANCY_MISMATCH");
    const ageKey = [...ages].sort((a,b) => a-b).join(",");
    if (partyAges !== undefined && partyAges !== ageKey) throw new Error("NUITEE_OCCUPANCY_MISMATCH");
    partyAges = ageKey;
    const catalog = await cachedCatalog(env, city);
    const hotel = Array.isArray(catalog?.data) ? catalog!.data.find((h:Json)=>h.id===rooms[0].hotelId) : null;
    if (!hotel) throw new Error("HOTEL_NOT_IN_CATALOG");
    const rawStars = Math.round(Number(hotel.stars));
    const stars = Number.isInteger(rawStars) && rawStars >= 1 && rawStars <= 5 ? rawStars : 0;
    // Unknown official stars remain unknown; use Standard only as internal pricing policy.
    const commercialStars = stars || 3;
    highestStars = Math.max(highestStars, commercialStars);
    let total = 0;
    for (const room of rooms) {
      if (!room.offerId || typeof room.offerId !== "string" || room.offerId.length > 20000 || typeof room.roomId !== "string" || !Number.isInteger(room.adults) || room.adults < 1 || room.adults > 8 || !Array.isArray(room.children) || room.children.some(age=>!Number.isInteger(age) || age<0 || age>17) || !dateParam(room.checkin) || !dateParam(room.checkout) || !stayDates(room.checkin,room.checkout)) throw new Error("NUITEE_INVALID_SELECTED_RATE");
      // Bind an opaque offer to server-observed hotel/dates/occupancy before
      // prebooking it. Re-searching creates new offer IDs and is not validation.
      const anchorKey = `rates:v2:${room.hotelId}:${room.checkin}:${room.checkout}:${room.adults}:${room.children.join(",")}:UZ:USD`;
      const anchor = await read(env, anchorKey);
      let original = Array.isArray(anchor?.data) && (anchor?.fresh || (isSandbox(env) && Date.now()-anchor.updatedAt < DAY*1000)) ? anchor!.data.find((r:Json)=>r.offerId===room.offerId && r.roomId===room.roomId) : null;
      if (!original && isSandbox(env)) {
        const historical = await read(env, `${anchorKey}:sandbox-quote:v1`);
        if (historical?.fresh && Array.isArray(historical.data)) original = historical.data.find((r:Json)=>r.offerId===room.offerId && r.roomId===room.roomId && Number(r.observedAt)>=Date.now()-DAY*1000);
      }
      if (!original) throw new Error("NUITEE_SELECTED_RATE_EXPIRED");
      const verifiedKey = JSON.stringify([anchorKey, room.offerId, room.roomId]);
      let current = verifiedOffers.get(verifiedKey);
      if (!current) {
        // Internal iumrah bookings may use a server-observed sandbox tariff.
        // It is not a supplier reservation and does not call the supplier book API.
        current = isSandbox(env) ? {...original, hotelId:room.hotelId} :
          (await provider(env, '/rates/prebook', undefined, {offerId:room.offerId,usePaymentSdk:false})).data;
        if (!current || (!isSandbox(env) && !current.prebookId) || current.hotelId!==room.hotelId || current.currency!=="USD" || !Number.isFinite(current.price) || current.price<=0) throw new Error("NUITEE_RATE_RECHECK_FAILED");
        if (current.cancellationChanged || current.boardChanged) throw new Error("NUITEE_RATE_TERMS_CHANGED");
        verifiedOffers.set(verifiedKey,current);
      }
      total += current.price;
      const included = supplierMealInclusions(original.mealPlan);
      included.breakfast ||= stars >= 4;
      const choices: HotelMealChoices = {
        breakfast: included.breakfast || room.meals?.breakfast === true,
        lunch: city === "makkah" && (included.lunch || room.meals?.lunch === true),
        dinner: included.dinner || room.meals?.dinner === true,
      };
      const nights = Math.round((Date.parse(room.checkout)-Date.parse(room.checkin))/86400000);
      const people = room.adults + room.children.filter(age=>age>=2).length;
      for (const meal of ["breakfast","lunch","dinner"] as const) {
        if (!choices[meal]) continue;
        mealComponents.push({code:`meal_${city}_${room.id}_${meal}`,label:`${city === "makkah" ? "Мекка" : "Медина"} · ${room.id} · ${{breakfast:"Завтрак",lunch:"Обед",dinner:"Ужин"}[meal]}${included[meal] ? " · включено" : ""}`,
          supplierCostUsd:included[meal] ? 0 : hotelMealUnit(packageTierForStars(commercialStars))*people*nights});
      }
      selected.push({meals:choices,includedMeals:included,stars,tariffSource:isSandbox(env)?"sandbox":"production",supplierReservationConfirmed:false,id:room.id,city:room.city,hotelId:room.hotelId,offerId:room.offerId,roomId:room.roomId,checkin:room.checkin,checkout:room.checkout,adults:room.adults,children:[...room.children],prebookId:current.prebookId});
    }
    const nights = Math.round((Date.parse(rooms[0].checkout)-Date.parse(rooms[0].checkin))/86400000);
    result[city] = {hotelId:rooms[0].hotelId, roomId:rooms[0].roomId, amountUsd:total/nights/travelers.rooms, unit:"perRoomNight", nights, pricingMode:isSandbox(env)?"nuiteeSandbox":"nuiteeRevalidated"};
  }
  return {makkah:result.makkah, madinah:result.madinah ?? null, tier:packageTierForStars(highestStars), rooms:selected, mealComponents, supplierMode:isSandbox(env)?"sandbox" as const:"production" as const, bookingAllowed:true};
}

/** Authenticated staff diagnostics. Counts reflect the supplier pages actually read, not an invented global total. */
export async function nuiteeCatalogCoverage(env:Env,refresh=false):Promise<Response>{
  if(!env.HOTELS_DB)return error('HOTELS_DB_NOT_CONFIGURED',503);
  await ensure(env);
  const cities=[];
  for(const city of ['makkah','madinah'] as const){
    let refreshFailed=false;
    if(refresh){try{const result=await catalog(env,city,true);refreshFailed=result.stale;}catch{refreshFailed=true;}}
    const snapshot=await cachedCatalog(env,city);
    const coverage=await read(env,`catalog:coverage:v3:${city}`);
    const attempt=await read(env,`catalog:attempt:v3:${city}`);
    const items=Array.isArray(snapshot?.data)?snapshot.data as Json[]:[];
    const data=coverage?.data;
    const latestFailed=refreshFailed || Number(attempt?.data?.attemptedAt??0)>Number(data?.syncedAt??0);
    const {checkin,checkout}=defaultDates();
    const scope=`minimum:property:v1:${city}:${checkin}:${checkout}:2:UZ:USD:`;
    const entries=await readMany(env,items.map(h=>scope+h.id));
    const priced=[...entries.values()].filter(v=>v.fresh&&Number(v.data?.price)>0).length;
    cities.push({city,stored:items.length,supplierUnique:data?.supplierUnique??null,unknownStars:items.filter(h=>!h.stars||h.stars>5).length,
      complete:!!data?.complete&&!latestFailed&&!!snapshot?.fresh,stale:!snapshot?.fresh||latestFailed,syncedAt:data?.syncedAt??null,
      lastError:latestFailed?attempt?.data?.code??'NUITEE_CATALOG_UNAVAILABLE':null,priceCheckin:checkin,priceCheckout:checkout,priced,priceAdults:2,sources:data?.sources??[]});
  }
  return output({ok:true,sandbox:isSandbox(env),cities});
}
