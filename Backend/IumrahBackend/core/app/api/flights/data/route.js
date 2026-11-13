// Ported from iumrah-web-main 5.zip: app/api/flights/data/route.ts
import { requestEnv, backendFetch } from "../../../../runtime.js";
import { NextResponse } from "../../../../runtime.js";
import { isBookableDeparture } from "../../../../lib/flights/validity.js";
/** Same authenticated-backend-owned Aviasales Data API used by the native app.
 * No Aviasales / Travelpayouts secret is ever sent to the browser.
 */
export const dynamic = "force-dynamic";
const BASE = "https://iumrah-backend.helloiumrah.workers.dev";
export async function GET(request) {
    const sp = request.nextUrl.searchParams;
    const origin = (sp.get("origin") ?? "").trim().toUpperCase();
    const destination = (sp.get("destination") ?? "").trim().toUpperCase();
    const view = sp.get("view") ?? "offers";
    const departure = sp.get("departure") ?? "";
    const arrivalReturn = sp.get("return") ?? "";
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || origin === destination || !["offers", "direct", "calendar"].includes(view) || !/^\d{4}-\d{2}(?:-\d{2})?$/.test(departure) || (arrivalReturn && !/^\d{4}-\d{2}-\d{2}$/.test(arrivalReturn))) {
        return NextResponse.json({ ok: false, error: "INVALID_FLIGHT_SEARCH" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const params = new URLSearchParams({ view, origin, destination, departure, currency: "usd" });
    if (view === "calendar")
        params.set("direct", sp.get("direct") === "true" ? "true" : "false");
    else {
        if (arrivalReturn)
            params.set("return", arrivalReturn);
        if (sp.get("fresh") === "1")
            params.set("fresh", "1");
        params.set("limit", String(Math.max(1, Math.min(100, Number(sp.get("limit") ?? 100) || 100))));
    }
    try {
        const upstream = await backendFetch(`${BASE}/api/package/flights/data?${params}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(16000), cache: "no-store" });
        const payload = await upstream.text();
        const contentType = upstream.headers.get("content-type") ?? "";
        if (!contentType.includes("json"))
            throw new Error(`PackageEngine returned ${upstream.status} without JSON`);
        // Enforce the same cutoff on the API as in the UI: cached prices for an
        // already departed flight must never make it into a new search response.
        if (upstream.ok) {
            const parsed = JSON.parse(payload);
            const now = Date.now();
            const eligible = (entry) => {
                if (!entry || typeof entry !== "object")
                    return false;
                const row = entry;
                const out = typeof row.departureAt === "string" ? row.departureAt : "";
                const from = typeof row.originAirport === "string" ? row.originAirport : row.origin;
                const ret = typeof row.returnAt === "string" ? row.returnAt : null;
                const to = typeof row.destinationAirport === "string" ? row.destinationAirport : row.destination;
                return typeof from === "string" && isBookableDeparture(out, from, now)
                    && (!ret || (typeof to === "string" && isBookableDeparture(ret, to, now, 0)));
            };
            if (Array.isArray(parsed.offers))
                parsed.offers = parsed.offers.filter(eligible);
            if (Array.isArray(parsed.days))
                parsed.days = parsed.days.filter(eligible);
            return NextResponse.json(parsed, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
        }
        return new NextResponse(payload, { status: upstream.status, headers: { "content-type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
    }
    catch (error) {
        console.error("[flights-data] upstream unavailable", error instanceof Error ? error.message : error);
        return NextResponse.json({ ok: false, error: "FLIGHTS_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
}
