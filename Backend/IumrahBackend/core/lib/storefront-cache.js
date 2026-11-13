// Ported from iumrah-web-main 5.zip: lib/storefront-cache.ts
import { requestEnv, backendFetch } from "../runtime.js";
import { currentStorefrontItems, isCurrentStorefrontPackage } from "./storefront-validity.js";
import { getCloudflareContext } from "../runtime.js";
import { FLIGHT_FIRST_ENGINE_VERSION, HOTEL_FIRST_ENGINE_VERSION, } from "./storefront-packages.js";
export const STOREFRONT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FLIGHT_KEY = "storefront:flight-first:daily";
const HOTEL_KEY = "storefront:hotel-first:daily";
const PACKAGE_ID_PATTERN = /^\d{10}$/;
let schemaPromise = null;
function normalizedScope(scope) {
    const value = scope?.trim().toUpperCase() ?? "";
    return /^[A-Z]{3}$/.test(value) ? value : null;
}
function cacheKey(mode, scope) {
    if (mode === "flight-first")
        return FLIGHT_KEY;
    const origin = normalizedScope(scope);
    return origin ? `storefront:hotel-first:${origin}:daily` : HOTEL_KEY;
}
function legacyPrefix(mode, scope) {
    if (mode === "flight-first")
        return "storefront:flight-first:%";
    const origin = normalizedScope(scope);
    return origin ? `storefront:hotel-first:${origin}:%` : "storefront:hotel-first:%";
}
function isReadyPackage(item) {
    return item.status === "ready"
        && typeof item.pricePerPerson === "number"
        && Number.isFinite(item.pricePerPerson)
        && item.pricePerPerson > 0
        && typeof item.totalPackagePrice === "number"
        && Number.isFinite(item.totalPackagePrice)
        && item.totalPackagePrice > 0
        && Boolean(item.hotelName)
        && Boolean(item.imageUrl)
        && Boolean(item.providerItineraryId)
        && Boolean(item.outboundOfferId)
        && Boolean(item.inboundOfferId)
        && Boolean(item.outbound?.arrivalAt)
        && Boolean(item.inbound?.arrivalAt);
}
const HOTEL_FIRST_VARIANTS = ["short", "balanced", "extended"];
function hotelFirstGroupsAreAtomic(items) {
    if (!items.length || items.length % HOTEL_FIRST_VARIANTS.length !== 0)
        return false;
    const groups = new Map();
    for (const item of items) {
        if (item.entryMode !== "hotel-first"
            || !item.hotelFirstAnchorHotelId
            || item.hotelFirstEngineVersion !== HOTEL_FIRST_ENGINE_VERSION
            || item.hotelFirstVariantIndex === null
            || item.hotelFirstVariantIndex === undefined
            || !item.hotelFirstVariant
            || typeof item.makkahNights !== "number"
            || typeof item.madinahNights !== "number")
            return false;
        const key = `${item.originCode}:${item.hotelFirstAnchorHotelId}`;
        const group = groups.get(key) ?? [];
        group.push(item);
        groups.set(key, group);
    }
    for (const group of groups.values()) {
        if (group.length !== HOTEL_FIRST_VARIANTS.length)
            return false;
        const byIndex = [...group].sort((a, b) => (a.hotelFirstVariantIndex ?? 99) - (b.hotelFirstVariantIndex ?? 99));
        const outboundOfferId = byIndex[0].outboundOfferId;
        const outboundDepartureAt = byIndex[0].outbound.departureAt;
        const returnIDs = new Set();
        const durations = new Set();
        for (let index = 0; index < HOTEL_FIRST_VARIANTS.length; index += 1) {
            const item = byIndex[index];
            if (item.hotelFirstVariantIndex !== index || item.hotelFirstVariant !== HOTEL_FIRST_VARIANTS[index])
                return false;
            if (item.outboundOfferId !== outboundOfferId || item.outbound.departureAt !== outboundDepartureAt)
                return false;
            if (returnIDs.has(item.inboundOfferId) || durations.has(item.totalDays))
                return false;
            if (typeof item.hotelFirstVariantMinDays === "number" && item.totalDays < item.hotelFirstVariantMinDays)
                return false;
            if (typeof item.hotelFirstVariantMaxDays === "number" && item.totalDays > item.hotelFirstVariantMaxDays)
                return false;
            returnIDs.add(item.inboundOfferId);
            durations.add(item.totalDays);
        }
    }
    return true;
}
export function isPublicPackageId(value) {
    return PACKAGE_ID_PATTERN.test(value.trim());
}
export function getStorefrontDb() {
    try {
        const env = getCloudflareContext().env;
        return env.DB ?? null;
    }
    catch {
        return null;
    }
}
export async function ensureStorefrontCacheSchema(db) {
    if (!schemaPromise) {
        schemaPromise = db.batch([
            db.prepare(`CREATE TABLE IF NOT EXISTS storefront_package_cache (
        cache_key TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        item_count INTEGER NOT NULL DEFAULT 0,
        is_complete INTEGER NOT NULL DEFAULT 0
      )`),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_storefront_package_cache_expiry ON storefront_package_cache(expires_at)"),
            db.prepare(`CREATE TABLE IF NOT EXISTS storefront_package_snapshots (
        package_id TEXT PRIMARY KEY,
        entry_mode TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        parent_package_id TEXT
      )`),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_storefront_package_snapshots_expiry ON storefront_package_snapshots(expires_at)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_storefront_package_snapshots_mode ON storefront_package_snapshots(entry_mode, generated_at)"),
            db.prepare(`CREATE TABLE IF NOT EXISTS storefront_flight_refresh_progress (
        cache_key TEXT PRIMARY KEY,
        next_offset INTEGER NOT NULL DEFAULT 0,
        candidate_count INTEGER NOT NULL DEFAULT 0,
        engine_version INTEGER NOT NULL,
        expires_at TEXT NOT NULL
      )`),
        ]).then(() => undefined).catch((error) => {
            schemaPromise = null;
            throw error;
        });
    }
    await schemaPromise;
}
// This cursor is independent from the number of *priced* packages: a batch can
// attempt eight published routes and receive only one valid supplier quote.
// Advancing by `items.length` would repeatedly process the same failed routes.
export async function readFlightRefreshProgress() {
    const db = getStorefrontDb();
    if (!db)
        return null;
    await ensureStorefrontCacheSchema(db);
    const row = await db.prepare(`SELECT next_offset, candidate_count, engine_version, expires_at
    FROM storefront_flight_refresh_progress WHERE cache_key = ? LIMIT 1`)
        .bind(FLIGHT_KEY)
        .first();
    const expiry = Date.parse(row?.expires_at ?? "");
    if (!row || row.engine_version !== FLIGHT_FIRST_ENGINE_VERSION
        || !Number.isFinite(expiry) || expiry <= Date.now())
        return null;
    return {
        nextOffset: Math.max(0, Number(row.next_offset) || 0),
        candidateCount: Math.max(0, Number(row.candidate_count) || 0),
    };
}
export async function writeFlightRefreshProgress(nextOffset, candidateCount) {
    const db = getStorefrontDb();
    if (!db)
        return false;
    await ensureStorefrontCacheSchema(db);
    const now = Date.now();
    const expiry = new Date(now + STOREFRONT_CACHE_TTL_MS).toISOString();
    // Use monotonic updates within one version/TTL. Simultaneous Cloudflare
    // isolates must not move a cursor backwards after a slower batch completes.
    await db.prepare(`INSERT INTO storefront_flight_refresh_progress
    (cache_key, next_offset, candidate_count, engine_version, expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      next_offset = CASE
        WHEN engine_version != excluded.engine_version OR expires_at <= ?
          THEN excluded.next_offset
        ELSE MAX(next_offset, excluded.next_offset)
      END,
      candidate_count = excluded.candidate_count,
      engine_version = excluded.engine_version,
      expires_at = CASE
        WHEN engine_version != excluded.engine_version OR expires_at <= ?
          THEN excluded.expires_at
        ELSE expires_at
      END`)
        .bind(FLIGHT_KEY, nextOffset, candidateCount, FLIGHT_FIRST_ENGINE_VERSION, expiry, new Date(now).toISOString(), new Date(now).toISOString())
        .run();
    return true;
}
async function rowForMode(db, mode, scope) {
    const stableKey = cacheKey(mode, scope);
    const stable = await db.prepare(`SELECT cache_key, payload_json, generated_at, expires_at, item_count, is_complete
    FROM storefront_package_cache WHERE cache_key = ? LIMIT 1`)
        .bind(stableKey)
        .first();
    if (stable)
        return stable;
    if (mode === "hotel-first" && normalizedScope(scope) === "TAS") {
        const legacyDaily = await db.prepare(`SELECT cache_key, payload_json, generated_at, expires_at, item_count, is_complete
      FROM storefront_package_cache WHERE cache_key = ? LIMIT 1`)
            .bind(HOTEL_KEY)
            .first();
        if (legacyDaily)
            return legacyDaily;
    }
    return db.prepare(`SELECT cache_key, payload_json, generated_at, expires_at, item_count, is_complete
    FROM storefront_package_cache
    WHERE cache_key LIKE ? AND is_complete = 1
    ORDER BY generated_at DESC LIMIT 1`)
        .bind(legacyPrefix(mode, scope))
        .first();
}
export async function readStorefrontCache(mode, scope) {
    const db = getStorefrontDb();
    if (!db)
        return null;
    await ensureStorefrontCacheSchema(db);
    const row = await rowForMode(db, mode, scope);
    if (!row)
        return null;
    try {
        const parsed = JSON.parse(row.payload_json);
        if (!Array.isArray(parsed))
            return null;
        const items = currentStorefrontItems(parsed.filter(isReadyPackage));
        if (!items.length)
            return null;
        // Pre-unified caches used technical IDs such as `hotel-first:...`. Never
        // expose those rows after the Package Registry migration: force one rebuild
        // so every package returned to Web/iOS/Android has a canonical 10-digit ID.
        if (items.some((item) => !isPublicPackageId(item.id)))
            return null;
        // Engine-version validation is also cache invalidation. Flight First v4 publishes
        // the full candidate catalogue incrementally, so an older daily row must be rebuilt instead
        // of remaining visible for the rest of its 24-hour TTL. Hotel First v6 remains
        // valid only as an atomic three-variant group per hotel.
        const structurallyComplete = mode === "flight-first"
            ? items.every((item) => item.entryMode === "flight-first"
                && item.flightFirstEngineVersion === FLIGHT_FIRST_ENGINE_VERSION)
            : hotelFirstGroupsAreAtomic(items);
        if (!structurallyComplete)
            return null;
        const now = Date.now();
        const expiresAtMs = Date.parse(row.expires_at);
        const isExpired = !Number.isFinite(expiresAtMs) || expiresAtMs <= now;
        const isComplete = row.is_complete === 1
            && items.length === Number(row.item_count)
            && structurallyComplete;
        return {
            items,
            generatedAt: row.generated_at,
            expiresAt: row.expires_at,
            isComplete,
            isExpired,
            refreshRecommended: isExpired || !isComplete,
        };
    }
    catch {
        return null;
    }
}
function randomTenDigitId() {
    const words = new Uint32Array(2);
    crypto.getRandomValues(words);
    // Build an exact 53-bit integer without BigInt so the code remains compatible
    // with the repository's ES2017 TypeScript target.
    const random53 = (words[0] & 0x001fffff) * 0x100000000 + words[1];
    return String(1_000_000_000 + (random53 % 9_000_000_000));
}
async function allocatePackageId(db) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
        const candidate = randomTenDigitId();
        const exists = await db.prepare("SELECT package_id FROM storefront_package_snapshots WHERE package_id = ? LIMIT 1")
            .bind(candidate)
            .first();
        if (!exists)
            return candidate;
    }
    throw new Error("PACKAGE_ID_ALLOCATION_FAILED");
}
async function insertSnapshot(db, item, options) {
    const packageId = isPublicPackageId(item.id) ? item.id : await allocatePackageId(db);
    const generatedAt = options?.generatedAt ?? new Date().toISOString();
    const expiresAt = options?.expiresAt ?? new Date(Date.now() + STOREFRONT_CACHE_TTL_MS).toISOString();
    const snapshot = { ...item, id: packageId };
    await db.prepare(`INSERT INTO storefront_package_snapshots (
      package_id, entry_mode, payload_json, generated_at, expires_at, parent_package_id
    ) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(packageId, snapshot.entryMode, JSON.stringify(snapshot), generatedAt, expiresAt, options?.parentPackageId ?? null)
        .run();
    return snapshot;
}
export async function createStorefrontPackageSnapshot(item, options) {
    if (!isReadyPackage(item) || !isCurrentStorefrontPackage(item))
        return null;
    const db = getStorefrontDb();
    if (!db)
        return null;
    await ensureStorefrontCacheSchema(db);
    const generatedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + STOREFRONT_CACHE_TTL_MS).toISOString();
    const snapshot = await insertSnapshot(db, { ...item, id: "" }, {
        parentPackageId: options?.parentPackageId ?? null,
        generatedAt,
        expiresAt,
    });
    return { item: snapshot, generatedAt, expiresAt, isExpired: false, parentPackageId: options?.parentPackageId ?? null };
}
export async function readStorefrontPackageSnapshot(packageId) {
    const normalized = packageId.trim();
    if (!isPublicPackageId(normalized))
        return null;
    const db = getStorefrontDb();
    if (!db)
        return null;
    await ensureStorefrontCacheSchema(db);
    const row = await db.prepare(`SELECT package_id, entry_mode, payload_json, generated_at, expires_at, parent_package_id
    FROM storefront_package_snapshots WHERE package_id = ? LIMIT 1`)
        .bind(normalized)
        .first();
    if (!row)
        return null;
    try {
        const item = JSON.parse(row.payload_json);
        if (!isReadyPackage(item) || item.id !== normalized)
            return null;
        const expiresAtMs = Date.parse(row.expires_at);
        return {
            item,
            generatedAt: row.generated_at,
            expiresAt: row.expires_at,
            isExpired: !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() || !isCurrentStorefrontPackage(item),
            parentPackageId: row.parent_package_id,
        };
    }
    catch {
        return null;
    }
}
export async function writeStorefrontCache(input) {
    const db = getStorefrontDb();
    if (!db)
        return false;
    await ensureStorefrontCacheSchema(db);
    const sourceItems = currentStorefrontItems(input.items.filter(isReadyPackage));
    if (!sourceItems.length)
        return false;
    const structurallyComplete = input.mode !== "hotel-first" || hotelFirstGroupsAreAtomic(sourceItems);
    if (!structurallyComplete)
        return false;
    const expectedItemCount = input.expectedItemCount === undefined
        ? sourceItems.length
        : Math.max(0, Math.trunc(input.expectedItemCount));
    const calculatedComplete = sourceItems.length === expectedItemCount;
    const isComplete = Boolean(input.isComplete ?? calculatedComplete) && calculatedComplete;
    const generatedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + STOREFRONT_CACHE_TTL_MS).toISOString();
    const items = [];
    for (const item of sourceItems) {
        if (input.preservePackageIds && isPublicPackageId(item.id)) {
            items.push(item);
        }
        else {
            items.push({ ...item, id: await allocatePackageId(db) });
        }
    }
    // Keep snapshot publication unbounded by a single D1 batch. Flight First can
    // legitimately contain hundreds of outbound/return combinations, while Hotel
    // First also grows incrementally. Chunking avoids a batch-size ceiling without
    // hiding any valid package from the public cache.
    const snapshotBatchSize = 50;
    for (let offset = 0; offset < items.length; offset += snapshotBatchSize) {
        const batch = items.slice(offset, offset + snapshotBatchSize);
        await db.batch(batch.map((item) => db.prepare(`INSERT INTO storefront_package_snapshots (
        package_id, entry_mode, payload_json, generated_at, expires_at, parent_package_id
      ) VALUES (?, ?, ?, ?, ?, NULL)
      ON CONFLICT(package_id) DO UPDATE SET
        entry_mode = excluded.entry_mode,
        payload_json = excluded.payload_json,
        generated_at = excluded.generated_at,
        expires_at = excluded.expires_at`)
            .bind(item.id, item.entryMode, JSON.stringify(item), generatedAt, expiresAt)));
    }
    await db.prepare(`INSERT INTO storefront_package_cache (
      cache_key, payload_json, generated_at, expires_at, item_count, is_complete
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      payload_json = excluded.payload_json,
      generated_at = excluded.generated_at,
      expires_at = excluded.expires_at,
      item_count = excluded.item_count,
      is_complete = excluded.is_complete`)
        .bind(cacheKey(input.mode, input.scope), JSON.stringify(items), generatedAt, expiresAt, items.length, isComplete ? 1 : 0)
        .run();
    await db.prepare(`DELETE FROM storefront_package_cache
    WHERE cache_key LIKE 'storefront:%'
      AND cache_key NOT IN (?, ?)
      AND cache_key NOT LIKE 'storefront:hotel-first:___:daily'`)
        .bind(FLIGHT_KEY, HOTEL_KEY)
        .run()
        .catch(() => undefined);
    // Keep snapshots for audit/control longer than their customer-facing 24h validity,
    // but bound storage growth. Business can later move this retention to a dedicated archive.
    const retentionCutoff = new Date(Date.now() - 30 * STOREFRONT_CACHE_TTL_MS).toISOString();
    await db.prepare("DELETE FROM storefront_package_snapshots WHERE expires_at < ?")
        .bind(retentionCutoff)
        .run()
        .catch(() => undefined);
    // SEO registry failure must never undo a successful package publication.
    try {
        const { registerSeoPackages } = await import("./seo/store.js");
        await registerSeoPackages(db, items, generatedAt);
    }
    catch (error) {
        console.error("[seo] registry update failed; catalog reads committed cache", error);
    }
    return true;
}
