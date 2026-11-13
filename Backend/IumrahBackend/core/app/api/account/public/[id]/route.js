// Ported from iumrah-web-main 5.zip: app/api/account/public/[id]/route.ts
import { requestEnv, backendFetch } from "../../../../../runtime.js";
import { NextResponse } from "../../../../../runtime.js";
import { accountUpstream, formatIumrahID, jsonPayload } from "../../../../../lib/iumrah-account.js";
export const dynamic = "force-dynamic";
export async function GET(request, context) {
    const { id } = await context.params;
    const normalized = formatIumrahID(id);
    const token = new URL(request.url).searchParams.get("v")?.trim() ?? "";
    if (!/^\d{8}$/.test(normalized) || !/^[A-Za-z0-9_-]{20,128}$/.test(token)) {
        return NextResponse.json({ error: "IDENTITY_LINK_REQUIRED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const upstream = await accountUpstream(`/api/package/public/id/${encodeURIComponent(normalized)}?v=${encodeURIComponent(token)}`);
    const payload = await jsonPayload(upstream);
    return NextResponse.json(payload, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
}
