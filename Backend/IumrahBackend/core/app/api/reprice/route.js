// Ported from iumrah-web-main 5.zip: app/api/reprice/route.ts
import { requestEnv, backendFetch } from "../../../runtime.js";
import { NextResponse } from "../../../runtime.js";
export async function POST() {
    return NextResponse.json({
        error: "PRICING_MOVED_TO_PACKAGE_ENGINE",
        endpoint: "/api/package/quote",
    }, {
        status: 410,
        headers: { "Cache-Control": "no-store" },
    });
}
