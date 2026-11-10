// Durable D1 outbox, reusing the existing Business APNs sender and device registry.
import { fingerprint } from './source-sync.js';
const uid=()=>crypto.randomUUID();
export async function recordPriceChange(db,{offerID,previous,next,currency,source,observedAt}) {
 if(previous===next)return false;
 const key=await fingerprint([offerID,previous,next,currency,source,observedAt].join('|'));
 await db.prepare(`INSERT OR IGNORE INTO flight_price_change_outbox
 (id,offer_id,previous_amount_minor,new_amount_minor,currency,source,observed_at,event_fingerprint)
 VALUES(?,?,?,?,?,?,?,?)`).bind(uid(),offerID,previous,next,currency,source,observedAt,key).run();
 return true;
}
export async function priceHistory(request,env) {
 const u=new URL(request.url);
 const key=u.searchParams.get('flight_key')||'';
 if(key.length>170||!(/^[A-Z0-9]{2}\|[A-Z0-9]+\|[A-Z]{3}\|[A-Z]{3}\|\d{4}-\d\d-\d\d$/.test(key)))
  return Response.json({ok:false,error:'INVALID_FLIGHT_KEY'},{status:400});
 const f=await env.FLIGHTS_DB.prepare('SELECT id,flight_key,airline_code,flight_number,origin,destination,departure_date FROM flights WHERE flight_key=?').bind(key).first();
 if(!f)return Response.json({ok:false,error:'NOT_FOUND'},{status:404});
 const offers=await env.FLIGHTS_DB.prepare(`SELECT id,provider,fare_brand,amount_minor,currency,checked_at FROM flight_offers WHERE flight_id=? ORDER BY checked_at DESC LIMIT 50`).bind(f.id).all();
 const observations=await env.FLIGHTS_DB.prepare(`SELECT h.offer_id,h.provider,h.amount_minor,h.currency,h.observed_at FROM price_history h
  JOIN flight_offers o ON o.id=h.offer_id WHERE o.flight_id=? ORDER BY h.observed_at DESC LIMIT 500`).bind(f.id).all();
 const events=await env.FLIGHTS_DB.prepare(`SELECT e.id,e.offer_id,e.previous_amount_minor,e.new_amount_minor,e.currency,e.source,e.observed_at,e.delivery_state
  FROM flight_price_change_outbox e JOIN flight_offers o ON o.id=e.offer_id WHERE o.flight_id=? ORDER BY e.observed_at DESC LIMIT 100`).bind(f.id).all();
 const attempts=await env.FLIGHTS_DB.prepare(`SELECT provider,attempted_at,outcome,message FROM flight_monitor_attempts WHERE flight_key=? ORDER BY attempted_at DESC LIMIT 60`).bind(key).all();
 return Response.json({ok:true,flight:f,offers:offers.results||[],observations:observations.results||[],events:events.results||[],attempts:attempts.results||[]},
  {headers:{'Cache-Control':'no-store'}});
}
export async function deliverPendingPriceEvents(env,{sender,limit=15}={}) {
 const db=env.FLIGHTS_DB;
 if(!sender){
  // No second APNs system: lazy-load exactly the Business sender used by hotel notifications.
  const existing=await import('../../HotelsWorker/src/index.js');
  sender=existing.sendStaffPush;
 }
 const rows=await db.prepare(`SELECT e.id,e.offer_id,e.previous_amount_minor,e.new_amount_minor,e.currency,e.source,e.observed_at,
 f.flight_key,f.airline_code,f.flight_number,f.origin,f.destination,f.departure_date
 FROM flight_price_change_outbox e JOIN flight_offers o ON o.id=e.offer_id JOIN flights f ON f.id=o.flight_id
 LEFT JOIN flight_push_delivery d ON d.event_id=e.id
 WHERE e.delivery_state IN ('pending','failed') AND (d.event_id IS NULL OR julianday(d.lease_until)<julianday('now'))
 ORDER BY e.observed_at ASC LIMIT ?`).bind(Math.min(limit,25)).all();
 let sent=0,failed=0,skipped=0;
 for(const e of rows.results||[]){
  const now=new Date().toISOString(),lease=new Date(Date.now()+3*60_000).toISOString();
  const claim=await db.prepare(`INSERT OR IGNORE INTO flight_push_delivery(event_id,lease_until,attempts,updated_at) VALUES(?,?,1,?)`).bind(e.id,lease,now).run();
  let owned=Number(claim?.meta?.changes||0)>0;
  if(!owned){
   const r=await db.prepare(`UPDATE flight_push_delivery SET lease_until=?,attempts=attempts+1,updated_at=? WHERE event_id=? AND julianday(lease_until)<julianday(?)`)
    .bind(lease,now,e.id,now).run();
   owned=Number(r?.meta?.changes||0)>0;
  }
  if(!owned){skipped++;continue;}
  const fmt=(n)=>`${(n/(e.currency==='UZS'?1:100)).toFixed(e.currency==='UZS'?0:2)} ${e.currency}`;
  const names={centrum:'Centrum Air Bot',uzbekistan:'Uzbekistan Airways Bot',flynas:'Flynas Bot',ignav:'Ignav'};
  const title=`${names[e.source]||e.airline_code} обновил цену`;
  const body=`${e.origin} → ${e.destination} · ${e.departure_date}: ${fmt(e.previous_amount_minor)} → ${fmt(e.new_amount_minor)}`;
  try{
   const result=await sender(env,title,body,{type:'flight_price_changed',flightKey:e.flight_key,eventID:e.id,section:'price_history'});
   if(Number(result?.sent||0)>0){
    await db.prepare("UPDATE flight_price_change_outbox SET delivery_state='delivered' WHERE id=?").bind(e.id).run();
    await db.prepare('UPDATE flight_push_delivery SET last_error=NULL,lease_until=?,updated_at=? WHERE event_id=?').bind('9999-12-31T00:00:00Z',new Date().toISOString(),e.id).run();
    sent++;
   }else{
    await db.prepare("UPDATE flight_price_change_outbox SET delivery_state='failed' WHERE id=?").bind(e.id).run();
    await db.prepare('UPDATE flight_push_delivery SET last_error=?,lease_until=?,updated_at=? WHERE event_id=?')
     .bind(String(result?.skipped||'NOT_DELIVERED').slice(0,150),new Date(Date.now()+60*60_000).toISOString(),new Date().toISOString(),e.id).run();
    failed++;
   }
  }catch(error){
   await db.prepare("UPDATE flight_price_change_outbox SET delivery_state='failed' WHERE id=?").bind(e.id).run();
   await db.prepare('UPDATE flight_push_delivery SET last_error=?,lease_until=?,updated_at=? WHERE event_id=?')
    .bind(String(error.message||error).slice(0,150),new Date(Date.now()+60*60_000).toISOString(),new Date().toISOString(),e.id).run();failed++;
  }
 }
 return {sent,failed,skipped};
}
