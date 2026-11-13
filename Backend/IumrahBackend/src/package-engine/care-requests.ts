import type { D1Like } from "./d1";
import type { Env } from "./env";

type CareRequestPayload = {
  locale?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  phone?: unknown;
  telegram?: unknown;
  accountID?: unknown;
  originCode?: unknown;
  timingMode?: unknown;
  preferredMonth?: unknown;
  flexibleWindowDays?: unknown;
  exactStartDate?: unknown;
  exactEndDate?: unknown;
  adults?: unknown;
  children?: unknown;
  infants?: unknown;
  rooms?: unknown;
  scope?: unknown;
  firstSaudiCity?: unknown;
  priority?: unknown;
  hotelClass?: unknown;
  transferPreference?: unknown;
  directFlightsPreferred?: unknown;
  checkedBaggagePreferred?: unknown;
  includeZiyarat?: unknown;
  includeESIM?: unknown;
  guidePreference?: unknown;
  budgetUSD?: unknown;
  notes?: unknown;
  configuration?: unknown;
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function clean(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function integer(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function bool(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

async function optionalVerifiedAccountID(request: Request, db: D1Like) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (!token || token.length > 256) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const row = await db.prepare(
    `SELECT s.pilgrim_id
     FROM iumrah_account_sessions s
     WHERE s.token_hash=?1 AND s.revoked_at IS NULL AND s.expires_at>?2
     LIMIT 1`,
  ).bind(tokenHash, new Date().toISOString()).first<{ pilgrim_id: number | string }>();
  if (!row) return null;
  const id = Number(row.pilgrim_id);
  return Number.isFinite(id) && id > 0 ? String(Math.round(id)).padStart(8, "0") : null;
}

function requestID(now: Date) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  const suffix = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `CARE-${now.getUTCFullYear()}-${suffix}`;
}

let schemaReady = false;
async function ensureSchema(db: D1Like) {
  if (schemaReady) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS iumrah_care_package_requests (
    id TEXT PRIMARY KEY NOT NULL,
    request_type TEXT NOT NULL DEFAULT 'CARE_BUILD',
    status TEXT NOT NULL DEFAULT 'CARE_REQUEST',
    source TEXT NOT NULL DEFAULT 'ios',
    locale TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    contact_phone TEXT NOT NULL,
    contact_telegram TEXT,
    account_id TEXT,
    origin_code TEXT NOT NULL,
    timing_mode TEXT NOT NULL,
    preferred_month TEXT,
    flexible_window_days INTEGER,
    exact_start_date TEXT,
    exact_end_date TEXT,
    adults INTEGER NOT NULL,
    children INTEGER NOT NULL,
    infants INTEGER NOT NULL,
    rooms INTEGER NOT NULL,
    scope TEXT NOT NULL,
    first_saudi_city TEXT,
    priority TEXT NOT NULL,
    hotel_class INTEGER NOT NULL,
    transfer_preference TEXT NOT NULL,
    direct_flights_preferred INTEGER NOT NULL DEFAULT 0,
    checked_baggage_preferred INTEGER NOT NULL DEFAULT 1,
    include_ziyarat INTEGER NOT NULL DEFAULT 1,
    include_esim INTEGER NOT NULL DEFAULT 1,
    guide_preference TEXT NOT NULL DEFAULT 'voice',
    budget_usd INTEGER,
    notes TEXT,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    response_due_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_iumrah_care_requests_status_due ON iumrah_care_package_requests(status,response_due_at)",
  ).run();
  schemaReady = true;
}

export async function createCarePackageRequest(request: Request, env: Env): Promise<Response> {
  if (!env.HOTELS_DB) return json({ ok: false, error: "HOTELS_DB_NOT_CONFIGURED" }, 503);

  let body: CareRequestPayload;
  try { body = await request.json() as CareRequestPayload; }
  catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }

  const firstName = clean(body.firstName, 80);
  const lastName = clean(body.lastName, 80);
  const phone = clean(body.phone, 80);
  const originCode = clean(body.originCode, 8).toUpperCase();
  const timingMode = clean(body.timingMode, 40);
  const exactStartDate = clean(body.exactStartDate, 20) || null;
  const exactEndDate = clean(body.exactEndDate, 20) || null;
  const preferredMonth = clean(body.preferredMonth, 20) || null;

  if (!firstName || !phone || !/^[A-Z]{3}$/.test(originCode)) {
    return json({ ok: false, error: "CARE_REQUEST_CONTACT_OR_ORIGIN_REQUIRED" }, 400);
  }
  if (!["flexible_month", "exact_dates"].includes(timingMode)) {
    return json({ ok: false, error: "CARE_REQUEST_TIMING_INVALID" }, 400);
  }
  if (timingMode === "exact_dates") {
    if (!exactStartDate || !exactEndDate || !/^\d{4}-\d{2}-\d{2}$/.test(exactStartDate) || !/^\d{4}-\d{2}-\d{2}$/.test(exactEndDate)) {
      return json({ ok: false, error: "CARE_REQUEST_DATES_REQUIRED" }, 400);
    }
    if (exactEndDate <= exactStartDate) {
      return json({ ok: false, error: "CARE_REQUEST_DATE_RANGE_INVALID" }, 400);
    }
  }
  if (timingMode === "flexible_month" && (!preferredMonth || !/^\d{4}-\d{2}$/.test(preferredMonth))) {
    return json({ ok: false, error: "CARE_REQUEST_MONTH_REQUIRED" }, 400);
  }

  const normalized = {
    locale: clean(body.locale, 16) || "ru",
    firstName,
    lastName,
    phone,
    telegram: clean(body.telegram, 120),
    accountID: null as string | null,
    originCode,
    timingMode,
    preferredMonth,
    flexibleWindowDays: timingMode === "flexible_month" ? integer(body.flexibleWindowDays, 7, 0, 31) : null,
    exactStartDate,
    exactEndDate,
    adults: integer(body.adults, 1, 1, 20),
    children: integer(body.children, 0, 0, 20),
    infants: integer(body.infants, 0, 0, 10),
    rooms: integer(body.rooms, 1, 1, 10),
    scope: clean(body.scope, 40) || "makkahAndMadinah",
    firstSaudiCity: clean(body.firstSaudiCity, 20) || null,
    priority: clean(body.priority, 40) || "balanced",
    hotelClass: integer(body.hotelClass, 4, 3, 5),
    transferPreference: clean(body.transferPreference, 40) || "comfortable",
    directFlightsPreferred: bool(body.directFlightsPreferred),
    checkedBaggagePreferred: bool(body.checkedBaggagePreferred, true),
    includeZiyarat: bool(body.includeZiyarat, true),
    includeESIM: bool(body.includeESIM, true),
    guidePreference: clean(body.guidePreference, 24) || "voice",
    budgetUSD: body.budgetUSD == null ? null : integer(body.budgetUSD, 0, 0, 100_000),
    notes: clean(body.notes, 2000),
    // Client estimate is an operator request attachment, never a signed quote.
    configuration: body.configuration && typeof body.configuration === "object" &&
      JSON.stringify(body.configuration).length <= 64000 ? body.configuration : null,
  };

  if (!["makkahOnly", "makkahAndMadinah"].includes(normalized.scope)) {
    return json({ ok: false, error: "CARE_REQUEST_SCOPE_INVALID" }, 400);
  }
  if (normalized.firstSaudiCity && !["JED", "MED"].includes(normalized.firstSaudiCity)) {
    return json({ ok: false, error: "CARE_REQUEST_FIRST_CITY_INVALID" }, 400);
  }
  if (!["lowest_price", "near_haram", "balanced", "premium"].includes(normalized.priority)) {
    return json({ ok: false, error: "CARE_REQUEST_PRIORITY_INVALID" }, 400);
  }
  if (!["comfortable", "private_suv", "vip"].includes(normalized.transferPreference)) {
    return json({ ok: false, error: "CARE_REQUEST_TRANSFER_INVALID" }, 400);
  }
  if (!["none", "voice", "live"].includes(normalized.guidePreference)) {
    return json({ ok: false, error: "CARE_REQUEST_GUIDE_INVALID" }, 400);
  }

  try {
    await ensureSchema(env.HOTELS_DB);
    const now = new Date();
    const id = requestID(now);
    const createdAt = now.toISOString();
    const responseDueAt = new Date(now.getTime() + 2 * 60 * 60_000).toISOString();
    const contactName = [normalized.firstName, normalized.lastName].filter(Boolean).join(" ");
    normalized.accountID = await optionalVerifiedAccountID(request, env.HOTELS_DB);

    await env.HOTELS_DB.prepare(`INSERT INTO iumrah_care_package_requests (
      id,request_type,status,source,locale,contact_name,contact_phone,contact_telegram,account_id,
      origin_code,timing_mode,preferred_month,flexible_window_days,exact_start_date,exact_end_date,
      adults,children,infants,rooms,scope,first_saudi_city,priority,hotel_class,transfer_preference,
      direct_flights_preferred,checked_baggage_preferred,include_ziyarat,include_esim,guide_preference,
      budget_usd,notes,payload_json,created_at,response_due_at,updated_at
    ) VALUES (
      ?1,'CARE_BUILD','CARE_REQUEST','ios',?2,?3,?4,?5,?6,
      ?7,?8,?9,?10,?11,?12,
      ?13,?14,?15,?16,?17,?18,?19,?20,?21,
      ?22,?23,?24,?25,?26,
      ?27,?28,?29,?30,?31,?30
    )`).bind(
      id, normalized.locale, contactName, normalized.phone, normalized.telegram || null, normalized.accountID,
      normalized.originCode, normalized.timingMode, normalized.preferredMonth, normalized.flexibleWindowDays,
      normalized.exactStartDate, normalized.exactEndDate, normalized.adults, normalized.children, normalized.infants,
      normalized.rooms, normalized.scope, normalized.firstSaudiCity, normalized.priority, normalized.hotelClass,
      normalized.transferPreference, normalized.directFlightsPreferred ? 1 : 0, normalized.checkedBaggagePreferred ? 1 : 0,
      normalized.includeZiyarat ? 1 : 0, normalized.includeESIM ? 1 : 0, normalized.guidePreference, normalized.budgetUSD,
      normalized.notes || null, JSON.stringify(normalized), createdAt, responseDueAt,
    ).run();

    return json({ ok: true, requestID: id, status: "CARE_REQUEST", createdAt, responseDueAt }, 201);
  } catch (error) {
    console.error("care-package-request-create-failed", error);
    return json({ ok: false, error: "CARE_REQUEST_CREATE_FAILED" }, 500);
  }
}

export async function listCarePackageRequests(url: URL, env: Env): Promise<Response> {
  if (!env.HOTELS_DB) return json({ ok: false, error: "HOTELS_DB_NOT_CONFIGURED" }, 503);
  try {
    await ensureSchema(env.HOTELS_DB);
    const requestedLimit = Number(url.searchParams.get("limit") ?? 100);
    const limit = Math.max(1, Math.min(250, Number.isFinite(requestedLimit) ? Math.round(requestedLimit) : 100));
    const status = clean(url.searchParams.get("status"), 60).toUpperCase();
    const query = status
      ? env.HOTELS_DB.prepare(`SELECT * FROM iumrah_care_package_requests WHERE status=?1 ORDER BY created_at DESC LIMIT ?2`).bind(status, limit)
      : env.HOTELS_DB.prepare(`SELECT * FROM iumrah_care_package_requests ORDER BY created_at DESC LIMIT ?1`).bind(limit);
    const rows = await query.all<Record<string, unknown>>();
    return json({ ok: true, requests: rows.results ?? [] });
  } catch (error) {
    console.error("care-package-request-list-failed", error);
    return json({ ok: false, error: "CARE_REQUEST_LIST_FAILED" }, 500);
  }
}

export async function updateCarePackageRequest(request: Request, id: string, env: Env): Promise<Response> {
  if (!env.HOTELS_DB) return json({ ok: false, error: "HOTELS_DB_NOT_CONFIGURED" }, 503);
  if (!/^CARE-\d{4}-[A-Z2-9]{7}$/.test(id)) return json({ ok: false, error: "INVALID_CARE_REQUEST_ID" }, 400);
  let body: { status?: unknown };
  try { body = await request.json() as { status?: unknown }; }
  catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }
  const status = clean(body.status, 60).replace(/-/g, "_").toUpperCase();
  const allowed = new Set(["CARE_REQUEST", "IN_REVIEW", "QUOTING", "READY", "CONTACTED", "CANCELLED", "COMPLETED"]);
  if (!allowed.has(status)) return json({ ok: false, error: "INVALID_CARE_REQUEST_STATUS" }, 400);
  try {
    await ensureSchema(env.HOTELS_DB);
    const now = new Date().toISOString();
    const result = await env.HOTELS_DB.prepare(
      "UPDATE iumrah_care_package_requests SET status=?1,updated_at=?2 WHERE id=?3",
    ).bind(status, now, id).run();
    if (Number(result?.meta?.changes ?? 0) < 1) return json({ ok: false, error: "CARE_REQUEST_NOT_FOUND" }, 404);
    return json({ ok: true, requestID: id, status, updatedAt: now });
  } catch (error) {
    console.error("care-package-request-update-failed", error);
    return json({ ok: false, error: "CARE_REQUEST_UPDATE_FAILED" }, 500);
  }
}
