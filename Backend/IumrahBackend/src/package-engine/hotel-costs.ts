import type { D1Like } from "./d1";

export type ServerHotelPricingInput = {
  amountUsd: number;
  unit: "perRoomNight";
  nights: number;
  hotelId: string;
  roomId: string | null;
  pricingMode: string;
};

type HotelPriceRow = {
  id: string;
  city: string;
  cached_nightly_usd: number | string | null;
  override_nightly_usd: number | string | null;
  provider: string | null;
  method: string | null;
  status: string | null;
  fetched_at: string | null;
  override_updated_at: string | null;
};

export async function resolveServerHotelPricing(
  db: D1Like | undefined,
  hotelId: string,
  roomId: string | null,
  nights: number,
): Promise<ServerHotelPricingInput> {
  if (!db) throw new Error("HOTELS_DB_NOT_CONFIGURED");
  const cleanHotelID = String(hotelId ?? "").trim();
  const cleanRoomID = String(roomId ?? "").trim() || null;
  if (!cleanHotelID || cleanHotelID.length > 180) throw new Error("INVALID_HOTEL");
  if (!Number.isInteger(nights) || nights < 1 || nights > 90) throw new Error("INVALID_HOTEL_NIGHTS");

  const row = await db.prepare(
    `SELECT h.id, h.city,
       hp.nightly_price_usd AS cached_nightly_usd,
       hpo.nightly_price_usd AS override_nightly_usd,
       hp.provider, hp.method, hp.status, hp.fetched_at,
       hpo.updated_at AS override_updated_at
     FROM hotels h
     LEFT JOIN hotel_price_cache hp ON hp.hotel_id = h.id
     LEFT JOIN hotel_price_overrides hpo ON hpo.hotel_id = h.id
     WHERE h.id = ?1 AND h.status = 'published'
     LIMIT 1`,
  ).bind(cleanHotelID).first<HotelPriceRow>();
  if (!row) throw new Error("HOTEL_NOT_FOUND");

  const manual = Number(row.override_nightly_usd ?? 0);
  const cached = Number(row.cached_nightly_usd ?? 0);
  const nightly = Number.isFinite(manual) && manual > 0 ? manual : cached;
  if (!Number.isFinite(nightly) || nightly <= 0) throw new Error("HOTEL_PRICE_UNAVAILABLE");

  // The room category currently does not change the Business nightly rate, but
  // validate a category-style id when present so a quote cannot attach a room
  // from another hotel to the immutable pricing report.
  if (cleanRoomID) {
    const category = await db.prepare(
      `SELECT id FROM hotel_room_categories
       WHERE id = ?1 AND hotel_id = ?2 AND active = 1 LIMIT 1`,
    ).bind(cleanRoomID, cleanHotelID).first<{ id: string }>().catch(() => null);

    if (!category) {
      // Legacy catalogue rooms use a separate table. Keep backward compatibility
      // without trusting arbitrary cross-hotel identifiers.
      const legacy = await db.prepare(
        `SELECT id FROM hotel_rooms WHERE id = ?1 AND hotel_id = ?2 LIMIT 1`,
      ).bind(cleanRoomID, cleanHotelID).first<{ id: string }>().catch(() => null);
      if (!legacy) throw new Error("HOTEL_ROOM_MISMATCH");
    }
  }

  const pricingMode = Number.isFinite(manual) && manual > 0
    ? "iumrah-business-manual-override"
    : `iumrah-business-${String(row.provider || row.method || row.status || "catalog").toLowerCase()}`;

  return {
    amountUsd: Math.round(nightly * 100) / 100,
    unit: "perRoomNight",
    nights,
    hotelId: cleanHotelID,
    roomId: cleanRoomID,
    pricingMode,
  };
}
