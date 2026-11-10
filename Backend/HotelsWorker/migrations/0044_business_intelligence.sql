-- iumrah Intelligence: pseudonymous product analytics and aggregate Gemini reports.
-- No names, passports, messages, payment data or arbitrary event properties.
CREATE TABLE IF NOT EXISTS intelligence_events (
  event_id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  screen TEXT NOT NULL DEFAULT '',
  element_id TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL,
  app_version TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intelligence_events_created ON intelligence_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_events_session ON intelligence_events(session_id, occurred_at ASC);
CREATE INDEX IF NOT EXISTS idx_intelligence_events_name_created ON intelligence_events(event_name, created_at DESC);

CREATE TABLE IF NOT EXISTS intelligence_reports (
  id TEXT PRIMARY KEY,
  report_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('running','ready','no_data','failed')),
  model TEXT NOT NULL DEFAULT '',
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  report_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_intelligence_reports_created ON intelligence_reports(created_at DESC);
