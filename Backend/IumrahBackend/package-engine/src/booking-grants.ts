import type { D1Like } from './d1';
export async function bookingGrantHash(db:D1Like,id:string,hash:string):Promise<string|null>{
 try {
  const row=await db.prepare(`SELECT b.access_token_hash,b.payload_json,g.channel,g.contact FROM booking_device_grants_v3 g JOIN bookings b ON b.id=g.booking_id AND b.access_token_hash=g.primary_hash WHERE g.booking_id=? AND g.token_hash=? AND g.revoked_at IS NULL LIMIT 1`).bind(id,hash).first<{access_token_hash:string;payload_json:string;channel:string;contact:string}>();
  if(!row)return null;
  const p=JSON.parse(row.payload_json||'{}').pilgrimProfile||{};
  return ((row.channel==='email'&&(p.emailVerifiedAt||p.guestCheckout===true)&&String(p.email||'').trim().toLowerCase()===row.contact)||(row.channel==='sms'&&(p.phoneVerifiedAt||p.guestCheckout===true)&&String(p.phone||'')===row.contact))?row.access_token_hash:null;
 }catch(e){if(String(e instanceof Error?e.message:e).includes('no such table'))return null;throw e;}
}
export async function bookingGrantRead<T>(db:D1Like,sql:string,id:string,hash:string):Promise<T|null>{
 const primary=await db.prepare(sql).bind(id,hash).first<T>();if(primary)return primary;
 const alternate=await bookingGrantHash(db,id,hash);return alternate?db.prepare(sql).bind(id,alternate).first<T>():null;
}
