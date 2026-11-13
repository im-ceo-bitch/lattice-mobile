// Ported from iumrah-web-main 5.zip: app/api/account/register/confirm/route.ts
import { requestEnv, backendFetch } from "../../../../../runtime.js";
import { NextResponse } from "../../../../../runtime.js";
import { accountCookieOptions, accountUpstream, IUMRAH_ACCOUNT_COOKIE, jsonPayload, normalizedAccount } from "../../../../../lib/iumrah-account.js";
export const dynamic = "force-dynamic";
export async function POST(request) {
    const body = await request.json().catch(() => null);
    if (!body?.challengeID || !body.code || !body.password || !body.device) {
        return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const upstream = await accountUpstream("/api/package/client/account/register/email/confirm", {
        method: "POST",
        body: JSON.stringify(body),
    });
    const payload = await jsonPayload(upstream);
    if (!upstream.ok)
        return NextResponse.json(payload, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
    const account = normalizedAccount(payload.account);
    const session = object(payload.session);
    const token = typeof session.token === "string" ? session.token : "";
    if (!account || !token) {
        return NextResponse.json({ error: "INVALID_ACCOUNT_RESPONSE" }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
    const response = NextResponse.json({ ok: true, account }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(IUMRAH_ACCOUNT_COOKIE, token, accountCookieOptions());
    return response;
}
function object(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
