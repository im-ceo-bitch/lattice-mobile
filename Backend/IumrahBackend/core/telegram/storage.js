// Mini App credentials are encrypted and subordinate to the ONE native subscription.
import {encryptSecret,encodeStoredBookingCredential,normalizeLocale} from './mini-bot.js';
import {ORIGIN,backendFetch} from '../runtime.js';
export async function ensureMiniSchema(db){
 await db.batch([
  db.prepare(`CREATE TABLE IF NOT EXISTS telegram_mini_pending(token_hash TEXT PRIMARY KEY, booking_id TEXT NOT NULL, ciphertext TEXT NOT NULL, iv TEXT NOT NULL, language TEXT NOT NULL, expires_at TEXT NOT NULL)`),
  db.prepare(`CREATE TABLE IF NOT EXISTS telegram_mini_credentials(booking_id TEXT PRIMARY KEY, telegram_user_id INTEGER NOT NULL, chat_id INTEGER NOT NULL, booking_token_ciphertext TEXT NOT NULL, booking_token_iv TEXT NOT NULL, language TEXT NOT NULL, last_status TEXT, last_payment_status TEXT, last_confirmation_number TEXT, notifications_enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)`),
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_telegram_mini_user ON telegram_mini_credentials(telegram_user_id,updated_at)`),
  db.prepare(`CREATE VIEW IF NOT EXISTS telegram_mini_active AS SELECT c.* FROM telegram_mini_credentials c JOIN booking_telegram_subscriptions s ON s.booking_id=c.booking_id AND s.telegram_id=CAST(c.telegram_user_id AS TEXT) AND s.disabled_at IS NULL JOIN bookings b ON b.id=c.booking_id`),
  db.prepare(`CREATE TABLE IF NOT EXISTS telegram_mini_preferences(telegram_user_id INTEGER PRIMARY KEY, language TEXT NOT NULL DEFAULT 'ru', pinned_message_id INTEGER, updated_at TEXT NOT NULL)`)
 ]);
}
export function miniEnv(env,key){return {DB:env.BOOKINGS_DB,TELEGRAM_BOT_TOKEN:env.IUMRAH_TELEGRAM_BOT_TOKEN.trim(),LINK_ENCRYPTION_KEY:key,PUBLIC_BASE_URL:ORIGIN,assets:env.TELEGRAM_ASSETS,dispatch:backendFetch};}
export async function pendingMiniStatement(env,key,hash,id,credential,language,expiresAt){
 const encrypted=await encryptSecret(miniEnv(env,key),encodeStoredBookingCredential(credential.kind,credential.token));
 return env.BOOKINGS_DB.prepare('INSERT INTO telegram_mini_pending(token_hash,booking_id,ciphertext,iv,language,expires_at) VALUES(?,?,?,?,?,?)').bind(hash,id,encrypted.ciphertext,encrypted.iv,normalizeLocale(typeof language==='string'?language:'ru'),expiresAt);
}
export function claimMiniStatements(db,hash,claim,telegramID,now){return [
 db.prepare(`DELETE FROM telegram_mini_credentials WHERE booking_id IN (SELECT booking_id FROM booking_telegram_links WHERE token_hash=? AND claim_id=?)`).bind(hash,claim),
 db.prepare(`INSERT INTO telegram_mini_credentials(booking_id,telegram_user_id,chat_id,booking_token_ciphertext,booking_token_iv,language,updated_at) SELECT p.booking_id,?,?,p.ciphertext,p.iv,p.language,? FROM telegram_mini_pending p JOIN booking_telegram_links l ON l.token_hash=p.token_hash AND l.booking_id=p.booking_id WHERE p.token_hash=? AND l.claim_id=? AND p.expires_at>?`).bind(telegramID,telegramID,now,hash,claim,now),
 db.prepare(`DELETE FROM telegram_mini_pending WHERE token_hash=? AND EXISTS(SELECT 1 FROM booking_telegram_links WHERE token_hash=? AND claim_id=?)`).bind(hash,hash,claim)
];}
export async function purgeMiniExpired(db){await ensureMiniSchema(db);await db.batch([db.prepare('DELETE FROM telegram_mini_pending WHERE expires_at<=?').bind(new Date().toISOString()),db.prepare('DELETE FROM telegram_mini_credentials WHERE NOT EXISTS (SELECT 1 FROM telegram_mini_active a WHERE a.booking_id=telegram_mini_credentials.booking_id)')]);}
