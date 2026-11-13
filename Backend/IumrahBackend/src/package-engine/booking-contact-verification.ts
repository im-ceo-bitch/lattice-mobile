import type { D1Like } from "./d1";
import type { Env } from "./env";
import { attachVerifiedBookingPhone } from "./booking-control";

type ChallengeRow = {
  id: string;
  phone: string;
  salt: string;
  code_hash: string;
  attempts: number;
  expires_at: string;
  verified_at: string | null;
};

type ProofRow = {
  phone: string;
  expires_at: string;
  consumed_at: string | null;
  booking_id: string | null;
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function sha256(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
function secret(length = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function hashCode(code: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 100000,
  }, key, 256);
  return hex(new Uint8Array(bits));
}
function equalHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
function normalizePhone(raw: unknown): string {
  return "+" + String(raw ?? "").replace(/\D/g, "").slice(0, 15);
}
function randomCode(): string {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

async function sendCode(env: Env, phone: string, code: string): Promise<void> {
  if (!env.DEVSMS_API_TOKEN) throw new Error("SMS_NOT_CONFIGURED");
  const response = await fetch("https://devsms.uz/api/send_sms.php", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.DEVSMS_API_TOKEN}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      phone: phone.slice(1), type: "universal_otp", template_type: 1,
      service_name: "iumrah", otp_code: code,
    }),
  });
  const result = await response.json().catch(() => null) as { success?: boolean } | null;
  if (!response.ok || result?.success !== true) throw new Error("SMS_DELIVERY_UNAVAILABLE");
}

async function start(request: Request, db: D1Like, env: Env): Promise<Response> {
  const body = await request.json().catch(() => null) as { phone?: unknown } | null;
  const phone = normalizePhone(body?.phone);
  if (!/^\+998\d{9}$/.test(phone)) return json({ ok: false, error: "PHONE_INVALID_OR_UNSUPPORTED" }, 400);
  const ip = request.headers.get("cf-connecting-ip") ?? "";
  const ipHash = ip ? await sha256(ip) : "";
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const prior = await db.prepare(
    `SELECT COUNT(*) AS attempts FROM iumrah_guest_booking_phone_challenges
     WHERE created_at>?1 AND (phone=?2 OR (ip_hash<>'' AND ip_hash=?3))`,
  ).bind(since, phone, ipHash).first<{ attempts: number }>();
  if (Number(prior?.attempts ?? 0) >= 5) return json({ ok: false, error: "SMS_RATE_LIMITED" }, 429);

  const id = `book-sms-${crypto.randomUUID()}`;
  const salt = secret(18);
  const code = randomCode();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await db.prepare(
    `INSERT INTO iumrah_guest_booking_phone_challenges
     (id,phone,salt,code_hash,created_at,expires_at,attempts,ip_hash)
     VALUES(?1,?2,?3,?4,?5,?6,0,?7)`,
  ).bind(id, phone, salt, await hashCode(code, salt), createdAt, expiresAt, ipHash).run();
  try {
    await sendCode(env, phone, code);
  } catch {
    await db.prepare("DELETE FROM iumrah_guest_booking_phone_challenges WHERE id=?1").bind(id).run();
    return json({ ok: false, error: "SMS_DELIVERY_UNAVAILABLE" }, 503);
  }
  return json({ ok: true, challengeID: id, expiresAt });
}

async function confirm(request: Request, db: D1Like): Promise<Response> {
  const body = await request.json().catch(() => null) as { challengeID?: unknown; code?: unknown } | null;
  const id = String(body?.challengeID ?? "").slice(0, 120);
  const code = String(body?.code ?? "");
  if (!/^\d{6}$/.test(code)) return json({ ok: false, error: "CODE_INVALID" }, 400);
  const row = await db.prepare(
    `SELECT id,phone,salt,code_hash,attempts,expires_at,verified_at
     FROM iumrah_guest_booking_phone_challenges WHERE id=?1 LIMIT 1`,
  ).bind(id).first<ChallengeRow>();
  if (!row || row.verified_at || Number(row.attempts) >= 5 || Date.parse(row.expires_at) <= Date.now()) {
    return json({ ok: false, error: "CODE_EXPIRED_OR_INVALID" }, 400);
  }
  const matched = equalHash(await hashCode(code, row.salt), row.code_hash);
  if (!matched) {
    await db.prepare("UPDATE iumrah_guest_booking_phone_challenges SET attempts=attempts+1 WHERE id=?1 AND verified_at IS NULL")
      .bind(id).run();
    return json({ ok: false, error: "CODE_INVALID" }, 400);
  }
  const token = secret();
  const tokenHash = await sha256(token);
  const verifiedAt = new Date().toISOString();
  const tokenExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const update = await db.prepare(
    `UPDATE iumrah_guest_booking_phone_challenges
     SET verified_at=?1, verification_token_hash=?2, proof_expires_at=?3
     WHERE id=?4 AND verified_at IS NULL AND attempts<5 AND expires_at>?1`,
  ).bind(verifiedAt, tokenHash, tokenExpiresAt, id).run();
  // An exact second concurrent submission must not produce another valid token.
  const check = await db.prepare(
    "SELECT verification_token_hash FROM iumrah_guest_booking_phone_challenges WHERE id=?1",
  ).bind(id).first<{ verification_token_hash: string }>();
  if (check?.verification_token_hash !== tokenHash || update.success === false) {
    return json({ ok: false, error: "CODE_ALREADY_USED" }, 409);
  }
  return json({ ok: true, phone: row.phone, verificationToken: token, expiresAt: tokenExpiresAt });
}

async function attach(request: Request, id: string, db: D1Like, env: Env): Promise<Response> {
  if (!env.BOOKINGS_DB) return json({ ok: false, error: "BOOKINGS_DB_NOT_CONFIGURED" }, 503);
  const body = await request.json().catch(() => null) as { verificationToken?: unknown } | null;
  const token = String(body?.verificationToken ?? "");
  if (!/^[a-f0-9]{64}$/.test(token)) return json({ ok: false, error: "PROOF_INVALID" }, 400);
  const proof = await db.prepare(
    `SELECT phone,proof_expires_at AS expires_at,consumed_at,booking_id
     FROM iumrah_guest_booking_phone_challenges WHERE verification_token_hash=?1 LIMIT 1`,
  ).bind(await sha256(token)).first<ProofRow>();
  if (!proof || Date.parse(proof.expires_at) <= Date.now() ||
      (proof.consumed_at && proof.booking_id !== id)) {
    return json({ ok: false, error: "PROOF_EXPIRED_OR_INVALID" }, 400);
  }
  const updated = await attachVerifiedBookingPhone(request, id, proof.phone, env);
  if (updated.status !== 200) return updated;
  await db.prepare(
    `UPDATE iumrah_guest_booking_phone_challenges
     SET consumed_at=COALESCE(consumed_at,?1),booking_id=COALESCE(booking_id,?2)
     WHERE verification_token_hash=?3 AND (booking_id IS NULL OR booking_id=?2)`,
  ).bind(new Date().toISOString(), id, await sha256(token)).run();
  return json({ ok: true, verified: true, phone: proof.phone });
}

export async function handleGuestBookingPhone(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.HOTELS_DB) return json({ ok: false, error: "HOTELS_DB_NOT_CONFIGURED" }, 503);
  try {
    if (url.pathname === "/api/package/booking-contact/sms/start" && request.method === "POST")
      return await start(request, env.HOTELS_DB, env);
    if (url.pathname === "/api/package/booking-contact/sms/confirm" && request.method === "POST")
      return await confirm(request, env.HOTELS_DB);
    const match = url.pathname.match(/^\/api\/package\/booking\/(IUM-\d{4}-[A-Z2-9]{7})\/verified-phone$/);
    if (match && request.method === "POST") return await attach(request, match[1], env.HOTELS_DB, env);
  } catch (error) {
    console.error("guest-booking-sms", error instanceof Error ? error.message : "unknown");
    return json({ ok: false, error: "BOOKING_PHONE_VERIFICATION_FAILED" }, 503);
  }
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
}
