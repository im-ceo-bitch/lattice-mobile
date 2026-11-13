// Ported from iumrah-web-main 5.zip: app/api/generate/route.ts
import { requestEnv, backendFetch } from "../../../runtime.js";
import { NextResponse } from "../../../runtime.js";
function moved() {
    return NextResponse.json({
        error: "GENERATOR_MOVED_TO_PACKAGE_ENGINE",
        endpoint: "/api/package/quote",
    }, {
        status: 410,
        headers: { "Cache-Control": "no-store" },
    });
}
export async function GET() {
    return moved();
}
export async function POST() {
    return moved();
}
