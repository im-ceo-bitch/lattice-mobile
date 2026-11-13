import type { Env } from "./env";

type City = "Makkah" | "Madinah";

function canonicalCity(value: string | null): City | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["makkah", "mecca", "makka"].includes(normalized)) return "Makkah";
  if ([
    "madinah", "medina", "madina", "medinah",
    "al madinah", "al medina", "al madina", "al medinah",
    "madinah al munawwarah", "medina al munawwarah", "madina al munawwarah",
    "al madinah al munawwarah", "al medina al munawwarah", "al madina al munawwarah",
  ].includes(normalized)) return "Madinah";
  return null;
}

// Primary Hotels are maintained by Business and older hotel rows can contain
// several English spellings of the same Saudi city. Normalize both the curation
// row and the hotel catalogue row inside SQL so one spelling cannot make a valid
// Primary Hotel disappear from the generator.
const NORMALIZED_CITY_SQL = `(CASE
  WHEN LOWER(TRIM(%COLUMN%)) IN ('makkah','mecca','makka') THEN 'makkah'
  WHEN LOWER(TRIM(%COLUMN%)) IN ('madinah','medina','madina','medinah','al madinah','al medina','al madina','al medinah','madinah al munawwarah','medina al munawwarah','madina al munawwarah','al madinah al munawwarah','al medina al munawwarah','al madina al munawwarah') THEN 'madinah'
  ELSE LOWER(TRIM(%COLUMN%))
END)`;

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * Resolves the recommended Primary Hotel maintained by iumrah Business.
 * The Primary Hotel category is an editorial generator category: a hotel can be
 * assigned to a different category than its factual property star rating.
 *
 * Generator eligibility is coupled to the hotel catalog's server-maintained
 * accepted price. A late provider refresh does not invalidate the last known D1
 * room-night rate, and a Business manual override is immediately eligible. Beta
 * never scrapes Booking/Expedia directly.
 */
export async function curatedPrimaryHotel(url: URL, env: Env) {
  if (!env.HOTELS_DB) return json({ ok: false, error: "HOTELS_DB binding is not configured" }, 503);

  const stars = Number(url.searchParams.get("stars"));
  const city = canonicalCity(url.searchParams.get("city"));
  if (!city || !Number.isInteger(stars) || stars < 1 || stars > 5) {
    return json({ ok: false, error: "stars and city are required" }, 400);
  }

  try {
    const curatedCitySQL = NORMALIZED_CITY_SQL.split("%COLUMN%").join("p.city");
    const curated = await env.HOTELS_DB.prepare(
      `SELECT p.position, h.id AS hotel_id, h.stars, h.city
       FROM primary_hotels p
       INNER JOIN hotels h ON h.id = p.hotel_id
       LEFT JOIN hotel_price_cache hp ON hp.hotel_id = h.id
       LEFT JOIN hotel_price_overrides hpo ON hpo.hotel_id = h.id
       WHERE ${curatedCitySQL} = LOWER(?1)
         AND p.star_category = ?2
         AND h.status = 'published'
         AND COALESCE(hpo.nightly_price_usd, hp.nightly_price_usd) IS NOT NULL
         AND COALESCE(hpo.nightly_price_usd, hp.nightly_price_usd) > 0
       ORDER BY p.position ASC
       LIMIT 1`,
    ).bind(city, stars).first<{ position: number; hotel_id: string; stars: number | null; city: string }>();

    if (curated) {
      return json({
        ok: true,
        hotelId: curated.hotel_id,
        roomId: null,
        tier: url.searchParams.get("tier") ?? null,
        stars: Number(curated.stars ?? stars),
        city,
        requestedTier: url.searchParams.get("tier") ?? null,
        requestedStars: stars,
        matchType: "curatedPrimary",
        isFallback: false,
        pricingMode: "catalog48h",
        position: Number(curated.position),
      });
    }

    // Keep generation usable when Business has not curated a slot yet, but this
    // is still only hotel selection. It never fabricates a price.
    const catalogCitySQL = NORMALIZED_CITY_SQL.split("%COLUMN%").join("h.city");
    const catalog = await env.HOTELS_DB.prepare(
      `SELECT h.id, h.stars, h.city
       FROM hotels h
       LEFT JOIN hotel_price_cache hp ON hp.hotel_id = h.id
       LEFT JOIN hotel_price_overrides hpo ON hpo.hotel_id = h.id
       WHERE h.status = 'published'
         AND ${catalogCitySQL} = LOWER(?1)
         AND h.stars = ?2
         AND COALESCE(hpo.nightly_price_usd, hp.nightly_price_usd) IS NOT NULL
         AND COALESCE(hpo.nightly_price_usd, hp.nightly_price_usd) > 0
       ORDER BY h.rating DESC, h.review_count DESC, h.updated_at DESC
       LIMIT 1`,
    ).bind(city, stars).first<{ id: string; stars: number | null; city: string }>();

    if (!catalog) return json({ ok: false, error: `No published ${stars}-star hotel is available for ${city}` }, 404);
    return json({
      ok: true,
      hotelId: catalog.id,
      roomId: null,
      tier: url.searchParams.get("tier") ?? null,
      stars: Number(catalog.stars ?? stars),
      city,
      requestedTier: url.searchParams.get("tier") ?? null,
      requestedStars: stars,
      matchType: "catalogFallback",
      isFallback: true,
      pricingMode: "catalog48h",
      position: null,
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "PRIMARY_HOTEL_LOOKUP_FAILED" }, 500);
  }
}
