-- IUMRAH · Public viewing links — additive, no private data or raw token stored.
-- Applied by scripts/apply-package-schema.mjs before publishing the one Worker.
CREATE TABLE IF NOT EXISTS booking_public_shares (
  token_hash TEXT PRIMARY KEY NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_booking_public_shares_booking_id
  ON booking_public_shares (booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_public_shares_expiry
  ON booking_public_shares (expires_at);
