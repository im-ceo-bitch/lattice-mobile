-- New independent Cloudflare D1 database. NEVER run against HOTELS_DB.
CREATE TABLE IF NOT EXISTS flights (
 id TEXT PRIMARY KEY,
 flight_key TEXT NOT NULL UNIQUE,
 airline_code TEXT NOT NULL,
 flight_number TEXT NOT NULL,
 origin TEXT NOT NULL,
 destination TEXT NOT NULL,
 departure_date TEXT NOT NULL,
 departure_at TEXT,
 arrival_at TEXT,
 schedule_source TEXT,
 schedule_observed_at TEXT,
 operational_status TEXT,
 operational_observed_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS flights_departure_idx ON flights(departure_date,airline_code,origin,destination);
CREATE TABLE IF NOT EXISTS flight_offers (
 id TEXT PRIMARY KEY,
 flight_id TEXT NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
 provider TEXT NOT NULL,
 fare_brand TEXT NOT NULL DEFAULT '',
 adults INTEGER NOT NULL DEFAULT 1,
 children INTEGER NOT NULL DEFAULT 0,
 infants INTEGER NOT NULL DEFAULT 0,
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 currency TEXT NOT NULL,
 price_scope TEXT NOT NULL,
 checked_at TEXT NOT NULL,
 expires_at TEXT,
 baggage_checked_kg REAL,
 baggage_cabin_kg REAL,
 seats_left INTEGER,
 source_url TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(flight_id,provider,fare_brand,adults,children,infants,currency)
);
CREATE INDEX IF NOT EXISTS offers_flight_idx ON flight_offers(flight_id,checked_at DESC);
CREATE TABLE IF NOT EXISTS price_history (
 id TEXT PRIMARY KEY,
 offer_id TEXT NOT NULL REFERENCES flight_offers(id),
 amount_minor INTEGER NOT NULL,
 currency TEXT NOT NULL,
 observed_at TEXT NOT NULL,
 provider TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS price_history_offer_idx ON price_history(offer_id,observed_at DESC);
CREATE TABLE IF NOT EXISTS monitor_runs (
 id TEXT PRIMARY KEY,
 provider TEXT NOT NULL,
 checked_at TEXT NOT NULL,
 status TEXT NOT NULL,
 accepted INTEGER NOT NULL DEFAULT 0,
 unmatched INTEGER NOT NULL DEFAULT 0,
 rejected INTEGER NOT NULL DEFAULT 0,
 message TEXT
);
CREATE INDEX IF NOT EXISTS monitor_runs_idx ON monitor_runs(provider,checked_at DESC);
CREATE TABLE IF NOT EXISTS unmatched_observations (
 id TEXT PRIMARY KEY,
 provider TEXT NOT NULL,
 flight_key TEXT,
 airline_code TEXT,
 flight_number TEXT,
 origin TEXT,
 destination TEXT,
 departure_date TEXT,
 reason TEXT NOT NULL,
 observed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS unmatched_idx ON unmatched_observations(provider,observed_at DESC);
