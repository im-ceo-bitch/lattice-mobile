import type { Env } from "./env";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, max-age=300" },
});

type SourceRow = {
  provider: string;
  source_url: string;
  provider_hotel_id: string | null;
  canonical_url: string | null;
};

export async function hotelPricingSources(hotelId: string, env: Env): Promise<Response> {
  if (!env.HOTELS_DB) return json({ ok: false, error: "HOTELS_DB binding is not configured" }, 503);
  if (!hotelId || hotelId.length > 180) return json({ ok: false, error: "INVALID_HOTEL" }, 400);
  try {
    const hotel = await env.HOTELS_DB.prepare("SELECT id FROM hotels WHERE id = ? AND status = 'published' LIMIT 1").bind(hotelId).first<{ id: string }>();
    if (!hotel) return json({ ok: false, error: "HOTEL_NOT_FOUND" }, 404);
    const result = await env.HOTELS_DB.prepare(
      `SELECT provider, source_url, provider_hotel_id, canonical_url
       FROM hotel_sources
       WHERE hotel_id = ? AND LOWER(provider) IN ('booking', 'booking.com', 'expedia')
       ORDER BY checked_at DESC`,
    ).bind(hotelId).all<SourceRow>();

    const seen = new Set<string>();
    const sources = (result.results ?? []).flatMap((row) => {
      const raw = String(row.provider ?? "").trim().toLowerCase();
      const provider = raw.startsWith("booking") ? "booking" : raw === "expedia" ? "expedia" : "";
      if (!provider || seen.has(provider)) return [];
      const sourceURL = String(row.source_url ?? "").trim();
      const canonicalURL = String(row.canonical_url ?? "").trim() || null;
      const providerHotelID = String(row.provider_hotel_id ?? "").trim() || null;
      if (!sourceURL.startsWith("https://") && !(canonicalURL ?? "").startsWith("https://")) return [];
      seen.add(provider);
      return [{ provider, sourceURL, providerHotelID, canonicalURL }];
    });
    return json({ ok: true, hotelId, sources });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "HOTEL_PRICING_SOURCES_FAILED" }, 500);
  }
}
