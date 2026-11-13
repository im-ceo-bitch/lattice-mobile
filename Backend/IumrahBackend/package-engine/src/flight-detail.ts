import type { Env } from './env';

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : undefined;
const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const canonical = (value: unknown) => (text(value) ?? '').toUpperCase().replace(/[\s-]/g, '');
const response = (detail: unknown = null, status = 200, reason?: string) => new Response(JSON.stringify({ detail, ...(reason ? { reason } : {}) }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const clock = (value: unknown) => text(obj(value).local);
const utc = (value: unknown) => text(obj(value).utc);

// Never select a different flight solely because a number or date matches.
export function matchingFlightDetail(payload: unknown, flight: string, day: string, origin: string, destination: string, localTime: string, now = Date.now()) {
  if (!Array.isArray(payload)) return null;
  const matches = payload.map(obj).filter(row => {
    const dep = obj(row.departure), arr = obj(row.arrival);
    const scheduled = clock(dep.scheduledTime);
    return canonical(row.number) === flight && obj(dep.airport).iata === origin && obj(arr.airport).iata === destination && scheduled?.slice(0, 10) === day;
  });
  // Multiple same-number flights on the same route/day are ambiguous unless
  // the scheduled local minute identifies exactly one of them.
  const exact = matches.filter(row => clock(obj(row.departure).scheduledTime)?.slice(11, 16) === localTime);
  const selected = exact.length === 1 ? exact[0] : exact.length === 0 && matches.length === 1 && !localTime ? matches[0] : undefined;
  if (!selected) return null;
  const dep = obj(selected.departure), arr = obj(selected.arrival), aircraft = obj(selected.aircraft), location = obj(selected.location);
  const status = text(selected.status);
  const reportedAt = text(location.reportedAtUtc);
  const age = reportedAt ? now - Date.parse(reportedAt) : Infinity;
  const lat = number(location.lat), lon = number(location.lon);
  const live = ['EnRoute', 'Approaching', 'Departed'].includes(status ?? '') && age >= -60_000 && age <= 15 * 60_000 && lat !== undefined && Math.abs(lat) <= 90 && lon !== undefined && Math.abs(lon) <= 180;
  return {
    status, updatedAt: text(selected.lastUpdatedUtc),
    departureTerminal: text(dep.terminal), departureGate: text(dep.gate),
    arrivalTerminal: text(arr.terminal), arrivalGate: text(arr.gate), baggageBelt: text(arr.baggageBelt),
    departureScheduled: clock(dep.scheduledTime), arrivalScheduled: clock(arr.scheduledTime),
    departureRevised: clock(dep.revisedTime), arrivalRevised: clock(arr.revisedTime),
    departureActual: clock(dep.runwayTime), arrivalActual: clock(arr.runwayTime),
    arrivalEstimatedUTC: utc(arr.revisedTime),
    aircraft: text(aircraft.model), registration: text(aircraft.reg),
    position: live ? { latitude: lat, longitude: lon, reportedAt, altitudeFeet: number(obj(location.altitude).feet), speedKmh: number(obj(location.groundSpeed).kmPerHour) } : undefined,
  };
}

// Primary keeps its existing D1 daily counter. Backup has an independent counter.
// Never expose or log credentials; duplicate keys cannot double the budget.
const DEFAULT_DAILY_LIMIT = 5;
type Credential = { slot: 'primary' | 'backup'; key: string; limit: number };
function credentials(env: Env): Credential[] {
  const make = (slot: Credential['slot'], raw: string | undefined, cap: string | undefined): Credential | undefined => {
    const key = raw?.trim(), limit = Number(cap ?? DEFAULT_DAILY_LIMIT);
    return key && Number.isInteger(limit) && limit >= 1 && limit <= 100000 ? { slot, key, limit } : undefined;
  };
  const primary = make('primary', env.AERODATABOX_RAPIDAPI_KEY, env.AERODATABOX_DAILY_REQUEST_LIMIT);
  const backup = make('backup', env.AERODATABOX_RAPIDAPI_KEY_BACKUP, env.AERODATABOX_BACKUP_DAILY_REQUEST_LIMIT);
  return [primary, backup && backup.key !== env.AERODATABOX_RAPIDAPI_KEY?.trim() ? backup : undefined].filter((x): x is Credential => Boolean(x));
}
export function aeroDataBoxConfiguration(env: Env) {
  const configured = env.HOTELS_DB ? credentials(env) : [];
  return { aerodataBoxConfigured: configured.length > 0, aerodataBoxPrimaryConfigured: configured.some(c => c.slot === 'primary'), aerodataBoxBackupConfigured: configured.some(c => c.slot === 'backup') };
}
const quotaHeaders = ['x-ratelimit-requests', 'x-rate-limit-rapid-free-plans-hard-limit'];
const MAX_COOLDOWN = 32 * 86400;
function positiveSeconds(value: string | null, now: number): number {
  if (!value?.trim()) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_COOLDOWN, Math.ceil(n > 1e9 ? Math.max(0, n - now / 1000) : n));
}
function providerCooldown(result: Response, now: number): number {
  let seconds = 0;
  for (const prefix of quotaHeaders) {
    const remaining = result.headers.get(`${prefix}-remaining`);
    if (remaining?.trim() && Number(remaining) === 0) {
      // Missing reset: conservative day for daily/monthly allowance, never immediately retry.
      seconds = Math.max(seconds, positiveSeconds(result.headers.get(`${prefix}-reset`), now) || (prefix.includes('hard-limit') ? 30 * 86400 : 86400));
    }
  }
  if (result.status === 429) {
    const retry = result.headers.get('retry-after');
    const dateSeconds = retry && !/^\d+$/.test(retry) ? Math.max(0, Math.ceil((Date.parse(retry) - now) / 1000)) : 0;
    seconds = Math.max(seconds, positiveSeconds(retry, now), Math.min(MAX_COOLDOWN, dateSeconds || 0), positiveSeconds(result.headers.get('x-ratelimit-reset'), now)) || 3600;
  }
  if ([401, 403, 402].includes(result.status)) seconds = Math.max(seconds, 3600);
  return seconds;
}

// The single Worker shares one quota ledger across detail, admin verification and flight refresh.
export async function requestAeroDataBox(env: Env, endpoint: URL | string): Promise<{ payload?: unknown; reason?: string; status?: number }> {
  const upstream = new URL(endpoint);
  if (upstream.protocol !== 'https:' || upstream.hostname !== 'aerodatabox.p.rapidapi.com' || upstream.port || upstream.username || upstream.password || !/^\/flights\/number\/[A-Z0-9]+\/\d{4}-\d{2}-\d{2}$/.test(upstream.pathname)) return {reason: 'invalid_request', status: 400};
  const keys = credentials(env), db = env.HOTELS_DB;
  if (!keys.length || !db) return { reason: "not_configured" };
  try {
    await db.prepare('CREATE TABLE IF NOT EXISTS aerodatabox_daily_usage (day TEXT PRIMARY KEY, requests INTEGER NOT NULL)').run();
    await db.prepare('CREATE TABLE IF NOT EXISTS aerodatabox_provider_cooldown (slot TEXT PRIMARY KEY, until_ms INTEGER NOT NULL)').run();
    let reason = 'quota_exhausted';
    const deadline = Date.now() + 12_000;
    for (const credential of keys) {
      const now = Date.now(), utcDay = new Date(now).toISOString().slice(0,10);
      if (deadline - now < 500) break;
      const usageKey = credential.slot === 'primary' ? utcDay : `${utcDay}:backup`;
      const reserved = await db.prepare(`INSERT INTO aerodatabox_daily_usage(day, requests)
        SELECT ?1, 1 WHERE NOT EXISTS (SELECT 1 FROM aerodatabox_provider_cooldown WHERE slot = ?3 AND until_ms > ?4)
        ON CONFLICT(day) DO UPDATE SET requests = requests + 1 WHERE requests < ?2 RETURNING requests`)
        .bind(usageKey, credential.limit, credential.slot, now).first<{requests: number}>();
      if (!reserved) continue;
      const result = await fetch(upstream, { headers: { 'X-RapidAPI-Key': credential.key, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com', Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.min(8000, deadline - Date.now()))) });
      const seconds = providerCooldown(result, Date.now());
      if (seconds > 0) {
        await db.prepare(`INSERT INTO aerodatabox_provider_cooldown(slot, until_ms) VALUES (?1, ?2)
          ON CONFLICT(slot) DO UPDATE SET until_ms = MAX(until_ms, excluded.until_ms)`)
          .bind(credential.slot, Date.now() + seconds * 1000).run();
      }
      if (result.status === 204 || result.status === 404) return { reason: "no_match", status: result.status };
      if (!result.ok) {
        console.warn("AeroDataBox upstream status", credential.slot, result.status);
        reason = result.status === 429 || result.status === 402 ? 'provider_quota' : 'provider_error';
        if ([401, 403, 402, 429].includes(result.status)) continue;
        // No double spend on malformed requests, missing flights or provider outages.
        return { reason, status: result.status };
      }
      return { payload: await result.json() };
    }
    return { reason };
  } catch { console.warn("AeroDataBox detail request failed"); return { reason: "request_failed" }; }
}

// No cron or workflow changes. On-demand tables; atomic reservation bounds
// simultaneous requests. A provider cooldown persists across Worker instances.
export async function flightDetailResponse(url: URL, env: Env): Promise<Response> {
  const flight = canonical(url.searchParams.get('number'));
  const day = url.searchParams.get('date') ?? '', origin = canonical(url.searchParams.get('origin')), destination = canonical(url.searchParams.get('destination'));
  const localTime = url.searchParams.get('time') ?? '';
  const parsed = Date.parse(day + 'T00:00:00Z');
  if (!/^[A-Z0-9]{2}[0-9]{1,4}[A-Z]?$/.test(flight) || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0,10) !== day || !/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || origin === destination || (localTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime))) return response(null, 400, "invalid_request");
  const upstream = new URL(`https://aerodatabox.p.rapidapi.com/flights/number/${flight}/${day}`);
  upstream.searchParams.set('dateLocalRole', 'Departure');
  upstream.searchParams.set('withLocation', 'true');
  const result = await requestAeroDataBox(env, upstream);
  if (result.reason) return response(null, 200, result.reason);
  const detail = matchingFlightDetail(result.payload, flight, day, origin, destination, localTime);
  return detail ? response(detail) : response(null, 200, "no_match");
}
