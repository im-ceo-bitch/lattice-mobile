-- Unified catalog source data. Non-bookable discoveries NEVER enter flight_offers/price_history.
CREATE TABLE IF NOT EXISTS flight_discovery_details (
 source TEXT NOT NULL,
 discovery_key TEXT NOT NULL,
 route_signature TEXT,
 quality TEXT NOT NULL CHECK (quality IN ('complete','partial','unverified')),
 details_json TEXT NOT NULL,
 received_at TEXT NOT NULL,
 PRIMARY KEY(source,discovery_key),
 FOREIGN KEY(source,discovery_key) REFERENCES flight_discovery_cache(source,discovery_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS flight_discovery_signature_idx ON flight_discovery_details(route_signature);
CREATE TABLE IF NOT EXISTS flight_itinerary_bundle_offers (
 id TEXT PRIMARY KEY,
 itinerary_id TEXT NOT NULL REFERENCES flight_itineraries(id) ON DELETE CASCADE,
 provider TEXT NOT NULL,
 source_reference TEXT,
 fare_brand TEXT NOT NULL DEFAULT '',
 adults INTEGER NOT NULL DEFAULT 1,
 children INTEGER NOT NULL DEFAULT 0,
 infants INTEGER NOT NULL DEFAULT 0,
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 currency TEXT NOT NULL,
 price_scope TEXT NOT NULL,
 checked_at TEXT NOT NULL,
 expires_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(itinerary_id,provider,fare_brand,adults,children,infants,currency)
);
CREATE INDEX IF NOT EXISTS flight_bundle_offer_idx ON flight_itinerary_bundle_offers(itinerary_id,checked_at DESC);
CREATE TABLE IF NOT EXISTS flight_itinerary_bundle_history (
 id TEXT PRIMARY KEY,
 bundle_offer_id TEXT NOT NULL REFERENCES flight_itinerary_bundle_offers(id) ON DELETE CASCADE,
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 currency TEXT NOT NULL,
 observed_at TEXT NOT NULL,
 provider TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS flight_bundle_history_idx ON flight_itinerary_bundle_history(bundle_offer_id,observed_at DESC);
CREATE TABLE IF NOT EXISTS flight_monitor_attempts (
 id TEXT PRIMARY KEY,
 provider TEXT NOT NULL,
 flight_key TEXT NOT NULL,
 attempted_at TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('verified','unchanged','no_fares','blocked','site_changed','failed')),
 message TEXT,
 run_id TEXT
);
CREATE INDEX IF NOT EXISTS flight_monitor_attempts_idx ON flight_monitor_attempts(provider,attempted_at DESC);
CREATE TABLE IF NOT EXISTS flight_push_delivery (
 event_id TEXT PRIMARY KEY REFERENCES flight_price_change_outbox(id) ON DELETE CASCADE,
 lease_until TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 1,
 last_error TEXT,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS flight_source_search_runs (
 source TEXT NOT NULL,
 search_key TEXT NOT NULL,
 searched_at TEXT NOT NULL,
 status TEXT NOT NULL,
 items_count INTEGER NOT NULL DEFAULT 0,
 message TEXT,
 PRIMARY KEY(source,search_key)
);
CREATE INDEX IF NOT EXISTS flight_source_search_runs_idx ON flight_source_search_runs(source,searched_at);
CREATE TABLE IF NOT EXISTS flight_ignav_references (
 offer_id TEXT PRIMARY KEY REFERENCES flight_offers(id) ON DELETE CASCADE,
 ignav_id TEXT NOT NULL,
 observed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS flight_source_search_attempt_log (
 id TEXT PRIMARY KEY,
 source TEXT NOT NULL,
 search_key TEXT NOT NULL,
 attempted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS flight_source_search_budget_idx ON flight_source_search_attempt_log(source,attempted_at);
