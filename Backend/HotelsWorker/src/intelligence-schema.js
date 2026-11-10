// Safety net for existing iumrah-hotels D1. All statements are additive / idempotent.
// The existing migrations and the single deploy workflow remain unchanged.
const SQL = [
  "CREATE TABLE IF NOT EXISTS intelligence_events (\n  event_id TEXT PRIMARY KEY,\n  visitor_id TEXT NOT NULL,\n  session_id TEXT NOT NULL,\n  event_name TEXT NOT NULL,\n  screen TEXT NOT NULL DEFAULT '',\n  element_id TEXT NOT NULL DEFAULT '',\n  platform TEXT NOT NULL,\n  app_version TEXT NOT NULL DEFAULT '',\n  occurred_at TEXT NOT NULL,\n  duration_ms INTEGER,\n  created_at TEXT NOT NULL\n)",
  "CREATE INDEX IF NOT EXISTS idx_intelligence_events_created ON intelligence_events(created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_intelligence_events_session ON intelligence_events(session_id, occurred_at ASC)",
  "CREATE INDEX IF NOT EXISTS idx_intelligence_events_name_created ON intelligence_events(event_name, created_at DESC)",
  "CREATE TABLE IF NOT EXISTS intelligence_reports (\n  id TEXT PRIMARY KEY,\n  report_key TEXT NOT NULL UNIQUE,\n  status TEXT NOT NULL CHECK(status IN ('running','ready','no_data','failed')),\n  model TEXT NOT NULL DEFAULT '',\n  period_start TEXT NOT NULL,\n  period_end TEXT NOT NULL,\n  event_count INTEGER NOT NULL DEFAULT 0,\n  report_json TEXT,\n  error_code TEXT,\n  created_at TEXT NOT NULL,\n  completed_at TEXT\n)",
  "CREATE INDEX IF NOT EXISTS idx_intelligence_reports_created ON intelligence_reports(created_at DESC)",
  "CREATE TABLE IF NOT EXISTS intelligence_ai_threads (\n  id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL\n)",
  "CREATE TABLE IF NOT EXISTS intelligence_ai_messages (\n  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','assistant')),\n  content TEXT NOT NULL, created_at TEXT NOT NULL,\n  FOREIGN KEY(thread_id) REFERENCES intelligence_ai_threads(id) ON DELETE CASCADE\n)",
  "CREATE INDEX IF NOT EXISTS idx_intelligence_ai_messages_thread ON intelligence_ai_messages(thread_id, created_at)",
  "CREATE TABLE IF NOT EXISTS intelligence_ai_usage (day TEXT PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0)"
];
const ready = new WeakMap();

export async function ensureIntelligenceSchema(db) {
  if (!db || typeof db.prepare !== 'function') throw new Error('INTELLIGENCE_DATABASE_UNAVAILABLE');
  let promise = ready.get(db);
  if (!promise) {
    promise = (async () => {
      // Validate presence before DDL: normal requests are read-only.
      const names = ['intelligence_events','intelligence_reports','intelligence_ai_threads','intelligence_ai_messages','intelligence_ai_usage'];
      const existing = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'intelligence_%'").all();
      const have = new Set((existing.results || []).map(x => x.name));
      if (names.every(name => have.has(name))) return;
      // The baseline schema was missed. Recover only the dedicated Intelligence tables.
      for (const statement of SQL) await db.prepare(statement).run();
      const verified = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'intelligence_%'").all();
      const finalNames = new Set((verified.results || []).map(x=>x.name));
      if (!names.every(name => finalNames.has(name))) throw new Error('INTELLIGENCE_SCHEMA_UNAVAILABLE');
    })();
    ready.set(db,promise);
  }
  try { await promise; } catch(error) { ready.delete(db); throw error; }
}
