// Ported from iumrah-web-main 5.zip: app/api/chat/[id]/route.ts
import { requestEnv, backendFetch } from "../../../../runtime.js";
import { NextResponse } from "../../../../runtime.js";
import { authorizePilgrimBooking, ensureChatSchema, getChatDb, insertMessage, markRead, readMessages } from "../../../../lib/chat-store.js";
import { rowToSummary } from "../../../../lib/booking-store.js";
export const dynamic = "force-dynamic";
function token(request) { return request.headers.get("x-booking-token")?.trim() ?? ""; }
function bodyText(value) {
    if (!value || typeof value !== "object")
        return "";
    const raw = value.message;
    return typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim().slice(0, 2000) : "";
}
export async function GET(request, { params }) {
    const { id } = await params;
    const db = getChatDb();
    if (!db)
        return NextResponse.json({ error: "CHAT_DB_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    try {
        await ensureChatSchema(db);
        const bookingRow = await authorizePilgrimBooking(db, id, token(request));
        if (!bookingRow)
            return NextResponse.json({ error: "CHAT_NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
        const messages = await readMessages(db, id);
        await markRead(db, id, "pilgrim");
        return NextResponse.json({ booking: rowToSummary(bookingRow), messages }, { headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        console.error("pilgrim-chat-read-failed", error);
        return NextResponse.json({ error: "CHAT_READ_FAILED" }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
}
export async function POST(request, { params }) {
    const { id } = await params;
    const db = getChatDb();
    if (!db)
        return NextResponse.json({ error: "CHAT_DB_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    let body;
    try {
        body = await request.json();
    }
    catch {
        return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    const message = bodyText(body);
    if (!message)
        return NextResponse.json({ error: "EMPTY_MESSAGE" }, { status: 400 });
    try {
        await ensureChatSchema(db);
        const bookingRow = await authorizePilgrimBooking(db, id, token(request));
        if (!bookingRow)
            return NextResponse.json({ error: "CHAT_NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
        const created = await insertMessage(db, id, "pilgrim", "booking-holder", message);
        return NextResponse.json({ message: created }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        if (error instanceof Error && error.message === "CHAT_RATE_LIMIT")
            return NextResponse.json({ error: "RATE_LIMIT" }, { status: 429 });
        console.error("pilgrim-chat-send-failed", error);
        return NextResponse.json({ error: "CHAT_SEND_FAILED" }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
}
