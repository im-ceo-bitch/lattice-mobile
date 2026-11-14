// Native booking notification bot. Only one Worker; no legacy service binding.
import { requestEnv, ORIGIN, backendFetch } from '../runtime.js';
import { ensureTelegramBookingSchema, randomSecret, sha256, queueTelegramNotice, deliverTelegramNotice } from './telegram-booking.js';
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const bookingPattern=/^IUM-\d{4}-[A-Z2-9]{7}$/;
export const botConfigured=e=>typeof e.IUMRAH_TELEGRAM_BOT_TOKEN==='string'&&/^\d+:[\w-]{25,}$/.test(e.IUMRAH_TELEGRAM_BOT_TOKEN.trim());
export const webhookPath='/api/telegram/webhook';
export async function purposeSecret(env,purpose){
 const secret=env.IUMRAH_SESSION_SECRET;
 if(typeof secret!=='string'||secret.trim().length<32)return '';
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('iumrah:v25:telegram:'+purpose));
 return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||!b||a.length!==b.length)return false;let v=0;for(let i=0;i<a.length;i++)v|=a.charCodeAt(i)^b.charCodeAt(i);return v===0;}
export const telegramRetrySecret=e=>purposeSecret(e,'retry');
export async function retryAuthorized(e,value){const secret=await telegramRetrySecret(e);return !!secret&&equal(value,'Bearer '+secret);}
async function botCall(env,method,body={}){
 if(!botConfigured(env))throw Error('TELEGRAM_BOT_NOT_CONFIGURED');
 const res=await backendFetch('https://api.telegram.org/bot'+env.IUMRAH_TELEGRAM_BOT_TOKEN.trim()+'/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(6500)});
 const data=await res.json().catch(()=>null);
 if(!res.ok||data?.ok!==true)throw Error('TELEGRAM_PROVIDER_'+res.status);
 return data.result;
}
// Dedicated iumrah bot: setting this webhook moves delivery from any old Worker.
// Do not drop pending updates. The secret is derived locally, never sent to clients.
export async function configureTelegramWebhook(env){
 const secret=await purposeSecret(env,'webhook');if(!secret)throw Error('TELEGRAM_SECURITY_NOT_CONFIGURED');
 const me=await botCall(env,'getMe');if(me?.is_bot!==true||!/^\w{5,32}$/.test(me.username||''))throw Error('TELEGRAM_BOT_INVALID');
 if(await botCall(env,'setWebhook',{url:ORIGIN+webhookPath,secret_token:secret,allowed_updates:['message'],drop_pending_updates:false})!==true)throw Error('TELEGRAM_WEBHOOK_SETUP_FAILED');
 return me.username;
}
async function authorized(request,id,env){
 if(!bookingPattern.test(id)||!env.BOOKINGS_DB)return false;
 const token=(request.headers.get('x-booking-token')||'').trim();
 if(token.length>=24&&token.length<=128){const row=await env.BOOKINGS_DB.prepare('SELECT id FROM bookings WHERE id=? AND access_token_hash=? LIMIT 1').bind(id,await sha256(token)).first();if(row)return true;}
 const bearer=request.headers.get('authorization')||'';
 const account=/^Bearer (\S{1,256})$/i.exec(bearer)?.[1];if(!account||!env.HOTELS_DB)return false;
 const session=await env.HOTELS_DB.prepare('SELECT pilgrim_id FROM iumrah_account_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>? LIMIT 1').bind(await sha256(account),new Date().toISOString()).first();
 if(!session?.pilgrim_id)return false;
 return !!(await env.HOTELS_DB.prepare('SELECT booking_id FROM pilgrim_trips WHERE booking_id=? AND pilgrim_id=? LIMIT 1').bind(id,session.pilgrim_id).first());
}
export async function nativeLink(request){
 const env=requestEnv(),db=env.BOOKINGS_DB;
 const body=await request.json().catch(()=>null),id=String(body?.bookingId??body?.bookingID??'');
 if(!await authorized(request,id,env))return json({ok:false,error:'BOOKING_AUTH_INVALID'},401);
 if(!botConfigured(env))return json({ok:false,error:'TELEGRAM_BOT_NOT_CONFIGURED'},503);
 try{
  const username=await configureTelegramWebhook(env);
  const token=randomSecret(),hash=await sha256(token),now=new Date(),expiresAt=new Date(now.getTime()+10*60_000).toISOString();
  await db.batch([
   db.prepare('UPDATE booking_telegram_links SET used_at=? WHERE booking_id=? AND used_at IS NULL').bind(now.toISOString(),id),
   db.prepare('INSERT INTO booking_telegram_links(token_hash,booking_id,created_at,expires_at) VALUES(?,?,?,?)').bind(hash,id,now.toISOString(),expiresAt)
  ]);
  return json({ok:true,booking:{bookingID:id},startParameter:token,linkUrl:`https://t.me/${username}?start=${token}`,expiresAt});
 }catch(e){console.warn('TELEGRAM_LINK_FAILED',e?.name);return json({ok:false,error:'TELEGRAM_LINK_FAILED'},502);}
}
export async function nativeStatus(request){
 const env=requestEnv(),id=new URL(request.url).searchParams.get('bookingId')||'';
 if(!await authorized(request,id,env))return json({ok:false,error:'BOOKING_AUTH_INVALID'},401);
 const row=await env.BOOKINGS_DB.prepare('SELECT telegram_name,disabled_at FROM booking_telegram_subscriptions WHERE booking_id=? LIMIT 1').bind(id).first();
 return json({ok:true,linked:!!row&&!row.disabled_at,connected:!!row&&!row.disabled_at,username:row?.telegram_name||''});
}
export async function nativeWebhook(request){
 const env=requestEnv(),db=env.BOOKINGS_DB;
 if(!botConfigured(env)||!equal(request.headers.get('x-telegram-bot-api-secret-token'),await purposeSecret(env,'webhook')))return json({ok:false,error:'UNAUTHORIZED'},401);
 const message=(await request.json().catch(()=>null))?.message;
 const telegramID=String(message?.from?.id||'');
 if(message?.chat?.type!=='private'||!/^\d{1,20}$/.test(telegramID)||String(message.chat.id)!==telegramID||message.from.is_bot)return json({ok:true});
 const token=/^\/start\s+([a-f0-9]{64})$/.exec(String(message.text||'').trim())?.[1];
 if(!token)return json({ok:true});
 const hash=await sha256(token),now=new Date().toISOString(),claim=randomSecret();
 const link=await db.prepare('SELECT booking_id FROM booking_telegram_links WHERE token_hash=? AND used_at IS NULL AND expires_at>? LIMIT 1').bind(hash,now).first();
 if(!link)return json({ok:true}); // expired, revoked or replayed: no new subscription
 const id=link.booking_id,name=typeof message.from.username==='string'?message.from.username.slice(0,64):'';
 // Atomic claim and subscription; the random claim prevents a concurrent loser
 // from replacing the winning subscription, even with a duplicate webhook.
 const results=await db.batch([
  db.prepare('UPDATE booking_telegram_links SET used_at=?,claim_id=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?').bind(now,claim,hash,now),
  db.prepare(`INSERT INTO booking_telegram_subscriptions(booking_id,telegram_id,telegram_name,connected_at,disabled_at)
    SELECT booking_id,?,?,?,NULL FROM booking_telegram_links WHERE token_hash=? AND claim_id=?
    ON CONFLICT(booking_id) DO UPDATE SET telegram_id=excluded.telegram_id,telegram_name=excluded.telegram_name,connected_at=excluded.connected_at,disabled_at=NULL`).bind(telegramID,name,now,hash,claim),
  db.prepare('DELETE FROM booking_telegram_outbox WHERE booking_id=? AND EXISTS(SELECT 1 FROM booking_telegram_links WHERE token_hash=? AND claim_id=?)').bind(id,hash,claim),
  db.prepare(`INSERT OR IGNORE INTO booking_telegram_outbox(booking_id,status,created_at)
    SELECT b.id,b.status,? FROM bookings b JOIN booking_telegram_links l ON l.booking_id=b.id
    WHERE l.token_hash=? AND l.claim_id=? AND b.status IN ('AVAILABILITY_CHECK','PAYMENT_PENDING','BOOKING_CONFIRMED','READY_TO_TRAVEL','IN_TRIP','COMPLETED','CANCELLED')`).bind(now,hash,claim)
 ]);
 if(Number(results[0]?.meta?.changes||0)>0){
  const booking=await db.prepare('SELECT status FROM bookings WHERE id=?').bind(id).first();
  if(booking?.status)await deliverTelegramNotice(db,id,booking.status);
 }
 return json({ok:true});
}
export async function notifyTelegramStatus(env,id,status){
 if(!botConfigured(env)||!['AVAILABILITY_CHECK','PAYMENT_PENDING','BOOKING_CONFIRMED','READY_TO_TRAVEL','IN_TRIP','COMPLETED','CANCELLED'].includes(status))return false;
 await ensureTelegramBookingSchema(env.BOOKINGS_DB);
 await queueTelegramNotice(env.BOOKINGS_DB,id,status);
 return deliverTelegramNotice(env.BOOKINGS_DB,id,status);
}
