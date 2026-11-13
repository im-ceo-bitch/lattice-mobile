// Ported from iumrah-web-main 5.zip: app/api/storefront/primary-hotel/route.ts
import { requestEnv, backendFetch } from "../../../../runtime.js";
import { NextResponse } from "../../../../runtime.js";
export const dynamic = "force-dynamic";
const BACKEND = "https://iumrah-backend.helloiumrah.workers.dev";
export async function GET(request) {
    try {
        const url = new URL("/api/package/primary-hotel", BACKEND);
        for (const key of ["tier", "stars", "city"]) {
            const value = request.nextUrl.searchParams.get(key);
            if (value)
                url.searchParams.set(key, value);
        }
        const response = await backendFetch(url, { cache: "no-store" });
        const body = await response.json();
        return NextResponse.json(body, { status: response.status, headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        console.error("[storefront-primary-hotel] proxy failed", error);
        return NextResponse.json({ ok: false, error: "HOTEL_UNAVAILABLE" }, { status: 503 });
    }
}
