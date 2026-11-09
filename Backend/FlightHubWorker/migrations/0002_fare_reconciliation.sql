-- Additive migration: never rename an existing table, never touch HOTELS_DB.
-- Quarantines implausible changes instead of changing a currently visible fare.
CREATE TABLE IF NOT EXISTS fare_review_queue (
  id TEXT PRIMARY KEY,
  flight_id TEXT NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  offer_id TEXT NOT NULL REFERENCES flight_offers(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  old_amount_minor INTEGER NOT NULL,
  proposed_amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  reason TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS fare_review_pending_idx ON fare_review_queue(reviewed_at, observed_at DESC);
CREATE INDEX IF NOT EXISTS fare_review_offer_idx ON fare_review_queue(offer_id, observed_at DESC);
