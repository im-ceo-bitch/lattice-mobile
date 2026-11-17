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

-- Additive AI-chat tables are kept in the existing migration entrypoint
-- because the permanent deploy workflow executes this file every time.
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

-- Booking Experience 3.0 Foundation 1B: additive, repeatable, existing booking data untouched.
CREATE TABLE IF NOT EXISTS booking_receipt_reviews_v3 (
  receipt_id TEXT PRIMARY KEY, booking_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents>=0), currency TEXT NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
  decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
  reason TEXT NOT NULL DEFAULT '', reviewed_by TEXT NOT NULL, reviewed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_receipt_reviews_v3_booking ON booking_receipt_reviews_v3(booking_id);
CREATE TABLE IF NOT EXISTS booking_document_publication_v3 (
  document_id TEXT PRIMARY KEY, booking_id TEXT NOT NULL,
  slots_json TEXT NOT NULL DEFAULT '[]', publication_status TEXT NOT NULL CHECK(publication_status IN ('published','revoked')),
  updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_document_publication_v3_booking ON booking_document_publication_v3(booking_id);
CREATE TABLE IF NOT EXISTS booking_operations_audit_v3 (
  id TEXT PRIMARY KEY, booking_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT NOT NULL,
  actor TEXT NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_booking_operations_audit_v3_booking ON booking_operations_audit_v3(booking_id,created_at);

-- Booking Experience 3.0 Stage 2A: independent progress for each required document.
CREATE TABLE IF NOT EXISTS booking_document_requirement_state_v3 (
  booking_id TEXT NOT NULL, requirement_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','preparing','needs_correction')),
  updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(booking_id,requirement_key)
);

-- Stage 3: operational records are additive and never delete financial history.
CREATE TABLE IF NOT EXISTS booking_service_operations_v3 (
 booking_id TEXT NOT NULL, service_key TEXT NOT NULL, scope TEXT NOT NULL,
 availability TEXT NOT NULL CHECK(availability IN ('pending','confirmed','unavailable')),
 execution TEXT NOT NULL CHECK(execution IN ('planned','in_progress','completed','delayed','rescheduled')),
 reference TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(booking_id,service_key)
);
CREATE TABLE IF NOT EXISTS booking_manager_v3 (
 booking_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS booking_cancellation_v3 (
 booking_id TEXT PRIMARY KEY, reason TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL,
 paid_cents INTEGER NOT NULL CHECK(paid_cents>=0), historical_unverified INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS booking_refunds_v3 (
 id TEXT PRIMARY KEY, booking_id TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 reference TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(booking_id,reference)
);
CREATE TABLE IF NOT EXISTS booking_cancel_request_v3 (
 booking_id TEXT PRIMARY KEY, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS booking_itinerary_execution_v3 (
 booking_id TEXT NOT NULL, item_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('planned','in_progress','completed','delayed','rescheduled')),
 updated_by TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(booking_id,item_id)
);
CREATE INDEX IF NOT EXISTS idx_booking_manager_v3_member ON booking_manager_v3(member_id);
CREATE INDEX IF NOT EXISTS idx_booking_refunds_v3_booking ON booking_refunds_v3(booking_id);

-- Serialize competing operations on one booking; no change to existing tables.
CREATE TABLE IF NOT EXISTS booking_mutation_lock_v3 (booking_id TEXT PRIMARY KEY,token TEXT NOT NULL,expires_at INTEGER NOT NULL);

-- Stage 4: private feedback and immutable financial closeout.
CREATE TABLE IF NOT EXISTS booking_travel_feedback_v3 (booking_id TEXT PRIMARY KEY, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), comment TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS booking_financial_close_v3 (booking_id TEXT PRIMARY KEY, paid_cents INTEGER NOT NULL, refunded_cents INTEGER NOT NULL, expense_cents INTEGER NOT NULL, retained_cents INTEGER NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS booking_itinerary_times_v3 (booking_id TEXT NOT NULL, item_id TEXT NOT NULL, time_local TEXT, end_time_local TEXT, PRIMARY KEY(booking_id,item_id));
CREATE TABLE IF NOT EXISTS booking_umrah_certificates_v3 (booking_id TEXT NOT NULL, position INTEGER NOT NULL, id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, issued_at TEXT NOT NULL, actor TEXT NOT NULL, PRIMARY KEY(booking_id,position));

-- Release QA: historical reconciliations are explicit external evidence, not inferred from legacy statuses.
CREATE TABLE IF NOT EXISTS booking_payment_reconciliation_v3 (booking_id TEXT PRIMARY KEY, added_cents INTEGER NOT NULL CHECK(added_cents>=0), reference TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS booking_certificate_history_v3 (id TEXT PRIMARY KEY, booking_id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, issued_at TEXT NOT NULL, original_actor TEXT NOT NULL, reason TEXT NOT NULL, action TEXT NOT NULL, changed_by TEXT NOT NULL, changed_at TEXT NOT NULL, replacement_id TEXT);

-- Release QA: bounded APNs retries, no destructive schema changes.
CREATE TABLE IF NOT EXISTS booking_push_delivery_v3(
 id TEXT PRIMARY KEY,event_id TEXT NOT NULL,booking_id TEXT NOT NULL,event_type TEXT NOT NULL,expected_status TEXT,device_token TEXT NOT NULL,created_at TEXT NOT NULL,next_attempt_at TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until TEXT,last_error TEXT
);
CREATE INDEX IF NOT EXISTS booking_push_delivery_v3_due ON booking_push_delivery_v3(state,next_attempt_at);
CREATE INDEX IF NOT EXISTS booking_push_delivery_v3_event ON booking_push_delivery_v3(event_id);
