// Ported from iumrah-web-main 5.zip: app/api/admin/chats/route.ts
import { requestEnv, backendFetch } from "../../../../runtime.js";
import { NextResponse } from "../../../../runtime.js";
import { readCookie, STAFF_SESSION_COOKIE, verifyStaffSessionToken } from "../../../../lib/staff-auth.js";
import { ensureChatSchema, getChatDb, listChatThreads } from "../../../../lib/chat-store.js";
export const dynamic = "force-dynamic";
export async function GET(request) {
    const session = await verifyStaffSessionToken(readCookie(request.headers.get("cookie"), STAFF_SESSION_COOKIE));
    if (!session)
        return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const db = getChatDb();
    if (!db)
        return NextResponse.json({ error: "CHAT_DB_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    try {
        await ensureChatSchema(db);
        return NextResponse.json({ threads: await listChatThreads(db) }, { headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        console.error("admin-chat-list-failed", error);
        return NextResponse.json({ error: "CHAT_LIST_FAILED" }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
}
