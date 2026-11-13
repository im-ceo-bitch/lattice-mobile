// Ported from iumrah-web-main 5.zip: app/api/storefront/packages/route.ts
import { requestEnv, backendFetch } from "../../../../runtime.js";
import { currentStorefrontItems } from "../../../../lib/storefront-validity.js";
import { getCloudflareContext } from "../../../../runtime.js";
import { NextResponse } from "../../../../runtime.js";
import { buildHotelFirstStorefrontPackagesDetailed, buildPricedStorefrontPackagesDetailed, STORE_ORIGINS, } from "../../../../lib/storefront-packages.js";
import { readStorefrontCache, readFlightRefreshProgress, writeFlightRefreshProgress, writeStorefrontCache, } from "../../../../lib/storefront-cache.js";
export const dynamic = "force-dynamic";
const FLIGHT_FIRST_BATCH_SIZE = 8;
const HOTEL_FIRST_BATCH_SIZE = 3;
let flightRefreshInFlight = null;
const hotelRefreshInFlight = new Map();
function parseMode(value) {
    return value === "hotel-first" ? "hotel-first" : "flight-first";
}
function parseRefreshMode(value) {
    return value === "hotel-first" || value === "flight-first" ? value : null;
}
function parseLimit(value) {
    if (!value)
        return null;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed))
        return null;
    return Math.max(1, parsed);
}
function parseOrigins(value) {
    if (!value)
        return Array.from(STORE_ORIGINS);
    const allowed = new Set(STORE_ORIGINS);
    const parsed = value
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter((item) => allowed.has(item));
    return parsed.length ? parsed : Array.from(STORE_ORIGINS);
}
function hotelOrigin(value) {
    const normalized = value?.trim().toUpperCase() ?? "TAS";
    return STORE_ORIGINS.includes(normalized) ? normalized : "TAS";
}
function refreshCursor(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}
function packageApiBase() {
    // Package Engine + Hotels Worker are canonically routed on iumrah.app. The
    // storefront itself may be opened on iumrah.uz, so never derive backend origin
    // from the public website host.
    return "https://iumrah-backend.helloiumrah.workers.dev";
}
function waitUntil(promise) {
    try {
        const ctx = getCloudflareContext().ctx;
        if (ctx.waitUntil) {
            ctx.waitUntil(promise);
            return true;
        }
    }
    catch {
        // Local Next.js fallback: caller may await directly when needed.
    }
    return false;
}
function flightFirstMergeKey(item) {
    return item.providerItineraryId
        || `${item.originCode}:${item.outboundOfferId}:${item.inboundOfferId}`;
}
function mergeFlightFirstPackages(freshItems, cachedItems) {
    const merged = new Map();
    for (const item of cachedItems)
        merged.set(flightFirstMergeKey(item), item);
    for (const item of freshItems) {
        const key = flightFirstMergeKey(item);
        const existing = merged.get(key);
        // Preserve a public 10-digit package ID already exposed by a previous batch.
        merged.set(key, existing ? { ...item, id: existing.id } : item);
    }
    return [...merged.values()].sort((a, b) => {
        if (a.startDate !== b.startDate)
            return a.startDate.localeCompare(b.startDate);
        return flightFirstMergeKey(a).localeCompare(flightFirstMergeKey(b));
    });
}
async function rebuildFlightCache(baseUrl) {
    const current = await readStorefrontCache("flight-first");
    const reusableCurrent = current?.items.length && !current.isExpired ? current : null;
    const progress = await readFlightRefreshProgress();
    // Server-side cursor is the authority. iOS/Android don't run the browser's
    // POST refresh loop, so they must not depend on a web visitor opening a page.
    const candidateOffset = progress?.nextOffset ?? 0;
    const result = await buildPricedStorefrontPackagesDetailed({
        origins: Array.from(STORE_ORIGINS),
        baseUrl,
        candidateOffset,
        candidateBatchSize: FLIGHT_FIRST_BATCH_SIZE,
    });
    const items = currentStorefrontItems(mergeFlightFirstPackages(result.items, reusableCurrent?.items ?? []));
    console.info(`[storefront-cache] flight-first attempt ${candidateOffset}..${result.nextCandidateOffset}/${result.candidateCount}: ${result.items.length} priced, ${result.failedCandidateCount} failed`);
    // Completion means every published outbound/return candidate has been attempted,
    // not that every supplier quote succeeded. Failed/unavailable quotes stay out of
    // the public catalogue; successful packages are never truncated.
    const complete = result.complete;
    const written = items.length
        ? await writeStorefrontCache({
            mode: "flight-first",
            items,
            expectedItemCount: complete ? items.length : Math.max(items.length + 1, result.candidateCount),
            isComplete: complete,
            preservePackageIds: Boolean(reusableCurrent?.items.length),
        })
        : false;
    // Store progress even when no supplier quote succeeds in a batch. Never
    // advance past successfully priced items unless they were committed to D1.
    if (written || result.items.length === 0) {
        await writeFlightRefreshProgress(result.nextCandidateOffset, result.candidateCount);
    }
    else {
        console.error("[storefront-cache] flight-first batch could not be committed; preserving refresh cursor");
    }
    return {
        mode: "flight-first",
        itemCount: items.length,
        written,
        expectedItemCount: result.candidateCount,
        complete,
        failedCandidateCount: result.failedCandidateCount,
        nextCandidateOffset: result.nextCandidateOffset,
    };
}
function hotelFirstGroupKey(item) {
    return item.hotelFirstAnchorHotelId ? `${item.originCode}:${item.hotelFirstAnchorHotelId}` : null;
}
function completeHotelFirstKeys(items) {
    const groups = new Map();
    for (const item of items) {
        const key = hotelFirstGroupKey(item);
        if (!key)
            continue;
        groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    return new Set([...groups.entries()].filter(([, count]) => count === 3).map(([key]) => key));
}
function mergeHotelFirstGroups(freshItems, cachedItems, expectedKeys) {
    const groups = new Map();
    const addGroups = (items, overwrite) => {
        const next = new Map();
        for (const item of items) {
            const key = hotelFirstGroupKey(item);
            if (!key || !expectedKeys.has(key))
                continue;
            const group = next.get(key) ?? [];
            group.push(item);
            next.set(key, group);
        }
        for (const [key, group] of next) {
            if (group.length !== 3)
                continue;
            if (overwrite || !groups.has(key))
                groups.set(key, group);
        }
    };
    addGroups(cachedItems, false);
    addGroups(freshItems, true);
    return [...groups.values()].flat();
}
async function rebuildHotelCache(baseUrl, origin = "TAS", hotelOffset = 0) {
    const scopedOrigin = hotelOrigin(origin);
    const current = await readStorefrontCache("hotel-first", scopedOrigin);
    const reusableCurrent = current?.items.length && !current.isExpired ? current : null;
    const completedBefore = reusableCurrent ? completeHotelFirstKeys(reusableCurrent.items) : new Set();
    const result = await buildHotelFirstStorefrontPackagesDetailed({
        origins: [scopedOrigin],
        baseUrl,
        skipHotelKeys: [...completedBefore],
        hotelOffset,
        hotelBatchSize: HOTEL_FIRST_BATCH_SIZE,
    });
    const expectedKeys = new Set(result.expectedHotelKeys);
    let items = result.items;
    if (reusableCurrent?.items.length && expectedKeys.size) {
        items = mergeHotelFirstGroups(result.items, reusableCurrent.items, expectedKeys);
    }
    items = currentStorefrontItems(items);
    const completedKeys = completeHotelFirstKeys(items);
    const remainingKeys = [...expectedKeys].filter((key) => !completedKeys.has(key));
    const complete = result.expectedPackageCount > 0
        && items.length === result.expectedPackageCount
        && remainingKeys.length === 0;
    // Incremental Hotel First builds preserve package IDs that were already exposed
    // to the user. Only newly completed hotel trios receive new 10-digit IDs.
    const shouldWrite = items.length > 0 && (result.items.length > 0 || complete || !reusableCurrent);
    const written = shouldWrite
        ? await writeStorefrontCache({
            mode: "hotel-first",
            items,
            scope: scopedOrigin,
            expectedItemCount: result.expectedPackageCount,
            isComplete: complete,
            preservePackageIds: Boolean(reusableCurrent?.items.length),
        })
        : false;
    if (!complete) {
        console.warn(`[storefront-cache] hotel-first ${scopedOrigin} progress: `
            + `${items.length}/${result.expectedPackageCount} packages, `
            + `${remainingKeys.length} hotel(s) pending, nextOffset=${result.nextHotelOffset}`);
    }
    return {
        mode: "hotel-first",
        itemCount: items.length,
        written,
        expectedItemCount: result.expectedPackageCount,
        complete,
        failedHotelCount: remainingKeys.length,
        nextHotelOffset: result.nextHotelOffset,
    };
}
function refreshModeOnce(mode, baseUrl, origin = "TAS", cursorOffset = 0) {
    if (mode === "flight-first") {
        if (!flightRefreshInFlight) {
            flightRefreshInFlight = rebuildFlightCache(baseUrl).finally(() => {
                flightRefreshInFlight = null;
            });
        }
        return flightRefreshInFlight;
    }
    const scopedOrigin = hotelOrigin(origin);
    const existing = hotelRefreshInFlight.get(scopedOrigin);
    if (existing)
        return existing;
    const refresh = rebuildHotelCache(baseUrl, scopedOrigin, cursorOffset).finally(() => {
        hotelRefreshInFlight.delete(scopedOrigin);
    });
    hotelRefreshInFlight.set(scopedOrigin, refresh);
    return refresh;
}
function scheduleFullRefresh(mode, baseUrl, origin = "TAS") {
    const primary = refreshModeOnce(mode, baseUrl, origin).catch((error) => {
        console.error(`[storefront-cache] ${mode} refresh failed`, error);
    });
    waitUntil(primary);
}
function noPricedFlightPackages(candidateCount, cursor) {
    return NextResponse.json({
        ok: false,
        cacheState: "unavailable",
        refreshRecommended: false,
        itemCount: 0,
        totalItemCount: 0,
        expectedItemCount: candidateCount,
        nextRefreshCursor: cursor,
        complete: true,
        items: [],
        error: candidateCount === 0
            ? "STOREFRONT_NO_ELIGIBLE_FLIGHT_PAIRS"
            : "STOREFRONT_NO_PRICED_PACKAGES",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
function filteredItems(items, origins, limit) {
    const filtered = currentStorefrontItems(items).filter((item) => origins.includes(item.originCode));
    return limit === null ? filtered : filtered.slice(0, limit);
}
export async function GET(request) {
    const mode = parseMode(request.nextUrl.searchParams.get("mode"));
    const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
    const parsedOrigins = parseOrigins(request.nextUrl.searchParams.get("origins"));
    const origins = mode === "hotel-first" ? [hotelOrigin(parsedOrigins[0])] : parsedOrigins;
    const cacheScope = mode === "hotel-first" ? origins[0] : undefined;
    const baseUrl = packageApiBase();
    let cached = await readStorefrontCache(mode, cacheScope);
    // If all candidate routes were attempted but no priced package could be
    // published, report an actionable terminal state instead of a perpetual
    // "building" spinner. Never fabricate a package price from raw airfare.
    if (mode === "flight-first" && !cached?.items.length) {
        const progress = await readFlightRefreshProgress();
        if (progress && progress.nextOffset >= progress.candidateCount) {
            return noPricedFlightPackages(progress.candidateCount, progress.nextOffset);
        }
    }
    // Expired Hotel First data is not reused as progress. The first small batch
    // starts a new 24-hour generation, then the client continues batch-by-batch.
    if (cached?.items.length && cached.isExpired) {
        try {
            const refreshed = await refreshModeOnce(mode, baseUrl, cacheScope, 0);
            const next = await readStorefrontCache(mode, cacheScope);
            cached = next?.items.length && !next.isExpired ? next : null;
            if (!cached && mode === "hotel-first") {
                return NextResponse.json({
                    ok: true,
                    cacheState: "building",
                    refreshRecommended: true,
                    generatedAt: null,
                    expiresAt: null,
                    itemCount: 0,
                    totalItemCount: 0,
                    expectedItemCount: refreshed.expectedItemCount ?? null,
                    complete: false,
                    failedHotelCount: refreshed.failedHotelCount ?? 0,
                    nextRefreshCursor: refreshed.nextHotelOffset ?? 0,
                    items: [],
                }, { headers: { "Cache-Control": "no-store" } });
            }
        }
        catch (error) {
            console.error(`[storefront-cache] ${mode} expired snapshot refresh failed`, error);
            cached = null;
        }
    }
    if (cached?.items.length) {
        const refreshRecommended = cached.refreshRecommended;
        const progress = mode === "flight-first" ? await readFlightRefreshProgress() : null;
        // Mobile clients only GET; advance their catalog in Cloudflare waitUntil.
        // Work stays bounded to one candidate batch per request.
        if (mode === "flight-first" && !cached.isComplete
            && (!progress || progress.nextOffset < progress.candidateCount)) {
            scheduleFullRefresh(mode, baseUrl);
        }
        // Partial catalogues are advanced by explicit small POST batches from the web
        // client. Avoid a competing background Flight First rebuild at cursor 0.
        const items = filteredItems(cached.items, origins, limit);
        return NextResponse.json({
            ok: true,
            cacheState: cached.isComplete ? "ready" : "building",
            refreshRecommended,
            generatedAt: cached.generatedAt,
            expiresAt: cached.expiresAt,
            itemCount: items.length,
            totalItemCount: cached.items.length,
            complete: cached.isComplete,
            nextRefreshCursor: progress?.nextOffset ?? 0,
            expectedItemCount: progress?.candidateCount ?? null,
            items,
        }, { headers: { "Cache-Control": "no-store" } });
    }
    try {
        const refreshed = await refreshModeOnce(mode, baseUrl, cacheScope, 0);
        const ready = await readStorefrontCache(mode, cacheScope);
        if (ready?.items.length && !ready.isExpired) {
            const items = filteredItems(ready.items, origins, limit);
            return NextResponse.json({
                ok: true,
                cacheState: ready.isComplete ? "ready" : "building",
                refreshRecommended: ready.refreshRecommended,
                generatedAt: ready.generatedAt,
                expiresAt: ready.expiresAt,
                itemCount: items.length,
                totalItemCount: ready.items.length,
                refreshedItemCount: refreshed.itemCount,
                expectedItemCount: refreshed.expectedItemCount ?? null,
                complete: refreshed.complete ?? ready.isComplete,
                failedHotelCount: refreshed.failedHotelCount ?? 0,
                failedCandidateCount: refreshed.failedCandidateCount ?? 0,
                nextRefreshCursor: mode === "flight-first"
                    ? (refreshed.nextCandidateOffset ?? 0)
                    : (refreshed.nextHotelOffset ?? 0),
                items,
            }, { headers: { "Cache-Control": "no-store" } });
        }
        if (mode === "flight-first" && refreshed.complete) {
            return noPricedFlightPackages(refreshed.expectedItemCount ?? 0, refreshed.nextCandidateOffset ?? 0);
        }
        if ((refreshed.expectedItemCount ?? 0) > 0 && !refreshed.complete) {
            return NextResponse.json({
                ok: true,
                cacheState: "building",
                refreshRecommended: true,
                generatedAt: null,
                expiresAt: null,
                itemCount: 0,
                totalItemCount: 0,
                refreshedItemCount: refreshed.itemCount,
                expectedItemCount: refreshed.expectedItemCount ?? null,
                complete: false,
                failedHotelCount: refreshed.failedHotelCount ?? 0,
                failedCandidateCount: refreshed.failedCandidateCount ?? 0,
                nextRefreshCursor: mode === "flight-first"
                    ? (refreshed.nextCandidateOffset ?? 0)
                    : (refreshed.nextHotelOffset ?? 0),
                items: [],
            }, { headers: { "Cache-Control": "no-store" } });
        }
    }
    catch (error) {
        console.error(`[storefront-cache] ${mode} first build failed`, error);
    }
    return NextResponse.json({
        ok: false,
        cacheState: "unavailable",
        refreshRecommended: true,
        items: [],
        error: "STOREFRONT_DAILY_CACHE_UNAVAILABLE",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
async function refreshOneMode(request, mode, origin, cursor) {
    const baseUrl = packageApiBase();
    const scope = mode === "hotel-first" ? origin : undefined;
    const current = await readStorefrontCache(mode, scope);
    if (current?.items.length && !current.isExpired && current.isComplete) {
        return NextResponse.json({
            ok: true,
            refreshed: false,
            mode,
            itemCount: current.items.length,
            expectedItemCount: current.items.length,
            complete: true,
            failedHotelCount: 0,
            nextRefreshCursor: cursor,
            generatedAt: current.generatedAt,
            expiresAt: current.expiresAt,
        }, { headers: { "Cache-Control": "no-store" } });
    }
    const refreshed = await refreshModeOnce(mode, baseUrl, origin, cursor);
    const updated = await readStorefrontCache(mode, scope);
    const flightProgress = mode === "flight-first" ? await readFlightRefreshProgress() : null;
    const itemCount = updated?.items.length ?? refreshed.itemCount;
    const complete = updated?.isComplete ?? refreshed.complete ?? false;
    return NextResponse.json({
        ok: true,
        refreshed: refreshed.written,
        mode,
        itemCount,
        expectedItemCount: refreshed.expectedItemCount ?? itemCount,
        complete,
        failedHotelCount: refreshed.failedHotelCount ?? 0,
        nextRefreshCursor: mode === "flight-first"
            ? (flightProgress?.nextOffset ?? refreshed.nextCandidateOffset ?? cursor)
            : (refreshed.nextHotelOffset ?? cursor),
        generatedAt: updated?.generatedAt ?? null,
        expiresAt: updated?.expiresAt ?? null,
    }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request) {
    let body = {};
    try {
        body = await request.json();
    }
    catch {
        body = {};
    }
    const requestedMode = parseRefreshMode(body.mode);
    const origin = hotelOrigin(body.origin);
    const cursor = refreshCursor(body.cursor);
    if (requestedMode) {
        try {
            return await refreshOneMode(request, requestedMode, origin, cursor);
        }
        catch (error) {
            console.error(`[storefront-cache] ${requestedMode} explicit refresh failed`, error);
            return NextResponse.json({
                ok: false,
                refreshed: false,
                mode: requestedMode,
                complete: false,
                nextRefreshCursor: cursor,
                error: "STOREFRONT_REFRESH_FAILED",
            }, { status: 503, headers: { "Cache-Control": "no-store" } });
        }
    }
    // Backward-compatible prewarm used by older clients: refresh whichever daily
    // caches need attention, one Hotel First batch at a time.
    const baseUrl = packageApiBase();
    const [flightCache, hotelCache] = await Promise.all([
        readStorefrontCache("flight-first"),
        readStorefrontCache("hotel-first", "TAS"),
    ]);
    const refreshFlight = !flightCache?.items.length || flightCache.refreshRecommended;
    const refreshHotel = !hotelCache?.items.length || hotelCache.refreshRecommended;
    if (!refreshFlight && !refreshHotel) {
        return NextResponse.json({
            ok: true,
            refreshed: false,
            flightCount: flightCache.items.length,
            hotelCount: hotelCache.items.length,
            hotelComplete: hotelCache.isComplete,
            generatedAt: flightCache.generatedAt,
            expiresAt: flightCache.expiresAt,
        }, { headers: { "Cache-Control": "no-store" } });
    }
    const jobs = [];
    if (refreshFlight)
        jobs.push(refreshModeOnce("flight-first", baseUrl));
    if (refreshHotel)
        jobs.push(refreshModeOnce("hotel-first", baseUrl, "TAS", cursor));
    await Promise.allSettled(jobs);
    const [updatedFlight, updatedHotel] = await Promise.all([
        readStorefrontCache("flight-first"),
        readStorefrontCache("hotel-first", "TAS"),
    ]);
    return NextResponse.json({
        ok: Boolean(updatedFlight?.items.length || updatedHotel?.items.length),
        refreshed: true,
        flightCount: updatedFlight?.items.length ?? 0,
        hotelCount: updatedHotel?.items.length ?? 0,
        hotelComplete: updatedHotel?.isComplete ?? false,
        generatedAt: updatedFlight?.generatedAt ?? updatedHotel?.generatedAt ?? null,
        expiresAt: updatedFlight?.expiresAt ?? updatedHotel?.expiresAt ?? null,
    }, { headers: { "Cache-Control": "no-store" } });
}
