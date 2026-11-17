import { bookingGrantRead } from "./booking-grants.js";
// Native booking notification bot. Only one Worker; no legacy service binding.
import { requestEnv, ORIGIN, backendFetch } from '../runtime.js';
import { ensureTelegramBookingSchema, randomSecret, sha256, queueTelegramNotice, deliverTelegramNotice } from './telegram-booking.js';
import {miniFetch,handleUpdate,setMiniAppMenuButton,normalizeLocale,decryptSecret,decodeStoredBookingCredential} from '../telegram/mini-bot.js';
import {ensureMiniSchema,miniEnv,pendingMiniStatement,claimMiniStatements,purgeMiniExpired} from '../telegram/storage.js';
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
// Only fixed error codes leave this module. Never log a provider URL, token,
// arbitrary Telegram description or exception message (may contain secrets).
const setupMethods=new Set(['getMe','setWebhook','getWebhookInfo','setChatMenuButton']);
function telegramSetupError(code){return Object.assign(Error(code),{telegramSetupCode:code});}
async function botCall(env,method,body={}){
 if(!botConfigured(env))throw telegramSetupError('TELEGRAM_BOT_NOT_CONFIGURED');
 if(!setupMethods.has(method))throw telegramSetupError('TELEGRAM_METHOD_NOT_ALLOWED');
 for(let attempt=0;attempt<3;attempt++){
  let failure, retry=false, delay=350*(attempt+1);
  try{
   const res=await backendFetch('https://api.telegram.org/bot'+env.IUMRAH_TELEGRAM_BOT_TOKEN.trim()+'/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(12000)});
   // Workers supports manual/follow only. Reject redirects without forwarding the bot token.
   const data=res.status>=300&&res.status<400?null:await res.json().catch(()=>null);
   if(res.ok&&data?.ok===true)return data.result;
   const status=Number.isInteger(data?.error_code)&&data.error_code>=400&&data.error_code<=599?data.error_code:res.status;
   failure=telegramSetupError(`TELEGRAM_${method}_HTTP_${status}`);
   retry=status===429||status>=500;
   if(status===429){const seconds=Number(data?.parameters?.retry_after);if(Number.isFinite(seconds)&&seconds>0){if(seconds>5)retry=false;else delay=Math.max(delay,seconds*1000);}}
  }catch(e){
   failure=telegramSetupError(`TELEGRAM_${method}_${e?.name==='TimeoutError'||e?.name==='AbortError'?'TIMEOUT':'NETWORK_ERROR'}`);retry=true;
  }
  if(!retry||attempt===2)throw failure;
  await new Promise(resolve=>setTimeout(resolve,delay));
 }
}
// Dedicated iumrah bot: setting this webhook moves delivery from any old Worker.
// Do not drop pending updates. The secret is derived locally, never sent to clients.
export async function configureTelegramWebhook(env){
 const secret=await purposeSecret(env,'webhook');if(!secret)throw telegramSetupError('TELEGRAM_SECURITY_NOT_CONFIGURED');
 const me=await botCall(env,'getMe');if(me?.is_bot!==true||!/^\w{5,32}$/.test(me.username||''))throw telegramSetupError('TELEGRAM_BOT_INVALID');
 if(await botCall(env,'setWebhook',{url:ORIGIN+webhookPath,secret_token:secret,allowed_updates:['message','callback_query'],drop_pending_updates:false})!==true)throw telegramSetupError('TELEGRAM_WEBHOOK_SETUP_FAILED');
 return me.username;
}
async function authorized(request,id,env){
 if(!bookingPattern.test(id)||!env.BOOKINGS_DB)return false;
 const bearer=request.headers.get('authorization')||'';
 const account=/^Bearer (\S{1,256})$/i.exec(bearer)?.[1];
 if(account&&env.HOTELS_DB){
  const session=await env.HOTELS_DB.prepare('SELECT pilgrim_id FROM iumrah_account_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>? LIMIT 1').bind(await sha256(account),new Date().toISOString()).first();
  if(session?.pilgrim_id && await env.HOTELS_DB.prepare('SELECT booking_id FROM pilgrim_trips WHERE booking_id=? AND pilgrim_id=? LIMIT 1').bind(id,session.pilgrim_id).first() && await env.BOOKINGS_DB.prepare('SELECT id FROM bookings WHERE id=?').bind(id).first())return {kind:'account',token:account};
 }
 const token=(request.headers.get('x-booking-token')||'').trim();
 if(token.length>=24&&token.length<=128){const row=await bookingGrantRead(env.BOOKINGS_DB,'SELECT id FROM bookings WHERE id=? AND access_token_hash=? LIMIT 1',id,await sha256(token));if(row)return {kind:'booking',token};}
 return false;
}
async function storedCredentialValid(env,id,row){
 if(!row)return false;
 try{const mini=miniEnv(env,await purposeSecret(env,'mini-credentials'));const c=decodeStoredBookingCredential(await decryptSecret(mini,row.ciphertext,row.iv));const h=new Headers(c.kind==='account'?{authorization:'Bearer '+c.token}:{'x-booking-token':c.token});return !!(await authorized({headers:h},id,env));}catch{return false;}
}
export async function nativeLink(request){
 const env=requestEnv(),db=env.BOOKINGS_DB;
 const body=await request.json().catch(()=>null),id=String(body?.bookingId??body?.bookingID??'');
 const credential=await authorized(request,id,env);if(!credential)return json({ok:false,error:'BOOKING_AUTH_INVALID'},401);
 if(!botConfigured(env))return json({ok:false,error:'TELEGRAM_BOT_NOT_CONFIGURED'},503);
 try{
  await ensureMiniSchema(db);
  const username=await configureTelegramWebhook(env);
  const token=randomSecret(),hash=await sha256(token),now=new Date(),expiresAt=new Date(now.getTime()+10*60_000).toISOString();
  await db.batch([
   db.prepare('UPDATE booking_telegram_links SET used_at=? WHERE booking_id=? AND used_at IS NULL').bind(now.toISOString(),id),
   db.prepare('INSERT INTO booking_telegram_links(token_hash,booking_id,created_at,expires_at) VALUES(?,?,?,?)').bind(hash,id,now.toISOString(),expiresAt),
   db.prepare('DELETE FROM telegram_mini_pending WHERE booking_id=? OR expires_at<=?').bind(id,now.toISOString()),
   await pendingMiniStatement(env,await purposeSecret(env,'mini-credentials'),hash,id,credential,body?.language,expiresAt)
  ]);
  return json({ok:true,booking:{bookingID:id},startParameter:token,linkUrl:`https://t.me/${username}?start=${token}`,expiresAt});
 }catch(e){console.warn('TELEGRAM_LINK_FAILED',e?.name);return json({ok:false,error:'TELEGRAM_LINK_FAILED'},502);}
}
export async function nativeStatus(request){
 const env=requestEnv(),id=new URL(request.url).searchParams.get('bookingId')||'';
 if(!await authorized(request,id,env))return json({ok:false,error:'BOOKING_AUTH_INVALID'},401);
 const row=await env.BOOKINGS_DB.prepare('SELECT telegram_name,disabled_at FROM booking_telegram_subscriptions WHERE booking_id=? LIMIT 1').bind(id).first();
 const connected=!!row&&!row.disabled_at;
 let miniAppReady=false;
 if(connected&&botConfigured(env)){await ensureMiniSchema(env.BOOKINGS_DB);const grant=await env.BOOKINGS_DB.prepare('SELECT booking_token_ciphertext AS ciphertext,booking_token_iv AS iv FROM telegram_mini_active WHERE booking_id=?').bind(id).first();miniAppReady=await storedCredentialValid(env,id,grant);}
 return json({ok:true,linked:connected&&miniAppReady,connected,miniAppReady,username:row?.telegram_name||''});
}
export async function nativeWebhook(request){
 const env=requestEnv(),db=env.BOOKINGS_DB;
 if(!botConfigured(env)||!equal(request.headers.get('x-telegram-bot-api-secret-token'),await purposeSecret(env,'webhook')))return json({ok:false,error:'UNAUTHORIZED'},401);
 const update=await request.json().catch(()=>null);
 const message=update?.message, callback=update?.callback_query;
 const user=callback?.from||message?.from, chat=callback?.message?.chat||message?.chat;
 const telegramID=String(user?.id||'');
 if(chat?.type!=='private'||!Number.isSafeInteger(user?.id)||user.id<=0||String(chat.id)!==telegramID||user.is_bot)return json({ok:true});
 await ensureMiniSchema(db);
 const mini=miniEnv(env,await purposeSecret(env,'mini-credentials'));
 if(callback){try{await handleUpdate(mini,update,ORIGIN);return json({ok:true});}catch{return json({ok:false,error:'TELEGRAM_CALLBACK_FAILED'},502);}}
 const token=/^\/start\s+([a-f0-9]{64})$/.exec(String(message.text||'').trim())?.[1];
 if(!token){try{await handleUpdate(mini,update,ORIGIN);return json({ok:true});}catch{return json({ok:false,error:'TELEGRAM_MESSAGE_FAILED'},502);}}
 const hash=await sha256(token),now=new Date().toISOString(),claim=randomSecret();
 const link=await db.prepare('SELECT booking_id FROM booking_telegram_links WHERE token_hash=? AND used_at IS NULL AND expires_at>? LIMIT 1').bind(hash,now).first();
 if(!link)return json({ok:true}); // expired, revoked or replayed: no new subscription
 const pending=await db.prepare('SELECT ciphertext,iv FROM telegram_mini_pending WHERE token_hash=? AND expires_at>?').bind(hash,now).first();
 if(pending&&!await storedCredentialValid(env,link.booking_id,pending))return json({ok:true});
 const id=link.booking_id,name=typeof message.from.username==='string'?message.from.username.slice(0,64):'';
 // Atomic claim and subscription; the random claim prevents a concurrent loser
 // from replacing the winning subscription, even with a duplicate webhook.
 const results=await db.batch([
  db.prepare('UPDATE booking_telegram_links SET used_at=?,claim_id=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?').bind(now,claim,hash,now),
  db.prepare(`INSERT INTO booking_telegram_subscriptions(booking_id,telegram_id,telegram_name,connected_at,disabled_at)
    SELECT booking_id,?,?,?,NULL FROM booking_telegram_links WHERE token_hash=? AND claim_id=?
    ON CONFLICT(booking_id) DO UPDATE SET telegram_id=excluded.telegram_id,telegram_name=excluded.telegram_name,connected_at=excluded.connected_at,disabled_at=NULL`).bind(telegramID,name,now,hash,claim),
  ...claimMiniStatements(db,hash,claim,telegramID,now),
  db.prepare('DELETE FROM booking_telegram_outbox WHERE booking_id=? AND EXISTS(SELECT 1 FROM booking_telegram_links WHERE token_hash=? AND claim_id=?)').bind(id,hash,claim),
  db.prepare(`INSERT OR IGNORE INTO booking_telegram_outbox(booking_id,status,created_at)
    SELECT b.id,b.status,? FROM bookings b JOIN booking_telegram_links l ON l.booking_id=b.id
    WHERE l.token_hash=? AND l.claim_id=? AND b.status IN ('AVAILABILITY_CHECK','PAYMENT_PENDING','BOOKING_CONFIRMED','READY_TO_TRAVEL','IN_TRIP','COMPLETED','CANCELLED')`).bind(now,hash,claim)
 ]);
 if(Number(results[0]?.meta?.changes||0)>0){
  const booking=await db.prepare('SELECT status FROM bookings WHERE id=?').bind(id).first();
  if(booking?.status)await deliverTelegramNotice(db,id,booking.status);
  await setMiniAppMenuButton(mini,Number(telegramID),normalizeLocale(user.language_code),ORIGIN).catch(()=>{});
 }
 return json({ok:true});
}
export async function notifyTelegramStatus(env,id,status){
 if(!botConfigured(env)||!['AVAILABILITY_CHECK','PAYMENT_PENDING','BOOKING_CONFIRMED','READY_TO_TRAVEL','IN_TRIP','COMPLETED','CANCELLED'].includes(status))return false;
 await ensureTelegramBookingSchema(env.BOOKINGS_DB);
 await queueTelegramNotice(env.BOOKINGS_DB,id,status);
 return deliverTelegramNotice(env.BOOKINGS_DB,id,status);
}

// Deployment-only operation: fixed webhook destination, existing CI admin credential.
export async function nativeTelegramSetup(request){
 const env=requestEnv();
 if(!env.ADMIN_TOKEN||!equal(request.headers.get('authorization'),'Bearer '+env.ADMIN_TOKEN))return json({ok:false,error:'UNAUTHORIZED'},401);
 let stage='SCHEMA';
 try{
  await ensureMiniSchema(env.BOOKINGS_DB);
  stage='WEBHOOK';
  const username=await configureTelegramWebhook(env);
  stage='VERIFY';
  // Telegram may briefly return the old webhook configuration after setWebhook.
  let verified=false;
  for(let attempt=0;attempt<3;attempt++){
   const info=await botCall(env,'getWebhookInfo');
   if(info?.url===ORIGIN+webhookPath&&info.allowed_updates?.includes('callback_query')&&info.allowed_updates?.includes('message')){verified=true;break;}
   if(attempt<2)await new Promise(resolve=>setTimeout(resolve,400*(attempt+1)));
  }
  if(!verified)throw telegramSetupError('TELEGRAM_WEBHOOK_VERIFY_FAILED');
  stage='MENU';
  // Global default; individual chat menus are also refreshed on /start and new links.
  if(await botCall(env,'setChatMenuButton',{menu_button:{type:'web_app',text:'iumrah',web_app:{url:ORIGIN+'/telegram/mini'}}})!==true)throw telegramSetupError('TELEGRAM_MENU_SETUP_FAILED');
  return json({ok:true,webhook:ORIGIN+webhookPath,username,miniApp:ORIGIN+'/telegram/mini'});
 }catch(e){
  const detail=e?.telegramSetupCode||`TELEGRAM_SETUP_${stage}_FAILED`;
  console.warn('TELEGRAM_SETUP_FAILED',stage,detail);
  return json({ok:false,error:'TELEGRAM_WEBHOOK_SETUP_FAILED',stage,detail},502);
 }
}
export async function nativeMini(request){
 const env=requestEnv();if(!botConfigured(env))return json({ok:false,error:'TELEGRAM_BOT_NOT_CONFIGURED'},503);
 const key=await purposeSecret(env,'mini-credentials');if(!key)return json({ok:false,error:'TELEGRAM_SECURITY_NOT_CONFIGURED'},503);
 try{if(request.method==='POST')await ensureMiniSchema(env.BOOKINGS_DB);return await miniFetch(request,miniEnv(env,key));}
 catch{return json({ok:false,error:'TELEGRAM_MINI_REQUEST_FAILED'},500);}
}
export async function maintainTelegram(env){await purgeMiniExpired(env.BOOKINGS_DB);}
