// Ported from iumrah-web-main 5.zip: app/api/auth/staff/login/route.ts
import { requestEnv, backendFetch } from "../../../../../runtime.js";
import { NextResponse } from "../../../../../runtime.js";
import { createStaffSession, STAFF_SESSION_COOKIE, STAFF_SESSION_MAX_AGE, verifyStaffCredentials, } from "../../../../../lib/staff-auth.js";
export const dynamic = "force-dynamic";
export async function POST(request) {
    let body;
    try {
        body = await request.json();
    }
    catch {
        return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const input = body && typeof body === "object" ? body : {};
    const login = typeof input.login === "string" ? input.login.slice(0, 120) : "";
    const password = typeof input.password === "string" ? input.password.slice(0, 256) : "";
    if (!login || !password) {
        return NextResponse.json({ error: "MISSING_CREDENTIALS" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const result = await verifyStaffCredentials(login, password);
    if (!result.ok) {
        if (result.reason === "NOT_CONFIGURED") {
            return NextResponse.json({ error: "AUTH_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
        }
        await new Promise((resolve) => setTimeout(resolve, 420));
        return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const token = await createStaffSession(result.login);
    const response = NextResponse.json({ ok: true, role: "superadmin", login: result.login }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(STAFF_SESSION_COOKIE, token, {
        httpOnly: true,
        secure: requestEnv().NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: STAFF_SESSION_MAX_AGE,
    });
    return response;
}
