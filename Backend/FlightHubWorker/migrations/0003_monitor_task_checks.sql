-- Additive repair for /v1/monitor/tasks. Historical flight and offer IDs are untouched.
CREATE TABLE IF NOT EXISTS monitor_task_checks (
  provider TEXT NOT NULL,
  flight_id TEXT NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  last_requested_at TEXT NOT NULL,
  PRIMARY KEY(provider,flight_id)
);
CREATE INDEX IF NOT EXISTS monitor_task_dispatch_idx ON monitor_task_checks(provider,last_requested_at);
