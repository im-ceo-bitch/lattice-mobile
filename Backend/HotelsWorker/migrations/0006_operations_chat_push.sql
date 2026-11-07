PRAGMA foreign_keys = ON;

-- Rich import progress that survives app relaunch and explains failures precisely.
ALTER TABLE hotel_import_jobs ADD COLUMN current_image INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hotel_import_jobs ADD COLUMN current_image_label TEXT;
ALTER TABLE hotel_import_jobs ADD COLUMN warning TEXT;
ALTER TABLE hotel_import_jobs ADD COLUMN compression_mode TEXT;

-- Persistent staff-side one-to-one chat keyed by booking. The client app can use
-- the same booking id when its authenticated chat surface is connected later.
CREATE TABLE IF NOT EXISTS business_chat_threads (
  booking_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_message_at TEXT,
  last_message_preview TEXT NOT NULL DEFAULT '',
  last_sender_type TEXT,
  unread_for_staff INTEGER NOT NULL DEFAULT 0 CHECK (unread_for_staff IN (0,1))
);

CREATE TABLE IF NOT EXISTS business_chat_messages (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('staff','client','system')),
  sender_name TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_by_staff INTEGER NOT NULL DEFAULT 1 CHECK (read_by_staff IN (0,1)),
  client_message_id TEXT,
  FOREIGN KEY (booking_id) REFERENCES business_chat_threads(booking_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_chat_client_message
  ON business_chat_messages(booking_id, client_message_id)
  WHERE client_message_id IS NOT NULL AND client_message_id != '';
CREATE INDEX IF NOT EXISTS idx_business_chat_messages_booking
  ON business_chat_messages(booking_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_business_chat_threads_updated
  ON business_chat_threads(updated_at DESC);

-- Device tokens are only populated after the Apple provisioning profile contains
-- aps-environment. Keeping the table/backend ready does not alter iOS signing.
CREATE TABLE IF NOT EXISTS business_push_devices (
  device_token TEXT PRIMARY KEY,
  staff_login TEXT,
  platform TEXT NOT NULL DEFAULT 'ios',
  environment TEXT NOT NULL DEFAULT 'production',
  app_bundle_id TEXT NOT NULL DEFAULT 'com.iumrah.root',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_success_at TEXT,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_business_push_enabled
  ON business_push_devices(enabled, updated_at DESC);
