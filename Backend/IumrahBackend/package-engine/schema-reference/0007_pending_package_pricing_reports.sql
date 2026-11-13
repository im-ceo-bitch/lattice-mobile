-- Durable hand-off for a server-owned generator report after a booking exists but
-- before iumrah Business has created its operational pilgrim_trips row.
CREATE TABLE IF NOT EXISTS pending_package_pricing_reports (
  booking_id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL,
  pricing_version TEXT NOT NULL,
  pricing_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_package_pricing_reports_updated_at
ON pending_package_pricing_reports(updated_at);
