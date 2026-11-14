// Owner-only recovery. The destination is provisioned out of band in a Worker secret.
// No client account, booking contact, or caller-selected destination can grant staff rights.
import {requestEnv, NextResponse} from '../runtime.js';

const TABLE = 'staff_recovery_state';
export const STAFF_RECOVERY_SCHEMA = `CREATE TABLE IF NOT EXISTS staff_recovery_state (
 id INTEGER PRIMARY KEY CHECK(id=1), credential_version INTEGER NOT NULL DEFAULT 0,
 password_salt TEXT, password_hash TEXT, challenge_id TEXT, code_hash TEXT,
 expires_at INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
 sent_at INTEGER NOT NULL DEFAULT 0, window_start INTEGER NOT NULL DEFAULT 0,
 window_count INTEGER NOT NULL DEFAULT 0
)`;
const encoder = new TextEncoder();
const bytesToHex = bytes => Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const randomHex = n => bytesToHex(crypto.getRandomValues(new Uint8Array(n)));
const email = value => typeof value==='string' ? value.trim().toLowerCase() : '';
export function ownerRecoveryEmail(env=requestEnv()) {
 const address=email(env.IUMRAH_ADMIN_RECOVERY_EMAIL);
 return address.length<=254 && /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(address) ? address : '';
}
export function staffRecoverySecret(env=requestEnv()) {
 let value=typeof env.IUMRAH_SESSION_SECRET==='string'?env.IUMRAH_SESSION_SECRET.trim():'';
 if(value.length>1 && ((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))))value=value.slice(1,-1).trim();
 return value;
}
const dbFor = env => env.BOOKINGS_DB;
export async function staffCredentialState(env=requestEnv()) {
 const db=dbFor(env);
 if(!db?.prepare) throw Error('STAFF_RECOVERY_DB_UNAVAILABLE');
 try { return await db.prepare(`SELECT * FROM ${TABLE} WHERE id=1`).first(); }
 catch(e) {
  // Compatibility with pre-V36 installations only. A provisioned recovery system
  // fails closed if its schema is absent; other database errors never fall back.
  if(!ownerRecoveryEmail(env) && /no such table:\s*(?:main\.)?staff_recovery_state\b/i.test(String(e?.message)))return null;
  throw e;
 }
}
async function hmac(secret, message) {
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(message)));
}
function equalHex(a,b) {
 if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;
}
async function passwordHash(password,salt,secret) {
 // Server-side pepper plus the Workers-compatible PBKDF2 iteration ceiling.
 const peppered=await hmac(secret,'staff-password-v1:'+password);
 const key=await crypto.subtle.importKey('raw',peppered,'PBKDF2',false,['deriveBits']);
 return bytesToHex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:100000},key,256)));
}
export async function verifyRecoveredPassword(state,password,secret) {
 if(!state?.password_hash||!state?.password_salt)return false;
 return equalHex(await passwordHash(password,state.password_salt,secret),state.password_hash);
}
const otpHash=async(secret,address,challenge,code)=>bytesToHex(await hmac(secret,`staff-recovery-v1:${address}:${challenge}:${code}`));
function newCode(){let n;do{n=crypto.getRandomValues(new Uint32Array(1))[0];}while(n>=4294000000);return String(n%1000000).padStart(6,'0');}
const reply=(value,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
const fail=(error,status)=>reply({ok:false,error},status);
const changed=result=>Number(result?.meta?.changes??0)===1;
async function input(request){try{const data=await request.json();return data&&typeof data==='object'&&!Array.isArray(data)?data:null;}catch{return null;}}
function settings(env){const address=ownerRecoveryEmail(env),secret=staffRecoverySecret(env);return address&&secret.length>=32&&env.RESEND_API_KEY&&dbFor(env)?.prepare?{address,secret,db:dbFor(env)}:null;}
export async function startStaffRecovery(request) {
 const env=requestEnv(),cfg=settings(env);if(!cfg)return fail('STAFF_RECOVERY_NOT_CONFIGURED',503);
 const body=await input(request);if(!body||email(body.email)!==cfg.address)return fail('STAFF_RECOVERY_INVALID_CONTACT',400);
 const now=Date.now(),challenge=randomHex(24),code=newCode(),digest=await otpHash(cfg.secret,cfg.address,challenge,code);
 // One owner, one active code. Atomically rate-limit sends across isolates.
 await cfg.db.prepare(`INSERT INTO ${TABLE}(id) VALUES(1) ON CONFLICT(id) DO NOTHING`).run();
 const issued=await cfg.db.prepare(`UPDATE ${TABLE} SET challenge_id=?, code_hash=?, expires_at=?, attempts=0, sent_at=?,
 window_start=CASE WHEN window_start<=? THEN ? ELSE window_start END,
 window_count=CASE WHEN window_start<=? THEN 1 ELSE window_count+1 END
 WHERE id=1 AND sent_at<=? AND (window_start<=? OR window_count<5)`)
 .bind(challenge,digest,now+600000,now,now-3600000,now,now-3600000,now-60000,now-3600000).run();
 if(!changed(issued))return fail('STAFF_RECOVERY_RATE_LIMIT',429);
 try {
  const result=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,'content-type':'application/json','Idempotency-Key':`staff-recovery-${challenge}`},signal:AbortSignal.timeout(10000),body:JSON.stringify({from:`iumrah Business <${env.ACCOUNT_EMAIL_FROM||'security@iumrah.app'}>`,to:[cfg.address],subject:'iumrah Business — код восстановления',text:`Код восстановления: ${code}\nДействует 10 минут. Никому не сообщайте код. Если вы не запрашивали его, проигнорируйте письмо.`})});
  if(!result.ok)throw Error('DELIVERY_FAILED');
 } catch {
  // Do not log provider responses, recipient or code. Never clear a newer challenge.
  await cfg.db.prepare(`UPDATE ${TABLE} SET code_hash=NULL, expires_at=0 WHERE id=1 AND challenge_id=?`).bind(challenge).run();
  return fail('STAFF_RECOVERY_EMAIL_FAILED',503);
 }
 return reply({ok:true,challengeID:challenge,expiresIn:600});
}
export async function finishStaffRecovery(request) {
 const env=requestEnv(),cfg=settings(env);if(!cfg)return fail('STAFF_RECOVERY_NOT_CONFIGURED',503);
 const body=await input(request);if(!body||email(body.email)!==cfg.address)return fail('STAFF_RECOVERY_INVALID_CONTACT',400);
 const {challengeID,code,password}=body;
 if(typeof password!=='string'||password.length<12||password.length>128||!password.trim())return fail('STAFF_RECOVERY_PASSWORD_POLICY',400);
 if(typeof challengeID!=='string'||! /^[a-f0-9]{48}$/.test(challengeID)||typeof code!=='string'||! /^\d{6}$/.test(code))return fail('STAFF_RECOVERY_INVALID_CODE',400);
 const state=await staffCredentialState(env),now=Date.now();
 if(!state||state.challenge_id!==challengeID||!state.code_hash||state.expires_at<=now||state.attempts>=5)return fail('STAFF_RECOVERY_INVALID_CODE',400);
 const digest=await otpHash(cfg.secret,cfg.address,challengeID,code);
 if(!equalHex(state.code_hash,digest)){
  await cfg.db.prepare(`UPDATE ${TABLE} SET attempts=attempts+1 WHERE id=1 AND challenge_id=? AND code_hash IS NOT NULL AND expires_at>? AND attempts<5`).bind(challengeID,now).run();
  return fail('STAFF_RECOVERY_INVALID_CODE',400);
 }
 const salt=randomHex(24),hash=await passwordHash(password,salt,cfg.secret);
 // One atomic compare-and-set both consumes the OTP and replaces the credential.
 const result=await cfg.db.prepare(`UPDATE ${TABLE} SET password_salt=?,password_hash=?,credential_version=credential_version+1,
 challenge_id=NULL,code_hash=NULL,expires_at=0,attempts=0 WHERE id=1 AND challenge_id=? AND code_hash=? AND expires_at>? AND attempts<5`)
 .bind(salt,hash,challengeID,digest,Date.now()).run();
 if(!changed(result))return fail('STAFF_RECOVERY_INVALID_CODE',400);
 return reply({ok:true});
}
