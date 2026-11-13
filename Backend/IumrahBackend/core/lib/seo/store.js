const cache = (fn) => fn;
import { storefrontDepartureIsEligible, storefrontGenerationIsOutdated } from "../storefront-date-policy.js";
import { ensureStorefrontCacheSchema, getStorefrontDb } from "../storefront-cache.js";
import { FLIGHT_FIRST_ENGINE_VERSION, HOTEL_FIRST_ENGINE_VERSION } from "../storefront-packages.js";
import { descriptors, groupPackages } from "./catalog.js";
let schema;
export async function ensureSeoSchema(db) {
    if (!schema)
        schema = db.prepare(`CREATE TABLE IF NOT EXISTS seo_page_registry (
    page_key TEXT PRIMARY KEY, descriptor_json TEXT NOT NULL, updated_at TEXT NOT NULL
  )`).run().then(() => undefined).catch((error) => { schema = undefined; throw error; });
    await schema;
}
/** Called after the authoritative snapshot commits. No supplier requests or repricing. */
export async function registerSeoPackages(db, items, updatedAt) {
    await ensureSeoSchema(db);
    const pages = new Map();
    for (const item of items)
        for (const page of descriptors(item))
            pages.set(page.key, page);
    const statements = [...pages.values()].map((page) => db.prepare(`INSERT INTO seo_page_registry
    (page_key, descriptor_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(page_key) DO UPDATE SET descriptor_json = excluded.descriptor_json, updated_at = excluded.updated_at`)
        .bind(page.key, JSON.stringify(page), updatedAt));
    for (let offset = 0; offset < statements.length; offset += 80)
        await db.batch(statements.slice(offset, offset + 80));
}
export const loadSeoCatalog = cache(async () => {
    const db = getStorefrontDb();
    if (!db)
        throw new Error("SEO_DATABASE_UNAVAILABLE");
    await ensureStorefrontCacheSchema(db);
    await ensureSeoSchema(db);
    const rows = await db.prepare(`SELECT cache_key, payload_json, generated_at, expires_at FROM storefront_package_cache
    WHERE cache_key = 'storefront:flight-first:daily' OR cache_key = 'storefront:hotel-first:daily'
    OR cache_key LIKE 'storefront:hotel-first:___:daily'`).all();
    const items = [];
    const timestamps = new Map();
    const historical = new Map();
    for (const row of rows.results) {
        const parsed = JSON.parse(row.payload_json);
        if (!Array.isArray(parsed))
            throw new Error("SEO_INVALID_CACHE");
        for (const item of parsed) {
            for (const descriptor of descriptors(item))
                historical.set(descriptor.key, descriptor);
            const versionOk = item.entryMode === "flight-first" ? item.flightFirstEngineVersion === FLIGHT_FIRST_ENGINE_VERSION : item.hotelFirstEngineVersion === HOTEL_FIRST_ENGINE_VERSION;
            if (!Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()
                || storefrontGenerationIsOutdated(row.generated_at) || !versionOk
                || !storefrontDepartureIsEligible(item.startDate))
                continue;
            items.push(item);
            timestamps.set(item.id, row.generated_at);
        }
    }
    const groups = groupPackages(items);
    for (const group of groups.values())
        group.updatedAt = group.items.map((item) => timestamps.get(item.id) ?? "").sort().at(-1);
    const registry = await db.prepare("SELECT descriptor_json FROM seo_page_registry").all();
    const known = new Map();
    for (const row of registry.results) {
        const descriptor = JSON.parse(row.descriptor_json);
        known.set(descriptor.key, descriptor);
    }
    // Persist previously published routes on first deployment, even if the next
    // snapshot drops a direction. ON CONFLICT protects concurrent publications.
    const missing = [...historical.values()].filter((descriptor) => !known.has(descriptor.key));
    for (let offset = 0; offset < missing.length; offset += 80) {
        await db.batch(missing.slice(offset, offset + 80).map((descriptor) => db.prepare("INSERT INTO seo_page_registry (page_key, descriptor_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(page_key) DO NOTHING").bind(descriptor.key, JSON.stringify(descriptor), new Date().toISOString())));
    }
    // Existing installations are discoverable immediately, before the first new snapshot write.
    for (const [key, descriptor] of historical)
        known.set(key, descriptor);
    known.set("", { key: "", kind: "all" });
    return { groups, known };
});
