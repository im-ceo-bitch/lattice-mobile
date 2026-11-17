import type { Env } from './env';
import { bookingGrantHash } from './booking-grants';
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const secret=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export async function recoverGuestBooking(request:Request,env:Env):Promise<Response>{
 if(request.method!=='POST')return response({ok:false,error:'METHOD_NOT_ALLOWED'},405);
 if(!env.BOOKINGS_DB||!env.HOTELS_DB)return response({ok:false,error:'BOOKING_RECOVERY_UNAVAILABLE'},503);
 const p=await request.json().catch(()=>null) as {bookingNumber?:unknown;channel?:unknown;verificationToken?:unknown}|null;
 const number=String(p?.bookingNumber??'').trim().replace(/^#/,'').toUpperCase(), proof=String(p?.verificationToken??''), channel=p?.channel;
 if(!(/^[0-9]{4,9}$/.test(number)||/^IUM-\d{4}-[A-Z2-9]{7}$/.test(number))||!['email','sms'].includes(String(channel))||!/^[a-f0-9]{64}$/.test(proof))return response({ok:false,error:'BOOKING_RECOVERY_INVALID'},400);
 const h=await hash(proof),now=new Date().toISOString(),table=channel==='email'?'iumrah_guest_booking_email_challenges':'iumrah_guest_booking_phone_challenges',field=channel==='email'?'email':'phone';
 const db=env.HOTELS_DB,bookings=env.BOOKINGS_DB;
 const invalid=()=>response({ok:false,error:'BOOKING_RECOVERY_INVALID'},403);
 try{
  // Consume before lookup: one verified OTP permits only one booking-number attempt, preventing enumeration.
  const verified=await db.prepare(`SELECT ${field} AS contact FROM ${table} WHERE verification_token_hash=? AND consumed_at IS NULL AND verified_at IS NOT NULL AND proof_expires_at>? LIMIT 1`).bind(h,now).first<{contact:string}>();
  if(!verified)return invalid();
  const claim=await db.prepare(`UPDATE ${table} SET consumed_at=?,booking_id=? WHERE verification_token_hash=? AND consumed_at IS NULL AND verified_at IS NOT NULL AND proof_expires_at>?`).bind(now,'recovery:'+crypto.randomUUID(),h,now).run();
  if(Number(claim.meta?.changes||0)!==1)return invalid();
  const trip=await db.prepare(/^IUM-/.test(number)?'SELECT booking_id FROM pilgrim_trips WHERE booking_id=? LIMIT 1':'SELECT booking_id FROM pilgrim_trips WHERE booking_number=? LIMIT 1').bind(/^IUM-/.test(number)?number:Number(number)).first<{booking_id:string}>();
  if(!trip)return invalid();
  const row=await bookings.prepare('SELECT id,access_token_hash,payload_json,status,created_at,updated_at FROM bookings WHERE id=? LIMIT 1').bind(trip.booking_id).first<{id:string;access_token_hash:string;payload_json:string;status:string;created_at:string;updated_at:string}>();
  if(!row)return invalid();
  const payload=JSON.parse(row.payload_json||'{}'), profile=payload.pilgrimProfile||{};
  if(channel==='email'?((!profile.emailVerifiedAt&&profile.guestCheckout!==true)||String(profile.email||'').trim().toLowerCase()!==verified.contact):((!profile.phoneVerifiedAt&&profile.guestCheckout!==true)||String(profile.phone||'')!==verified.contact))return invalid();
  await bookings.prepare('CREATE TABLE IF NOT EXISTS booking_device_grants_v3(booking_id TEXT NOT NULL,token_hash TEXT NOT NULL PRIMARY KEY,primary_hash TEXT NOT NULL,channel TEXT NOT NULL,contact TEXT NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT)').run();
  const token=secret(),tokenHash=await hash(token);
  await bookings.prepare('INSERT INTO booking_device_grants_v3(booking_id,token_hash,primary_hash,channel,contact,created_at) VALUES(?,?,?,?,?,?)').bind(row.id,tokenHash,row.access_token_hash,channel,verified.contact,now).run();
  if(!await bookingGrantHash(bookings,row.id,tokenHash))return invalid();
  // Same public response as GET /api/bookings/:id; no account, no cost or passport material added.
  return response({ok:true,accessToken:token,booking:{...payload,id:row.id,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at}});
 }catch(e){console.warn('BOOKING_RECOVERY_FAILED',e instanceof Error?e.message:'unknown');return response({ok:false,error:'BOOKING_RECOVERY_UNAVAILABLE'},503);}
}
