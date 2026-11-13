// Ported from iumrah-web-main 5.zip: app/api/telegram/consent/challenge/route.ts
import { requestEnv, backendFetch } from "../../../../../runtime.js";
import { NextResponse } from "../../../../../runtime.js";
import { randomSecret, telegramConfiguration } from "../../../../../lib/telegram-booking.js";
export const dynamic = "force-dynamic";
export async function GET(request) {
    const config = telegramConfiguration();
    if (!config.configured)
        return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
    // Reuse the same browser nonce while it is active. Multiple UI controls can
    // mount at once; overwriting the cookie would invalidate an open Telegram popup.
    const existing = request.cookies.get("iumrah_tg_nonce")?.value || "";
    const nonce = /^[a-f0-9]{64}$/.test(existing) ? existing : randomSecret();
    const response = NextResponse.json({ enabled: true, clientId: config.clientId, nonce }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set("iumrah_tg_nonce", nonce, {
        httpOnly: true, secure: requestEnv().NODE_ENV === "production", sameSite: "lax", path: "/api/telegram/consent", maxAge: 600,
    });
    return response;
}
