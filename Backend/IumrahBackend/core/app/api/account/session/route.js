// Ported from iumrah-web-main 5.zip: app/api/account/session/route.ts
import { requestEnv, backendFetch } from "../../../../runtime.js";
import { NextResponse } from "../../../../runtime.js";
import { accountAuthedUpstream, jsonPayload, normalizedAccount } from "../../../../lib/iumrah-account.js";
export const dynamic = "force-dynamic";
export async function GET(request) {
    const upstream = await accountAuthedUpstream(request, "/api/catalog/hotels/client/account/session");
    if (!upstream)
        return NextResponse.json({ authenticated: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const payload = await jsonPayload(upstream);
    if (!upstream.ok)
        return NextResponse.json({ authenticated: false, ...payload }, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
    const account = normalizedAccount(payload.account);
    if (!account)
        return NextResponse.json({ authenticated: false, error: "INVALID_ACCOUNT_RESPONSE" }, { status: 502, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ authenticated: true, account }, { headers: { "Cache-Control": "no-store" } });
}
