// Verified checkout contact and durable creation dispatch. No raw OTP or booking
// access token is persisted in the outbox. This module is called only internally.
import {hashBookingToken} from './booking-store.js';
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const bundle='com.iumrah.app';
const err=code=>Object.assign(new Error(code),{checkoutError:true});
export async function ensureCreationOutbox(db){
 await db.prepare(`CREATE TABLE IF NOT EXISTS booking_creation_delivery_v1 (
 booking_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL UNIQUE, channel TEXT NOT NULL,
 locale TEXT NOT NULL, device_token TEXT, environment TEXT NOT NULL,
 contact_done INTEGER NOT NULL DEFAULT 0, push_done INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, lease_token TEXT,
 lease_until TEXT, created_at TEXT NOT NULL, last_error TEXT)`).run();
 await db.prepare('CREATE INDEX IF NOT EXISTS idx_creation_delivery_due ON booking_creation_delivery_v1(next_attempt_at,lease_until)').run();
}
async function hmac(secret,value){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value)));
}
const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
export async function prepareCreationIntent(env,raw,input,quoteProof,lang){
 if(raw==null)return null; // old clients remain supported
 if(!env.HOTELS_DB||!env.BOOKINGS_DB||String(env.IUMRAH_SESSION_SECRET||'').length<32)throw err('NOTIFICATION_SERVICE_UNAVAILABLE');
 const channel=raw.contactChannel, proof=String(raw.verificationToken||''), requestID=String(raw.requestID||'').toLowerCase();
 if(raw.event!=='booking_created'||!['email','sms'].includes(channel)||!/^[a-f0-9]{64}$/.test(proof)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(requestID))throw err('NOTIFICATION_PROOF_INVALID');
 const contact=String(raw.contact||'').trim();
 if(channel==='email'?(!/^\S+@\S+\.\S+$/.test(contact)||contact.length>180):!/^\+998\d{9}$/.test(contact))throw err('NOTIFICATION_PROOF_INVALID');
 const proofHash=await hashBookingToken(proof), normalized=channel==='email'?contact.toLowerCase():contact;
 // Scope retry to the verified recipient, original quote, and request identifier.
 const requestHash=await hashBookingToken(JSON.stringify([requestID,proofHash,channel,normalized,String(quoteProof||''),input]));
 const bytes=await hmac(env.IUMRAH_SESSION_SECRET,'creation-id:'+requestHash);
 const id=`IUM-${input.input.startDate.slice(0,4)}-${Array.from(bytes.slice(0,7),b=>alphabet[b%alphabet.length]).join('')}`;
 const accessToken=hex(await hmac(env.IUMRAH_SESSION_SECRET,'creation-access:'+requestHash));
 const table=channel==='email'?'iumrah_guest_booking_email_challenges':'iumrah_guest_booking_phone_challenges';
 const field=channel==='email'?'email':'phone', now=new Date().toISOString(),db=env.HOTELS_DB;
 const row=await db.prepare(`SELECT ${field} AS contact,verified_at,proof_expires_at,booking_id,consumed_at FROM ${table} WHERE verification_token_hash=?`).bind(proofHash).first();
 if(!row?.verified_at||row.contact!==normalized||Date.parse(row.proof_expires_at)<=Date.now()||(row.consumed_at&&row.booking_id!==id))throw err('NOTIFICATION_PROOF_INVALID');
 // Claim before cross-database writes; same deterministic retry may resume.
 await db.prepare(`UPDATE ${table} SET consumed_at=COALESCE(consumed_at,?),booking_id=? WHERE verification_token_hash=? AND verified_at IS NOT NULL AND proof_expires_at>? AND (consumed_at IS NULL OR booking_id=?)`).bind(now,id,proofHash,now,id).run();
 const claim=await db.prepare(`SELECT booking_id,consumed_at FROM ${table} WHERE verification_token_hash=?`).bind(proofHash).first();
 if(claim?.booking_id!==id||!claim.consumed_at)throw err('NOTIFICATION_PROOF_INVALID');
 const device=String(raw.pushDeviceToken||'').toLowerCase();
 const deviceToken=raw.appBundleID===bundle&&/^[a-f0-9]{64}$/.test(device)?device:null;
 const profile={...(input.pilgrimProfile||{}),[field]:normalized,[field==='email'?'emailVerifiedAt':'phoneVerifiedAt']:row.verified_at};
 return {id,accessToken,requestHash,channel,locale:lang,profile,deviceToken,environment:raw.pushEnvironment==='development'?'development':'production'};
}
// A guest order is not a verified identity. Keep contact ownership separate from
// the booking credential, and restrict unverified notifications to non-private copy.
export async function prepareGuestCreationIntent(env,requestID,input,quoteProof,lang){
 const p=input.pilgrimProfile||{},phone=String(p.phone||''),email=String(p.email||'').toLowerCase();
 if(typeof requestID!=='string'||!/^[a-f0-9]{64}$/.test(requestID)||!p.firstName||!p.lastName||!/^\+998\d{9}$/.test(phone)||!/^\S+@\S+\.\S+$/.test(email)||email.length>180)throw err('GUEST_REQUEST_INVALID');
 if(!env.BOOKINGS_DB||!env.HOTELS_DB||String(env.IUMRAH_SESSION_SECRET||'').length<32)throw err('NOTIFICATION_SERVICE_UNAVAILABLE');
 const db=env.BOOKINGS_DB,requestHash=await hashBookingToken(JSON.stringify(['guest-v1',requestID,String(quoteProof||''),input]));
 const bytes=await hmac(env.IUMRAH_SESSION_SECRET,'creation-id:'+requestHash);
 const id=`IUM-${input.input.startDate.slice(0,4)}-${Array.from(bytes.slice(0,7),b=>alphabet[b%alphabet.length]).join('')}`;
 const accessToken=hex(await hmac(env.IUMRAH_SESSION_SECRET,'creation-access:'+requestHash));
 await db.prepare('CREATE TABLE IF NOT EXISTS guest_checkout_admission_v1 (id TEXT PRIMARY KEY, phone_hash TEXT NOT NULL, email_hash TEXT NOT NULL, created_at TEXT NOT NULL)').run();
 await db.prepare('CREATE INDEX IF NOT EXISTS guest_checkout_rate_phone ON guest_checkout_admission_v1(phone_hash,created_at)').run();
 await db.prepare('CREATE INDEX IF NOT EXISTS guest_checkout_rate_email ON guest_checkout_admission_v1(email_hash,created_at)').run();
 const now=new Date().toISOString(), since=new Date(Date.now()-3600000).toISOString(),ph=await hashBookingToken(phone),eh=await hashBookingToken(email);
 await db.prepare(`INSERT OR IGNORE INTO guest_checkout_admission_v1(id,phone_hash,email_hash,created_at)
 SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM guest_checkout_admission_v1 WHERE phone_hash=? AND created_at>?)<3 AND (SELECT COUNT(*) FROM guest_checkout_admission_v1 WHERE email_hash=? AND created_at>?)<3 AND (SELECT COUNT(*) FROM guest_checkout_admission_v1 WHERE created_at>?)<200`).bind(id,ph,eh,now,ph,since,eh,since,since).run();
 if(!await db.prepare('SELECT id FROM guest_checkout_admission_v1 WHERE id=?').bind(id).first())throw err('GUEST_RATE_LIMIT');
 return {id,accessToken,requestHash,channel:'guest',locale:lang,profile:{...p,phone,email,guestCheckout:true},deviceToken:null,environment:'production'};
}
export function creationOutboxStatement(db,job,now){
 return db.prepare('INSERT INTO booking_creation_delivery_v1(booking_id,request_hash,channel,locale,device_token,environment,push_done,next_attempt_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(job.id,job.requestHash,job.channel,job.locale,job.deviceToken,job.environment,job.deviceToken?0:1,now,now);
}
export async function dispatchCreationNotifications(env,handlers,bookingID=null){
 const db=env.BOOKINGS_DB;if(!db||!env.HOTELS_DB)return;
 await ensureCreationOutbox(db);
 const now=new Date().toISOString(), cutoff=new Date(Date.now()-7*86400000).toISOString();
 const q='SELECT * FROM booking_creation_delivery_v1 WHERE (contact_done=0 OR push_done=0) AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<?) AND created_at>?';
 const rows=await (bookingID?db.prepare(q+' AND booking_id=? LIMIT 1').bind(now,now,cutoff,bookingID):db.prepare(q+' ORDER BY next_attempt_at LIMIT 10').bind(now,now,cutoff)).all();
 for(const row of rows.results||[]){
  const lease=crypto.randomUUID();const claim=await db.prepare('UPDATE booking_creation_delivery_v1 SET lease_token=?,lease_until=?,attempts=attempts+1 WHERE booking_id=? AND (lease_until IS NULL OR lease_until<?) AND (contact_done=0 OR push_done=0)').bind(lease,new Date(Date.now()+120000).toISOString(),row.booking_id,now).run();
  if(Number(claim.meta?.changes||0)!==1)continue;
  let contactDone=Number(row.contact_done),pushDone=Number(row.push_done),error='';
  try{
   const b=await db.prepare('SELECT id,status,payload_json FROM bookings WHERE id=?').bind(row.booking_id).first();
   if(!b){contactDone=pushDone=1;}
   else{
    const booking={...JSON.parse(b.payload_json),id:b.id,status:b.status};
    const trip=await handlers.materializeBookingIdentity(env,booking);
    if(!trip?.bookingNumber)throw Error('IDENTITY_PENDING');
    if(!contactDone)try{
     const p=booking.pilgrimProfile||{};
     if(row.channel==='guest'&&p.guestCheckout===true){
      await handlers.ensureBookingMailSchema(env.HOTELS_DB);
      await env.HOTELS_DB.prepare('INSERT OR IGNORE INTO iumrah_booking_email_subscriptions(booking_id,email,locale,verified_at) VALUES(?,?,?,?)').bind(b.id,p.email,row.locale,'').run();
      const mail=await handlers.sendBookingEmailStatus(env,b.id);
      const sub=await env.HOTELS_DB.prepare('SELECT last_sent_status FROM iumrah_booking_email_subscriptions WHERE booking_id=?').bind(b.id).first();
      const sms=await handlers.sendBookingSMSStatus(env,b.id);
      contactDone=(mail==='sent'||!!sub?.last_sent_status)&&['accepted','rejected'].includes(sms)?1:0;
     }else if(row.channel==='email'&&p.emailVerifiedAt&&p.email){
      await handlers.ensureBookingMailSchema(env.HOTELS_DB);
      await env.HOTELS_DB.prepare('INSERT OR IGNORE INTO iumrah_booking_email_subscriptions(booking_id,email,locale,verified_at) VALUES(?,?,?,?)').bind(b.id,p.email,row.locale,p.emailVerifiedAt).run();
      const result=await handlers.sendBookingEmailStatus(env,b.id);
      const sub=await env.HOTELS_DB.prepare('SELECT last_sent_status FROM iumrah_booking_email_subscriptions WHERE booking_id=?').bind(b.id).first();
      contactDone=result==='sent'||!!sub?.last_sent_status?1:0;
     }else if(row.channel==='sms'&&p.phoneVerifiedAt){
      const result=await handlers.sendBookingSMSStatus(env,b.id);contactDone=result==='accepted'||result==='rejected'?1:0;
     }else contactDone=1;
    }catch{error='CONTACT_RETRY';}
    if(!pushDone)try{pushDone=await handlers.registerCreationPush(env,b.id,row.device_token,row.environment,row.locale)?1:0;}catch{error='PUSH_RETRY';}
   }
  }catch{error='CREATION_DISPATCH_RETRY';}
  const next=new Date(Date.now()+Math.min(60,5*2**Math.min(Number(row.attempts),4))*60000).toISOString();
  await db.prepare('UPDATE booking_creation_delivery_v1 SET contact_done=?,push_done=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL,last_error=?,device_token=CASE WHEN ?=1 THEN NULL ELSE device_token END WHERE booking_id=? AND lease_token=?').bind(contactDone,pushDone,next,error||null,pushDone,row.booking_id,lease).run();
 }
}
