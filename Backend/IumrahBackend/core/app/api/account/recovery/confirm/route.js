// Ported from iumrah-web-main 5.zip: app/api/account/recovery/confirm/route.ts
import { requestEnv, backendFetch } from "../../../../../runtime.js";
import { NextResponse } from "../../../../../runtime.js";
import { accountUpstream, jsonPayload } from "../../../../../lib/iumrah-account.js";
export const dynamic = "force-dynamic";
export async function POST(request) {
    const body = await request.json().catch(() => null);
    if (!body?.challengeID || !body.code || !body.newPassword) {
        return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const upstream = await accountUpstream("/api/package/client/account/password/recovery/confirm", {
        method: "POST",
        body: JSON.stringify(body),
    });
    const payload = await jsonPayload(upstream);
    return NextResponse.json(payload, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
}
