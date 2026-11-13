-- DevSMS-backed phone verification plus standalone SMS sign-in/registration.
-- This file is deliberately cumulative because the existing deployment workflow
-- already executes migration 0008 on every Package Engine deploy.

CREATE TABLE IF NOT EXISTS iumrah_client_account_phones (
  pilgrim_id INTEGER PRIMARY KEY,
  phone_normalized TEXT NOT NULL UNIQUE,
  phone_display TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (pilgrim_id) REFERENCES pilgrims(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_iumrah_client_account_phone_lookup
ON iumrah_client_account_phones(phone_normalized);

-- Rebuild the SMS challenge table so old production databases that still have
-- the original CHECK constraint gain login_phone/register_phone support.
-- Re-running this migration is safe: all existing challenge rows are copied.
DROP TABLE IF EXISTS iumrah_client_sms_challenges_v2;
CREATE TABLE iumrah_client_sms_challenges_v2 (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_phone','activate_account','login_phone','register_phone')),
  pilgrim_id INTEGER NOT NULL,
  phone_normalized TEXT NOT NULL,
  phone_display TEXT NOT NULL,
  code_salt TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  code_iterations INTEGER NOT NULL DEFAULT 100000,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT,
  request_ip_hash TEXT NOT NULL DEFAULT '',
  provider_sms_id TEXT,
  provider_request_id TEXT,
  provider_status TEXT,
  FOREIGN KEY (pilgrim_id) REFERENCES pilgrims(id) ON DELETE CASCADE
);

-- The first deployment may not have created the old table yet.
CREATE TABLE IF NOT EXISTS iumrah_client_sms_challenges (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_phone','activate_account','login_phone','register_phone')),
  pilgrim_id INTEGER NOT NULL,
  phone_normalized TEXT NOT NULL,
  phone_display TEXT NOT NULL,
  code_salt TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  code_iterations INTEGER NOT NULL DEFAULT 100000,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT,
  request_ip_hash TEXT NOT NULL DEFAULT '',
  provider_sms_id TEXT,
  provider_request_id TEXT,
  provider_status TEXT,
  FOREIGN KEY (pilgrim_id) REFERENCES pilgrims(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO iumrah_client_sms_challenges_v2 (
  id,purpose,pilgrim_id,phone_normalized,phone_display,code_salt,code_hash,
  code_iterations,attempts,max_attempts,expires_at,created_at,consumed_at,
  request_ip_hash,provider_sms_id,provider_request_id,provider_status
)
SELECT
  id,purpose,pilgrim_id,phone_normalized,phone_display,code_salt,code_hash,
  code_iterations,attempts,max_attempts,expires_at,created_at,consumed_at,
  request_ip_hash,provider_sms_id,provider_request_id,provider_status
FROM iumrah_client_sms_challenges;

DROP TABLE iumrah_client_sms_challenges;
ALTER TABLE iumrah_client_sms_challenges_v2 RENAME TO iumrah_client_sms_challenges;

CREATE INDEX IF NOT EXISTS idx_iumrah_client_sms_challenge_lookup
ON iumrah_client_sms_challenges(purpose, phone_normalized, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iumrah_client_sms_challenge_account
ON iumrah_client_sms_challenges(pilgrim_id, created_at DESC);

-- Guest booking SMS verification is independent of account registration/login.
-- Additively created on the already-existing deployment migration path.
CREATE TABLE IF NOT EXISTS iumrah_guest_booking_phone_challenges (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  salt TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT NOT NULL DEFAULT '',
  verified_at TEXT,
  verification_token_hash TEXT UNIQUE,
  proof_expires_at TEXT,
  consumed_at TEXT,
  booking_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_guest_booking_phone_rate
ON iumrah_guest_booking_phone_challenges(phone,created_at);
CREATE INDEX IF NOT EXISTS idx_guest_booking_ip_rate
ON iumrah_guest_booking_phone_challenges(ip_hash,created_at);
