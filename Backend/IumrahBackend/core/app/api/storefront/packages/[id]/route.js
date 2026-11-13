// Ported from iumrah-web-main 5.zip: app/api/storefront/packages/[id]/route.ts
import { requestEnv, backendFetch } from "../../../../../runtime.js";
import { NextResponse } from "../../../../../runtime.js";
import { readStorefrontPackageSnapshot } from "../../../../../lib/storefront-cache.js";
export const dynamic = "force-dynamic";
export async function GET(_request, context) {
    const { id } = await context.params;
    const snapshot = await readStorefrontPackageSnapshot(id);
    if (!snapshot) {
        return NextResponse.json({ ok: false, error: "PACKAGE_NOT_FOUND" }, { status: 404 });
    }
    if (snapshot.isExpired) {
        return NextResponse.json({
            ok: false,
            error: "PACKAGE_EXPIRED",
            packageId: id,
            expiredAt: snapshot.expiresAt,
        }, { status: 410, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({
        ok: true,
        package: snapshot.item,
        generatedAt: snapshot.generatedAt,
        expiresAt: snapshot.expiresAt,
        expired: false,
        parentPackageId: snapshot.parentPackageId,
    }, { headers: { "Cache-Control": "no-store" } });
}
