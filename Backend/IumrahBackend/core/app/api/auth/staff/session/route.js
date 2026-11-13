// Ported from iumrah-web-main 5.zip: app/api/auth/staff/session/route.ts
import { requestEnv, backendFetch } from "../../../../../runtime.js";
import { NextResponse } from "../../../../../runtime.js";
import { readCookie, STAFF_SESSION_COOKIE, verifyStaffSessionToken } from "../../../../../lib/staff-auth.js";
export const dynamic = "force-dynamic";
export async function GET(request) {
    const token = readCookie(request.headers.get("cookie"), STAFF_SESSION_COOKIE);
    const session = await verifyStaffSessionToken(token);
    if (!session) {
        return NextResponse.json({ authenticated: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ authenticated: true, user: { login: session.sub, role: session.role, displayName: session.displayName } }, { headers: { "Cache-Control": "no-store" } });
}
