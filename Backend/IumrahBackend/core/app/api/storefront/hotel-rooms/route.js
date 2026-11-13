// Ported from iumrah-web-main 5.zip: app/api/storefront/hotel-rooms/route.ts
import { requestEnv, backendFetch } from "../../../../runtime.js";
import { NextResponse } from "../../../../runtime.js";
export const dynamic = "force-dynamic";
const BACKEND = "https://iumrah-backend.helloiumrah.workers.dev";
export async function GET(request) {
    const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";
    if (!id || id.length > 180)
        return NextResponse.json({ ok: false, error: "INVALID_HOTEL" }, { status: 400 });
    try {
        const response = await backendFetch(new URL(`/api/package/hotel/${encodeURIComponent(id)}/room-categories`, BACKEND), { cache: "no-store" });
        const body = await response.json();
        return NextResponse.json(body, { status: response.status, headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        console.error("[storefront-hotel-rooms] proxy failed", error);
        return NextResponse.json({ ok: false, error: "ROOMS_UNAVAILABLE" }, { status: 503 });
    }
}
