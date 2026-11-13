import type { D1Like } from "./d1";
import type { Env } from "./env";

type BookingDB = D1Like;

type TelegramCredential =
  | { bookingToken: string; accountToken?: never }
  | { accountToken: string; bookingToken?: never };

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function clean(value: unknown, max = 256) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return "";
  return authorization.slice(7).trim();
}

async function bookingCredential(request: Request, bookingID: string, env: Env): Promise<TelegramCredential | null> {
  if (!env.BOOKINGS_DB) return null;

  const bookingToken = clean(request.headers.get("x-booking-token"), 180);
  if (bookingToken.length >= 24 && bookingToken.length <= 128) {
    const tokenHash = await sha256Hex(bookingToken);
    const row = await env.BOOKINGS_DB.prepare(
      "SELECT id FROM bookings WHERE id=?1 AND access_token_hash=?2 LIMIT 1",
    ).bind(bookingID, tokenHash).first<{ id: string }>();
    if (row) return { bookingToken };
  }

  const accountToken = bearerToken(request);
  if (!accountToken || accountToken.length > 256 || !env.HOTELS_DB) return null;
  const tokenHash = await sha256Hex(accountToken);
  const now = new Date().toISOString();
  const session = await env.HOTELS_DB.prepare(
    `SELECT pilgrim_id FROM iumrah_account_sessions
     WHERE token_hash=?1 AND revoked_at IS NULL AND expires_at>?2 LIMIT 1`,
  ).bind(tokenHash, now).first<{ pilgrim_id: number }>();
  const pilgrimID = Number(session?.pilgrim_id ?? 0);
  if (!pilgrimID) return null;

  const trip = await env.HOTELS_DB.prepare(
    "SELECT booking_id FROM pilgrim_trips WHERE booking_id=?1 AND pilgrim_id=?2 LIMIT 1",
  ).bind(bookingID, pilgrimID).first<{ booking_id: string }>();
  return trip ? { accountToken } : null;
}

function telegramOrigin(env: Env) {
  const raw = clean(env.TELEGRAM_BOT_ORIGIN, 300).replace(/\/+$/, "");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function createTelegramBookingLink(request: Request, bookingID: string, env: Env): Promise<Response> {
  if (!env.BOOKINGS_DB) return json({ ok: false, error: "BOOKING_DB_NOT_CONFIGURED" }, 503);
  const origin = telegramOrigin(env);
  if (!origin) return json({ ok: false, error: "TELEGRAM_BOT_NOT_CONFIGURED" }, 503);

  let payload: Record<string, unknown> = {};
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  const credential = await bookingCredential(request, bookingID, env);
  if (!credential) return json({ ok: false, error: "BOOKING_AUTH_INVALID" }, 401);

  const language = clean(payload.language, 16) || "ru";
  try {
    const response = await fetch(`${origin}/internal/link-token`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "iumrah-package-engine/telegram-bridge",
      },
      body: JSON.stringify({ bookingId: bookingID, language, ...credential }),
      redirect: "manual",
    });

    const text = await response.text();
    const headers = new Headers({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    if (!response.ok) {
      console.error("telegram-link-create-failed", bookingID, response.status, text.slice(0, 400));
      return new Response(text || JSON.stringify({ ok: false, error: "TELEGRAM_LINK_FAILED" }), {
        status: response.status >= 400 && response.status < 600 ? response.status : 502,
        headers,
      });
    }
    return new Response(text, { status: 200, headers });
  } catch (error) {
    console.error("telegram-link-bridge-unreachable", bookingID, error);
    return json({ ok: false, error: "TELEGRAM_BOT_UNREACHABLE" }, 502);
  }
}


export async function getTelegramBookingStatus(request: Request, bookingID: string, env: Env): Promise<Response> {
  if (!env.BOOKINGS_DB) return json({ ok: false, error: "BOOKING_DB_NOT_CONFIGURED" }, 503);
  const origin = telegramOrigin(env);
  if (!origin) return json({ ok: false, error: "TELEGRAM_BOT_NOT_CONFIGURED" }, 503);

  const credential = await bookingCredential(request, bookingID, env);
  if (!credential) return json({ ok: false, error: "BOOKING_AUTH_INVALID" }, 401);

  try {
    const response = await fetch(`${origin}/internal/link-status`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "iumrah-package-engine/telegram-bridge",
      },
      body: JSON.stringify({ bookingId: bookingID, ...credential }),
      redirect: "manual",
    });
    const text = await response.text();
    const headers = new Headers({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    if (!response.ok) {
      return new Response(text || JSON.stringify({ ok: false, error: "TELEGRAM_STATUS_FAILED" }), {
        status: response.status >= 400 && response.status < 600 ? response.status : 502,
        headers,
      });
    }
    return new Response(text, { status: 200, headers });
  } catch (error) {
    console.error("telegram-link-status-unreachable", bookingID, error);
    return json({ ok: false, error: "TELEGRAM_BOT_UNREACHABLE" }, 502);
  }
}
