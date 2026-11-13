// Ported from iumrah-web-main 5.zip: app/api/account/login/route.ts
import { requestEnv, backendFetch } from "../../../../runtime.js";
import { NextResponse } from "../../../../runtime.js";
import { accountCookieOptions, accountUpstream, formatIumrahID, IUMRAH_ACCOUNT_COOKIE, jsonPayload, normalizedAccount } from "../../../../lib/iumrah-account.js";
export const dynamic = "force-dynamic";
export async function POST(request) {
    let body;
    try {
        body = await request.json();
    }
    catch {
        return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const rawIdentifier = typeof body.identifier === "string" ? body.identifier.trim().slice(0, 254) : "";
    const digits = rawIdentifier.replace(/\D/g, "");
    const identifier = /^\d{6}$/.test(digits) || /^\d{8}$/.test(digits) ? formatIumrahID(digits) : rawIdentifier.toLowerCase();
    const password = typeof body.password === "string" ? body.password.slice(0, 256) : "";
    if (!identifier || password.length < 8 || !body.device) {
        return NextResponse.json({ error: "MISSING_CREDENTIALS" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const upstream = await accountUpstream("/api/package/client/account/login", {
        method: "POST",
        body: JSON.stringify({ identifier, password, device: body.device }),
    });
    const payload = await jsonPayload(upstream);
    if (!upstream.ok)
        return NextResponse.json(payload, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
    const account = normalizedAccount(payload.account);
    const session = payload.session && typeof payload.session === "object" ? payload.session : {};
    const token = typeof session.token === "string" ? session.token : "";
    if (!account || !token)
        return NextResponse.json({ error: "INVALID_ACCOUNT_RESPONSE" }, { status: 502, headers: { "Cache-Control": "no-store" } });
    const response = NextResponse.json({ ok: true, account }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(IUMRAH_ACCOUNT_COOKIE, token, accountCookieOptions());
    return response;
}
