// Secondary booking credentials are scoped to one booking and the verified contact at issuance.
export async function bookingGrantHash(db,id,hash){
 try {
  const row=await db.prepare(`SELECT b.access_token_hash,b.payload_json,g.channel,g.contact FROM booking_device_grants_v3 g JOIN bookings b ON b.id=g.booking_id AND b.access_token_hash=g.primary_hash WHERE g.booking_id=? AND g.token_hash=? AND g.revoked_at IS NULL LIMIT 1`).bind(id,hash).first();
  if(!row)return null;
  const p=JSON.parse(row.payload_json||'{}').pilgrimProfile||{};
  const email=String(p.email||'').trim().toLowerCase(), phone=String(p.phone||'');
  return ((row.channel==='email'&&p.emailVerifiedAt&&email===row.contact)||(row.channel==='sms'&&p.phoneVerifiedAt&&phone===row.contact))?row.access_token_hash:null;
 }catch(e){if(String(e?.message||e).includes('no such table'))return null;throw e;}
}
export async function bookingGrantRead(db,sql,id,hash){
 const primary=await db.prepare(sql).bind(id,hash).first();if(primary)return primary;
 const alternate=await bookingGrantHash(db,id,hash);return alternate?db.prepare(sql).bind(id,alternate).first():null;
}
