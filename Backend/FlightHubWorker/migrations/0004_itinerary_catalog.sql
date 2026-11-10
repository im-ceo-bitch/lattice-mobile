-- iumrah Flight Catalog V2. ADDITIVE ONLY: one existing flights row = one segment.
-- Run against FLIGHTS_DB ONLY after a backup and verification. Do not run on HOTELS_DB.
-- A flight is not a price; an itinerary is an ordered set of one or more flight segments.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS flight_itineraries (
  id TEXT PRIMARY KEY,
  itinerary_key TEXT NOT NULL UNIQUE,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  departure_date TEXT NOT NULL,
  segment_count INTEGER NOT NULL CHECK(segment_count >= 1),
  stop_count INTEGER NOT NULL CHECK(stop_count >= 0),
  detail_status TEXT NOT NULL DEFAULT 'needs_confirmation' CHECK(detail_status IN ('complete','needs_confirmation')),
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS flight_itineraries_route_idx ON flight_itineraries(origin,destination,departure_date);
CREATE TABLE IF NOT EXISTS flight_itinerary_segments (
  itinerary_id TEXT NOT NULL REFERENCES flight_itineraries(id) ON DELETE CASCADE,
  segment_order INTEGER NOT NULL CHECK(segment_order >= 0),
  flight_id TEXT NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  transfer_type TEXT NOT NULL DEFAULT 'unknown' CHECK(transfer_type IN ('through','self_transfer','unknown')),
  PRIMARY KEY(itinerary_id,segment_order)
);
CREATE INDEX IF NOT EXISTS flight_itinerary_segments_flight_idx ON flight_itinerary_segments(flight_id);
CREATE TABLE IF NOT EXISTS flight_itinerary_offers (
  itinerary_id TEXT NOT NULL REFERENCES flight_itineraries(id) ON DELETE CASCADE,
  offer_id TEXT NOT NULL REFERENCES flight_offers(id) ON DELETE CASCADE,
  PRIMARY KEY(itinerary_id,offer_id)
);
CREATE TABLE IF NOT EXISTS flight_discovery_cache (
  source TEXT NOT NULL CHECK(source IN ('aviasales_data','ignav_discovery')),
  discovery_key TEXT NOT NULL,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  departure_date TEXT NOT NULL,
  transfer_count INTEGER,
  raw_price_minor INTEGER,
  currency TEXT,
  observed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  segment_details_complete INTEGER NOT NULL DEFAULT 0 CHECK(segment_details_complete IN (0,1)),
  linked_itinerary_id TEXT REFERENCES flight_itineraries(id) ON DELETE SET NULL,
  -- Cache records are hints, not purchasable price offers.
  PRIMARY KEY(source,discovery_key)
);
CREATE INDEX IF NOT EXISTS flight_discovery_cache_idx ON flight_discovery_cache(origin,destination,departure_date,expires_at);
CREATE TABLE IF NOT EXISTS flight_price_change_outbox (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES flight_offers(id) ON DELETE CASCADE,
  previous_amount_minor INTEGER NOT NULL,
  new_amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK(delivery_state IN ('pending','delivered','failed','suppressed')),
  event_fingerprint TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS price_change_outbox_idx ON flight_price_change_outbox(delivery_state,observed_at);

-- Backfill: preserve every existing flights.id, flight_key, schedules and offers.
-- Only create a one-segment itinerary for active flights in the operating 30-day window.
INSERT OR IGNORE INTO flight_itineraries(id,itinerary_key,origin,destination,departure_date,segment_count,stop_count,detail_status,source,created_at,updated_at)
SELECT 'direct:' || f.id, 'direct:' || f.flight_key, f.origin, f.destination, f.departure_date,
  1,0,CASE WHEN f.departure_at IS NOT NULL AND f.arrival_at IS NOT NULL THEN 'complete' ELSE 'needs_confirmation' END,
  'existing_catalog', datetime('now'),datetime('now')
FROM flights f
WHERE f.departure_date BETWEEN date('now','+5 hours') AND date('now','+5 hours','+30 days');
INSERT OR IGNORE INTO flight_itinerary_segments(itinerary_id,segment_order,flight_id,transfer_type)
SELECT 'direct:' || f.id,0,f.id,'through'
FROM flights f JOIN flight_itineraries i ON i.id='direct:' || f.id;
INSERT OR IGNORE INTO flight_itinerary_offers(itinerary_id,offer_id)
SELECT 'direct:' || f.id,o.id
FROM flights f JOIN flight_itineraries i ON i.id='direct:' || f.id
JOIN flight_offers o ON o.flight_id=f.id;

-- Automatically mirror future single-flight imports without changing the existing importer.
CREATE TRIGGER IF NOT EXISTS catalog_v2_after_flight_insert
AFTER INSERT ON flights
WHEN NEW.departure_date BETWEEN date('now','+5 hours') AND date('now','+5 hours','+30 days')
BEGIN
  INSERT OR IGNORE INTO flight_itineraries(id,itinerary_key,origin,destination,departure_date,segment_count,stop_count,detail_status,source,created_at,updated_at)
  VALUES('direct:' || NEW.id,'direct:' || NEW.flight_key,NEW.origin,NEW.destination,NEW.departure_date,1,0,
    CASE WHEN NEW.departure_at IS NOT NULL AND NEW.arrival_at IS NOT NULL THEN 'complete' ELSE 'needs_confirmation' END,
    'existing_catalog',datetime('now'),datetime('now'));
  INSERT OR IGNORE INTO flight_itinerary_segments(itinerary_id,segment_order,flight_id,transfer_type)
  VALUES('direct:' || NEW.id,0,NEW.id,'through');
END;
CREATE TRIGGER IF NOT EXISTS catalog_v2_after_offer_insert
AFTER INSERT ON flight_offers
BEGIN
  INSERT OR IGNORE INTO flight_itinerary_offers(itinerary_id,offer_id)
  SELECT 'direct:' || NEW.flight_id,NEW.id
  WHERE EXISTS(SELECT 1 FROM flight_itineraries WHERE id='direct:' || NEW.flight_id);
END;
CREATE TRIGGER IF NOT EXISTS catalog_v2_after_schedule_update
AFTER UPDATE OF departure_at,arrival_at ON flights
BEGIN
  UPDATE flight_itineraries
  SET detail_status=CASE WHEN NEW.departure_at IS NOT NULL AND NEW.arrival_at IS NOT NULL THEN 'complete' ELSE 'needs_confirmation' END,
      updated_at=datetime('now')
  WHERE id='direct:' || NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS catalog_v2_after_flight_delete
AFTER DELETE ON flights
BEGIN
  DELETE FROM flight_itineraries
  WHERE NOT EXISTS (SELECT 1 FROM flight_itinerary_segments s WHERE s.itinerary_id=flight_itineraries.id);
END;
-- Only data that has not reached its expiry may be presented as an Aviasales discovery hint.
CREATE VIEW IF NOT EXISTS active_flight_discoveries AS
SELECT source,discovery_key,origin,destination,departure_date,transfer_count,
       raw_price_minor,currency,observed_at,expires_at,segment_details_complete,linked_itinerary_id
FROM flight_discovery_cache
WHERE expires_at > datetime('now')
  AND departure_date >= date('now','+5 hours');
