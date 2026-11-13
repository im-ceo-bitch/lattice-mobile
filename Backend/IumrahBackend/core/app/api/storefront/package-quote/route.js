// Ported from iumrah-web-main 5.zip: app/api/storefront/package-quote/route.ts
import { requestEnv, backendFetch } from "../../../../runtime.js";
import { NextResponse } from "../../../../runtime.js";
export const dynamic = "force-dynamic";
const BACKEND = "https://iumrah-backend.helloiumrah.workers.dev";
export async function POST(request) {
    let body;
    try {
        body = await request.json();
    }
    catch {
        return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
    }
    try {
        const response = await backendFetch(new URL("/api/package/quote", BACKEND), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            cache: "no-store",
        });
        const result = await response.json();
        return NextResponse.json(result, { status: response.status, headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        console.error("[storefront-package-quote] proxy failed", error);
        return NextResponse.json({ ok: false, error: "QUOTE_UNAVAILABLE" }, { status: 503 });
    }
}
