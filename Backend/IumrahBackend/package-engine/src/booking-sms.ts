import type { Env } from "./env";
const messages: Record<string,string> = {
 availability_check:'Бронирование создано. Проверяем наличие. Оплата пока не требуется.',
 payment_pending:'Наличие подтверждено. Ожидаем оплату и данные паломников.',
 booking_confirmed:'Оплата подтверждена. Подготавливаем вашу поездку.',
 ready_to_travel:'Документы готовы. Вы готовы к поездке.',
 in_trip:'Ваша поездка началась.', completed:'Ваша поездка завершена.', cancelled:'Бронирование отменено.'
};
export async function sendBookingSMSStatus(env:Env,bookingID:string):Promise<string>{
 if(!env.HOTELS_DB||!env.BOOKINGS_DB||!env.DEVSMS_API_TOKEN)return 'not_configured';
 const booking=await env.BOOKINGS_DB.prepare('SELECT status,payload_json FROM bookings WHERE id=? LIMIT 1').bind(bookingID).first<{status:string;payload_json:string}>();
 if(!booking)return 'skipped';const profile=JSON.parse(booking.payload_json||'{}').pilgrimProfile;
 const phone=String(profile?.phone||'');if(!profile?.phoneVerifiedAt||!/^\+998\d{9}$/.test(phone))return 'skipped';
 const db=env.HOTELS_DB;
 const trip=await db.prepare('SELECT status,booking_number FROM pilgrim_trips WHERE booking_id=? LIMIT 1').bind(bookingID).first<{status:string;booking_number:number}>();
 const status=String(trip?.status||booking.status||'').toLowerCase();const copy=messages[status];if(!copy||!trip?.booking_number)return 'skipped';
 await db.prepare(`CREATE TABLE IF NOT EXISTS booking_sms_delivery (booking_id TEXT NOT NULL,status TEXT NOT NULL,phone TEXT NOT NULL,result TEXT NOT NULL,provider_id TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(booking_id,status,phone))`).run();
 const now=new Date().toISOString();const claim=await db.prepare('INSERT OR IGNORE INTO booking_sms_delivery(booking_id,status,phone,result,updated_at) VALUES(?,?,?,?,?)').bind(bookingID,status,phone,'sending',now).run();
 if(Number(claim.meta?.changes||0)!==1)return 'duplicate_or_pending';
 let result='unknown',providerID='';
 try{const response=await fetch('https://devsms.uz/api/v1/sms',{method:'POST',headers:{authorization:`Bearer ${env.DEVSMS_API_TOKEN}`,'content-type':'application/json','Idempotency-Key':`iumrah-${bookingID}-${status}-${phone.slice(1)}`},signal:AbortSignal.timeout(8000),body:JSON.stringify({phone:phone.slice(1),message:`iumrah. №${String(trip.booking_number).padStart(4,'0')}. ${copy}`})});const payload=await response.json().catch(()=>null) as {success?:boolean;data?:{id?:string|number;sms_id?:string|number};error_code?:string}|null;providerID=String(payload?.data?.id??payload?.data?.sms_id??'');result=response.ok&&payload?.success===true?'accepted':response.status>=500?'unknown':'rejected';}catch{}
 await db.prepare('UPDATE booking_sms_delivery SET result=?,provider_id=?,updated_at=? WHERE booking_id=? AND status=? AND phone=?').bind(result,providerID,new Date().toISOString(),bookingID,status,phone).run();return result;
}
