import type { Env } from './env';
import type { D1Like } from './d1';
import { ensureBookingMailSchema,mailLocale,sendResend,sendBookingEmailStatus } from './booking-email';

function json(value:unknown,status=200):Response{return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function digest(input:string):Promise<string>{return crypto.subtle.digest('SHA-256',new TextEncoder().encode(input)).then(b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join(''));}
function randomToken(bytes=32):string{const b=crypto.getRandomValues(new Uint8Array(bytes));return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');}
function pin():string{const b=new Uint32Array(1);const limit=Math.floor(2**32/1e6)*1e6;do{crypto.getRandomValues(b);}while(b[0]>=limit);return String(b[0]%1e6).padStart(6,'0');}
async function hashPin(code:string,salt:string):Promise<string>{const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(code),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),hash:'SHA-256',iterations:100000},k,256);return Array.from(new Uint8Array(bits),x=>x.toString(16).padStart(2,'0')).join('');}
function equals(a:string,b:string):boolean{if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
function normalizeEmail(raw:unknown):string{return String(raw??'').trim().toLowerCase().slice(0,254);}
function validEmail(raw:string):boolean{return /^[^\s@<>]+@[^\s@.<>]+(?:\.[^\s@.<>]+)+$/.test(raw);}

const otpCopy={
  ru:['Код подтверждения бронирования','Введите код, чтобы подтвердить электронную почту для бронирования.','Никому не сообщайте этот код. Он действует 10 минут.'],
  en:['Booking confirmation code','Enter this code to verify your email for your booking.','Never share this code. It expires in 10 minutes.'],
  uz:['Bronni tasdiqlash kodi','Bron uchun emailingizni tasdiqlash uchun ushbu kodni kiriting.','Kodni hech kimga bermang. U 10 daqiqa amal qiladi.'],
  'uz-cyrl':['Бронни тасдиқлаш коди','Брон учун электрон почтангизни тасдиқлаш учун ушбу кодни киритинг.','Кодни ҳеч кимга берманг. У 10 дақиқа амал қилади.'],
} as const;
async function start(request:Request,db:D1Like,env:Env):Promise<Response>{
  const body=await request.json().catch(()=>null) as {email?:unknown;locale?:unknown}|null;
  const email=normalizeEmail(body?.email);if(!validEmail(email))return json({ok:false,error:'EMAIL_INVALID'},400);
  if(!env.RESEND_API_KEY)return json({ok:false,error:'EMAIL_DELIVERY_NOT_CONFIGURED'},503);
  const ip=request.headers.get('cf-connecting-ip')??'';const ipHash=ip?await digest(ip):'';
  const oneHourAgo=new Date(Date.now()-3600000).toISOString();
  const prior=await db.prepare(`SELECT COUNT(*) AS count FROM iumrah_guest_booking_email_challenges WHERE created_at>?1 AND (email=?2 OR (ip_hash<>'' AND ip_hash=?3))`).bind(oneHourAgo,email,ipHash).first<{count:number}>();
  if(Number(prior?.count??0)>=5)return json({ok:false,error:'EMAIL_RATE_LIMITED'},429);
  const code=pin(),salt=randomToken(18),id=`book-email-${crypto.randomUUID()}`;
  const created=new Date().toISOString(),expires=new Date(Date.now()+10*60000).toISOString();
  await db.prepare(`INSERT INTO iumrah_guest_booking_email_challenges(id,email,salt,code_hash,created_at,expires_at,ip_hash) VALUES(?1,?2,?3,?4,?5,?6,?7)`)
    .bind(id,email,salt,await hashPin(code,salt),created,expires,ipHash).run();
  const locale=mailLocale(body?.locale),c=otpCopy[locale];
  try{
    await sendResend(env,email,{
      subject:`iumrah · ${c[0]}`,
      text:`${c[1]}\n\n${code}\n\n${c[2]}`,
      html:`<!doctype html><html lang="${locale}"><meta charset="utf-8"><body style="margin:0;background:#f5f6f8;color:#15171b;font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;padding:24px"><main style="max-width:520px;margin:0 auto;background:#fff;padding:32px;border-radius:24px"><img width="110" alt="iumrah" src="https://iumrah.app/api/package/email-brand/logo.png"><h1 style="font-size:25px">${c[0]}</h1><p style="color:#606770">${c[1]}</p><p style="font-size:38px;font-weight:700;letter-spacing:7px">${code}</p><p style="color:#606770;font-size:13px">${c[2]}</p></main></body></html>`,
    },id);
  }catch(e){
    await db.prepare('DELETE FROM iumrah_guest_booking_email_challenges WHERE id=?1').bind(id).run();
    console.error('booking-email-otp',e instanceof Error?e.message:'unknown');
    return json({ok:false,error:'EMAIL_DELIVERY_UNAVAILABLE'},503);
  }
  return json({ok:true,challengeID:id,expiresAt:expires});
}
interface Challenge {id:string;email:string;salt:string;code_hash:string;attempts:number;expires_at:string;verified_at:string|null;verification_token_hash:string|null;}
async function confirm(request:Request,db:D1Like):Promise<Response>{
  const body=await request.json().catch(()=>null) as {challengeID?:unknown;code?:unknown}|null;
  const id=String(body?.challengeID??'').slice(0,120),code=String(body?.code??'');
  if(!/^\d{6}$/.test(code))return json({ok:false,error:'CODE_INVALID'},400);
  const row=await db.prepare('SELECT * FROM iumrah_guest_booking_email_challenges WHERE id=?1 LIMIT 1').bind(id).first<Challenge>();
  if(!row||row.verified_at||row.attempts>=5||Date.parse(row.expires_at)<=Date.now())return json({ok:false,error:'CODE_EXPIRED_OR_INVALID'},400);
  if(!equals(await hashPin(code,row.salt),row.code_hash)){
    await db.prepare('UPDATE iumrah_guest_booking_email_challenges SET attempts=attempts+1 WHERE id=?1 AND verified_at IS NULL').bind(id).run();
    return json({ok:false,error:'CODE_INVALID'},400);
  }
  const proof=randomToken();const hashed=await digest(proof),now=new Date().toISOString(),proofExpires=new Date(Date.now()+15*60000).toISOString();
  const update=await db.prepare(`UPDATE iumrah_guest_booking_email_challenges SET verified_at=?1,verification_token_hash=?2,proof_expires_at=?3 WHERE id=?4 AND verified_at IS NULL AND expires_at>?1 AND attempts<5`).bind(now,hashed,proofExpires,id).run();
  const check=await db.prepare('SELECT verification_token_hash FROM iumrah_guest_booking_email_challenges WHERE id=?1').bind(id).first<{verification_token_hash:string}>();
  if(!update.success||check?.verification_token_hash!==hashed)return json({ok:false,error:'CODE_ALREADY_USED'},409);
  return json({ok:true,email:row.email,verificationToken:proof,expiresAt:proofExpires});
}
async function attach(request:Request,bookingID:string,db:D1Like,env:Env):Promise<Response>{
  if(!env.BOOKINGS_DB)return json({ok:false,error:'BOOKINGS_DB_NOT_CONFIGURED'},503);
  const body=await request.json().catch(()=>null) as {verificationToken?:unknown;locale?:unknown}|null;
  const token=String(body?.verificationToken??'');if(!/^[a-f0-9]{64}$/.test(token))return json({ok:false,error:'PROOF_INVALID'},400);
  const hashed=await digest(token);
  const proof=await db.prepare(`SELECT email,proof_expires_at,consumed_at,booking_id FROM iumrah_guest_booking_email_challenges WHERE verification_token_hash=?1 LIMIT 1`).bind(hashed).first<{email:string;proof_expires_at:string;consumed_at:string|null;booking_id:string|null}>();
  if(!proof||Date.parse(proof.proof_expires_at)<=Date.now()||(proof.consumed_at&&proof.booking_id!==bookingID))return json({ok:false,error:'PROOF_EXPIRED_OR_INVALID'},400);
  const bookingToken=String(request.headers.get('x-booking-token')??'').trim();
  if(bookingToken.length<24||bookingToken.length>128)return json({ok:false,error:'BOOKING_AUTH_INVALID'},401);
  const existing=await env.BOOKINGS_DB.prepare('SELECT id,payload_json FROM bookings WHERE id=?1 AND access_token_hash=?2 LIMIT 1').bind(bookingID,await digest(bookingToken)).first<{id:string;payload_json:string}>();
  if(!existing)return json({ok:false,error:'BOOKING_AUTH_INVALID'},401);
  const now=new Date().toISOString(),locale=mailLocale(body?.locale);
  const payload=JSON.parse(existing.payload_json||'{}') as Record<string,unknown>;
  const profile=payload.pilgrimProfile&&typeof payload.pilgrimProfile==='object'?payload.pilgrimProfile as Record<string,unknown>:{};
  payload.pilgrimProfile={...profile,email:proof.email,emailVerifiedAt:now};
  // A successfully verified contact is not an account credential.
  await env.BOOKINGS_DB.prepare('UPDATE bookings SET payload_json=?1,updated_at=?2 WHERE id=?3').bind(JSON.stringify(payload),now,bookingID).run();
  await db.prepare(`INSERT INTO iumrah_booking_email_subscriptions(booking_id,email,locale,verified_at) VALUES(?1,?2,?3,?4)
    ON CONFLICT(booking_id) DO UPDATE SET email=excluded.email,locale=excluded.locale,verified_at=excluded.verified_at,
      last_sent_status=CASE WHEN iumrah_booking_email_subscriptions.email=excluded.email THEN iumrah_booking_email_subscriptions.last_sent_status ELSE NULL END`).bind(bookingID,proof.email,locale,now).run();
  await db.prepare(`UPDATE iumrah_guest_booking_email_challenges SET consumed_at=COALESCE(consumed_at,?1),booking_id=COALESCE(booking_id,?2)
    WHERE verification_token_hash=?3 AND (booking_id IS NULL OR booking_id=?2)`).bind(now,bookingID,hashed).run();
  // A provider outage must not undo verification or create a second booking.
  await sendBookingEmailStatus(env,bookingID).catch(e=>console.error('initial-booking-email',e));
  return json({ok:true,verified:true,email:proof.email});
}
export async function handleGuestBookingEmail(request:Request,env:Env,url:URL):Promise<Response>{
  if(!env.HOTELS_DB)return json({ok:false,error:'HOTELS_DB_NOT_CONFIGURED'},503);
  try{
    await ensureBookingMailSchema(env.HOTELS_DB);
    if(request.method==='POST'&&url.pathname==='/api/package/booking-contact/email/start')return await start(request,env.HOTELS_DB,env);
    if(request.method==='POST'&&url.pathname==='/api/package/booking-contact/email/confirm')return await confirm(request,env.HOTELS_DB);
    const match=url.pathname.match(/^\/api\/package\/booking\/(IUM-\d{4}-[A-Z2-9]{7})\/verified-email$/);
    if(match&&request.method==='POST')return await attach(request,match[1],env.HOTELS_DB,env);
  }catch(e){console.error('guest-booking-email',e instanceof Error?e.message:'unknown');return json({ok:false,error:'BOOKING_EMAIL_VERIFICATION_FAILED'},503);}
  return json({ok:false,error:'METHOD_NOT_ALLOWED'},405);
}
