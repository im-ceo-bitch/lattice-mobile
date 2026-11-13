import type { D1Like } from "./d1";

export type IumrahRoomCategory = "DOUBLE" | "TRIPLE" | "QUADRUPLE";

export type HotelRoomCategoryRecord = {
  id: string;
  hotel_id: string;
  category: IumrahRoomCategory;
  display_name: string;
  max_guests: number;
  bed_configuration: string;
  position: number;
  active: number;
  source: string;
  updated_at: string;
};

export type BookingRoomSchemaDb = D1Like;

const CATEGORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS hotel_room_categories (
  id TEXT PRIMARY KEY,
  hotel_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('DOUBLE', 'TRIPLE', 'QUADRUPLE')),
  display_name TEXT NOT NULL,
  max_guests INTEGER NOT NULL,
  bed_configuration TEXT NOT NULL,
  position INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'iumrah-default',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hotel_id, category)
)`;

const CATEGORY_INDEX = `
CREATE INDEX IF NOT EXISTS idx_hotel_room_categories_hotel
ON hotel_room_categories(hotel_id, active, position)
`;

const CATEGORY_SEED_SQL = `
INSERT OR IGNORE INTO hotel_room_categories
  (id, hotel_id, category, display_name, max_guests, bed_configuration, position, active, source, updated_at)
SELECT id || ':DOUBLE', id, 'DOUBLE', 'Double Room', 2, '1 King Bed', 1, 1, 'iumrah-default', CURRENT_TIMESTAMP
FROM hotels
WHERE status = 'published'
UNION ALL
SELECT id || ':TRIPLE', id, 'TRIPLE', 'Triple Room', 3, '3 Single Beds', 2, 1, 'iumrah-default', CURRENT_TIMESTAMP
FROM hotels
WHERE status = 'published'
UNION ALL
SELECT id || ':QUADRUPLE', id, 'QUADRUPLE', 'Quadruple Room', 4, '4 Single Beds', 3, 1, 'iumrah-default', CURRENT_TIMESTAMP
FROM hotels
WHERE status = 'published'
`;

export async function ensureHotelRoomCategories(db: D1Like) {
  await db.prepare(CATEGORY_SCHEMA).run();
  await db.prepare(CATEGORY_INDEX).run();
  await db.prepare(CATEGORY_SEED_SQL).run();
}

export async function listHotelRoomCategories(db: D1Like, hotelId: string) {
  await ensureHotelRoomCategories(db);

  const hotel = await db.prepare(
    "SELECT id FROM hotels WHERE id = ?1 AND status = 'published' LIMIT 1",
  ).bind(hotelId).first<{ id: string }>();
  if (!hotel) return null;

  const result = await db.prepare(
    `SELECT id, hotel_id, category, display_name, max_guests, bed_configuration, position, active, source, updated_at
     FROM hotel_room_categories
     WHERE hotel_id = ?1 AND active = 1
     ORDER BY position ASC`,
  ).bind(hotelId).all<HotelRoomCategoryRecord>();

  return result.results ?? [];
}

export async function findHotelRoomCategory(db: D1Like, hotelId: string, category: IumrahRoomCategory) {
  await ensureHotelRoomCategories(db);
  return db.prepare(
    `SELECT id, hotel_id, category, display_name, max_guests, bed_configuration, position, active, source, updated_at
     FROM hotel_room_categories
     WHERE hotel_id = ?1 AND category = ?2 AND active = 1
     LIMIT 1`,
  ).bind(hotelId, category).first<HotelRoomCategoryRecord>();
}

export function parseRoomCategory(value: unknown): IumrahRoomCategory | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === "DOUBLE" || normalized === "TRIPLE" || normalized === "QUADRUPLE") {
    return normalized;
  }
  return null;
}

async function bookingColumns(db: BookingRoomSchemaDb) {
  const result = await db.prepare('PRAGMA table_info("bookings")').all<{ name: string }>();
  return new Set((result.results ?? []).map((row) => row.name));
}

async function addBookingColumn(db: BookingRoomSchemaDb, sql: string) {
  try {
    await db.prepare(sql).run();
  } catch (error) {
    // Two cold workers can race during the first post-deploy health check. If the
    // other worker already created the same column, keep the migration idempotent.
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (!message.includes("duplicate column") && !message.includes("already exists")) throw error;
  }
}

export async function ensureBookingRoomColumns(db: BookingRoomSchemaDb) {
  const columns = await bookingColumns(db);
  if (!columns.has("makkah_room_category")) {
    await addBookingColumn(db, "ALTER TABLE bookings ADD COLUMN makkah_room_category TEXT");
  }
  if (!columns.has("makkah_room_name")) {
    await addBookingColumn(db, "ALTER TABLE bookings ADD COLUMN makkah_room_name TEXT");
  }
  if (!columns.has("makkah_room_id")) {
    await addBookingColumn(db, "ALTER TABLE bookings ADD COLUMN makkah_room_id TEXT");
  }
}

export async function countActiveHotelRoomCategories(db: D1Like) {
  await ensureHotelRoomCategories(db);
  const row = await db.prepare(
    "SELECT COUNT(*) AS count FROM hotel_room_categories WHERE active = 1",
  ).first<{ count: number | string }>();
  return Number(row?.count ?? 0);
}
