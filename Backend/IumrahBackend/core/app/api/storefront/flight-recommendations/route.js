// Ported from iumrah-web-main 5.zip: app/api/storefront/flight-recommendations/route.ts
import { requestEnv, backendFetch } from "../../../../runtime.js";
import { NextResponse } from "../../../../runtime.js";
export const dynamic = "force-dynamic";
const PACKAGE_ENGINE_ORIGIN = "https://iumrah-backend.helloiumrah.workers.dev";
function safeLimit(value) {
    const parsed = Number(value ?? "500");
    if (!Number.isFinite(parsed))
        return "500";
    return String(Math.max(1, Math.min(1000, Math.trunc(parsed))));
}
export async function GET(request) {
    const origin = (request.nextUrl.searchParams.get("umrah_origin") ?? "TAS").trim().toUpperCase();
    const from = (request.nextUrl.searchParams.get("from") ?? "").trim();
    const to = (request.nextUrl.searchParams.get("to") ?? "").trim();
    if (!/^[A-Z]{3}$/.test(origin)) {
        return NextResponse.json({ ok: false, error: "INVALID_ORIGIN" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const params = new URLSearchParams({ umrah_origin: origin, limit: safeLimit(request.nextUrl.searchParams.get("limit")) });
    if (/^\d{4}-\d{2}-\d{2}$/.test(from))
        params.set("from", from);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to))
        params.set("to", to);
    try {
        const upstream = await backendFetch(new URL(`/api/package/flights/recommendations?${params.toString()}`, PACKAGE_ENGINE_ORIGIN), {
            method: "GET",
            headers: { accept: "application/json" },
            cache: "no-store",
        });
        const body = await upstream.text();
        return new NextResponse(body, {
            status: upstream.status,
            headers: {
                "content-type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
                "Cache-Control": "no-store",
            },
        });
    }
    catch (error) {
        console.error("[storefront-flight-recommendations] canonical PackageEngine unavailable", error);
        return NextResponse.json({ ok: false, error: "FLIGHTS_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
}
