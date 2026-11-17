import type { Env } from './env';
import type { D1Like } from './d1';
const messages: Record<string,string> = {
 availability_check:'Бронирование создано. Проверяем наличие. Оплата пока не требуется.',
 payment_pending:'Наличие подтверждено. Ожидаем оплату и паспорта.',
 booking_confirmed:'Оплата подтверждена. Подготавливаем вашу поездку.',
 ready_to_travel:'Документы готовы. Вы готовы к поездке.',
 in_trip:'Ваша поездка началась.', completed:'Ваша поездка завершена.', cancelled:'Бронирование отменено.'
};
export async function smsIdempotencyKey(bookingID:string,status:string,phone:string){
 const h=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['iumrah-sms-v2',bookingID,status,phone]))));
 h[6]=(h[6]&15)|64;h[8]=(h[8]&63)|128;
 const s=Array.from(h.slice(0,16),v=>v.toString(16).padStart(2,'0')).join('');
 return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20,32)}`;
}
async function ensure(db:D1Like){
 await db.prepare(`CREATE TABLE IF NOT EXISTS booking_sms_delivery (booking_id TEXT NOT NULL,status TEXT NOT NULL,phone TEXT NOT NULL,result TEXT NOT NULL,provider_id TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(booking_id,status,phone))`).run();
 // Immutable message + UUID are persisted before sending; provider requires the same body on retries.
 await db.prepare(`CREATE TABLE IF NOT EXISTS booking_sms_jobs_v2 (booking_id TEXT NOT NULL,status TEXT NOT NULL,phone TEXT NOT NULL,message TEXT NOT NULL,request_id TEXT NOT NULL,created_at TEXT NOT NULL,next_attempt_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,lease_until TEXT,lease_token TEXT,state TEXT NOT NULL DEFAULT 'pending',provider_id TEXT,last_error TEXT,PRIMARY KEY(booking_id,status,phone))`).run();
 await db.prepare('CREATE INDEX IF NOT EXISTS idx_booking_sms_due_v2 ON booking_sms_jobs_v2(state,next_attempt_at)').run();
}
export async function sendBookingSMSStatus(env:Env,bookingID:string):Promise<string>{
 if(!env.HOTELS_DB||!env.BOOKINGS_DB||!env.DEVSMS_API_TOKEN)return 'not_configured';
 const booking=await env.BOOKINGS_DB.prepare('SELECT status,payload_json,start_date,end_date,traveler_count FROM bookings WHERE id=? LIMIT 1').bind(bookingID).first<{status:string;payload_json:string;start_date:string;end_date:string;traveler_count:number}>();
 if(!booking)return 'skipped';const profile=JSON.parse(booking.payload_json||'{}').pilgrimProfile;
 const phone=String(profile?.phone||'');if(!profile?.phoneVerifiedAt||!/^\+998\d{9}$/.test(phone))return 'skipped';
 const db=env.HOTELS_DB;
 const trip=await db.prepare('SELECT status,booking_number FROM pilgrim_trips WHERE booking_id=? LIMIT 1').bind(bookingID).first<{status:string;booking_number:number}>();
 const status=String(trip?.status||booking.status||'').toLowerCase();const copy=messages[status];if(!copy||!trip?.booking_number)return 'skipped';
 await ensure(db);
 const old=await db.prepare('SELECT result FROM booking_sms_delivery WHERE booking_id=? AND status=? AND phone=?').bind(bookingID,status,phone).first<{result:string}>();
 if(old?.result==='accepted')return 'accepted';
 // Old unknown/sending rows may represent already dispatched SMS. Never blindly resend them with a new key.
 if(old&&['unknown','sending'].includes(old.result)){
  const known=await db.prepare('SELECT request_id FROM booking_sms_jobs_v2 WHERE booking_id=? AND status=? AND phone=?').bind(bookingID,status,phone).first();if(!known)return 'legacy_unknown';
 }
 const now=new Date().toISOString();
 const dates=/^\d{4}-\d{2}-\d{2}$/.test(booking.start_date)&&/^\d{4}-\d{2}-\d{2}$/.test(booking.end_date)?` ${booking.start_date} – ${booking.end_date}. ${booking.traveler_count} чел.`:'';
 const message=`iumrah. №${String(trip.booking_number).padStart(4,'0')}. ${copy}${status==='availability_check'?dates:''} https://iumrah.app/booking`;
 await db.prepare('INSERT OR IGNORE INTO booking_sms_jobs_v2(booking_id,status,phone,message,request_id,created_at,next_attempt_at) VALUES(?,?,?,?,?,?,?)').bind(bookingID,status,phone,message,await smsIdempotencyKey(bookingID,status,phone),now,now).run();
 return deliver(env,bookingID,status,phone);
}
async function deliver(env:Env,bookingID:string,status:string,phone:string):Promise<string>{
 const db=env.HOTELS_DB!,now=new Date().toISOString(),lease=crypto.randomUUID();
 const job=await db.prepare('SELECT * FROM booking_sms_jobs_v2 WHERE booking_id=? AND status=? AND phone=?').bind(bookingID,status,phone).first<{state:string;message:string;request_id:string;attempts:number;created_at:string}>();
 if(!job)return 'skipped';if(job.state!=='pending')return job.state;
 if(Date.parse(job.created_at)<Date.now()-7*86400000||job.attempts>=8){await db.prepare("UPDATE booking_sms_jobs_v2 SET state='expired' WHERE booking_id=? AND status=? AND phone=? AND (lease_until IS NULL OR lease_until<?)").bind(bookingID,status,phone,now).run();return 'expired';}
 const claim=await db.prepare("UPDATE booking_sms_jobs_v2 SET lease_token=?,lease_until=?,attempts=attempts+1 WHERE booking_id=? AND status=? AND phone=? AND state='pending' AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<?)").bind(lease,new Date(Date.now()+120000).toISOString(),bookingID,status,phone,now,now).run();
 if(Number(claim.meta?.changes||0)!==1)return 'pending';
 let result='pending',providerID='',error='';
 try{
  // Revalidate canonical contact and stage; don't send superseded or deleted trip notices.
  const b=await env.BOOKINGS_DB!.prepare('SELECT status,payload_json FROM bookings WHERE id=?').bind(bookingID).first<{status:string;payload_json:string}>();
  const p=b?JSON.parse(b.payload_json).pilgrimProfile:null;
  const trip=await db.prepare('SELECT status FROM pilgrim_trips WHERE booking_id=?').bind(bookingID).first<{status:string}>();
  if(!b||!trip||!p?.phoneVerifiedAt||p.phone!==phone||String(trip.status).toLowerCase()!==status)result='skipped';
  else{
   const response=await fetch('https://devsms.uz/api/v1/sms',{method:'POST',headers:{authorization:`Bearer ${env.DEVSMS_API_TOKEN}`,'content-type':'application/json','Idempotency-Key':job.request_id},signal:AbortSignal.timeout(8000),body:JSON.stringify({phone:phone.slice(1),message:job.message})});
   const payload=await response.json().catch(()=>null) as {success?:boolean;data?:{id?:string|number;sms_id?:string|number;status?:string};error_code?:string;meta?:{sms_id?:number}}|null;
   providerID=String(payload?.data?.id??payload?.data?.sms_id??payload?.meta?.sms_id??'');
   error=String(payload?.error_code||response.status).slice(0,100);
   if(response.ok&&payload?.success===true)result=payload.data?.status==='failed'?'rejected':'accepted';
   else if(response.status===409||response.status===429||response.status>=500||response.status===401||response.status===403)result='pending';
   else result='rejected';
  }
 }catch{error='TRANSPORT_ERROR';}
 const next=new Date(Date.now()+Math.min(60,5*2**Math.min(job.attempts,4))*60000).toISOString();
 await db.prepare('UPDATE booking_sms_jobs_v2 SET state=?,provider_id=?,last_error=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL WHERE booking_id=? AND status=? AND phone=? AND lease_token=?').bind(result,providerID||null,error||null,next,bookingID,status,phone,lease).run();
 if(result==='accepted'||result==='rejected')await db.prepare('INSERT INTO booking_sms_delivery(booking_id,status,phone,result,provider_id,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(booking_id,status,phone) DO UPDATE SET result=excluded.result,provider_id=excluded.provider_id,updated_at=excluded.updated_at').bind(bookingID,status,phone,result,providerID,now).run();
 return result;
}
export async function retryBookingSMSStatuses(env:Env){
 if(!env.HOTELS_DB||!env.BOOKINGS_DB||!env.DEVSMS_API_TOKEN)return;
 const db=env.HOTELS_DB,now=new Date().toISOString();await ensure(db);
 const rows=await db.prepare("SELECT booking_id,status,phone FROM booking_sms_jobs_v2 WHERE state='pending' AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY next_attempt_at LIMIT 10").bind(now,now).all<{booking_id:string;status:string;phone:string}>();
 for(const row of rows.results||[])await deliver(env,row.booking_id,row.status,row.phone).catch(()=>{});
}
