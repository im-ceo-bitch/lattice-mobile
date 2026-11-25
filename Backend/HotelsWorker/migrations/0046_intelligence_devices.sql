CREATE TABLE IF NOT EXISTS intelligence_devices (
 platform TEXT NOT NULL, visitor_id TEXT NOT NULL, internal INTEGER NOT NULL DEFAULT 0 CHECK(internal IN (0,1)),
 model TEXT NOT NULL DEFAULT '', os_version TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '',
 last_seen TEXT NOT NULL DEFAULT '', PRIMARY KEY(platform, visitor_id)
);
CREATE INDEX IF NOT EXISTS idx_intelligence_events_visitor ON intelligence_events(platform, visitor_id, occurred_at);
CREATE VIEW IF NOT EXISTS intelligence_external_events AS SELECT e.* FROM intelligence_events e
 WHERE NOT EXISTS (SELECT 1 FROM intelligence_devices d WHERE d.platform=e.platform AND d.visitor_id=e.visitor_id AND d.internal=1);
