// Ported from iumrah-web-main 5.zip: app/api/auth/staff/logout/route.ts
import { requestEnv, backendFetch } from "../../../../../runtime.js";
import { NextResponse } from "../../../../../runtime.js";
import { STAFF_SESSION_COOKIE } from "../../../../../lib/staff-auth.js";
export const dynamic = "force-dynamic";
export async function POST() {
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(STAFF_SESSION_COOKIE, "", {
        httpOnly: true,
        secure: requestEnv().NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
    });
    return response;
}
