-- Nuitee Hotels V1; kept isolated from the existing manual hotel inventory.
CREATE TABLE IF NOT EXISTS nuitee_hotel_cache (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nuitee_hotel_cache_expiry ON nuitee_hotel_cache(expires_at);
