// Ported from iumrah-web-main 5.zip: app/api/storefront/hotels/route.ts
import { requestEnv, backendFetch } from "../../../../runtime.js";
import { NextResponse } from "../../../../runtime.js";
export const dynamic = "force-dynamic";
const BACKEND = "https://iumrah-backend.helloiumrah.workers.dev";
function aliases(city) {
    return city === "Makkah"
        ? ["Makkah"]
        : ["Madinah", "Medina", "Madina", "Medinah", "Al Madinah", "Al Medina", "Madinah Al Munawwarah", "Al Madinah Al Munawwarah"];
}
export async function GET(request) {
    const city = request.nextUrl.searchParams.get("city") === "Madinah" ? "Madinah" : "Makkah";
    try {
        const settled = await Promise.allSettled(aliases(city).map(async (alias) => {
            const url = new URL("/api/catalog/hotels", BACKEND);
            url.searchParams.set("city", alias);
            const response = await backendFetch(url, { cache: "no-store" });
            const body = await response.json();
            if (!response.ok)
                throw new Error(body.error || "HOTELS_UNAVAILABLE");
            return body.hotels ?? [];
        }));
        const merged = new Map();
        for (const result of settled) {
            if (result.status !== "fulfilled")
                continue;
            for (const hotel of result.value) {
                if (hotel?.id && hotel?.name)
                    merged.set(hotel.id, hotel);
            }
        }
        const hotels = [...merged.values()];
        if (!hotels.length) {
            return NextResponse.json({ ok: false, error: "HOTELS_UNAVAILABLE", hotels: [] }, { status: 503, headers: { "Cache-Control": "no-store" } });
        }
        return NextResponse.json({ ok: true, city, hotels }, { headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        console.error(`[storefront-hotels] ${city} proxy failed`, error);
        return NextResponse.json({ ok: false, error: "HOTELS_UNAVAILABLE", hotels: [] }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
}
