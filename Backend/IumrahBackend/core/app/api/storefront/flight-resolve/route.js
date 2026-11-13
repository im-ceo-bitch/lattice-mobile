// Ported from iumrah-web-main 5.zip: app/api/storefront/flight-resolve/route.ts
import { requestEnv, backendFetch } from "../../../../runtime.js";
import { NextResponse } from "../../../../runtime.js";
export const dynamic = "force-dynamic";
const PACKAGE_ENGINE_ORIGIN = "https://iumrah-backend.helloiumrah.workers.dev";
const NO_STORE = { "Cache-Control": "no-store" };
export async function POST(request) {
    const selection = await request.json().catch(() => null);
    if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
        return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400, headers: NO_STORE });
    }
    // Only proxy flight IDs, never an arbitrary URL supplied by a client.
    // The canonical worker remains responsible for verifying published flights.
    const ids = [selection.completeID, selection.outboundID, selection.returnID];
    const validIDs = ids.every((id) => id == null || (typeof id === "string" && id.length > 0 && id.length <= 256));
    const hasSelection = Boolean(selection.completeID || (selection.outboundID && selection.returnID));
    const travelerCount = selection.travelerCount;
    const validOrigin = typeof selection.origin === "string" && /^[A-Z]{3}$/.test(selection.origin);
    if (!validIDs || !hasSelection || !validOrigin || typeof travelerCount !== "number" || !Number.isInteger(travelerCount) || travelerCount < 1 || travelerCount > 20) {
        return NextResponse.json({ ok: false, error: "INVALID_FLIGHT_SELECTION" }, { status: 400, headers: NO_STORE });
    }
    try {
        const response = await backendFetch(new URL("/api/package/flights/recommendations/resolve", PACKAGE_ENGINE_ORIGIN), {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify(selection),
            cache: "no-store",
        });
        const body = await response.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return NextResponse.json({ ok: false, error: "FLIGHT_SELECTION_UNAVAILABLE" }, { status: 502, headers: NO_STORE });
        }
        return NextResponse.json(body, { status: response.status, headers: NO_STORE });
    }
    catch (error) {
        console.error("[storefront-flight-resolve] canonical PackageEngine unavailable", error);
        return NextResponse.json({ ok: false, error: "FLIGHT_SELECTION_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
    }
}
