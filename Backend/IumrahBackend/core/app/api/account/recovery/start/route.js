// Ported from iumrah-web-main 5.zip: app/api/account/recovery/start/route.ts
import { requestEnv, backendFetch } from "../../../../../runtime.js";
import { NextResponse } from "../../../../../runtime.js";
import { accountUpstream, jsonPayload } from "../../../../../lib/iumrah-account.js";
export const dynamic = "force-dynamic";
export async function POST(request) {
    const body = await request.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().slice(0, 254) : "";
    const locale = typeof body?.locale === "string" ? body.locale.slice(0, 24) : "";
    if (!email || !email.includes("@")) {
        return NextResponse.json({ error: "EMAIL_INVALID" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const upstream = await accountUpstream("/api/package/client/account/password/recovery/start", {
        method: "POST",
        body: JSON.stringify({ email, locale }),
    });
    const payload = await jsonPayload(upstream);
    return NextResponse.json(payload, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
}
