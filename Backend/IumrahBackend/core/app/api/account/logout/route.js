// Ported from iumrah-web-main 5.zip: app/api/account/logout/route.ts
import { requestEnv, backendFetch } from "../../../../runtime.js";
import { NextResponse } from "../../../../runtime.js";
import { accountAuthedUpstream, accountCookieOptions, IUMRAH_ACCOUNT_COOKIE } from "../../../../lib/iumrah-account.js";
export const dynamic = "force-dynamic";
export async function POST(request) {
    const upstream = await accountAuthedUpstream(request, "/api/catalog/hotels/client/account/logout", {
        method: "POST",
        body: JSON.stringify({}),
    });
    if (upstream)
        await upstream.arrayBuffer().catch(() => undefined);
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(IUMRAH_ACCOUNT_COOKIE, "", accountCookieOptions(0));
    return response;
}
