// Ported from iumrah-web-main 5.zip: app/api/airports/route.ts
import { requestEnv, backendFetch } from "../../../runtime.js";
import { NextResponse } from "../../../runtime.js";
import { searchAirports } from "../../../lib/airports/search.js";
export async function GET(request) {
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim();
    const limitRaw = Number(url.searchParams.get("limit") ?? 8);
    const limit = Math.max(1, Math.min(12, Number.isFinite(limitRaw) ? Math.round(limitRaw) : 8));
    if (!query) {
        return NextResponse.json({ airports: [] }, { headers: { "Cache-Control": "public, max-age=3600" } });
    }
    return NextResponse.json({ airports: searchAirports(query, limit) }, { headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } });
}
