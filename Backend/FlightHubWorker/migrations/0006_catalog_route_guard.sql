-- Route guard for fresh DIRECT itinerary creation only. All historic IDs and rows remain untouched.
-- Connecting segment flights continue to exist in flights and flight_itinerary_segments.
DROP TRIGGER IF EXISTS catalog_v2_after_flight_insert;
CREATE TRIGGER catalog_v2_after_flight_insert
AFTER INSERT ON flights
WHEN NEW.departure_date BETWEEN date('now','+5 hours') AND date('now','+5 hours','+30 days')
 AND ((NEW.origin IN ('TAS','FEG','NMA','AZN','SKD','BHK','KSQ','TMJ','UGC') AND NEW.destination IN ('JED','MED','TIF'))
   OR (NEW.destination IN ('TAS','FEG','NMA','AZN','SKD','BHK','KSQ','TMJ','UGC') AND NEW.origin IN ('JED','MED','TIF')))
BEGIN
 INSERT OR IGNORE INTO flight_itineraries(id,itinerary_key,origin,destination,departure_date,segment_count,stop_count,detail_status,source,created_at,updated_at)
 VALUES('direct:' || NEW.id,'direct:' || NEW.flight_key,NEW.origin,NEW.destination,NEW.departure_date,1,0,
  CASE WHEN NEW.departure_at IS NOT NULL AND NEW.arrival_at IS NOT NULL THEN 'complete' ELSE 'needs_confirmation' END,
  'existing_catalog',datetime('now'),datetime('now'));
 INSERT OR IGNORE INTO flight_itinerary_segments(itinerary_id,segment_order,flight_id,transfer_type)
 VALUES('direct:' || NEW.id,0,NEW.id,'through');
END;
