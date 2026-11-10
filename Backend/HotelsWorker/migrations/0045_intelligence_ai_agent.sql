-- Read-only analyst chat: only superadmin; stored on existing HOTELS_DB.
CREATE TABLE IF NOT EXISTS intelligence_ai_threads (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS intelligence_ai_messages (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(thread_id) REFERENCES intelligence_ai_threads(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_intelligence_ai_messages_thread ON intelligence_ai_messages(thread_id, created_at);

-- Free-tier safety: total chat requests per UTC day (independent of thread).
CREATE TABLE IF NOT EXISTS intelligence_ai_usage (day TEXT PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0);
