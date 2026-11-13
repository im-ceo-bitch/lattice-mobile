// Ported from iumrah-web-main 5.zip: app/api/account/public-card/route.ts
import { requestEnv, backendFetch } from "../../../../runtime.js";
import { NextResponse } from "../../../../runtime.js";
import { accountAuthedUpstream, jsonPayload } from "../../../../lib/iumrah-account.js";
export const dynamic = "force-dynamic";
export async function GET(request) {
    const upstream = await accountAuthedUpstream(request, "/api/package/client/account/public-card");
    if (!upstream)
        return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const payload = await jsonPayload(upstream);
    return NextResponse.json(payload, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
}
