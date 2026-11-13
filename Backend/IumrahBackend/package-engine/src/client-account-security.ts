import type { D1Like } from "./d1";
import type { Env } from "./env";
import { buildIumrahWalletPass } from "./wallet-pass";
import { formatIumrahID, publicIdentityURL } from "./public-identity";

type PilgrimRow = {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  phone?: string | null;
  email?: string | null;
  telegram?: string | null;
  whatsapp?: string | null;
};

type AccountAuth = {
  pilgrimID: number;
  tokenHash: string;
  pilgrim: PilgrimRow;
};

type DeviceAuth = AccountAuth & {
  deviceID: string;
  installationID: string;
  sessionID: string;
  isPrimary: boolean;
};

type DeviceInput = {
  installationID: string;
  secret: string;
  name: string;
  model: string;
  platform: string;
  osVersion: string;
  appVersion: string;
  locale: string;
};

type AppleClaims = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  sub?: string;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
};

type GoogleClaims = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  sub?: string;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
};

class RouteError extends Error {
  constructor(readonly code: string, readonly status = 400) {
    super(code);
  }
}

const PASSWORD_ITERATIONS = 100_000;
const CODE_ITERATIONS = 100_000;
const SESSION_DAYS = 90;
const CODE_TTL_MINUTES = 10;
const MAX_CODE_ATTEMPTS = 5;
let appleKeyCache: { expiresAt: number; keys: JsonWebKey[] } | null = null;
let googleKeyCache: { expiresAt: number; keys: JsonWebKey[] } | null = null;

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeEmail(value: unknown) {
  return cleanText(value, 254).normalize("NFKC").toLowerCase();
}

function validEmail(value: string) {
  return value.length >= 5
    && value.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(value);
}

function normalizePhone(value: unknown) {
  const raw = cleanText(value, 40);
  const digits = raw.replace(/\D/g, "").slice(0, 15);
  return digits ? `+${digits}` : "";
}

function validUzbekPhone(value: string) {
  return /^\+998\d{9}$/.test(value);
}

type SMSChallengePurpose = "verify_phone" | "activate_account" | "login_phone" | "register_phone";

function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 128;
}

function constantTimeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (!a.length || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function base64URL(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeBase64URL(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function randomToken(byteCount = 32) {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return base64URL(bytes);
}

function randomVerificationCode() {
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  const buffer = new Uint32Array(1);
  do crypto.getRandomValues(buffer); while (buffer[0] >= limit);
  return String(buffer[0] % 1_000_000).padStart(6, "0");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function passwordDigest(password: string, salt: string, iterations = PASSWORD_ITERATIONS) {
  if (!Number.isInteger(iterations) || iterations <= 0 || iterations > PASSWORD_ITERATIONS) {
    throw new RouteError("UNSUPPORTED_PASSWORD_ITERATIONS", 409);
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: new TextEncoder().encode(salt),
    iterations,
  }, key, 256);
  return base64URL(new Uint8Array(bits));
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return "";
  return authorization.slice(7).trim();
}

function accountProfile(pilgrim: PilgrimRow) {
  const firstName = cleanText(pilgrim.first_name, 120);
  const lastName = cleanText(pilgrim.last_name, 120);
  const displayName = cleanText(pilgrim.display_name, 240) || [firstName, lastName].filter(Boolean).join(" ");
  return {
    iumrahID: formatIumrahID(pilgrim.id),
    displayName,
    firstName,
    lastName,
    phone: cleanText(pilgrim.phone, 100),
    email: cleanText(pilgrim.email, 254),
    telegram: cleanText(pilgrim.telegram, 120),
    whatsapp: cleanText(pilgrim.whatsapp, 120),
  };
}

async function requireAccount(request: Request, db: D1Like): Promise<AccountAuth> {
  const token = bearerToken(request);
  if (!token || token.length > 256) throw new RouteError("ACCOUNT_SESSION_REQUIRED", 401);
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();
  const row = await db.prepare(
    `SELECT s.pilgrim_id,
            p.id,p.first_name,p.last_name,p.display_name,p.phone,
            p.email,p.telegram,p.whatsapp
     FROM iumrah_account_sessions s
     INNER JOIN pilgrims p ON p.id=s.pilgrim_id
     WHERE s.token_hash=?1 AND s.revoked_at IS NULL AND s.expires_at>?2
     LIMIT 1`,
  ).bind(tokenHash, now).first<PilgrimRow & { pilgrim_id: number }>();
  if (!row) throw new RouteError("ACCOUNT_SESSION_INVALID", 401);
  await db.prepare("UPDATE iumrah_account_sessions SET last_used_at=?1 WHERE token_hash=?2")
    .bind(now, tokenHash).run();
  return { pilgrimID: Number(row.pilgrim_id), tokenHash, pilgrim: row };
}

function requestLocation(request: Request) {
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf ?? {};
  return {
    city: cleanText(cf.city, 100),
    region: cleanText(cf.region, 120),
    country: cleanText(cf.country, 8),
  };
}

function parseDevice(value: unknown): DeviceInput {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const device: DeviceInput = {
    installationID: cleanText(raw.installationID, 80),
    secret: cleanText(raw.secret, 180),
    name: cleanText(raw.name, 120) || "iPhone",
    model: cleanText(raw.model, 100) || "iPhone",
    platform: cleanText(raw.platform, 40) || "iOS",
    osVersion: cleanText(raw.osVersion, 80),
    appVersion: cleanText(raw.appVersion, 80),
    locale: cleanText(raw.locale, 24),
  };
  if (!/^[A-Za-z0-9-]{20,80}$/.test(device.installationID)
      || !/^[A-Za-z0-9_-]{32,180}$/.test(device.secret)) {
    throw new RouteError("INVALID_DEVICE_CREDENTIALS", 400);
  }
  return device;
}

async function bindCurrentSession(
  db: D1Like,
  auth: AccountAuth,
  device: DeviceInput,
  request: Request,
) {
  const now = new Date().toISOString();
  const location = requestLocation(request);
  const secretHash = await sha256Hex(device.secret);
  let deviceRow = await db.prepare(
    `SELECT id,secret_hash FROM iumrah_client_devices
     WHERE pilgrim_id=?1 AND installation_id=?2 LIMIT 1`,
  ).bind(auth.pilgrimID, device.installationID).first<{ id: string; secret_hash: string }>();

  if (deviceRow && !constantTimeEqual(deviceRow.secret_hash, secretHash)) {
    throw new RouteError("DEVICE_ID_CONFLICT", 403);
  }
  if (!deviceRow) {
    const id = `device-${crypto.randomUUID()}`;
    await db.prepare(
      `INSERT INTO iumrah_client_devices(
         id,pilgrim_id,installation_id,secret_hash,name,model,platform,os_version,
         app_version,locale,created_at,first_seen_at,last_seen_at,last_city,last_region,last_country
       ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11,?11,?12,?13,?14)`,
    ).bind(
      id, auth.pilgrimID, device.installationID, secretHash, device.name, device.model,
      device.platform, device.osVersion, device.appVersion, device.locale, now,
      location.city, location.region, location.country,
    ).run();
    deviceRow = { id, secret_hash: secretHash };
  } else {
    await db.prepare(
      `UPDATE iumrah_client_devices
       SET name=?1,model=?2,platform=?3,os_version=?4,app_version=?5,locale=?6,
           last_seen_at=?7,last_city=?8,last_region=?9,last_country=?10,revoked_at=NULL
       WHERE id=?11`,
    ).bind(
      device.name, device.model, device.platform, device.osVersion, device.appVersion,
      device.locale, now, location.city, location.region, location.country, deviceRow.id,
    ).run();
  }

  const binding = await db.prepare(
    "SELECT session_id,device_id FROM iumrah_client_session_bindings WHERE token_hash=?1 LIMIT 1",
  ).bind(auth.tokenHash).first<{ session_id: string; device_id: string | null }>();
  if (binding?.device_id && binding.device_id !== deviceRow.id) {
    throw new RouteError("SESSION_ALREADY_BOUND", 409);
  }

  // A security session represents one physical app installation, not one login
  // token. Re-authenticating with password, Apple or Google on the same trusted
  // installation rotates the bearer token while keeping one logical device row.
  // This prevents a single iPhone from appearing several times in Active Sessions.
  const retireOtherDeviceTokens = async () => {
    const duplicates = await db.prepare(
      `SELECT b.token_hash
       FROM iumrah_client_session_bindings b
       INNER JOIN iumrah_account_sessions s ON s.token_hash=b.token_hash
       WHERE b.pilgrim_id=?1 AND b.device_id=?2 AND b.token_hash<>?3
         AND s.revoked_at IS NULL AND s.expires_at>?4`,
    ).bind(auth.pilgrimID, deviceRow.id, auth.tokenHash, now).all<{ token_hash: string }>();
    for (const duplicate of duplicates.results ?? []) {
      await db.prepare(
        "UPDATE iumrah_account_sessions SET revoked_at=?1 WHERE token_hash=?2 AND revoked_at IS NULL",
      ).bind(now, duplicate.token_hash).run();
    }
  };

  if (binding) {
    await db.prepare(
      `UPDATE iumrah_client_session_bindings
       SET device_id=?1,last_seen_at=?2,last_city=?3,last_region=?4,last_country=?5
       WHERE token_hash=?6`,
    ).bind(deviceRow.id, now, location.city, location.region, location.country, auth.tokenHash).run();
    await retireOtherDeviceTokens();
    return binding.session_id;
  }

  const deviceBinding = await db.prepare(
    `SELECT session_id,token_hash
     FROM iumrah_client_session_bindings
     WHERE pilgrim_id=?1 AND device_id=?2
     ORDER BY last_seen_at DESC LIMIT 1`,
  ).bind(auth.pilgrimID, deviceRow.id).first<{ session_id: string; token_hash: string }>();

  if (deviceBinding) {
    const previousTokenHash = deviceBinding.token_hash;
    await db.prepare(
      `UPDATE iumrah_client_session_bindings
       SET token_hash=?1,last_seen_at=?2,last_city=?3,last_region=?4,last_country=?5
       WHERE session_id=?6`,
    ).bind(
      auth.tokenHash, now, location.city, location.region, location.country, deviceBinding.session_id,
    ).run();
    if (previousTokenHash !== auth.tokenHash) {
      await db.prepare(
        "UPDATE iumrah_account_sessions SET revoked_at=?1 WHERE token_hash=?2 AND revoked_at IS NULL",
      ).bind(now, previousTokenHash).run();
    }
    await retireOtherDeviceTokens();
    return deviceBinding.session_id;
  }

  const sessionID = `session-${crypto.randomUUID()}`;
  await db.prepare(
    `INSERT INTO iumrah_client_session_bindings(
       session_id,token_hash,pilgrim_id,device_id,created_at,last_seen_at,last_city,last_region,last_country
     ) VALUES(?1,?2,?3,?4,?5,?5,?6,?7,?8)`,
  ).bind(
    sessionID, auth.tokenHash, auth.pilgrimID, deviceRow.id, now,
    location.city, location.region, location.country,
  ).run();
  return sessionID;
}

async function requireDevice(request: Request, db: D1Like): Promise<DeviceAuth> {
  const auth = await requireAccount(request, db);
  const installationID = cleanText(request.headers.get("x-iumrah-device-id"), 80);
  const secret = cleanText(request.headers.get("x-iumrah-device-secret"), 180);
  if (!installationID || !secret) throw new RouteError("DEVICE_REGISTRATION_REQUIRED", 428);
  const secretHash = await sha256Hex(secret);
  const row = await db.prepare(
    `SELECT b.session_id,d.id AS device_id,d.installation_id,d.secret_hash,d.is_primary
     FROM iumrah_client_session_bindings b
     INNER JOIN iumrah_client_devices d ON d.id=b.device_id
     WHERE b.token_hash=?1 AND b.pilgrim_id=?2 AND d.installation_id=?3
       AND d.revoked_at IS NULL
     LIMIT 1`,
  ).bind(auth.tokenHash, auth.pilgrimID, installationID).first<{
    session_id: string;
    device_id: string;
    installation_id: string;
    secret_hash: string;
    is_primary: number;
  }>();
  if (!row || !constantTimeEqual(row.secret_hash, secretHash)) {
    throw new RouteError("DEVICE_AUTHENTICATION_FAILED", 403);
  }
  const now = new Date().toISOString();
  const location = requestLocation(request);
  await db.prepare(
    `UPDATE iumrah_client_devices
     SET last_seen_at=?1,last_city=?2,last_region=?3,last_country=?4 WHERE id=?5`,
  ).bind(now, location.city, location.region, location.country, row.device_id).run();
  await db.prepare(
    `UPDATE iumrah_client_session_bindings
     SET last_seen_at=?1,last_city=?2,last_region=?3,last_country=?4 WHERE session_id=?5`,
  ).bind(now, location.city, location.region, location.country, row.session_id).run();
  return {
    ...auth,
    deviceID: row.device_id,
    installationID: row.installation_id,
    sessionID: row.session_id,
    isPrimary: Number(row.is_primary) === 1,
  };
}

async function ensureLegacySessionHandles(db: D1Like, pilgrimID: number) {
  const now = new Date().toISOString();
  const missing = await db.prepare(
    `SELECT s.token_hash,s.created_at,s.last_used_at
     FROM iumrah_account_sessions s
     LEFT JOIN iumrah_client_session_bindings b ON b.token_hash=s.token_hash
     WHERE s.pilgrim_id=?1 AND s.revoked_at IS NULL AND s.expires_at>?2
       AND b.token_hash IS NULL`,
  ).bind(pilgrimID, now).all<{ token_hash: string; created_at: string; last_used_at: string }>();
  for (const row of missing.results ?? []) {
    await db.prepare(
      `INSERT OR IGNORE INTO iumrah_client_session_bindings(
         session_id,token_hash,pilgrim_id,device_id,created_at,last_seen_at,last_city,last_region,last_country
       ) VALUES(?1,?2,?3,NULL,?4,?5,'','','')`,
    ).bind(
      `session-${crypto.randomUUID()}`, row.token_hash, pilgrimID,
      row.created_at, row.last_used_at || row.created_at,
    ).run();
  }
}

async function collapseDuplicateDeviceSessions(
  db: D1Like,
  pilgrimID: number,
  currentTokenHash: string,
) {
  const now = new Date().toISOString();
  const rows = await db.prepare(
    `SELECT b.device_id,b.token_hash,COALESCE(s.last_used_at,b.last_seen_at) AS last_active_at
     FROM iumrah_account_sessions s
     INNER JOIN iumrah_client_session_bindings b ON b.token_hash=s.token_hash
     WHERE s.pilgrim_id=?1 AND s.revoked_at IS NULL AND s.expires_at>?2
       AND b.device_id IS NOT NULL
     ORDER BY b.device_id ASC,
              CASE WHEN b.token_hash=?3 THEN 0 ELSE 1 END,
              COALESCE(s.last_used_at,b.last_seen_at) DESC`,
  ).bind(pilgrimID, now, currentTokenHash).all<{
    device_id: string;
    token_hash: string;
    last_active_at: string;
  }>();

  const keptDevices = new Set<string>();
  for (const row of rows.results ?? []) {
    if (!keptDevices.has(row.device_id)) {
      keptDevices.add(row.device_id);
      continue;
    }
    await db.prepare(
      "UPDATE iumrah_account_sessions SET revoked_at=?1 WHERE token_hash=?2 AND revoked_at IS NULL",
    ).bind(now, row.token_hash).run();
  }
}

async function securityOverview(db: D1Like, auth: DeviceAuth) {
  await ensureLegacySessionHandles(db, auth.pilgrimID);
  await collapseDuplicateDeviceSessions(db, auth.pilgrimID, auth.tokenHash);
  const now = new Date().toISOString();
  const result = await db.prepare(
    `SELECT b.session_id,b.token_hash,s.created_at,s.expires_at,
            COALESCE(s.last_used_at,b.last_seen_at) AS last_active_at,
            b.last_city,b.last_region,b.last_country,
            d.name,d.model,d.platform,d.os_version,d.app_version,d.is_primary
     FROM iumrah_account_sessions s
     INNER JOIN iumrah_client_session_bindings b ON b.token_hash=s.token_hash
     LEFT JOIN iumrah_client_devices d ON d.id=b.device_id AND d.revoked_at IS NULL
     WHERE s.pilgrim_id=?1 AND s.revoked_at IS NULL AND s.expires_at>?2
     ORDER BY CASE WHEN b.token_hash=?3 THEN 0 ELSE 1 END,
              COALESCE(s.last_used_at,b.last_seen_at) DESC`,
  ).bind(auth.pilgrimID, now, auth.tokenHash).all<{
    session_id: string;
    token_hash: string;
    created_at: string;
    expires_at: string;
    last_active_at: string;
    last_city: string;
    last_region: string;
    last_country: string;
    name: string | null;
    model: string | null;
    platform: string | null;
    os_version: string | null;
    app_version: string | null;
    is_primary: number | null;
  }>();
  const sessions = (result.results ?? []).map((row) => {
    const isCurrent = row.token_hash === auth.tokenHash;
    return {
      id: row.session_id,
      deviceName: row.name || "Unknown device",
      model: row.model || "",
      platform: row.platform || "",
      osVersion: row.os_version || "",
      appVersion: row.app_version || "",
      city: row.last_city || "",
      region: row.last_region || "",
      country: row.last_country || "",
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
      expiresAt: row.expires_at,
      isCurrent,
      isPrimary: Number(row.is_primary ?? 0) === 1,
      canTerminate: isCurrent || auth.isPrimary,
    };
  });
  const primary = await db.prepare(
    `SELECT id FROM iumrah_client_devices
     WHERE pilgrim_id=?1 AND is_primary=1 AND revoked_at IS NULL LIMIT 1`,
  ).bind(auth.pilgrimID).first<{ id: string }>();
  const apple = await db.prepare(
    "SELECT linked_at FROM iumrah_client_apple_links WHERE pilgrim_id=?1 LIMIT 1",
  ).bind(auth.pilgrimID).first<{ linked_at: string }>();
  const google = await db.prepare(
    "SELECT linked_at FROM iumrah_client_google_links WHERE pilgrim_id=?1 LIMIT 1",
  ).bind(auth.pilgrimID).first<{ linked_at: string }>();
  const accountEmail = await db.prepare(
    `SELECT email_display,verified_at FROM iumrah_client_account_emails
     WHERE pilgrim_id=?1 LIMIT 1`,
  ).bind(auth.pilgrimID).first<{ email_display: string; verified_at: string }>();
  const accountPhone = await db.prepare(
    `SELECT phone_display,phone_normalized,verified_at FROM iumrah_client_account_phones
     WHERE pilgrim_id=?1 LIMIT 1`,
  ).bind(auth.pilgrimID).first<{ phone_display: string; phone_normalized: string; verified_at: string }>();
  return {
    ok: true,
    iumrahID: formatIumrahID(auth.pilgrimID),
    currentSessionID: auth.sessionID,
    currentDeviceIsPrimary: auth.isPrimary,
    primaryDeviceProtected: Boolean(primary),
    loginPhone: accountPhone
      ? { phone: accountPhone.phone_display || accountPhone.phone_normalized, verifiedAt: accountPhone.verified_at }
      : null,
    loginEmail: accountEmail
      ? { email: accountEmail.email_display, verifiedAt: accountEmail.verified_at }
      : null,
    apple: { linked: Boolean(apple), linkedAt: apple?.linked_at ?? null },
    google: { linked: Boolean(google), linkedAt: google?.linked_at ?? null },
    sessions,
  };
}

async function verifyAccountPassword(db: D1Like, pilgrimID: number, password: string) {
  const row = await db.prepare(
    `SELECT password_salt,password_hash,password_iterations,failed_attempts,locked_until
     FROM iumrah_accounts WHERE pilgrim_id=?1 LIMIT 1`,
  ).bind(pilgrimID).first<{
    password_salt: string;
    password_hash: string;
    password_iterations: number;
    failed_attempts: number;
    locked_until: string | null;
  }>();
  if (!row || !validPassword(password)) throw new RouteError("INVALID_CREDENTIALS", 401);
  if (row.locked_until && Date.parse(row.locked_until) > Date.now()) {
    throw new RouteError("ACCOUNT_TEMPORARILY_LOCKED", 423);
  }
  const expected = await passwordDigest(password, row.password_salt, Number(row.password_iterations));
  if (!constantTimeEqual(expected, row.password_hash)) {
    const attempts = Number(row.failed_attempts ?? 0) + 1;
    const lockedUntil = attempts >= 6 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
    await db.prepare(
      "UPDATE iumrah_accounts SET failed_attempts=?1,locked_until=?2 WHERE pilgrim_id=?3",
    ).bind(lockedUntil ? 0 : attempts, lockedUntil, pilgrimID).run();
    throw new RouteError(lockedUntil ? "ACCOUNT_TEMPORARILY_LOCKED" : "INVALID_CREDENTIALS", lockedUntil ? 423 : 401);
  }
  await db.prepare(
    "UPDATE iumrah_accounts SET failed_attempts=0,locked_until=NULL WHERE pilgrim_id=?1",
  ).bind(pilgrimID).run();
}

async function audit(
  db: D1Like,
  pilgrimID: number,
  eventType: string,
  actorSessionID: string | null,
  targetSessionID: string | null,
) {
  await db.prepare(
    `INSERT INTO iumrah_client_security_audit(
       id,pilgrim_id,event_type,actor_session_id,target_session_id,created_at
     ) VALUES(?1,?2,?3,?4,?5,?6)`,
  ).bind(
    `audit-${crypto.randomUUID()}`, pilgrimID, eventType, actorSessionID,
    targetSessionID, new Date().toISOString(),
  ).run();
}

const SECURITY_PROOF_TTL_MS = 10 * 60_000;

type SecurityProofPurpose = "contact_change";

async function promoteCurrentDevice(db: D1Like, auth: DeviceAuth, eventType: string) {
  const existing = await db.prepare(
    `SELECT id FROM iumrah_client_devices
     WHERE pilgrim_id=?1 AND is_primary=1 AND revoked_at IS NULL LIMIT 1`,
  ).bind(auth.pilgrimID).first<{ id: string }>();

  await db.prepare(
    `UPDATE iumrah_client_devices
     SET is_primary=CASE WHEN id=?1 THEN 1 ELSE 0 END
     WHERE pilgrim_id=?2 AND revoked_at IS NULL`,
  ).bind(auth.deviceID, auth.pilgrimID).run();

  await audit(
    db,
    auth.pilgrimID,
    existing && existing.id !== auth.deviceID ? `${eventType}_transferred` : eventType,
    auth.sessionID,
    auth.sessionID,
  );
  return { ...auth, isPrimary: true };
}

async function createSecurityProof(
  db: D1Like,
  auth: DeviceAuth,
  purpose: SecurityProofPurpose,
) {
  const token = randomToken(32);
  const proofHash = await sha256Hex(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SECURITY_PROOF_TTL_MS).toISOString();
  const retentionCutoff = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();

  // Security proofs are deliberately ephemeral. Keep the table bounded without
  // retaining sensitive re-authentication artifacts longer than needed.
  await db.prepare(
    `DELETE FROM iumrah_client_security_proofs
     WHERE expires_at<=?1 OR (consumed_at IS NOT NULL AND consumed_at<?2)`,
  ).bind(now.toISOString(), retentionCutoff).run();

  // Keep one active proof per session/purpose. Re-authentication invalidates any
  // older proof so a copied token cannot remain useful in parallel.
  await db.prepare(
    `UPDATE iumrah_client_security_proofs SET consumed_at=?1
     WHERE pilgrim_id=?2 AND session_id=?3 AND purpose=?4 AND consumed_at IS NULL`,
  ).bind(now.toISOString(), auth.pilgrimID, auth.sessionID, purpose).run();

  await db.prepare(
    `INSERT INTO iumrah_client_security_proofs(
       id,proof_hash,pilgrim_id,session_id,purpose,created_at,expires_at,consumed_at
     ) VALUES(?1,?2,?3,?4,?5,?6,?7,NULL)`,
  ).bind(
    `proof-${crypto.randomUUID()}`, proofHash, auth.pilgrimID, auth.sessionID,
    purpose, now.toISOString(), expiresAt,
  ).run();

  return { token, expiresAt };
}

async function requireSecurityProof(
  request: Request,
  db: D1Like,
  auth: DeviceAuth,
  purpose: SecurityProofPurpose,
  consume = false,
) {
  const raw = cleanText(request.headers.get("x-iumrah-security-proof"), 512);
  if (!raw) throw new RouteError("SECURITY_REAUTH_REQUIRED", 403);
  const proofHash = await sha256Hex(raw);
  const now = new Date().toISOString();
  const proof = await db.prepare(
    `SELECT id FROM iumrah_client_security_proofs
     WHERE proof_hash=?1 AND pilgrim_id=?2 AND session_id=?3 AND purpose=?4
       AND consumed_at IS NULL AND expires_at>?5 LIMIT 1`,
  ).bind(proofHash, auth.pilgrimID, auth.sessionID, purpose, now).first<{ id: string }>();
  if (!proof) throw new RouteError("SECURITY_REAUTH_REQUIRED", 403);

  if (consume) {
    const consumed = await db.prepare(
      `UPDATE iumrah_client_security_proofs SET consumed_at=?1
       WHERE id=?2 AND consumed_at IS NULL`,
    ).bind(now, proof.id).run();
    const changes = Number(consumed.meta?.changes ?? 0);
    if (changes < 1) throw new RouteError("SECURITY_REAUTH_REQUIRED", 403);
  }
  return proof;
}

async function createAccountSession(db: D1Like, pilgrimID: number) {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString();
  await db.prepare(
    `INSERT INTO iumrah_account_sessions(token_hash,pilgrim_id,created_at,expires_at,last_used_at)
     VALUES(?1,?2,?3,?4,?3)`,
  ).bind(tokenHash, pilgrimID, now.toISOString(), expiresAt).run();
  return { token, tokenHash, expiresAt };
}

function parseJWT(identityToken: string) {
  const pieces = identityToken.split(".");
  if (pieces.length !== 3) throw new RouteError("APPLE_TOKEN_INVALID", 401);
  try {
    const header = JSON.parse(new TextDecoder().decode(decodeBase64URL(pieces[0]))) as { alg?: string; kid?: string };
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64URL(pieces[1]))) as AppleClaims;
    return { pieces, header, claims };
  } catch {
    throw new RouteError("APPLE_TOKEN_INVALID", 401);
  }
}

async function appleKeys(forceRefresh = false) {
  if (!forceRefresh && appleKeyCache && appleKeyCache.expiresAt > Date.now()) return appleKeyCache.keys;
  const response = await fetch("https://appleid.apple.com/auth/keys", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new RouteError("APPLE_VERIFICATION_UNAVAILABLE", 503);
  const payload = await response.json() as { keys?: JsonWebKey[] };
  if (!Array.isArray(payload.keys) || !payload.keys.length) {
    throw new RouteError("APPLE_VERIFICATION_UNAVAILABLE", 503);
  }
  appleKeyCache = { keys: payload.keys, expiresAt: Date.now() + 6 * 60 * 60_000 };
  return payload.keys;
}

async function verifyAppleIdentity(identityToken: unknown, rawNonce: unknown, audienceInput: string | string[]) {
  const token = cleanText(identityToken, 12_000);
  const nonce = cleanText(rawNonce, 256);
  if (!token || nonce.length < 32) throw new RouteError("APPLE_TOKEN_INVALID", 401);
  const { pieces, header, claims } = parseJWT(token);
  if (header.alg !== "RS256" || !header.kid) throw new RouteError("APPLE_TOKEN_INVALID", 401);
  let keys = await appleKeys();
  let keyData = keys.find((item) => (item as JsonWebKey & { kid?: string }).kid === header.kid);
  if (!keyData) {
    keys = await appleKeys(true);
    keyData = keys.find((item) => (item as JsonWebKey & { kid?: string }).kid === header.kid);
  }
  if (!keyData) throw new RouteError("APPLE_SIGNING_KEY_NOT_FOUND", 503);
  const key = await crypto.subtle.importKey(
    "jwk",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBase64URL(pieces[2]),
    new TextEncoder().encode(`${pieces[0]}.${pieces[1]}`),
  );
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const configuredAudiences = (Array.isArray(audienceInput) ? audienceInput : [audienceInput])
    .map((value) => cleanText(value, 512))
    .filter(Boolean);
  const nonceDigest = await sha256Hex(nonce);
  if (!verified
      || claims.iss !== "https://appleid.apple.com"
      || !configuredAudiences.some((audience) => audiences.includes(audience))
      || typeof claims.exp !== "number" || claims.exp <= now
      || typeof claims.iat !== "number" || claims.iat > now + 120
      || !claims.sub || claims.sub.length > 255
      || (claims.nonce !== nonce && claims.nonce !== nonceDigest)) {
    throw new RouteError("APPLE_TOKEN_INVALID", 401);
  }
  return {
    token,
    subject: claims.sub,
    email: normalizeEmail(claims.email),
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
  };
}

async function consumeAppleAssertion(db: D1Like, identityToken: string) {
  const digest = await sha256Hex(identityToken);
  await db.prepare("DELETE FROM iumrah_client_apple_assertions WHERE used_at<?1")
    .bind(new Date(Date.now() - 30 * 86_400_000).toISOString()).run();
  const existing = await db.prepare(
    "SELECT token_hash FROM iumrah_client_apple_assertions WHERE token_hash=?1 LIMIT 1",
  ).bind(digest).first<{ token_hash: string }>();
  if (existing) throw new RouteError("APPLE_TOKEN_REPLAYED", 409);
  await db.prepare(
    "INSERT INTO iumrah_client_apple_assertions(token_hash,used_at) VALUES(?1,?2)",
  ).bind(digest, new Date().toISOString()).run();
}

function parseGoogleJWT(identityToken: string) {
  const pieces = identityToken.split(".");
  if (pieces.length !== 3) throw new RouteError("GOOGLE_TOKEN_INVALID", 401);
  try {
    const header = JSON.parse(new TextDecoder().decode(decodeBase64URL(pieces[0]))) as { alg?: string; kid?: string };
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64URL(pieces[1]))) as GoogleClaims;
    return { pieces, header, claims };
  } catch {
    throw new RouteError("GOOGLE_TOKEN_INVALID", 401);
  }
}

async function googleKeys(forceRefresh = false) {
  if (!forceRefresh && googleKeyCache && googleKeyCache.expiresAt > Date.now()) return googleKeyCache.keys;
  const response = await fetch("https://www.googleapis.com/oauth2/v3/certs", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new RouteError("GOOGLE_VERIFICATION_UNAVAILABLE", 503);
  const payload = await response.json() as { keys?: JsonWebKey[] };
  if (!Array.isArray(payload.keys) || !payload.keys.length) {
    throw new RouteError("GOOGLE_VERIFICATION_UNAVAILABLE", 503);
  }
  const cacheControl = response.headers.get("cache-control") ?? "";
  const maxAgeMatch = cacheControl.match(/(?:^|[,\s])max-age=(\d+)/i);
  const maxAgeSeconds = maxAgeMatch ? Math.max(60, Math.min(Number(maxAgeMatch[1]), 86_400)) : 6 * 60 * 60;
  googleKeyCache = { keys: payload.keys, expiresAt: Date.now() + maxAgeSeconds * 1000 };
  return payload.keys;
}

async function verifyGoogleIdentity(identityToken: unknown, rawNonce: unknown, serverClientID: string) {
  const configuredAudience = cleanText(serverClientID, 512);
  if (!configuredAudience || configuredAudience.startsWith("__GOOGLE_")) {
    throw new RouteError("GOOGLE_AUTH_NOT_CONFIGURED", 503);
  }
  const token = cleanText(identityToken, 12_000);
  const nonce = cleanText(rawNonce, 256);
  if (!token || nonce.length < 32) throw new RouteError("GOOGLE_TOKEN_INVALID", 401);
  const { pieces, header, claims } = parseGoogleJWT(token);
  if (header.alg !== "RS256" || !header.kid) throw new RouteError("GOOGLE_TOKEN_INVALID", 401);
  let keys = await googleKeys();
  let keyData = keys.find((item) => (item as JsonWebKey & { kid?: string }).kid === header.kid);
  if (!keyData) {
    keys = await googleKeys(true);
    keyData = keys.find((item) => (item as JsonWebKey & { kid?: string }).kid === header.kid);
  }
  if (!keyData) throw new RouteError("GOOGLE_SIGNING_KEY_NOT_FOUND", 503);
  const key = await crypto.subtle.importKey(
    "jwk",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBase64URL(pieces[2]),
    new TextEncoder().encode(`${pieces[0]}.${pieces[1]}`),
  );
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!verified
      || (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com")
      || !audiences.includes(configuredAudience)
      || typeof claims.exp !== "number" || claims.exp <= now
      || typeof claims.iat !== "number" || claims.iat > now + 120
      || !claims.sub || claims.sub.length > 255
      || claims.nonce !== nonce) {
    throw new RouteError("GOOGLE_TOKEN_INVALID", 401);
  }
  return {
    token,
    subject: claims.sub,
    email: normalizeEmail(claims.email),
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
  };
}

async function consumeGoogleAssertion(db: D1Like, identityToken: string) {
  const digest = await sha256Hex(identityToken);
  await db.prepare("DELETE FROM iumrah_client_google_assertions WHERE used_at<?1")
    .bind(new Date(Date.now() - 30 * 86_400_000).toISOString()).run();
  const existing = await db.prepare(
    "SELECT token_hash FROM iumrah_client_google_assertions WHERE token_hash=?1 LIMIT 1",
  ).bind(digest).first<{ token_hash: string }>();
  if (existing) throw new RouteError("GOOGLE_TOKEN_REPLAYED", 409);
  await db.prepare(
    "INSERT INTO iumrah_client_google_assertions(token_hash,used_at) VALUES(?1,?2)",
  ).bind(digest, new Date().toISOString()).run();
}

async function resolveLoginPilgrimID(db: D1Like, identifierValue: unknown) {
  const identifier = cleanText(identifierValue, 254);
  if (/^\d{6,8}$/.test(identifier)) return Number(identifier);
  const email = normalizeEmail(identifier);
  if (!validEmail(email)) return 0;
  const row = await db.prepare(
    "SELECT pilgrim_id FROM iumrah_client_account_emails WHERE email_normalized=?1 LIMIT 1",
  ).bind(email).first<{ pilgrim_id: number }>();
  return Number(row?.pilgrim_id ?? 0);
}

async function accountRow(db: D1Like, pilgrimID: number) {
  return db.prepare(
    `SELECT p.id,p.first_name,p.last_name,p.display_name,p.phone,p.email,p.telegram,p.whatsapp
     FROM pilgrims p INNER JOIN iumrah_accounts a ON a.pilgrim_id=p.id
     WHERE p.id=?1 LIMIT 1`,
  ).bind(pilgrimID).first<PilgrimRow>();
}

type BookingActivationContext = {
  bookingID: string;
  pilgrimID: number;
  pilgrim: PilgrimRow;
};

async function bookingActivationContext(
  request: Request,
  env: Env,
  db: D1Like,
  bookingIDValue: unknown,
): Promise<BookingActivationContext> {
  const bookingID = cleanText(bookingIDValue, 80);
  const bookingToken = cleanText(request.headers.get("x-booking-token"), 180);
  if (!bookingID || bookingToken.length < 24 || bookingToken.length > 128) {
    throw new RouteError("BOOKING_PROOF_INVALID", 401);
  }
  if (!env.BOOKINGS_DB) throw new RouteError("BOOKINGS_DB_NOT_CONFIGURED", 503);

  const tokenHash = await sha256Hex(bookingToken);
  const booking = await env.BOOKINGS_DB.prepare(
    "SELECT id FROM bookings WHERE id=?1 AND access_token_hash=?2 LIMIT 1",
  ).bind(bookingID, tokenHash).first<{ id: string }>();
  if (!booking) throw new RouteError("BOOKING_PROOF_INVALID", 403);

  const trip = await db.prepare(
    "SELECT pilgrim_id FROM pilgrim_trips WHERE booking_id=?1 LIMIT 1",
  ).bind(bookingID).first<{ pilgrim_id: number }>();
  const pilgrimID = Number(trip?.pilgrim_id ?? 0);
  if (!pilgrimID) throw new RouteError("BOOKING_ACCOUNT_NOT_READY", 409);

  const pilgrim = await db.prepare(
    `SELECT id,first_name,last_name,display_name,phone,email,telegram,whatsapp
     FROM pilgrims WHERE id=?1 LIMIT 1`,
  ).bind(pilgrimID).first<PilgrimRow>();
  if (!pilgrim) throw new RouteError("BOOKING_ACCOUNT_NOT_READY", 409);
  return { bookingID, pilgrimID, pilgrim };
}

async function accountHasEstablishedCredentials(db: D1Like, pilgrimID: number) {
  const account = await db.prepare(
    "SELECT last_login_at FROM iumrah_accounts WHERE pilgrim_id=?1 LIMIT 1",
  ).bind(pilgrimID).first<{ last_login_at: string | null }>();
  if (cleanText(account?.last_login_at, 80)) return true;

  const row = await db.prepare(
    `SELECT
       EXISTS(SELECT 1 FROM iumrah_client_account_emails WHERE pilgrim_id=?1 AND verified_at IS NOT NULL) AS has_email,
       EXISTS(SELECT 1 FROM iumrah_client_apple_links WHERE pilgrim_id=?1) AS has_apple,
       EXISTS(SELECT 1 FROM iumrah_client_google_links WHERE pilgrim_id=?1) AS has_google,
       EXISTS(SELECT 1 FROM iumrah_client_devices WHERE pilgrim_id=?1 AND revoked_at IS NULL) AS has_device,
       EXISTS(SELECT 1 FROM iumrah_account_sessions
              WHERE pilgrim_id=?1 AND revoked_at IS NULL AND expires_at>?2) AS has_session`,
  ).bind(pilgrimID, new Date().toISOString()).first<{
    has_email: number;
    has_apple: number;
    has_google: number;
    has_device: number;
    has_session: number;
  }>();
  return Boolean(
    Number(row?.has_email ?? 0)
    || Number(row?.has_apple ?? 0)
    || Number(row?.has_google ?? 0)
    || Number(row?.has_device ?? 0)
    || Number(row?.has_session ?? 0),
  );
}

async function ensureActivationAvailable(db: D1Like, pilgrimID: number) {
  if (await accountHasEstablishedCredentials(db, pilgrimID)) {
    throw new RouteError("ACCOUNT_ALREADY_ACTIVE", 409);
  }
}

async function establishPasswordAccount(
  request: Request,
  db: D1Like,
  context: BookingActivationContext,
  passwordValue: unknown,
  deviceValue: unknown,
) {
  return establishPasswordCredentials(
    request,
    db,
    context.pilgrimID,
    context.pilgrim,
    passwordValue,
    deviceValue,
    "booking_account_activated",
  );
}

async function establishPasswordCredentials(
  request: Request,
  db: D1Like,
  pilgrimID: number,
  pilgrim: PilgrimRow,
  passwordValue: unknown,
  deviceValue: unknown,
  auditEvent: string,
) {
  if (!validPassword(passwordValue)) throw new RouteError("PASSWORD_TOO_WEAK", 400);
  await ensureActivationAvailable(db, pilgrimID);

  const password = String(passwordValue);
  const salt = randomToken(18);
  const passwordHash = await passwordDigest(password, salt, PASSWORD_ITERATIONS);
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO iumrah_accounts(
       pilgrim_id,password_salt,password_hash,password_iterations,activated_at,password_updated_at,
       failed_attempts,locked_until,last_login_at
     ) VALUES(?1,?2,?3,?4,?5,?5,0,NULL,NULL)
     ON CONFLICT(pilgrim_id) DO UPDATE SET
       password_salt=excluded.password_salt,
       password_hash=excluded.password_hash,
       password_iterations=excluded.password_iterations,
       activated_at=COALESCE(iumrah_accounts.activated_at, excluded.activated_at),
       password_updated_at=excluded.password_updated_at,
       failed_attempts=0,
       locked_until=NULL`,
  ).bind(pilgrimID, salt, passwordHash, PASSWORD_ITERATIONS, now).run();

  const device = parseDevice(deviceValue);
  const session = await createAccountSession(db, pilgrimID);
  const auth: AccountAuth = {
    pilgrimID,
    tokenHash: session.tokenHash,
    pilgrim,
  };
  let sessionID: string;
  try {
    sessionID = await bindCurrentSession(db, auth, device, request);
  } catch (error) {
    await db.prepare("UPDATE iumrah_account_sessions SET revoked_at=?1 WHERE token_hash=?2")
      .bind(new Date().toISOString(), session.tokenHash).run();
    throw error;
  }

  await db.prepare(
    `UPDATE iumrah_client_devices
     SET is_primary=CASE WHEN installation_id=?1 THEN 1 ELSE 0 END
     WHERE pilgrim_id=?2 AND revoked_at IS NULL`,
  ).bind(device.installationID, pilgrimID).run();
  await db.prepare("UPDATE iumrah_accounts SET last_login_at=?1 WHERE pilgrim_id=?2")
    .bind(now, pilgrimID).run();
  await audit(db, pilgrimID, auditEvent, sessionID, sessionID);

  return { session, sessionID };
}

async function establishNewPasswordCredentials(
  request: Request,
  db: D1Like,
  pilgrimID: number,
  pilgrim: PilgrimRow,
  passwordValue: unknown,
  deviceValue: unknown,
  auditEvent: string,
) {
  if (!validPassword(passwordValue)) throw new RouteError("PASSWORD_TOO_WEAK", 400);
  const password = String(passwordValue);
  const salt = randomToken(18);
  const passwordHash = await passwordDigest(password, salt, PASSWORD_ITERATIONS);
  const now = new Date().toISOString();
  try {
    await db.prepare(
      `INSERT INTO iumrah_accounts(
         pilgrim_id,password_salt,password_hash,password_iterations,activated_at,password_updated_at,
         failed_attempts,locked_until,last_login_at
       ) VALUES(?1,?2,?3,?4,?5,?5,0,NULL,NULL)`,
    ).bind(pilgrimID, salt, passwordHash, PASSWORD_ITERATIONS, now).run();
  } catch {
    throw new RouteError("ACCOUNT_ALREADY_ACTIVE", 409);
  }

  const device = parseDevice(deviceValue);
  let session: Awaited<ReturnType<typeof createAccountSession>> | null = null;
  try {
    session = await createAccountSession(db, pilgrimID);
    const auth: AccountAuth = { pilgrimID, tokenHash: session.tokenHash, pilgrim };
    const sessionID = await bindCurrentSession(db, auth, device, request);
    await db.prepare(
      `UPDATE iumrah_client_devices
       SET is_primary=CASE WHEN installation_id=?1 THEN 1 ELSE 0 END
       WHERE pilgrim_id=?2 AND revoked_at IS NULL`,
    ).bind(device.installationID, pilgrimID).run();
    await db.prepare("UPDATE iumrah_accounts SET last_login_at=?1 WHERE pilgrim_id=?2")
      .bind(now, pilgrimID).run();
    await audit(db, pilgrimID, auditEvent, sessionID, sessionID);
    return { session, sessionID };
  } catch (error) {
    if (session) {
      await db.prepare("UPDATE iumrah_account_sessions SET revoked_at=?1 WHERE token_hash=?2")
        .bind(new Date().toISOString(), session.tokenHash).run().catch(() => undefined);
    }
    await db.prepare("DELETE FROM iumrah_client_devices WHERE pilgrim_id=?1 AND installation_id=?2")
      .bind(pilgrimID, device.installationID).run().catch(() => undefined);
    await db.prepare("DELETE FROM iumrah_accounts WHERE pilgrim_id=?1 AND password_hash=?2")
      .bind(pilgrimID, passwordHash).run().catch(() => undefined);
    throw error;
  }
}

async function activateWithBookingPassword(request: Request, env: Env, db: D1Like) {
  const payload = await request.json().catch(() => null) as {
    bookingID?: unknown;
    password?: unknown;
    device?: unknown;
  } | null;
  const context = await bookingActivationContext(request, env, db, payload?.bookingID);
  const established = await establishPasswordAccount(request, db, context, payload?.password, payload?.device);
  return json({
    ok: true,
    account: accountProfile(context.pilgrim),
    session: { token: established.session.token, expiresAt: established.session.expiresAt },
  });
}

async function startBookingEmailActivation(request: Request, env: Env, db: D1Like) {
  const payload = await request.json().catch(() => null) as {
    bookingID?: unknown;
    email?: unknown;
    locale?: unknown;
  } | null;
  const context = await bookingActivationContext(request, env, db, payload?.bookingID);
  await ensureActivationAvailable(db, context.pilgrimID);
  const emailDisplay = cleanText(payload?.email, 254);
  const emailNormalized = normalizeEmail(emailDisplay);
  if (!validEmail(emailNormalized)) throw new RouteError("EMAIL_INVALID", 400);
  const collision = await db.prepare(
    `SELECT pilgrim_id FROM iumrah_client_account_emails
     WHERE email_normalized=?1 AND pilgrim_id<>?2 LIMIT 1`,
  ).bind(emailNormalized, context.pilgrimID).first<{ pilgrim_id: number }>();
  if (collision) throw new RouteError("EMAIL_ALREADY_CONNECTED", 409);

  const challenge = await createEmailChallenge(
    db,
    env,
    request,
    "verify_email",
    context.pilgrimID,
    emailDisplay,
    cleanText(payload?.locale, 24),
  );
  await audit(db, context.pilgrimID, "booking_email_activation_started", null, null);
  return json({ ok: true, challengeID: challenge.id, expiresAt: challenge.expiresAt });
}

async function confirmBookingEmailActivation(request: Request, env: Env, db: D1Like) {
  const payload = await request.json().catch(() => null) as {
    bookingID?: unknown;
    challengeID?: unknown;
    code?: unknown;
    password?: unknown;
    device?: unknown;
  } | null;
  const context = await bookingActivationContext(request, env, db, payload?.bookingID);
  await ensureActivationAvailable(db, context.pilgrimID);
  const challenge = await verifyEmailChallenge(
    db,
    cleanText(payload?.challengeID, 100),
    "verify_email",
    cleanText(payload?.code, 12),
    context.pilgrimID,
  );

  const collision = await db.prepare(
    `SELECT pilgrim_id FROM iumrah_client_account_emails
     WHERE email_normalized=?1 AND pilgrim_id<>?2 LIMIT 1`,
  ).bind(challenge.email_normalized, context.pilgrimID).first<{ pilgrim_id: number }>();
  if (collision) throw new RouteError("EMAIL_ALREADY_CONNECTED", 409);

  const established = await establishPasswordAccount(
    request,
    db,
    context,
    (payload?.password === undefined ? randomToken(48) : payload.password),
    payload?.device,
  );
  await linkVerifiedEmail(db, context.pilgrimID, challenge.email_display, challenge.email_normalized);
  await audit(db, context.pilgrimID, "booking_email_activation_completed", established.sessionID, established.sessionID);

  const updatedPilgrim = await db.prepare(
    `SELECT id,first_name,last_name,display_name,phone,email,telegram,whatsapp
     FROM pilgrims WHERE id=?1 LIMIT 1`,
  ).bind(context.pilgrimID).first<PilgrimRow>() ?? context.pilgrim;
  return json({
    ok: true,
    account: accountProfile(updatedPilgrim),
    session: { token: established.session.token, expiresAt: established.session.expiresAt },
  });
}


async function startBookingSMSActivation(request: Request, env: Env, db: D1Like) {
  const payload = await request.json().catch(() => null) as {
    bookingID?: unknown;
    phone?: unknown;
    locale?: unknown;
  } | null;
  const context = await bookingActivationContext(request, env, db, payload?.bookingID);
  await ensureActivationAvailable(db, context.pilgrimID);
  const challenge = await createSMSChallenge(
    db,
    env,
    request,
    "activate_account",
    context.pilgrimID,
    payload?.phone,
  );
  await audit(db, context.pilgrimID, "booking_sms_activation_started", null, null);
  return json({
    ok: true,
    challengeID: challenge.id,
    expiresAt: challenge.expiresAt,
    phone: challenge.phoneNormalized,
  });
}

async function confirmBookingSMSActivation(request: Request, env: Env, db: D1Like) {
  const payload = await request.json().catch(() => null) as {
    bookingID?: unknown;
    challengeID?: unknown;
    code?: unknown;
    password?: unknown;
    device?: unknown;
  } | null;
  const context = await bookingActivationContext(request, env, db, payload?.bookingID);
  await ensureActivationAvailable(db, context.pilgrimID);
  const challenge = await verifySMSChallenge(
    db,
    cleanText(payload?.challengeID, 120),
    "activate_account",
    cleanText(payload?.code, 12),
    context.pilgrimID,
  );
  await ensurePhoneAvailable(db, challenge.phone_normalized, context.pilgrimID);

  const established = await establishPasswordAccount(
    request,
    db,
    context,
    (payload?.password === undefined ? randomToken(48) : payload.password),
    payload?.device,
  );
  await linkVerifiedPhone(db, context.pilgrimID, challenge.phone_display, challenge.phone_normalized);
  await audit(db, context.pilgrimID, "booking_sms_activation_completed", established.sessionID, established.sessionID);

  const updatedPilgrim = await db.prepare(
    `SELECT id,first_name,last_name,display_name,phone,email,telegram,whatsapp
     FROM pilgrims WHERE id=?1 LIMIT 1`,
  ).bind(context.pilgrimID).first<PilgrimRow>() ?? context.pilgrim;
  return json({
    ok: true,
    account: accountProfile(updatedPilgrim),
    session: { token: established.session.token, expiresAt: established.session.expiresAt },
  });
}

async function bookingPhoneVerificationStatus(request: Request, env: Env, db: D1Like) {
  const url = new URL(request.url);
  const context = await bookingActivationContext(request, env, db, url.searchParams.get("bookingID"));
  const row = await db.prepare(
    `SELECT phone_normalized,verified_at FROM iumrah_client_account_phones
     WHERE pilgrim_id=?1 LIMIT 1`,
  ).bind(context.pilgrimID).first<{ phone_normalized: string; verified_at: string }>();
  return json({
    ok: true,
    verified: Boolean(row?.verified_at),
    phone: cleanText(row?.phone_normalized, 40),
    verifiedAt: cleanText(row?.verified_at, 80),
  });
}

async function startBookingPhoneVerification(request: Request, env: Env, db: D1Like) {
  const payload = await request.json().catch(() => null) as {
    bookingID?: unknown;
    phone?: unknown;
    locale?: unknown;
  } | null;
  const context = await bookingActivationContext(request, env, db, payload?.bookingID);
  const challenge = await createSMSChallenge(
    db,
    env,
    request,
    "verify_phone",
    context.pilgrimID,
    payload?.phone,
  );
  await audit(db, context.pilgrimID, "booking_phone_verification_started", null, null);
  return json({
    ok: true,
    challengeID: challenge.id,
    expiresAt: challenge.expiresAt,
    phone: challenge.phoneNormalized,
  });
}

async function confirmBookingPhoneVerification(request: Request, env: Env, db: D1Like) {
  const payload = await request.json().catch(() => null) as {
    bookingID?: unknown;
    challengeID?: unknown;
    code?: unknown;
  } | null;
  const context = await bookingActivationContext(request, env, db, payload?.bookingID);
  const challenge = await verifySMSChallenge(
    db,
    cleanText(payload?.challengeID, 120),
    "verify_phone",
    cleanText(payload?.code, 12),
    context.pilgrimID,
  );
  await ensurePhoneAvailable(db, challenge.phone_normalized, context.pilgrimID);
  const verifiedAt = await linkVerifiedPhone(
    db,
    context.pilgrimID,
    challenge.phone_display,
    challenge.phone_normalized,
  );
  await audit(db, context.pilgrimID, "booking_phone_verified", null, null);
  return json({ ok: true, phone: challenge.phone_normalized, verifiedAt });
}

async function startStandaloneEmailRegistration(request: Request, env: Env, db: D1Like) {
  const payload = await request.json().catch(() => null) as {
    email?: unknown;
    locale?: unknown;
  } | null;
  const emailDisplay = cleanText(payload?.email, 254);
  const emailNormalized = normalizeEmail(emailDisplay);
  if (!validEmail(emailNormalized)) throw new RouteError("EMAIL_INVALID", 400);
  const existing = await db.prepare(
    "SELECT pilgrim_id FROM iumrah_client_account_emails WHERE email_normalized=?1 LIMIT 1",
  ).bind(emailNormalized).first<{ pilgrim_id: number }>();
  if (existing) throw new RouteError("EMAIL_ALREADY_CONNECTED", 409);
  const challenge = await createEmailChallenge(
    db,
    env,
    request,
    "verify_email",
    null,
    emailDisplay,
    cleanText(payload?.locale, 24),
  );
  return json({ ok: true, challengeID: challenge.id, expiresAt: challenge.expiresAt });
}

async function reusableProvisionalPilgrim(db: D1Like, emailNormalized: string) {
  const result = await db.prepare(
    `SELECT p.id,p.first_name,p.last_name,p.display_name,p.phone,p.email,p.telegram,p.whatsapp
     FROM pilgrims p
     WHERE LOWER(TRIM(COALESCE(p.email,'')))=?1
       AND NOT EXISTS(SELECT 1 FROM iumrah_accounts a WHERE a.pilgrim_id=p.id)
       AND NOT EXISTS(SELECT 1 FROM iumrah_client_account_emails e WHERE e.pilgrim_id=p.id)
       AND NOT EXISTS(SELECT 1 FROM iumrah_client_apple_links a WHERE a.pilgrim_id=p.id)
       AND NOT EXISTS(SELECT 1 FROM iumrah_client_google_links g WHERE g.pilgrim_id=p.id)
       AND NOT EXISTS(SELECT 1 FROM iumrah_client_devices d WHERE d.pilgrim_id=p.id)
       AND NOT EXISTS(SELECT 1 FROM iumrah_account_sessions s WHERE s.pilgrim_id=p.id)
     ORDER BY p.id ASC LIMIT 2`,
  ).bind(emailNormalized).all<PilgrimRow>();
  const rows = result.results ?? [];
  return rows.length === 1 ? rows[0] : null;
}

async function confirmStandaloneEmailRegistration(request: Request, db: D1Like) {
  const payload = await request.json().catch(() => null) as {
    challengeID?: unknown;
    code?: unknown;
    password?: unknown;
    firstName?: unknown;
    lastName?: unknown;
    device?: unknown;
  } | null;
    const challenge = await verifyEmailChallenge(
    db,
    cleanText(payload?.challengeID, 100),
    "verify_email",
    cleanText(payload?.code, 12),
  );
  if (challenge.pilgrim_id !== null) throw new RouteError("VERIFICATION_CODE_INVALID", 400);

  const emailOwner = await db.prepare(
    "SELECT pilgrim_id FROM iumrah_client_account_emails WHERE email_normalized=?1 LIMIT 1",
  ).bind(challenge.email_normalized).first<{ pilgrim_id: number }>();
  if (emailOwner) throw new RouteError("EMAIL_ALREADY_CONNECTED", 409);

  const firstName = cleanText(payload?.firstName, 120);
  const lastName = cleanText(payload?.lastName, 120);
  if (!firstName || !lastName) throw new RouteError("NAME_REQUIRED", 400);
  const displayName = [firstName, lastName].filter(Boolean).join(" ").slice(0, 240);
  const now = new Date().toISOString();
  let pilgrim = await reusableProvisionalPilgrim(db, challenge.email_normalized);
  let createdPilgrim = false;
  if (!pilgrim) {
    pilgrim = await db.prepare(
      `INSERT INTO pilgrims(email,first_name,last_name,display_name,created_at,updated_at)
       VALUES(?1,?2,?3,?4,?5,?5)
       RETURNING id,first_name,last_name,display_name,phone,email,telegram,whatsapp`,
    ).bind(challenge.email_display, firstName, lastName, displayName, now).first<PilgrimRow>();
    if (!pilgrim) throw new RouteError("ACCOUNT_CREATION_FAILED", 503);
    createdPilgrim = true;
  } else {
    await db.prepare(
      `UPDATE pilgrims SET
         first_name=CASE WHEN TRIM(COALESCE(first_name,''))='' THEN ?1 ELSE first_name END,
         last_name=CASE WHEN TRIM(COALESCE(last_name,''))='' THEN ?2 ELSE last_name END,
         display_name=CASE WHEN TRIM(COALESCE(display_name,''))='' THEN ?3 ELSE display_name END,
         email=?4,updated_at=?5
       WHERE id=?6`,
    ).bind(firstName, lastName, displayName, challenge.email_display, now, Number(pilgrim.id)).run();
    pilgrim = await db.prepare(
      `SELECT id,first_name,last_name,display_name,phone,email,telegram,whatsapp
       FROM pilgrims WHERE id=?1 LIMIT 1`,
    ).bind(Number(pilgrim.id)).first<PilgrimRow>() ?? pilgrim;
  }

  const pilgrimID = Number(pilgrim.id);
  await ensureActivationAvailable(db, pilgrimID);
  try {
    await linkVerifiedEmail(db, pilgrimID, challenge.email_display, challenge.email_normalized);
    const established = await establishNewPasswordCredentials(
      request,
      db,
      pilgrimID,
      pilgrim,
      (payload?.password === undefined ? randomToken(48) : payload.password),
      payload?.device,
      "email_account_created",
    );
    const updated = await accountRow(db, pilgrimID) ?? pilgrim;
    return json({
      ok: true,
      account: accountProfile(updated),
      session: { token: established.session.token, expiresAt: established.session.expiresAt },
    });
  } catch (error) {
    await db.prepare(
      `DELETE FROM iumrah_client_account_emails
       WHERE pilgrim_id=?1
         AND NOT EXISTS(SELECT 1 FROM iumrah_accounts a WHERE a.pilgrim_id=?1)`,
    ).bind(pilgrimID).run().catch(() => undefined);
    if (createdPilgrim) {
      await db.prepare(
        `DELETE FROM pilgrims WHERE id=?1
         AND NOT EXISTS(SELECT 1 FROM iumrah_accounts a WHERE a.pilgrim_id=?1)`,
      ).bind(pilgrimID).run().catch(() => undefined);
    }
    throw error;
  }
}

async function loginWithPassword(request: Request, db: D1Like) {
  const payload = await request.json().catch(() => null) as {
    identifier?: unknown;
    iumrahID?: unknown;
    password?: unknown;
    device?: unknown;
  } | null;
  const pilgrimID = await resolveLoginPilgrimID(db, payload?.identifier ?? payload?.iumrahID);
  const password = String(payload?.password ?? "");
  if (!pilgrimID || !validPassword(password)) throw new RouteError("INVALID_CREDENTIALS", 401);
  const pilgrim = await accountRow(db, pilgrimID);
  if (!pilgrim) throw new RouteError("INVALID_CREDENTIALS", 401);
  await verifyAccountPassword(db, pilgrimID, password);
  const device = parseDevice(payload?.device);
  const session = await createAccountSession(db, pilgrimID);
  const auth: AccountAuth = { pilgrimID, tokenHash: session.tokenHash, pilgrim };
  let sessionID: string;
  try {
    sessionID = await bindCurrentSession(db, auth, device, request);
  } catch (error) {
    await db.prepare("UPDATE iumrah_account_sessions SET revoked_at=?1 WHERE token_hash=?2")
      .bind(new Date().toISOString(), session.tokenHash).run();
    throw error;
  }
  const now = new Date().toISOString();
  await db.prepare("UPDATE iumrah_accounts SET last_login_at=?1 WHERE pilgrim_id=?2")
    .bind(now, pilgrimID).run();
  await audit(db, pilgrimID, "password_sign_in", sessionID, sessionID);
  return json({
    ok: true,
    account: accountProfile(pilgrim),
    session: { token: session.token, expiresAt: session.expiresAt },
  });
}

async function reusableProvisionalPilgrimByPhone(db: D1Like, phoneNormalized: string) {
  const phoneDigits = phoneNormalized.replace(/\D+/g, "");
  const result = await db.prepare(
    `SELECT p.id,p.first_name,p.last_name,p.display_name,p.phone,p.email,p.telegram,p.whatsapp
     FROM pilgrims p
     WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.phone,''),' ',''),'-',''),'(',''),')',''),'+','')=?1
       AND NOT EXISTS(SELECT 1 FROM iumrah_accounts a WHERE a.pilgrim_id=p.id)
       AND NOT EXISTS(SELECT 1 FROM iumrah_client_account_phones ph WHERE ph.pilgrim_id=p.id)
       AND NOT EXISTS(SELECT 1 FROM iumrah_client_account_emails e WHERE e.pilgrim_id=p.id)
       AND NOT EXISTS(SELECT 1 FROM iumrah_client_apple_links a WHERE a.pilgrim_id=p.id)
       AND NOT EXISTS(SELECT 1 FROM iumrah_client_google_links g WHERE g.pilgrim_id=p.id)
       AND NOT EXISTS(SELECT 1 FROM iumrah_client_devices d WHERE d.pilgrim_id=p.id)
       AND NOT EXISTS(SELECT 1 FROM iumrah_account_sessions s WHERE s.pilgrim_id=p.id)
     ORDER BY p.id ASC LIMIT 2`,
  ).bind(phoneDigits).all<PilgrimRow>();
  const rows = result.results ?? [];
  return rows.length === 1 ? rows[0] : null;
}

async function startStandalonePhoneRegistration(request: Request, env: Env, db: D1Like) {
  const payload = await request.json().catch(() => null) as {
    phone?: unknown;
    firstName?: unknown;
    lastName?: unknown;
    locale?: unknown;
  } | null;
  const phone = normalizePhone(payload?.phone);
  if (!phone.startsWith("+998")) throw new RouteError("SMS_COUNTRY_UNSUPPORTED", 400);
  if (!validUzbekPhone(phone)) throw new RouteError("PHONE_INVALID", 400);

  const firstName = cleanText(payload?.firstName, 120);
  const lastName = cleanText(payload?.lastName, 120);
  if (!firstName || !lastName) throw new RouteError("NAME_REQUIRED", 400);

  const linked = await db.prepare(
    `SELECT pilgrim_id FROM iumrah_client_account_phones WHERE phone_normalized=?1 LIMIT 1`,
  ).bind(phone).first<{ pilgrim_id: number }>();
  if (linked) throw new RouteError("PHONE_ALREADY_CONNECTED", 409);

  const phoneDigits = phone.replace(/\D+/g, "");
  const activeLegacy = await db.prepare(
    `SELECT p.id AS pilgrim_id
     FROM pilgrims p
     INNER JOIN iumrah_accounts a ON a.pilgrim_id=p.id
     WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.phone,''),' ',''),'-',''),'(',''),')',''),'+','')=?1
     LIMIT 1`,
  ).bind(phoneDigits).first<{ pilgrim_id: number }>();
  if (activeLegacy) throw new RouteError("PHONE_ALREADY_CONNECTED", 409);

  const now = new Date().toISOString();
  const displayName = [firstName, lastName].join(" ").slice(0, 240);
  let pilgrim = await reusableProvisionalPilgrimByPhone(db, phone);
  if (!pilgrim) {
    pilgrim = await db.prepare(
      `INSERT INTO pilgrims(phone,first_name,last_name,display_name,created_at,updated_at)
       VALUES(?1,?2,?3,?4,?5,?5)
       RETURNING id,first_name,last_name,display_name,phone,email,telegram,whatsapp`,
    ).bind(phone, firstName, lastName, displayName, now).first<PilgrimRow>();
    if (!pilgrim) throw new RouteError("ACCOUNT_CREATION_FAILED", 503);
  } else {
    await db.prepare(
      `UPDATE pilgrims SET first_name=?1,last_name=?2,display_name=?3,phone=?4,updated_at=?5 WHERE id=?6`,
    ).bind(firstName, lastName, displayName, phone, now, Number(pilgrim.id)).run();
  }

  const pilgrimID = Number(pilgrim.id);
  const challenge = await createSMSChallenge(
    db,
    env,
    request,
    "register_phone",
    pilgrimID,
    phone,
  );
  await audit(db, pilgrimID, "phone_registration_code_sent", null, null);
  return json({
    ok: true,
    challengeID: challenge.id,
    expiresAt: challenge.expiresAt,
    phone: challenge.phoneNormalized,
  });
}

async function confirmStandalonePhoneRegistration(request: Request, db: D1Like) {
  const payload = await request.json().catch(() => null) as {
    challengeID?: unknown;
    code?: unknown;
    password?: unknown;
    device?: unknown;
  } | null;
  
  const challengeID = cleanText(payload?.challengeID, 120);
  const hint = await db.prepare(
    `SELECT pilgrim_id FROM iumrah_client_sms_challenges
     WHERE id=?1 AND purpose='register_phone' LIMIT 1`,
  ).bind(challengeID).first<{ pilgrim_id: number }>();
  const pilgrimID = Number(hint?.pilgrim_id ?? 0);
  if (!pilgrimID) throw new RouteError("VERIFICATION_CODE_INVALID", 400);

  const challenge = await verifySMSChallenge(
    db,
    challengeID,
    "register_phone",
    cleanText(payload?.code, 12),
    pilgrimID,
  );
  await ensureActivationAvailable(db, pilgrimID);
  await ensurePhoneAvailable(db, challenge.phone_normalized, pilgrimID);

  const pilgrim = await db.prepare(
    `SELECT id,first_name,last_name,display_name,phone,email,telegram,whatsapp
     FROM pilgrims WHERE id=?1 LIMIT 1`,
  ).bind(pilgrimID).first<PilgrimRow>();
  if (!pilgrim) throw new RouteError("ACCOUNT_CREATION_FAILED", 503);

  try {
    await linkVerifiedPhone(db, pilgrimID, challenge.phone_display, challenge.phone_normalized);
    const established = await establishNewPasswordCredentials(
      request,
      db,
      pilgrimID,
      pilgrim,
      (payload?.password === undefined ? randomToken(48) : payload.password),
      payload?.device,
      "phone_account_created",
    );
    const updated = await accountRow(db, pilgrimID) ?? pilgrim;
    return json({
      ok: true,
      account: accountProfile(updated),
      session: { token: established.session.token, expiresAt: established.session.expiresAt },
    });
  } catch (error) {
    await db.prepare(
      `DELETE FROM iumrah_client_account_phones
       WHERE pilgrim_id=?1
         AND NOT EXISTS(SELECT 1 FROM iumrah_accounts a WHERE a.pilgrim_id=?1)`,
    ).bind(pilgrimID).run().catch(() => undefined);
    throw error;
  }
}

async function startPhoneLogin(request: Request, env: Env, db: D1Like) {
  const payload = await request.json().catch(() => null) as {
    phone?: unknown;
    locale?: unknown;
  } | null;
  const phone = normalizePhone(payload?.phone);
  if (!phone.startsWith("+998")) throw new RouteError("SMS_COUNTRY_UNSUPPORTED", 400);
  if (!validUzbekPhone(phone)) throw new RouteError("PHONE_INVALID", 400);

  const linked = await db.prepare(
    `SELECT p.pilgrim_id
     FROM iumrah_client_account_phones p
     INNER JOIN iumrah_accounts a ON a.pilgrim_id=p.pilgrim_id
     WHERE p.phone_normalized=?1 AND p.verified_at IS NOT NULL
     LIMIT 1`,
  ).bind(phone).first<{ pilgrim_id: number }>();

  let pilgrimID = Number(linked?.pilgrim_id ?? 0);
  if (!pilgrimID) {
    // Legacy accounts can already have the phone in pilgrims.phone without a
    // verified-phone row. Allow the owner to prove the same number by OTP and
    // bind it during confirmation instead of incorrectly rejecting sign-in.
    const phoneDigits = phone.replace(/\D+/g, "");
    const legacy = await db.prepare(
      `SELECT p.id AS pilgrim_id
       FROM pilgrims p
       INNER JOIN iumrah_accounts a ON a.pilgrim_id=p.id
       WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.phone,''),' ',''),'-',''),'(',''),')',''),'+','')=?1
       ORDER BY p.id ASC
       LIMIT 2`,
    ).bind(phoneDigits).all<{ pilgrim_id: number }>();
    const rows = legacy.results ?? [];
    if (rows.length === 1) pilgrimID = Number(rows[0].pilgrim_id);
  }
  if (!pilgrimID) throw new RouteError("PHONE_ACCOUNT_NOT_FOUND", 404);

  const challenge = await createSMSChallenge(
    db,
    env,
    request,
    "login_phone",
    pilgrimID,
    phone,
  );
  await audit(db, pilgrimID, "phone_sign_in_code_sent", null, null);
  return json({
    ok: true,
    challengeID: challenge.id,
    expiresAt: challenge.expiresAt,
    phone: challenge.phoneNormalized,
  });
}

async function confirmPhoneLogin(request: Request, db: D1Like) {
  const payload = await request.json().catch(() => null) as {
    challengeID?: unknown;
    code?: unknown;
    device?: unknown;
  } | null;
  const challengeID = cleanText(payload?.challengeID, 120);
  const challengeHint = await db.prepare(
    `SELECT pilgrim_id FROM iumrah_client_sms_challenges
     WHERE id=?1 AND purpose='login_phone' LIMIT 1`,
  ).bind(challengeID).first<{ pilgrim_id: number }>();
  const pilgrimID = Number(challengeHint?.pilgrim_id ?? 0);
  if (!pilgrimID) throw new RouteError("VERIFICATION_CODE_INVALID", 400);

  const verifiedChallenge = await verifySMSChallenge(
    db,
    challengeID,
    "login_phone",
    cleanText(payload?.code, 12),
    pilgrimID,
  );

  const existingPhone = await db.prepare(
    `SELECT phone_normalized FROM iumrah_client_account_phones WHERE pilgrim_id=?1 LIMIT 1`,
  ).bind(pilgrimID).first<{ phone_normalized: string }>();
  if (!existingPhone) {
    await ensurePhoneAvailable(db, verifiedChallenge.phone_normalized, pilgrimID);
    await linkVerifiedPhone(
      db,
      pilgrimID,
      verifiedChallenge.phone_display,
      verifiedChallenge.phone_normalized,
    );
  }

  const pilgrim = await accountRow(db, pilgrimID);
  if (!pilgrim) throw new RouteError("INVALID_CREDENTIALS", 401);
  const device = parseDevice(payload?.device);
  const session = await createAccountSession(db, pilgrimID);
  const auth: AccountAuth = { pilgrimID, tokenHash: session.tokenHash, pilgrim };
  let sessionID: string;
  try {
    sessionID = await bindCurrentSession(db, auth, device, request);
  } catch (error) {
    await db.prepare("UPDATE iumrah_account_sessions SET revoked_at=?1 WHERE token_hash=?2")
      .bind(new Date().toISOString(), session.tokenHash).run();
    throw error;
  }
  const now = new Date().toISOString();
  await db.prepare("UPDATE iumrah_accounts SET last_login_at=?1 WHERE pilgrim_id=?2")
    .bind(now, pilgrimID).run();
  await audit(db, pilgrimID, "phone_sign_in", sessionID, sessionID);
  return json({
    ok: true,
    account: accountProfile(pilgrim),
    session: { token: session.token, expiresAt: session.expiresAt },
  });
}

// Passwordless email login is allowed ONLY for a previously verified email
// linked to an activated account. A plain pilgrims.email is not identity proof.
async function startEmailLogin(request: Request, env: Env, db: D1Like) {
  const payload = await request.json().catch(() => null) as { email?: unknown; locale?: unknown } | null;
  const email = normalizeEmail(payload?.email);
  if (!validEmail(email)) throw new RouteError("EMAIL_INVALID", 400);
  const owner = await db.prepare(
    `SELECT e.pilgrim_id,e.email_display FROM iumrah_client_account_emails e
     INNER JOIN iumrah_accounts a ON a.pilgrim_id=e.pilgrim_id
     WHERE e.email_normalized=?1 AND e.verified_at IS NOT NULL LIMIT 1`,
  ).bind(email).first<{ pilgrim_id: number; email_display: string }>();
  if (!owner) throw new RouteError("EMAIL_ACCOUNT_NOT_FOUND", 404);
  const challenge = await createEmailChallenge(
    db, env, request, "verify_email", Number(owner.pilgrim_id),
    owner.email_display, cleanText(payload?.locale, 24),
  );
  await audit(db, Number(owner.pilgrim_id), "email_sign_in_code_sent", null, null);
  return json({ ok: true, challengeID: challenge.id, expiresAt: challenge.expiresAt });
}

async function confirmEmailLogin(request: Request, db: D1Like) {
  const payload = await request.json().catch(() => null) as {
    challengeID?: unknown; code?: unknown; device?: unknown;
  } | null;
  const challengeID = cleanText(payload?.challengeID, 100);
  // Verify the challenge is bound to an existing verified login identity BEFORE
  // consuming it. Do not accept unlinked email-change challenges as a login.
  const hint = await db.prepare(
    `SELECT c.pilgrim_id,c.email_normalized FROM iumrah_client_email_challenges c
     INNER JOIN iumrah_client_account_emails e
       ON e.pilgrim_id=c.pilgrim_id AND e.email_normalized=c.email_normalized
     INNER JOIN iumrah_accounts a ON a.pilgrim_id=e.pilgrim_id
     WHERE c.id=?1 AND c.purpose='verify_email' AND e.verified_at IS NOT NULL LIMIT 1`,
  ).bind(challengeID).first<{ pilgrim_id: number; email_normalized: string }>();
  const pilgrimID = Number(hint?.pilgrim_id ?? 0);
  if (!pilgrimID) throw new RouteError("VERIFICATION_CODE_INVALID", 400);
  const challenge = await verifyEmailChallenge(
    db, challengeID, "verify_email", cleanText(payload?.code, 12), pilgrimID,
  );
  if (challenge.email_normalized !== hint!.email_normalized) throw new RouteError("VERIFICATION_CODE_INVALID", 400);
  const pilgrim = await accountRow(db, pilgrimID);
  if (!pilgrim) throw new RouteError("INVALID_CREDENTIALS", 401);
  const device = parseDevice(payload?.device);
  const session = await createAccountSession(db, pilgrimID);
  const auth: AccountAuth = { pilgrimID, tokenHash: session.tokenHash, pilgrim };
  let sessionID: string;
  try {
    sessionID = await bindCurrentSession(db, auth, device, request);
  } catch (error) {
    await db.prepare("UPDATE iumrah_account_sessions SET revoked_at=?1 WHERE token_hash=?2")
      .bind(new Date().toISOString(), session.tokenHash).run();
    throw error;
  }
  await db.prepare("UPDATE iumrah_accounts SET last_login_at=?1 WHERE pilgrim_id=?2")
    .bind(new Date().toISOString(), pilgrimID).run();
  await audit(db, pilgrimID, "email_sign_in", sessionID, sessionID);
  return json({
    ok: true, account: accountProfile(pilgrim),
    session: { token: session.token, expiresAt: session.expiresAt },
  });
}

async function linkVerifiedEmail(
  db: D1Like,
  pilgrimID: number,
  emailDisplay: string,
  emailNormalized: string,
) {
  const collision = await db.prepare(
    `SELECT pilgrim_id FROM iumrah_client_account_emails
     WHERE email_normalized=?1 AND pilgrim_id<>?2 LIMIT 1`,
  ).bind(emailNormalized, pilgrimID).first<{ pilgrim_id: number }>();
  if (collision) throw new RouteError("EMAIL_ALREADY_CONNECTED", 409);
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO iumrah_client_account_emails(
       pilgrim_id,email_normalized,email_display,verified_at,updated_at
     ) VALUES(?1,?2,?3,?4,?4)
     ON CONFLICT(pilgrim_id) DO UPDATE SET
       email_normalized=excluded.email_normalized,
       email_display=excluded.email_display,
       verified_at=excluded.verified_at,
       updated_at=excluded.updated_at`,
  ).bind(pilgrimID, emailNormalized, emailDisplay, now).run();
  await db.prepare("UPDATE pilgrims SET email=?1,updated_at=?2 WHERE id=?3")
    .bind(emailDisplay, now, pilgrimID).run();
  await db.prepare(
    `UPDATE iumrah_client_email_challenges SET consumed_at=?1
     WHERE pilgrim_id=?2 AND purpose='verify_email' AND consumed_at IS NULL`,
  ).bind(now, pilgrimID).run();
}

// Keep transactional emails in the locale sent by the iOS client. Never fall back
// to English for languages we explicitly support (especially tr and id).
const ACCOUNT_EMAIL_COPY = {
  ru: {
    verify: "Подтверждение почты iumrah", reset: "Восстановление пароля iumrah",
    verifyLead: "Код подтверждения почты:", resetLead: "Код для восстановления пароля:",
    warning: "Код действует 10 минут. Никому его не сообщайте. Если Вы не запрашивали код, проигнорируйте письмо.",
  },
  en: {
    verify: "Verify your iumrah email", reset: "Reset your iumrah password",
    verifyLead: "Your email verification code:", resetLead: "Your password reset code:",
    warning: "This code expires in 10 minutes. Never share it. If you did not request it, ignore this email.",
  },
  uz: {
    verify: "iumrah elektron pochtasini tasdiqlash", reset: "iumrah parolini tiklash",
    verifyLead: "Elektron pochtani tasdiqlash kodi:", resetLead: "Parolni tiklash kodi:",
    warning: "Kod 10 daqiqa amal qiladi. Uni hech kimga bermang. Agar kodni so‘ramagan bo‘lsangiz, xatni e’tiborsiz qoldiring.",
  },
  "uz-cyrl": {
    verify: "iumrah электрон почтасини тасдиқлаш", reset: "iumrah паролини тиклаш",
    verifyLead: "Электрон почтани тасдиқлаш коди:", resetLead: "Паролни тиклаш коди:",
    warning: "Код 10 дақиқа амал қилади. Уни ҳеч кимга берманг. Агар кодни сўрамаган бўлсангиз, хатни эътиборсиз қолдиринг.",
  },
  tr: {
    verify: "iumrah e-posta adresinizi doğrulayın", reset: "iumrah şifrenizi sıfırlayın",
    verifyLead: "E-posta doğrulama kodunuz:", resetLead: "Şifre sıfırlama kodunuz:",
    warning: "Bu kod 10 dakika geçerlidir. Kodunuzu kimseyle paylaşmayın. Bu kodu siz istemediyseniz e-postayı dikkate almayın.",
  },
  ar: {
    verify: "تأكيد البريد الإلكتروني في iumrah", reset: "إعادة تعيين كلمة مرور iumrah",
    verifyLead: "رمز تأكيد البريد الإلكتروني:", resetLead: "رمز إعادة تعيين كلمة المرور:",
    warning: "تنتهي صلاحية هذا الرمز بعد 10 دقائق. لا تشاركه مع أي شخص. إذا لم تطلب الرمز، فتجاهل هذه الرسالة.",
  },
  id: {
    verify: "Verifikasi email iumrah Anda", reset: "Atur ulang kata sandi iumrah Anda",
    verifyLead: "Kode verifikasi email Anda:", resetLead: "Kode pengaturan ulang kata sandi Anda:",
    warning: "Kode ini berlaku selama 10 menit. Jangan bagikan kepada siapa pun. Jika Anda tidak meminta kode ini, abaikan email ini.",
  },
} as const;

type AccountEmailLocale = keyof typeof ACCOUNT_EMAIL_COPY;

function accountEmailLocale(locale: string): AccountEmailLocale {
  const normalized = String(locale || "en").trim().toLowerCase().replace(/_/g, "-");
  if (normalized.startsWith("uz-cyrl")) return "uz-cyrl";
  const primary = normalized.split("-")[0];
  return primary === "ru" || primary === "en" || primary === "uz" || primary === "tr" || primary === "id" || primary === "ar" ? primary : "en";
}

function emailCopy(code: string, purpose: "verify_email" | "reset_password", locale: string) {
  const copy = ACCOUNT_EMAIL_COPY[accountEmailLocale(locale)];
  const title = purpose === "reset_password" ? copy.reset : copy.verify;
  const lead = purpose === "reset_password" ? copy.resetLead : copy.verifyLead;
  const warning = copy.warning;
  return {
    subject: title,
    text: `${lead}\n\n${code}\n\n${warning}`,
    html: `<!doctype html><html lang="${accountEmailLocale(locale)}" dir="${accountEmailLocale(locale) === "ar" ? "rtl" : "ltr"}"><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#111"><div style="max-width:520px;margin:32px auto;background:#fff;border-radius:28px;padding:32px"><div style="font-size:18px;font-weight:700">iumrah</div><h1 style="font-size:26px;margin:28px 0 12px">${title}</h1><p style="color:#62676d;line-height:1.5">${lead}</p><div dir="ltr" style="font-size:36px;font-weight:750;letter-spacing:9px;padding:18px 0">${code}</div><p style="color:#62676d;line-height:1.5">${warning}</p></div></body></html>`,
  };
}

async function sendAccountEmail(
  env: Env,
  to: string,
  copy: { subject: string; text: string; html: string },
) {
  const apiKey = cleanText(env.RESEND_API_KEY, 300);
  if (!apiKey) throw new RouteError("EMAIL_DELIVERY_NOT_CONFIGURED", 503);
  const fromAddress = cleanText(env.ACCOUNT_EMAIL_FROM, 254) || "security@iumrah.app";
  const replyTo = cleanText(env.ACCOUNT_EMAIL_REPLY_TO, 254) || "support@iumrah.app";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: `iumrah <${fromAddress}>`,
      to: [to],
      reply_to: replyTo,
      subject: copy.subject,
      text: copy.text,
      html: copy.html,
    }),
  });
  if (!response.ok) {
    console.error("RESEND_ACCOUNT_EMAIL_FAILED", response.status, await response.text().catch(() => ""));
    throw new RouteError("EMAIL_DELIVERY_UNAVAILABLE", 503);
  }
}

async function challengeRate(db: D1Like, purpose: string, email: string, pilgrimID: number | null, request: Request) {
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const ip = cleanText(request.headers.get("cf-connecting-ip"), 80);
  const ipHash = ip ? await sha256Hex(ip) : "";
  const row = await db.prepare(
    `SELECT COUNT(*) AS count FROM iumrah_client_email_challenges
     WHERE purpose=?1 AND created_at>?2
       AND (email_normalized=?3 OR (?4<>'' AND request_ip_hash=?4)
            OR (?5 IS NOT NULL AND pilgrim_id=?5))`,
  ).bind(purpose, since, email, ipHash, pilgrimID).first<{ count: number }>();
  return { limited: Number(row?.count ?? 0) >= 5, ipHash };
}

async function createEmailChallenge(
  db: D1Like,
  env: Env,
  request: Request,
  purpose: "verify_email" | "reset_password",
  pilgrimID: number | null,
  emailDisplay: string,
  locale: string,
) {
  const emailNormalized = normalizeEmail(emailDisplay);
  if (!validEmail(emailNormalized)) throw new RouteError("EMAIL_INVALID", 400);
  const rate = await challengeRate(db, purpose, emailNormalized, pilgrimID, request);
  if (rate.limited) throw new RouteError("EMAIL_RATE_LIMITED", 429);
  const code = randomVerificationCode();
  const salt = randomToken(18);
  const codeHash = await passwordDigest(code, salt, CODE_ITERATIONS);
  const id = `challenge-${crypto.randomUUID()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60_000).toISOString();
  await db.prepare(
    `INSERT INTO iumrah_client_email_challenges(
       id,purpose,pilgrim_id,email_normalized,email_display,code_salt,code_hash,
       code_iterations,attempts,max_attempts,expires_at,created_at,request_ip_hash
     ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,0,?9,?10,?11,?12)`,
  ).bind(
    id, purpose, pilgrimID, emailNormalized, emailDisplay, salt, codeHash,
    CODE_ITERATIONS, MAX_CODE_ATTEMPTS, expiresAt, now.toISOString(), rate.ipHash,
  ).run();
  try {
    await sendAccountEmail(env, emailDisplay, emailCopy(code, purpose, locale));
  } catch (error) {
    await db.prepare("UPDATE iumrah_client_email_challenges SET consumed_at=?1 WHERE id=?2")
      .bind(new Date().toISOString(), id).run();
    throw error;
  }
  return { id, expiresAt };
}

async function verifyEmailChallenge(
  db: D1Like,
  challengeID: string,
  purpose: "verify_email" | "reset_password",
  code: string,
  pilgrimID?: number,
) {
  const row = await db.prepare(
    `SELECT id,pilgrim_id,email_normalized,email_display,code_salt,code_hash,
            code_iterations,attempts,max_attempts,expires_at,consumed_at
     FROM iumrah_client_email_challenges WHERE id=?1 AND purpose=?2 LIMIT 1`,
  ).bind(challengeID, purpose).first<{
    id: string;
    pilgrim_id: number | null;
    email_normalized: string;
    email_display: string;
    code_salt: string;
    code_hash: string;
    code_iterations: number;
    attempts: number;
    max_attempts: number;
    expires_at: string;
    consumed_at: string | null;
  }>();
  if (!row || row.consumed_at || Date.parse(row.expires_at) <= Date.now()
      || (pilgrimID !== undefined && Number(row.pilgrim_id ?? 0) !== pilgrimID)
      || !/^\d{6}$/.test(code) || Number(row.attempts) >= Number(row.max_attempts)) {
    throw new RouteError("VERIFICATION_CODE_INVALID", 400);
  }
  const digest = await passwordDigest(code, row.code_salt, Number(row.code_iterations));
  if (!constantTimeEqual(digest, row.code_hash)) {
    const attempts = Number(row.attempts) + 1;
    await db.prepare(
      `UPDATE iumrah_client_email_challenges
       SET attempts=?1,consumed_at=CASE WHEN ?1>=max_attempts THEN ?2 ELSE consumed_at END
       WHERE id=?3`,
    ).bind(attempts, new Date().toISOString(), row.id).run();
    throw new RouteError("VERIFICATION_CODE_INVALID", 400);
  }
  await db.prepare("UPDATE iumrah_client_email_challenges SET consumed_at=?1 WHERE id=?2")
    .bind(new Date().toISOString(), row.id).run();
  return row;
}


async function ensurePhoneAvailable(db: D1Like, phoneNormalized: string, pilgrimID: number) {
  const collision = await db.prepare(
    `SELECT pilgrim_id FROM iumrah_client_account_phones
     WHERE phone_normalized=?1 AND pilgrim_id<>?2 LIMIT 1`,
  ).bind(phoneNormalized, pilgrimID).first<{ pilgrim_id: number }>();
  if (collision) throw new RouteError("PHONE_ALREADY_CONNECTED", 409);
}

async function sendDevSMSOTP(env: Env, purpose: SMSChallengePurpose, phoneNormalized: string, otpCode: string) {
  const token = cleanText(env.DEVSMS_API_TOKEN, 600);
  if (!token) throw new RouteError("SMS_DELIVERY_NOT_CONFIGURED", 503);

  const response = await fetch("https://devsms.uz/api/send_sms.php", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      phone: phoneNormalized.replace(/^\+/, ""),
      type: "universal_otp",
      template_type: purpose === "activate_account" ? 3 : 1,
      service_name: "iumrah",
      otp_code: otpCode,
    }),
  });

  const bodyText = await response.text().catch(() => "");
  type DevSMSResponse = {
    success?: boolean;
    error?: unknown;
    data?: { sms_id?: unknown; request_id?: unknown; status?: unknown };
  };
  let payload: DevSMSResponse | null = null;
  try {
    payload = bodyText ? JSON.parse(bodyText) as DevSMSResponse : null;
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.success !== true) {
    console.error("DEVSMS_OTP_SEND_FAILED", response.status, cleanText(payload?.error, 180));
    throw new RouteError("SMS_DELIVERY_UNAVAILABLE", 503);
  }

  return {
    smsID: cleanText(payload.data?.sms_id, 100),
    requestID: cleanText(payload.data?.request_id, 160),
    status: cleanText(payload.data?.status, 40) || "sent",
  };
}

async function smsChallengeRate(
  db: D1Like,
  purpose: SMSChallengePurpose,
  phoneNormalized: string,
  pilgrimID: number,
  request: Request,
) {
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const ip = cleanText(request.headers.get("cf-connecting-ip"), 80);
  const ipHash = ip ? await sha256Hex(ip) : "";
  const row = await db.prepare(
    `SELECT COUNT(*) AS count FROM iumrah_client_sms_challenges
     WHERE purpose=?1 AND created_at>?2
       AND (phone_normalized=?3 OR (?4<>'' AND request_ip_hash=?4) OR pilgrim_id=?5)`,
  ).bind(purpose, since, phoneNormalized, ipHash, pilgrimID).first<{ count: number }>();
  return { limited: Number(row?.count ?? 0) >= 5, ipHash };
}

async function createSMSChallenge(
  db: D1Like,
  env: Env,
  request: Request,
  purpose: SMSChallengePurpose,
  pilgrimID: number,
  phoneInput: unknown,
) {
  const phoneNormalized = normalizePhone(phoneInput);
  if (!phoneNormalized.startsWith("+998")) throw new RouteError("SMS_COUNTRY_UNSUPPORTED", 400);
  if (!validUzbekPhone(phoneNormalized)) throw new RouteError("PHONE_INVALID", 400);
  await ensurePhoneAvailable(db, phoneNormalized, pilgrimID);

  const rate = await smsChallengeRate(db, purpose, phoneNormalized, pilgrimID, request);
  if (rate.limited) throw new RouteError("SMS_RATE_LIMITED", 429);

  const code = randomVerificationCode();
  const salt = randomToken(18);
  const codeHash = await passwordDigest(code, salt, CODE_ITERATIONS);
  const id = `sms-${crypto.randomUUID()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60_000).toISOString();

  await db.prepare(
    `INSERT INTO iumrah_client_sms_challenges(
       id,purpose,pilgrim_id,phone_normalized,phone_display,code_salt,code_hash,
       code_iterations,attempts,max_attempts,expires_at,created_at,request_ip_hash
     ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,0,?9,?10,?11,?12)`,
  ).bind(
    id, purpose, pilgrimID, phoneNormalized, phoneNormalized, salt, codeHash,
    CODE_ITERATIONS, MAX_CODE_ATTEMPTS, expiresAt, now.toISOString(), rate.ipHash,
  ).run();

  try {
    const delivery = await sendDevSMSOTP(env, purpose, phoneNormalized, code);
    await db.prepare(
      `UPDATE iumrah_client_sms_challenges
       SET provider_sms_id=?1,provider_request_id=?2,provider_status=?3 WHERE id=?4`,
    ).bind(delivery.smsID || null, delivery.requestID || null, delivery.status, id).run();
  } catch (error) {
    await db.prepare(
      "UPDATE iumrah_client_sms_challenges SET consumed_at=?1,provider_status='failed' WHERE id=?2",
    ).bind(new Date().toISOString(), id).run().catch(() => undefined);
    throw error;
  }

  return { id, expiresAt, phoneNormalized };
}

async function verifySMSChallenge(
  db: D1Like,
  challengeID: string,
  purpose: SMSChallengePurpose,
  code: string,
  pilgrimID: number,
) {
  const row = await db.prepare(
    `SELECT id,pilgrim_id,phone_normalized,phone_display,code_salt,code_hash,
            code_iterations,attempts,max_attempts,expires_at,consumed_at
     FROM iumrah_client_sms_challenges WHERE id=?1 AND purpose=?2 LIMIT 1`,
  ).bind(challengeID, purpose).first<{
    id: string;
    pilgrim_id: number;
    phone_normalized: string;
    phone_display: string;
    code_salt: string;
    code_hash: string;
    code_iterations: number;
    attempts: number;
    max_attempts: number;
    expires_at: string;
    consumed_at: string | null;
  }>();

  if (!row || row.consumed_at || Date.parse(row.expires_at) <= Date.now()
      || Number(row.pilgrim_id) !== pilgrimID
      || !/^\d{6}$/.test(code) || Number(row.attempts) >= Number(row.max_attempts)) {
    throw new RouteError("VERIFICATION_CODE_INVALID", 400);
  }

  const digest = await passwordDigest(code, row.code_salt, Number(row.code_iterations));
  if (!constantTimeEqual(digest, row.code_hash)) {
    const attempts = Number(row.attempts) + 1;
    await db.prepare(
      `UPDATE iumrah_client_sms_challenges
       SET attempts=?1,consumed_at=CASE WHEN ?1>=max_attempts THEN ?2 ELSE consumed_at END
       WHERE id=?3`,
    ).bind(attempts, new Date().toISOString(), row.id).run();
    throw new RouteError("VERIFICATION_CODE_INVALID", 400);
  }

  await db.prepare(
    "UPDATE iumrah_client_sms_challenges SET consumed_at=?1,provider_status=COALESCE(provider_status,'verified') WHERE id=?2",
  ).bind(new Date().toISOString(), row.id).run();
  return row;
}

async function linkVerifiedPhone(
  db: D1Like,
  pilgrimID: number,
  phoneDisplay: string,
  phoneNormalized: string,
) {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO iumrah_client_account_phones(
       pilgrim_id,phone_normalized,phone_display,verified_at,updated_at
     ) VALUES(?1,?2,?3,?4,?4)
     ON CONFLICT(pilgrim_id) DO UPDATE SET
       phone_normalized=excluded.phone_normalized,
       phone_display=excluded.phone_display,
       verified_at=excluded.verified_at,
       updated_at=excluded.updated_at`,
  ).bind(pilgrimID, phoneNormalized, phoneDisplay, now).run();
  await db.prepare("UPDATE pilgrims SET phone=?1,updated_at=?2 WHERE id=?3")
    .bind(phoneDisplay, now, pilgrimID).run();
  await db.prepare(
    `UPDATE iumrah_client_sms_challenges SET consumed_at=?1
     WHERE pilgrim_id=?2 AND consumed_at IS NULL`,
  ).bind(now, pilgrimID).run();
  return now;
}

async function register(request: Request, db: D1Like) {
  const auth = await requireAccount(request, db);
  const payload = await request.json().catch(() => null) as { device?: unknown } | null;
  const device = parseDevice(payload?.device);
  await bindCurrentSession(db, auth, device, request);
  const headers = new Headers(request.headers);
  headers.set("x-iumrah-device-id", device.installationID);
  headers.set("x-iumrah-device-secret", device.secret);
  const secured = await requireDevice(new Request(request.url, { method: "GET", headers }), db);
  return json(await securityOverview(db, secured));
}

async function claimPrimary(request: Request, db: D1Like) {
  const auth = await requireDevice(request, db);
  const payload = await request.json().catch(() => null) as { password?: unknown } | null;
  await verifyAccountPassword(db, auth.pilgrimID, String(payload?.password ?? ""));
  const promoted = await promoteCurrentDevice(db, auth, "primary_device_claimed");
  return json(await securityOverview(db, promoted));
}

async function authorizeSensitiveActionWithPassword(request: Request, db: D1Like) {
  const auth = await requireDevice(request, db);
  const payload = await request.json().catch(() => null) as { password?: unknown } | null;
  await verifyAccountPassword(db, auth.pilgrimID, String(payload?.password ?? ""));
  return sensitiveAuthorizationResponse(db, auth, "password");
}


async function sensitiveAuthorizationResponse(db: D1Like, auth: DeviceAuth, method: string) {
  const promoted = await promoteCurrentDevice(db, auth, `sensitive_reauth_${method}`);
  const proof = await createSecurityProof(db, promoted, "contact_change");
  await audit(db, auth.pilgrimID, `contact_change_authorized_${method}`, auth.sessionID, null);
  return json({
    ok: true,
    securityProof: proof.token,
    proofExpiresAt: proof.expiresAt,
    overview: await securityOverview(db, promoted),
  });
}

async function authorizeSensitiveActionWithApple(request: Request, env: Env, db: D1Like) {
  const auth = await requireDevice(request, db);
  const payload = await request.json().catch(() => null) as {
    identityToken?: unknown;
    nonce?: unknown;
  } | null;
  const apple = await verifyAppleIdentity(
    payload?.identityToken,
    payload?.nonce,
    [env.APPLE_BUNDLE_ID ?? "com.iumrah.app", env.APPLE_WEB_CLIENT_ID ?? ""],
  );
  await consumeAppleAssertion(db, apple.token);
  const linked = await db.prepare(
    `SELECT pilgrim_id FROM iumrah_client_apple_links
     WHERE apple_subject=?1 AND pilgrim_id=?2 LIMIT 1`,
  ).bind(apple.subject, auth.pilgrimID).first<{ pilgrim_id: number }>();
  if (!linked) throw new RouteError("APPLE_REAUTH_MISMATCH", 403);
  return sensitiveAuthorizationResponse(db, auth, "apple");
}

async function authorizeSensitiveActionWithGoogle(request: Request, env: Env, db: D1Like) {
  const auth = await requireDevice(request, db);
  const payload = await request.json().catch(() => null) as {
    identityToken?: unknown;
    nonce?: unknown;
  } | null;
  const clientID = cleanText(env.GOOGLE_SERVER_CLIENT_ID, 512);
  if (!clientID) throw new RouteError("GOOGLE_AUTH_NOT_CONFIGURED", 503);
  const google = await verifyGoogleIdentity(payload?.identityToken, payload?.nonce, clientID);
  await consumeGoogleAssertion(db, google.token);
  const linked = await db.prepare(
    `SELECT pilgrim_id FROM iumrah_client_google_links
     WHERE google_subject=?1 AND pilgrim_id=?2 LIMIT 1`,
  ).bind(google.subject, auth.pilgrimID).first<{ pilgrim_id: number }>();
  if (!linked) throw new RouteError("GOOGLE_REAUTH_MISMATCH", 403);
  return sensitiveAuthorizationResponse(db, auth, "google");
}

async function terminateSession(request: Request, db: D1Like, sessionID: string) {
  const auth = await requireDevice(request, db);
  const target = await db.prepare(
    `SELECT b.token_hash,b.session_id
     FROM iumrah_client_session_bindings b
     INNER JOIN iumrah_account_sessions s ON s.token_hash=b.token_hash
     WHERE b.session_id=?1 AND b.pilgrim_id=?2
       AND s.revoked_at IS NULL AND s.expires_at>?3 LIMIT 1`,
  ).bind(sessionID, auth.pilgrimID, new Date().toISOString()).first<{
    token_hash: string;
    session_id: string;
  }>();
  if (!target) throw new RouteError("SESSION_NOT_FOUND", 404);
  const self = target.token_hash === auth.tokenHash;
  if (!self && !auth.isPrimary) throw new RouteError("PRIMARY_DEVICE_REQUIRED", 403);
  await db.prepare("UPDATE iumrah_account_sessions SET revoked_at=?1 WHERE token_hash=?2")
    .bind(new Date().toISOString(), target.token_hash).run();
  await audit(db, auth.pilgrimID, "session_terminated", auth.sessionID, target.session_id);
  return json({ ok: true, signedOut: self });
}

function maskedPhone(value: string) {
  const digits = normalizePhone(value);
  if (digits.length <= 6) return digits;
  return `${digits.slice(0, 4)} •••• ${digits.slice(-4)}`;
}

function maskedEmail(value: string) {
  const normalized = normalizeEmail(value);
  const at = normalized.indexOf("@");
  if (at <= 0) return normalized;
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}•••@${domain}`;
}

async function startPrimaryRecoveryChallenge(request: Request, env: Env, db: D1Like) {
  const auth = await requireDevice(request, db);
  const payload = await request.json().catch(() => null) as { method?: unknown; locale?: unknown } | null;
  const method = cleanText(payload?.method, 16).toLowerCase();
  const locale = cleanText(payload?.locale, 24);

  if (method === "phone") {
    const phone = await db.prepare(
      `SELECT phone_display,phone_normalized FROM iumrah_client_account_phones
       WHERE pilgrim_id=?1 AND verified_at IS NOT NULL LIMIT 1`,
    ).bind(auth.pilgrimID).first<{ phone_display: string; phone_normalized: string }>();
    if (!phone) throw new RouteError("RECOVERY_METHOD_UNAVAILABLE", 404);
    const destination = phone.phone_display || phone.phone_normalized;
    const challenge = await createSMSChallenge(
      db, env, request, "verify_phone", auth.pilgrimID, destination,
    );
    await audit(db, auth.pilgrimID, "primary_recovery_phone_started", auth.sessionID, null);
    return json({
      ok: true, method: "phone", challengeID: challenge.id,
      expiresAt: challenge.expiresAt, maskedDestination: maskedPhone(destination),
    });
  }

  if (method === "email") {
    const email = await db.prepare(
      `SELECT email_display FROM iumrah_client_account_emails
       WHERE pilgrim_id=?1 AND verified_at IS NOT NULL LIMIT 1`,
    ).bind(auth.pilgrimID).first<{ email_display: string }>();
    if (!email) throw new RouteError("RECOVERY_METHOD_UNAVAILABLE", 404);
    const challenge = await createEmailChallenge(
      db, env, request, "verify_email", auth.pilgrimID, email.email_display, locale,
    );
    await audit(db, auth.pilgrimID, "primary_recovery_email_started", auth.sessionID, null);
    return json({
      ok: true, method: "email", challengeID: challenge.id,
      expiresAt: challenge.expiresAt, maskedDestination: maskedEmail(email.email_display),
    });
  }

  throw new RouteError("RECOVERY_METHOD_INVALID", 400);
}

async function confirmPrimaryRecoveryChallenge(request: Request, db: D1Like) {
  const auth = await requireDevice(request, db);
  const payload = await request.json().catch(() => null) as {
    method?: unknown; challengeID?: unknown; code?: unknown;
  } | null;
  const method = cleanText(payload?.method, 16).toLowerCase();
  const challengeID = cleanText(payload?.challengeID, 120);
  const code = cleanText(payload?.code, 12);

  if (method === "phone") {
    await verifySMSChallenge(db, challengeID, "verify_phone", code, auth.pilgrimID);
  } else if (method === "email") {
    await verifyEmailChallenge(db, challengeID, "verify_email", code, auth.pilgrimID);
  } else {
    throw new RouteError("RECOVERY_METHOD_INVALID", 400);
  }

  const promoted = await promoteCurrentDevice(db, auth, `primary_recovery_${method}_completed`);
  const proof = await createSecurityProof(db, promoted, "contact_change");
  await audit(db, auth.pilgrimID, `contact_change_authorized_${method}`, auth.sessionID, null);
  return json({
    ok: true,
    securityProof: proof.token,
    proofExpiresAt: proof.expiresAt,
    overview: await securityOverview(db, promoted),
  });
}

async function startAccountPhoneVerification(request: Request, env: Env, db: D1Like) {
  const auth = await requireDevice(request, db);
  await requireSecurityProof(request, db, auth, "contact_change");
  const payload = await request.json().catch(() => null) as { phone?: unknown; locale?: unknown } | null;
  const phone = normalizePhone(payload?.phone);
  if (!phone.startsWith("+998")) throw new RouteError("SMS_COUNTRY_UNSUPPORTED", 400);
  if (!validUzbekPhone(phone)) throw new RouteError("PHONE_INVALID", 400);
  await ensurePhoneAvailable(db, phone, auth.pilgrimID);
  const challenge = await createSMSChallenge(
    db,
    env,
    request,
    "verify_phone",
    auth.pilgrimID,
    phone,
  );
  await audit(db, auth.pilgrimID, "account_phone_change_started", auth.sessionID, null);
  return json({
    ok: true,
    challengeID: challenge.id,
    expiresAt: challenge.expiresAt,
    phone: challenge.phoneNormalized,
  });
}

async function confirmAccountPhoneVerification(request: Request, db: D1Like) {
  const auth = await requireDevice(request, db);
  await requireSecurityProof(request, db, auth, "contact_change");
  const payload = await request.json().catch(() => null) as { challengeID?: unknown; code?: unknown } | null;
  const challenge = await verifySMSChallenge(
    db,
    cleanText(payload?.challengeID, 120),
    "verify_phone",
    cleanText(payload?.code, 12),
    auth.pilgrimID,
  );
  await ensurePhoneAvailable(db, challenge.phone_normalized, auth.pilgrimID);
  await requireSecurityProof(request, db, auth, "contact_change", true);
  const verifiedAt = await linkVerifiedPhone(
    db,
    auth.pilgrimID,
    challenge.phone_display,
    challenge.phone_normalized,
  );
  await audit(db, auth.pilgrimID, "account_phone_changed", auth.sessionID, null);
  return json({ ok: true, phone: challenge.phone_normalized, verifiedAt });
}

async function startEmailVerification(request: Request, env: Env, db: D1Like) {
  const auth = await requireDevice(request, db);
  await requireSecurityProof(request, db, auth, "contact_change");
  const payload = await request.json().catch(() => null) as { email?: unknown; locale?: unknown } | null;
  const email = cleanText(payload?.email, 254);
  const normalized = normalizeEmail(email);
  if (!validEmail(normalized)) throw new RouteError("EMAIL_INVALID", 400);
  const challenge = await createEmailChallenge(
    db, env, request, "verify_email", auth.pilgrimID, email, cleanText(payload?.locale, 24),
  );
  await audit(db, auth.pilgrimID, "email_verification_started", auth.sessionID, null);
  return json({ ok: true, challengeID: challenge.id, expiresAt: challenge.expiresAt });
}

async function confirmEmailVerification(request: Request, db: D1Like) {
  const auth = await requireDevice(request, db);
  await requireSecurityProof(request, db, auth, "contact_change");
  const payload = await request.json().catch(() => null) as { challengeID?: unknown; code?: unknown } | null;
  const challenge = await verifyEmailChallenge(
    db,
    cleanText(payload?.challengeID, 100),
    "verify_email",
    cleanText(payload?.code, 12),
    auth.pilgrimID,
  );
  await requireSecurityProof(request, db, auth, "contact_change", true);
  await linkVerifiedEmail(db, auth.pilgrimID, challenge.email_display, challenge.email_normalized);
  await audit(db, auth.pilgrimID, "login_email_verified", auth.sessionID, null);
  return json({ ok: true, email: challenge.email_display, verifiedAt: new Date().toISOString() });
}

async function changeAccountPassword(request: Request, db: D1Like) {
  const auth = await requireDevice(request, db);
  const payload = await request.json().catch(() => null) as {
    currentPassword?: unknown; newPassword?: unknown;
  } | null;
  const currentPassword = String(payload?.currentPassword ?? "");
  const newPassword = String(payload?.newPassword ?? "");
  if (!validPassword(newPassword)) throw new RouteError("PASSWORD_TOO_WEAK", 400);
  await verifyAccountPassword(db, auth.pilgrimID, currentPassword);

  const salt = randomToken(18);
  const passwordHash = await passwordDigest(newPassword, salt, PASSWORD_ITERATIONS);
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE iumrah_accounts
     SET password_salt=?1,password_hash=?2,password_iterations=?3,password_updated_at=?4,
         failed_attempts=0,locked_until=NULL
     WHERE pilgrim_id=?5`,
  ).bind(salt, passwordHash, PASSWORD_ITERATIONS, now, auth.pilgrimID).run();

  // Password changes are a high-risk event: keep the current session, revoke
  // every other session, and let the user see a clean device list immediately.
  await db.prepare(
    `UPDATE iumrah_account_sessions SET revoked_at=?1
     WHERE pilgrim_id=?2 AND token_hash<>?3 AND revoked_at IS NULL`,
  ).bind(now, auth.pilgrimID, auth.tokenHash).run();
  await audit(db, auth.pilgrimID, "password_changed", auth.sessionID, auth.sessionID);
  return json({ ok: true, sessionsRevoked: true });
}

async function unlinkApple(request: Request, db: D1Like) {
  const auth = await requireDevice(request, db);
  if (!auth.isPrimary) throw new RouteError("PRIMARY_DEVICE_REQUIRED", 403);
  await db.prepare("DELETE FROM iumrah_client_apple_links WHERE pilgrim_id=?1")
    .bind(auth.pilgrimID).run();
  await audit(db, auth.pilgrimID, "apple_unlinked", auth.sessionID, null);
  return json({ ok: true });
}

async function unlinkGoogle(request: Request, db: D1Like) {
  const auth = await requireDevice(request, db);
  if (!auth.isPrimary) throw new RouteError("PRIMARY_DEVICE_REQUIRED", 403);
  await db.prepare("DELETE FROM iumrah_client_google_links WHERE pilgrim_id=?1")
    .bind(auth.pilgrimID).run();
  await audit(db, auth.pilgrimID, "google_unlinked", auth.sessionID, null);
  return json({ ok: true });
}

async function startPasswordRecovery(request: Request, env: Env, db: D1Like) {
  if (!cleanText(env.RESEND_API_KEY, 300)) {
    throw new RouteError("EMAIL_DELIVERY_NOT_CONFIGURED", 503);
  }
  const payload = await request.json().catch(() => null) as { email?: unknown; locale?: unknown } | null;
  const email = normalizeEmail(payload?.email);
  const publicChallengeID = `challenge-${crypto.randomUUID()}`;
  if (!validEmail(email)) return json({ ok: true, challengeID: publicChallengeID });
  const accountEmail = await db.prepare(
    `SELECT pilgrim_id,email_display FROM iumrah_client_account_emails
     WHERE email_normalized=?1 LIMIT 1`,
  ).bind(email).first<{ pilgrim_id: number; email_display: string }>();
  if (!accountEmail) return json({ ok: true, challengeID: publicChallengeID });
  // A known, verified account must never receive a fake success when Resend
  // rejected the message. Propagate delivery/configuration failures so the app
  // stays on the email form and tells the user to retry instead of opening an
  // unusable code screen. Unknown addresses still get the neutral response
  // above to avoid exposing whether an account exists.
  const challenge = await createEmailChallenge(
    db, env, request, "reset_password", Number(accountEmail.pilgrim_id),
    accountEmail.email_display, cleanText(payload?.locale, 24),
  );
  await audit(db, Number(accountEmail.pilgrim_id), "password_reset_started", null, null);
  return json({ ok: true, challengeID: challenge.id, expiresAt: challenge.expiresAt });
}

async function confirmPasswordRecovery(request: Request, db: D1Like) {
  const payload = await request.json().catch(() => null) as {
    challengeID?: unknown;
    code?: unknown;
    newPassword?: unknown;
  } | null;
  if (!validPassword(payload?.newPassword)) throw new RouteError("PASSWORD_TOO_WEAK", 400);
  const challenge = await verifyEmailChallenge(
    db,
    cleanText(payload?.challengeID, 100),
    "reset_password",
    cleanText(payload?.code, 12),
  );
  if (challenge.pilgrim_id === null) throw new RouteError("VERIFICATION_CODE_INVALID", 400);
  const salt = randomToken(18);
  const passwordHash = await passwordDigest(payload.newPassword, salt, PASSWORD_ITERATIONS);
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE iumrah_accounts
     SET password_salt=?1,password_hash=?2,password_iterations=?3,password_updated_at=?4,
         failed_attempts=0,locked_until=NULL
     WHERE pilgrim_id=?5`,
  ).bind(salt, passwordHash, PASSWORD_ITERATIONS, now, Number(challenge.pilgrim_id)).run();
  await db.prepare(
    "UPDATE iumrah_account_sessions SET revoked_at=?1 WHERE pilgrim_id=?2 AND revoked_at IS NULL",
  ).bind(now, Number(challenge.pilgrim_id)).run();
  await db.prepare(
    "UPDATE iumrah_client_devices SET is_primary=0 WHERE pilgrim_id=?1",
  ).bind(Number(challenge.pilgrim_id)).run();
  await audit(db, Number(challenge.pilgrim_id), "password_reset_completed", null, null);
  return json({
    ok: true,
    iumrahID: formatIumrahID(challenge.pilgrim_id),
    sessionsRevoked: true,
  });
}

async function linkApple(request: Request, env: Env, db: D1Like) {
  const auth = await requireDevice(request, db);
  if (!auth.isPrimary) throw new RouteError("PRIMARY_DEVICE_REQUIRED", 403);
  const payload = await request.json().catch(() => null) as {
    identityToken?: unknown;
    nonce?: unknown;
  } | null;
  const apple = await verifyAppleIdentity(
    payload?.identityToken,
    payload?.nonce,
    [env.APPLE_BUNDLE_ID ?? "com.iumrah.app", env.APPLE_WEB_CLIENT_ID ?? ""],
  );
  await consumeAppleAssertion(db, apple.token);
  const subjectOwner = await db.prepare(
    "SELECT pilgrim_id FROM iumrah_client_apple_links WHERE apple_subject=?1 LIMIT 1",
  ).bind(apple.subject).first<{ pilgrim_id: number }>();
  if (subjectOwner && Number(subjectOwner.pilgrim_id) !== auth.pilgrimID) {
    throw new RouteError("APPLE_ID_CONNECTED_TO_ANOTHER_ACCOUNT", 409);
  }
  const accountLink = await db.prepare(
    "SELECT apple_subject FROM iumrah_client_apple_links WHERE pilgrim_id=?1 LIMIT 1",
  ).bind(auth.pilgrimID).first<{ apple_subject: string }>();
  if (accountLink && accountLink.apple_subject !== apple.subject) {
    throw new RouteError("APPLE_ID_ALREADY_CONNECTED", 409);
  }
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO iumrah_client_apple_links(apple_subject,pilgrim_id,linked_at,last_used_at)
     VALUES(?1,?2,?3,?3)
     ON CONFLICT(apple_subject) DO UPDATE SET last_used_at=excluded.last_used_at`,
  ).bind(apple.subject, auth.pilgrimID, now).run();
  if (apple.emailVerified && validEmail(apple.email)) {
    const emailOwner = await db.prepare(
      "SELECT pilgrim_id FROM iumrah_client_account_emails WHERE email_normalized=?1 LIMIT 1",
    ).bind(apple.email).first<{ pilgrim_id: number }>();
    if (emailOwner && Number(emailOwner.pilgrim_id) !== auth.pilgrimID) {
      await db.prepare("DELETE FROM iumrah_client_apple_links WHERE apple_subject=?1")
        .bind(apple.subject).run();
      throw new RouteError("APPLE_EMAIL_CONNECTED_TO_ANOTHER_ACCOUNT", 409);
    }
    const currentEmail = await db.prepare(
      "SELECT pilgrim_id FROM iumrah_client_account_emails WHERE pilgrim_id=?1 LIMIT 1",
    ).bind(auth.pilgrimID).first<{ pilgrim_id: number }>();
    if (!currentEmail) await linkVerifiedEmail(db, auth.pilgrimID, apple.email, apple.email);
  }
  await audit(db, auth.pilgrimID, "apple_id_linked", auth.sessionID, auth.sessionID);
  return json({ ok: true, appleLinked: true, iumrahID: formatIumrahID(auth.pilgrimID) });
}

async function signInWithApple(request: Request, env: Env, db: D1Like) {
  const payload = await request.json().catch(() => null) as {
    identityToken?: unknown;
    nonce?: unknown;
    device?: unknown;
  } | null;
  const apple = await verifyAppleIdentity(
    payload?.identityToken,
    payload?.nonce,
    [env.APPLE_BUNDLE_ID ?? "com.iumrah.app", env.APPLE_WEB_CLIENT_ID ?? ""],
  );
  await consumeAppleAssertion(db, apple.token);
  let row = await db.prepare(
    `SELECT p.id,p.first_name,p.last_name,p.display_name,p.phone,p.email,p.telegram,p.whatsapp
     FROM iumrah_client_apple_links a
     INNER JOIN pilgrims p ON p.id=a.pilgrim_id
     INNER JOIN iumrah_accounts account ON account.pilgrim_id=p.id
     WHERE a.apple_subject=?1 LIMIT 1`,
  ).bind(apple.subject).first<PilgrimRow>();
  let createdAccount = false;
  if (!row) {
    if (!apple.emailVerified || !validEmail(apple.email)) {
      throw new RouteError("APPLE_ACCOUNT_EMAIL_REQUIRED", 409);
    }
    const existingEmail = await db.prepare(
      `SELECT p.id,p.first_name,p.last_name,p.display_name,p.phone,p.email,p.telegram,p.whatsapp
       FROM iumrah_client_account_emails e
       INNER JOIN pilgrims p ON p.id=e.pilgrim_id
       INNER JOIN iumrah_accounts a ON a.pilgrim_id=p.id
       WHERE e.email_normalized=?1 LIMIT 1`,
    ).bind(apple.email).first<PilgrimRow>();
    if (existingEmail) {
      row = existingEmail;
    } else {
      const now = new Date().toISOString();
      const provisional = await reusableProvisionalPilgrim(db, apple.email);
      const created = provisional ?? await db.prepare(
        `INSERT INTO pilgrims(email,created_at,updated_at)
         VALUES(?1,?2,?2)
         RETURNING id,first_name,last_name,display_name,phone,email,telegram,whatsapp`,
      ).bind(apple.email, now).first<PilgrimRow>();
      if (!created) throw new RouteError("APPLE_ACCOUNT_CREATION_FAILED", 503);
      const createdPilgrim = !provisional;
      try {
        await linkVerifiedEmail(db, Number(created.id), apple.email, apple.email);
        const salt = randomToken(18);
        const inaccessiblePassword = randomToken(48);
        const passwordHash = await passwordDigest(inaccessiblePassword, salt, PASSWORD_ITERATIONS);
        await db.prepare(
          `INSERT INTO iumrah_accounts(
             pilgrim_id,password_salt,password_hash,password_iterations,activated_at,password_updated_at
           ) VALUES(?1,?2,?3,?4,?5,?5)`,
        ).bind(Number(created.id), salt, passwordHash, PASSWORD_ITERATIONS, now).run();
        row = created;
        createdAccount = true;
      } catch (error) {
        if (createdPilgrim) {
          await db.prepare("DELETE FROM pilgrims WHERE id=?1").bind(Number(created.id)).run().catch(() => undefined);
        }
        const racedOwner = await db.prepare(
          `SELECT p.id,p.first_name,p.last_name,p.display_name,p.phone,p.email,p.telegram,p.whatsapp
           FROM iumrah_client_account_emails e
           INNER JOIN pilgrims p ON p.id=e.pilgrim_id
           INNER JOIN iumrah_accounts a ON a.pilgrim_id=p.id
           WHERE e.email_normalized=?1 LIMIT 1`,
        ).bind(apple.email).first<PilgrimRow>();
        if (!racedOwner) throw error;
        row = racedOwner;
      }
    }
    try {
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT INTO iumrah_client_apple_links(apple_subject,pilgrim_id,linked_at,last_used_at)
         VALUES(?1,?2,?3,?3)`,
      ).bind(apple.subject, Number(row.id), now).run();
    } catch (error) {
      const linkedOwner = await db.prepare(
        `SELECT p.id,p.first_name,p.last_name,p.display_name,p.phone,p.email,p.telegram,p.whatsapp
         FROM iumrah_client_apple_links a
         INNER JOIN pilgrims p ON p.id=a.pilgrim_id
         WHERE a.apple_subject=?1 LIMIT 1`,
      ).bind(apple.subject).first<PilgrimRow>();
      if (!linkedOwner) throw error;
      row = linkedOwner;
      createdAccount = false;
    }
  }
  const device = parseDevice(payload?.device);
  const session = await createAccountSession(db, Number(row.id));
  const auth: AccountAuth = { pilgrimID: Number(row.id), tokenHash: session.tokenHash, pilgrim: row };
  let sessionID: string;
  try {
    sessionID = await bindCurrentSession(db, auth, device, request);
  } catch (error) {
    await db.prepare("UPDATE iumrah_account_sessions SET revoked_at=?1 WHERE token_hash=?2")
      .bind(new Date().toISOString(), session.tokenHash).run();
    throw error;
  }
  if (createdAccount) {
    await db.prepare(
      `UPDATE iumrah_client_devices SET is_primary=1
       WHERE pilgrim_id=?1 AND installation_id=?2`,
    ).bind(Number(row.id), device.installationID).run();
  }
  const now = new Date().toISOString();
  await db.prepare("UPDATE iumrah_client_apple_links SET last_used_at=?1 WHERE apple_subject=?2")
    .bind(now, apple.subject).run();
  await db.prepare("UPDATE iumrah_accounts SET last_login_at=?1 WHERE pilgrim_id=?2")
    .bind(now, Number(row.id)).run();
  await audit(db, Number(row.id), createdAccount ? "apple_account_created" : "apple_sign_in", sessionID, sessionID);
  return json({
    ok: true,
    account: accountProfile(row),
    session: { token: session.token, expiresAt: session.expiresAt },
  });
}


async function linkGoogle(request: Request, env: Env, db: D1Like) {
  const auth = await requireDevice(request, db);
  if (!auth.isPrimary) throw new RouteError("PRIMARY_DEVICE_REQUIRED", 403);
  const payload = await request.json().catch(() => null) as {
    identityToken?: unknown;
    nonce?: unknown;
  } | null;
  const google = await verifyGoogleIdentity(
    payload?.identityToken,
    payload?.nonce,
    env.GOOGLE_SERVER_CLIENT_ID ?? "",
  );
  await consumeGoogleAssertion(db, google.token);
  const subjectOwner = await db.prepare(
    "SELECT pilgrim_id FROM iumrah_client_google_links WHERE google_subject=?1 LIMIT 1",
  ).bind(google.subject).first<{ pilgrim_id: number }>();
  if (subjectOwner && Number(subjectOwner.pilgrim_id) !== auth.pilgrimID) {
    throw new RouteError("GOOGLE_ID_CONNECTED_TO_ANOTHER_ACCOUNT", 409);
  }
  const accountLink = await db.prepare(
    "SELECT google_subject FROM iumrah_client_google_links WHERE pilgrim_id=?1 LIMIT 1",
  ).bind(auth.pilgrimID).first<{ google_subject: string }>();
  if (accountLink && accountLink.google_subject !== google.subject) {
    throw new RouteError("GOOGLE_ID_ALREADY_CONNECTED", 409);
  }
  if (google.emailVerified && validEmail(google.email)) {
    const emailOwner = await db.prepare(
      "SELECT pilgrim_id FROM iumrah_client_account_emails WHERE email_normalized=?1 LIMIT 1",
    ).bind(google.email).first<{ pilgrim_id: number }>();
    if (emailOwner && Number(emailOwner.pilgrim_id) !== auth.pilgrimID) {
      throw new RouteError("GOOGLE_EMAIL_CONNECTED_TO_ANOTHER_ACCOUNT", 409);
    }
  }
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO iumrah_client_google_links(google_subject,pilgrim_id,linked_at,last_used_at)
     VALUES(?1,?2,?3,?3)
     ON CONFLICT(google_subject) DO UPDATE SET last_used_at=excluded.last_used_at`,
  ).bind(google.subject, auth.pilgrimID, now).run();
  if (google.emailVerified && validEmail(google.email)) {
    const currentEmail = await db.prepare(
      "SELECT pilgrim_id FROM iumrah_client_account_emails WHERE pilgrim_id=?1 LIMIT 1",
    ).bind(auth.pilgrimID).first<{ pilgrim_id: number }>();
    if (!currentEmail) await linkVerifiedEmail(db, auth.pilgrimID, google.email, google.email);
  }
  await audit(db, auth.pilgrimID, "google_id_linked", auth.sessionID, auth.sessionID);
  return json({ ok: true, googleLinked: true, iumrahID: formatIumrahID(auth.pilgrimID) });
}

async function signInWithGoogle(request: Request, env: Env, db: D1Like) {
  const payload = await request.json().catch(() => null) as {
    identityToken?: unknown;
    nonce?: unknown;
    device?: unknown;
  } | null;
  const google = await verifyGoogleIdentity(
    payload?.identityToken,
    payload?.nonce,
    env.GOOGLE_SERVER_CLIENT_ID ?? "",
  );
  await consumeGoogleAssertion(db, google.token);
  let row = await db.prepare(
    `SELECT p.id,p.first_name,p.last_name,p.display_name,p.phone,p.email,p.telegram,p.whatsapp
     FROM iumrah_client_google_links g
     INNER JOIN pilgrims p ON p.id=g.pilgrim_id
     INNER JOIN iumrah_accounts account ON account.pilgrim_id=p.id
     WHERE g.google_subject=?1 LIMIT 1`,
  ).bind(google.subject).first<PilgrimRow>();
  let createdAccount = false;
  if (!row) {
    if (!google.emailVerified || !validEmail(google.email)) {
      throw new RouteError("GOOGLE_ACCOUNT_EMAIL_REQUIRED", 409);
    }
    const existingEmail = await db.prepare(
      `SELECT p.id,p.first_name,p.last_name,p.display_name,p.phone,p.email,p.telegram,p.whatsapp
       FROM iumrah_client_account_emails e
       INNER JOIN pilgrims p ON p.id=e.pilgrim_id
       INNER JOIN iumrah_accounts a ON a.pilgrim_id=p.id
       WHERE e.email_normalized=?1 LIMIT 1`,
    ).bind(google.email).first<PilgrimRow>();
    if (existingEmail) {
      row = existingEmail;
    } else {
      const now = new Date().toISOString();
      const provisional = await reusableProvisionalPilgrim(db, google.email);
      const created = provisional ?? await db.prepare(
        `INSERT INTO pilgrims(email,created_at,updated_at)
         VALUES(?1,?2,?2)
         RETURNING id,first_name,last_name,display_name,phone,email,telegram,whatsapp`,
      ).bind(google.email, now).first<PilgrimRow>();
      if (!created) throw new RouteError("GOOGLE_ACCOUNT_CREATION_FAILED", 503);
      const createdPilgrim = !provisional;
      try {
        await linkVerifiedEmail(db, Number(created.id), google.email, google.email);
        const salt = randomToken(18);
        const inaccessiblePassword = randomToken(48);
        const passwordHash = await passwordDigest(inaccessiblePassword, salt, PASSWORD_ITERATIONS);
        await db.prepare(
          `INSERT INTO iumrah_accounts(
             pilgrim_id,password_salt,password_hash,password_iterations,activated_at,password_updated_at
           ) VALUES(?1,?2,?3,?4,?5,?5)`,
        ).bind(Number(created.id), salt, passwordHash, PASSWORD_ITERATIONS, now).run();
        row = created;
        createdAccount = true;
      } catch (error) {
        if (createdPilgrim) {
          await db.prepare("DELETE FROM pilgrims WHERE id=?1").bind(Number(created.id)).run().catch(() => undefined);
        }
        const racedOwner = await db.prepare(
          `SELECT p.id,p.first_name,p.last_name,p.display_name,p.phone,p.email,p.telegram,p.whatsapp
           FROM iumrah_client_account_emails e
           INNER JOIN pilgrims p ON p.id=e.pilgrim_id
           INNER JOIN iumrah_accounts a ON a.pilgrim_id=p.id
           WHERE e.email_normalized=?1 LIMIT 1`,
        ).bind(google.email).first<PilgrimRow>();
        if (!racedOwner) throw error;
        row = racedOwner;
      }
    }
    try {
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT INTO iumrah_client_google_links(google_subject,pilgrim_id,linked_at,last_used_at)
         VALUES(?1,?2,?3,?3)`,
      ).bind(google.subject, Number(row.id), now).run();
    } catch (error) {
      const linkedOwner = await db.prepare(
        `SELECT p.id,p.first_name,p.last_name,p.display_name,p.phone,p.email,p.telegram,p.whatsapp
         FROM iumrah_client_google_links g
         INNER JOIN pilgrims p ON p.id=g.pilgrim_id
         WHERE g.google_subject=?1 LIMIT 1`,
      ).bind(google.subject).first<PilgrimRow>();
      if (linkedOwner) {
        row = linkedOwner;
        createdAccount = false;
      } else {
        const accountLink = await db.prepare(
          "SELECT google_subject FROM iumrah_client_google_links WHERE pilgrim_id=?1 LIMIT 1",
        ).bind(Number(row.id)).first<{ google_subject: string }>();
        if (accountLink) throw new RouteError("GOOGLE_ID_ALREADY_CONNECTED", 409);
        throw error;
      }
    }
  }
  const device = parseDevice(payload?.device);
  const session = await createAccountSession(db, Number(row.id));
  const auth: AccountAuth = { pilgrimID: Number(row.id), tokenHash: session.tokenHash, pilgrim: row };
  let sessionID: string;
  try {
    sessionID = await bindCurrentSession(db, auth, device, request);
  } catch (error) {
    await db.prepare("UPDATE iumrah_account_sessions SET revoked_at=?1 WHERE token_hash=?2")
      .bind(new Date().toISOString(), session.tokenHash).run();
    throw error;
  }
  if (createdAccount) {
    await db.prepare(
      `UPDATE iumrah_client_devices SET is_primary=1
       WHERE pilgrim_id=?1 AND installation_id=?2`,
    ).bind(Number(row.id), device.installationID).run();
  }
  const now = new Date().toISOString();
  await db.prepare("UPDATE iumrah_client_google_links SET last_used_at=?1 WHERE google_subject=?2")
    .bind(now, google.subject).run();
  await db.prepare("UPDATE iumrah_accounts SET last_login_at=?1 WHERE pilgrim_id=?2")
    .bind(now, Number(row.id)).run();
  await audit(db, Number(row.id), createdAccount ? "google_account_created" : "google_sign_in", sessionID, sessionID);
  return json({
    ok: true,
    account: accountProfile(row),
    session: { token: session.token, expiresAt: session.expiresAt },
  });
}


function friendGiftCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  let value = "";
  for (const byte of bytes) value += alphabet[byte % alphabet.length];
  return `IUMG-${value}`;
}

async function ensureFriendGifts(db: D1Like, pilgrimID: number) {
  const existing = await db.prepare(
    `SELECT position FROM iumrah_friends_gifts
     WHERE referrer_pilgrim_id=?1 ORDER BY position ASC`,
  ).bind(pilgrimID).all<{ position: number }>();
  const positions = new Set((existing.results ?? []).map((row) => Number(row.position)));
  const now = new Date().toISOString();

  for (let position = 1; position <= 3; position += 1) {
    if (positions.has(position)) continue;
    let inserted = false;
    for (let attempt = 0; attempt < 5 && !inserted; attempt += 1) {
      try {
        await db.prepare(
          `INSERT INTO iumrah_friends_gifts(
             id,gift_token,referrer_pilgrim_id,position,status,created_at
           ) VALUES(?1,?2,?3,?4,'available',?5)`,
        ).bind(`gift-${crypto.randomUUID()}`, friendGiftCode(), pilgrimID, position, now).run();
        inserted = true;
      } catch (error) {
        if (attempt === 4) throw error;
      }
    }
  }
}

function normalizedBookingSettlementStatus(value: unknown) {
  return cleanText(value, 80).replace(/-/g, "_").toUpperCase();
}

async function internalBookingStatus(env: Env, bookingID: string) {
  if (!env.BOOKINGS_DB) return "";
  try {
    const row = await env.BOOKINGS_DB.prepare(
      "SELECT status,payload_json FROM bookings WHERE id=?1 LIMIT 1",
    ).bind(bookingID).first<{ status?: string | null; payload_json?: string | null }>();
    if (!row) return "";
    const direct = normalizedBookingSettlementStatus(row.status);
    if (direct) return direct;
    try {
      const payload = JSON.parse(row.payload_json ?? "{}") as Record<string, unknown>;
      return normalizedBookingSettlementStatus(payload.status);
    } catch {
      return "";
    }
  } catch {
    try {
      const row = await env.BOOKINGS_DB.prepare(
        "SELECT payload_json FROM bookings WHERE id=?1 LIMIT 1",
      ).bind(bookingID).first<{ payload_json?: string | null }>();
      if (!row) return "";
      const payload = JSON.parse(row.payload_json ?? "{}") as Record<string, unknown>;
      return normalizedBookingSettlementStatus(payload.status);
    } catch {
      return "";
    }
  }
}

async function settleFriendRewards(env: Env, referrerPilgrimID: number) {
  if (!env.HOTELS_DB || !env.BOOKINGS_DB) return;
  const pending = await env.HOTELS_DB.prepare(
    `SELECT r.id,r.gift_id,r.booking_id,r.reward_usd
     FROM iumrah_friends_redemptions r
     WHERE r.referrer_pilgrim_id=?1 AND r.reward_status='pending'
     ORDER BY r.created_at ASC LIMIT 40`,
  ).bind(referrerPilgrimID).all<{
    id: string;
    gift_id: string;
    booking_id: string;
    reward_usd: number;
  }>();

  for (const row of pending.results ?? []) {
    const status = await internalBookingStatus(env, row.booking_id);
    const paid = ["PAID", "BOOKING_CONFIRMED", "DOCUMENTS_READY", "READY_TO_TRAVEL", "IN_TRIP", "COMPLETED"].includes(status);
    const cancelled = status === "CANCELLED";
    if (!paid && !cancelled) continue;

    const now = new Date().toISOString();
    if (paid) {
      await env.HOTELS_DB.prepare(
        `UPDATE iumrah_friends_redemptions
         SET status='earned',reward_status='earned',settled_at=?1
         WHERE id=?2 AND reward_status='pending'`,
      ).bind(now, row.id).run();
      await env.HOTELS_DB.prepare(
        `INSERT OR IGNORE INTO iumrah_friends_credit_ledger(
           id,pilgrim_id,amount_usd,source_type,source_id,booking_id,created_at
         ) VALUES(?1,?2,?3,'friend_paid',?4,?5,?6)`,
      ).bind(
        `credit-${crypto.randomUUID()}`,
        referrerPilgrimID,
        Number(row.reward_usd || 100),
        row.id,
        row.booking_id,
        now,
      ).run();
    } else {
      await env.HOTELS_DB.prepare(
        `UPDATE iumrah_friends_redemptions
         SET status='cancelled',reward_status='cancelled',settled_at=?1
         WHERE id=?2 AND reward_status='pending'`,
      ).bind(now, row.id).run();
      await env.HOTELS_DB.prepare(
        `UPDATE iumrah_friends_gifts
         SET status='available',redeemed_booking_id=NULL,redeemed_at=NULL
         WHERE id=?1`,
      ).bind(row.gift_id).run();
    }
  }

  // A reward is earned only while the referred paid booking remains valid.
  // If Business later cancels/refunds that trip, reverse the iumrah Credit and
  // release the Gift Card again. The ledger makes the reversal idempotent.
  const earned = await env.HOTELS_DB.prepare(
    `SELECT r.id,r.gift_id,r.booking_id,r.reward_usd
     FROM iumrah_friends_redemptions r
     WHERE r.referrer_pilgrim_id=?1 AND r.reward_status='earned'
     ORDER BY r.settled_at DESC LIMIT 40`,
  ).bind(referrerPilgrimID).all<{
    id: string;
    gift_id: string;
    booking_id: string;
    reward_usd: number;
  }>();

  for (const row of earned.results ?? []) {
    const status = await internalBookingStatus(env, row.booking_id);
    if (status !== "CANCELLED") continue;
    const now = new Date().toISOString();
    await env.HOTELS_DB.prepare(
      `UPDATE iumrah_friends_redemptions
       SET status='cancelled',reward_status='cancelled',settled_at=?1
       WHERE id=?2 AND reward_status='earned'`,
    ).bind(now, row.id).run();
    await env.HOTELS_DB.prepare(
      `INSERT OR IGNORE INTO iumrah_friends_credit_ledger(
         id,pilgrim_id,amount_usd,source_type,source_id,booking_id,created_at
       ) VALUES(?1,?2,?3,'friend_cancelled_reversal',?4,?5,?6)`,
    ).bind(
      `credit-${crypto.randomUUID()}`,
      referrerPilgrimID,
      -Math.abs(Number(row.reward_usd || 100)),
      row.id,
      row.booking_id,
      now,
    ).run();
    await env.HOTELS_DB.prepare(
      `UPDATE iumrah_friends_gifts
       SET status='available',redeemed_booking_id=NULL,redeemed_at=NULL
       WHERE id=?1`,
    ).bind(row.gift_id).run();
  }
}

async function friendCreditBalance(db: D1Like, pilgrimID: number) {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(amount_usd),0) AS balance
     FROM iumrah_friends_credit_ledger WHERE pilgrim_id=?1`,
  ).bind(pilgrimID).first<{ balance: number | string }>();
  return Math.max(0, Number(row?.balance ?? 0));
}

async function friendsDashboard(request: Request, env: Env, db: D1Like) {
  const auth = await requireDevice(request, db);
  await ensureFriendGifts(db, auth.pilgrimID);
  await settleFriendRewards(env, auth.pilgrimID);

  const gifts = await db.prepare(
    `SELECT g.id,g.gift_token,g.position,g.status,g.redeemed_booking_id,g.created_at,g.redeemed_at,
            r.reward_status,r.reward_usd,r.discount_usd
     FROM iumrah_friends_gifts g
     LEFT JOIN iumrah_friends_redemptions r ON r.gift_id=g.id AND r.status<>'cancelled'
     WHERE g.referrer_pilgrim_id=?1
     ORDER BY g.position ASC`,
  ).bind(auth.pilgrimID).all<{
    id: string;
    gift_token: string;
    position: number;
    status: string;
    redeemed_booking_id: string | null;
    created_at: string;
    redeemed_at: string | null;
    reward_status: string | null;
    reward_usd: number | null;
    discount_usd: number | null;
  }>();

  const balance = await friendCreditBalance(db, auth.pilgrimID);
  const pending = await db.prepare(
    `SELECT COALESCE(SUM(reward_usd),0) AS amount
     FROM iumrah_friends_redemptions
     WHERE referrer_pilgrim_id=?1 AND reward_status='pending'`,
  ).bind(auth.pilgrimID).first<{ amount: number | string }>();
  const earned = await db.prepare(
    `SELECT COALESCE(SUM(reward_usd),0) AS amount
     FROM iumrah_friends_redemptions
     WHERE referrer_pilgrim_id=?1 AND reward_status='earned'`,
  ).bind(auth.pilgrimID).first<{ amount: number | string }>();

  return json({
    ok: true,
    availableCreditUsd: balance,
    pendingRewardsUsd: Number(pending?.amount ?? 0),
    earnedRewardsUsd: Number(earned?.amount ?? 0),
    gifts: (gifts.results ?? []).map((gift) => ({
      id: gift.id,
      code: gift.gift_token,
      position: Number(gift.position),
      status: gift.status,
      redeemedBookingID: gift.redeemed_booking_id,
      rewardStatus: gift.reward_status ?? null,
      rewardUsd: Number(gift.reward_usd ?? 100),
      discountUsd: Number(gift.discount_usd ?? 100),
      createdAt: gift.created_at,
      redeemedAt: gift.redeemed_at,
    })),
  });
}

export async function handleClientAccountSecurity(request: Request, env: Env, url: URL) {
  if (!env.HOTELS_DB) return json({ ok: false, error: "HOTELS_DB_NOT_CONFIGURED" }, 503);
  const db = env.HOTELS_DB;
  try {
    if (request.method === "POST" && url.pathname === "/api/package/client/account/activate") {
      return await activateWithBookingPassword(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/activate/email/start") {
      return await startBookingEmailActivation(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/activate/email/confirm") {
      return await confirmBookingEmailActivation(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/activate/sms/start") {
      return await startBookingSMSActivation(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/activate/sms/confirm") {
      return await confirmBookingSMSActivation(request, env, db);
    }
    if (request.method === "GET" && url.pathname === "/api/package/client/account/phone/status") {
      return await bookingPhoneVerificationStatus(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/phone/start") {
      return await startBookingPhoneVerification(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/phone/confirm") {
      return await confirmBookingPhoneVerification(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/login") {
      return await loginWithPassword(request, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/register/sms/start") {
      return await startStandalonePhoneRegistration(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/register/sms/confirm") {
      return await confirmStandalonePhoneRegistration(request, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/login/email/start") {
      return await startEmailLogin(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/login/email/confirm") {
      return await confirmEmailLogin(request, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/login/sms/start") {
      return await startPhoneLogin(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/login/sms/confirm") {
      return await confirmPhoneLogin(request, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/register/email/start") {
      return await startStandaloneEmailRegistration(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/register/email/confirm") {
      return await confirmStandaloneEmailRegistration(request, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/security/register") {
      return await register(request, db);
    }
    if (request.method === "GET" && url.pathname === "/api/package/client/account/public-card") {
      const auth = await requireAccount(request, db);
      return json({
        ok: true,
        iumrahID: formatIumrahID(auth.pilgrimID),
        url: await publicIdentityURL(env, auth.pilgrimID),
      });
    }
    if (request.method === "GET" && url.pathname === "/api/package/client/account/wallet-pass") {
      const auth = await requireAccount(request, db);
      return await buildIumrahWalletPass(env, accountProfile(auth.pilgrim));
    }
    if (request.method === "GET" && url.pathname === "/api/package/client/account/friends") {
      return await friendsDashboard(request, env, db);
    }
    if (request.method === "GET" && url.pathname === "/api/package/client/account/security") {
      const auth = await requireDevice(request, db);
      return json(await securityOverview(db, auth));
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/security/claim-primary") {
      return await claimPrimary(request, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/security/authorize/password") {
      return await authorizeSensitiveActionWithPassword(request, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/security/authorize/apple") {
      return await authorizeSensitiveActionWithApple(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/security/authorize/google") {
      return await authorizeSensitiveActionWithGoogle(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/security/recovery/start") {
      return await startPrimaryRecoveryChallenge(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/security/recovery/confirm") {
      return await confirmPrimaryRecoveryChallenge(request, db);
    }
    const sessionMatch = url.pathname.match(/^\/api\/package\/client\/account\/security\/sessions\/([^/]+)$/);
    if (request.method === "DELETE" && sessionMatch) {
      return await terminateSession(request, db, decodeURIComponent(sessionMatch[1]));
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/apple/link") {
      return await linkApple(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/apple/unlink") {
      return await unlinkApple(request, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/apple/sign-in") {
      return await signInWithApple(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/google/link") {
      return await linkGoogle(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/google/unlink") {
      return await unlinkGoogle(request, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/google/sign-in") {
      return await signInWithGoogle(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/security/phone/start") {
      return await startAccountPhoneVerification(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/security/phone/confirm") {
      return await confirmAccountPhoneVerification(request, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/email/start") {
      return await startEmailVerification(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/email/confirm") {
      return await confirmEmailVerification(request, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/security/password/change") {
      return await changeAccountPassword(request, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/password/recovery/start") {
      return await startPasswordRecovery(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/package/client/account/password/recovery/confirm") {
      return await confirmPasswordRecovery(request, db);
    }
    return json({ ok: false, error: "NOT_FOUND" }, 404);
  } catch (error) {
    if (error instanceof RouteError) return json({ ok: false, error: error.code }, error.status);
    console.error("CLIENT_ACCOUNT_SECURITY_FAILED", error);
    return json({ ok: false, error: "ACCOUNT_SECURITY_UNAVAILABLE" }, 500);
  }
}
