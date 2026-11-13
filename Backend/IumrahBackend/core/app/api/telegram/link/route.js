// Ported from iumrah-web-main 5.zip: app/api/telegram/link/route.ts
import { requestEnv, backendFetch } from "../../../../runtime.js";
import { getCloudflareContext } from "../../../../runtime.js";
import { NextResponse } from "../../../../runtime.js";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
function clean(value, max = 512) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function cloudflareEnv() {
    try {
        return getCloudflareContext().env;
    }
    catch {
        return {};
    }
}
async function callBotViaService(binding, body) {
    // Service bindings require a fully-qualified URL, but route traffic directly
    // to the bound Worker without using the public Internet.
    const request = new Request("https://iumrah-telegram.internal/internal/link-token", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "accept": "application/json",
            "x-iumrah-source": "iumrah-web",
        },
        body,
    });
    return binding.fetch(request);
}
async function callBotViaLegacyUrl(env, body) {
    const workerURL = clean(requestEnv().IUMRAH_TELEGRAM_BOT_WORKER_URL ?? env.IUMRAH_TELEGRAM_BOT_WORKER_URL).replace(/\/+$/, "");
    if (!workerURL)
        return null;
    const secret = clean(requestEnv().IUMRAH_TELEGRAM_BRIDGE_SECRET ?? env.IUMRAH_TELEGRAM_BRIDGE_SECRET, 1024);
    return backendFetch(`${workerURL}/internal/link-token`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "accept": "application/json",
            ...(secret ? { "authorization": `Bearer ${secret}` } : {}),
        },
        body,
        cache: "no-store",
    });
}
export async function POST(request) {
    const bookingToken = clean(request.headers.get("x-booking-token"), 256);
    if (bookingToken.length < 24) {
        return NextResponse.json({ error: "BOOKING_TOKEN_MISSING" }, { status: 400, headers: NO_STORE });
    }
    let input;
    try {
        input = await request.json();
    }
    catch {
        return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers: NO_STORE });
    }
    const bookingId = clean(input.bookingId ?? input.bookingID, 64);
    const language = clean(input.language, 16) || "ru";
    if (!/^IUM-\d{4}-[A-Z2-9]{7}$/.test(bookingId)) {
        return NextResponse.json({ error: "INVALID_BOOKING_ID" }, { status: 400, headers: NO_STORE });
    }
    const body = JSON.stringify({ bookingId, bookingToken, language });
    const env = cloudflareEnv();
    try {
        let upstream = null;
        let transport = "service-binding";
        if (env.IUMRAH_TELEGRAM_BOT && typeof env.IUMRAH_TELEGRAM_BOT.fetch === "function") {
            upstream = await callBotViaService(env.IUMRAH_TELEGRAM_BOT, body);
        }
        else {
            transport = "legacy-url";
            upstream = await callBotViaLegacyUrl(env, body);
        }
        if (!upstream) {
            return NextResponse.json({ error: "TELEGRAM_SERVICE_BINDING_MISSING" }, { status: 503, headers: NO_STORE });
        }
        const payload = await upstream.json().catch(() => null);
        if (!payload) {
            console.error("telegram-link-invalid-upstream-response", { status: upstream.status, transport });
            return NextResponse.json({ error: "TELEGRAM_BOT_INVALID_RESPONSE" }, { status: 502, headers: NO_STORE });
        }
        if (!upstream.ok) {
            console.error("telegram-link-upstream-error", { status: upstream.status, transport, error: payload.error });
            return NextResponse.json({ ...payload, error: clean(payload.error, 96) || `TELEGRAM_BOT_HTTP_${upstream.status}` }, { status: upstream.status, headers: NO_STORE });
        }
        const linkUrl = clean(payload.linkUrl, 2048);
        if (!/^https:\/\/t\.me\//i.test(linkUrl)) {
            console.error("telegram-link-url-missing", { transport, hasLink: Boolean(linkUrl) });
            return NextResponse.json({ error: "TELEGRAM_LINK_URL_MISSING" }, { status: 502, headers: NO_STORE });
        }
        return NextResponse.json({ ...payload, linkUrl }, { status: 200, headers: NO_STORE });
    }
    catch (error) {
        console.error("telegram-link-create-failed", error);
        return NextResponse.json({ error: "TELEGRAM_BRIDGE_UNAVAILABLE" }, { status: 502, headers: NO_STORE });
    }
}
