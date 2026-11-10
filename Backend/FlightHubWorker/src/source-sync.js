// Normalizes upstream source responses without pretending that cache hints are bookable fares.
// Ignav reference: POST /api/fares/one-way; Aviasales: /aviasales/v3/prices_for_dates.
import {normaliseFlight,normaliseOffer,eligibleFlightDay,validDay,clean} from './core.js';
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const IATA=/^[A-Z]{3}$/;
const CURRENCY=/^[A-Z]{3}$/;
const UZ=new Set(['TAS','FEG','NMA','AZN','SKD','BHK','KSQ','TMJ','UGC']);
const KSA=new Set(['JED','MED','TIF']);
const uid=()=>crypto.randomUUID();
export function validUmrahRoute(origin,destination){return (UZ.has(origin)&&KSA.has(destination))||(KSA.has(origin)&&UZ.has(destination));}
export async function fingerprint(value) {
 const binary=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(value)));
 return [...new Uint8Array(binary)].map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,40);
}
export function moneyMinor(price) {
 const currency=clean(price?.currency);
 const n=Number(price?.amount);
 if(!CURRENCY.test(currency)||!Number.isFinite(n)||n<=0||n>2000000000)return null;
 const factor=['UZS','JPY','KRW'].includes(currency)?1:100;
 const minor=Math.round(n*factor);
 return Number.isSafeInteger(minor)&&minor>0?{amount_minor:minor,currency}:null;
}
function utc(value){return typeof value==='string'&&ISO.test(value)&&/[Zz]|[+-]\d\d:\d\d$/.test(value)&&Number.isFinite(Date.parse(value))?value:null;}
function toNumberFlight(code,num){
 const c=clean(code);const n=clean(num).replace(/[-\s]/g,'');
 return n.startsWith(c)?n:c+n;
}
export function ignavSegments(item) {
 const raw=item?.outbound?.segments;
 if(!Array.isArray(raw)||!raw.length||raw.length>5)return null;
 const segments=[];
 for(const s of raw){
  const code=clean(s.marketing_carrier_code),flight_number=toNumberFlight(code,s.flight_number);
  const origin=clean(s.departure_airport),destination=clean(s.arrival_airport);
  const localDay=String(s.departure_time_local||'').slice(0,10);
  const departure_at=utc(s.departure_time_utc),arrival_at=utc(s.arrival_time_utc);
  try{
   const info=normaliseFlight({airline_code:code,flight_number,origin,destination,departure_date:localDay,departure_at,arrival_at},'ignav');
   if(!departure_at||!arrival_at||Date.parse(arrival_at)<=Date.parse(departure_at))return null;
   segments.push({...info,operating_carrier:s.operating_carrier_name?String(s.operating_carrier_name).slice(0,100):null});
  }catch{return null;}
 }
 if(segments.some((x,i)=>i&& (segments[i-1].destination!==x.origin||Date.parse(x.departure_at)<=Date.parse(segments[i-1].arrival_at))))return null;
 return segments;
}
export function parseIgnavResponse(payload, requested={}) {
 if(!payload||!Array.isArray(payload.itineraries))throw Error('IGNAV_INVALID_RESPONSE');
 const origin=clean(requested.origin||payload.origin),destination=clean(requested.destination||payload.destination);
 const day=String(requested.departure_date||payload.departure_date||'');
 if(!validUmrahRoute(origin,destination)||!eligibleFlightDay(day))throw Error('IGNAV_OUTSIDE_UMRAH_SEARCH_WINDOW');
 const observedAt=utc(payload.observed_at); // Ignav may return null: never invent a source observation time.
 const accepted=[];let skipped=0;
 for(const item of payload.itineraries.slice(0,100)){
  const segments=ignavSegments(item);
  const price=moneyMinor(item.price);
  if(!segments||segments[0].origin!==origin||segments.at(-1).destination!==destination||segments[0].departure_date!==day||
     !price||!observedAt||item.price?.status!=='verified') {skipped++;continue;}
  accepted.push({segments,price,observed_at:observedAt,source_reference:typeof item.ignav_id==='string'?item.ignav_id.slice(0,128):null,
    cabin_class:String(item.cabin_class||'economy').slice(0,64)});
 }
 return {accepted,skipped,source:'ignav'};
}
export function canonicalKey(segments) {return segments.map(s=>s.key).join('>');}
async function ensurePhysicalFlight(db,s,source,observedAt){
 await db.prepare(`INSERT OR IGNORE INTO flights(id,flight_key,airline_code,flight_number,origin,destination,departure_date,departure_at,arrival_at,schedule_source,schedule_observed_at,created_at,updated_at)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(uid(),s.key,s.airline_code,s.flight_number,s.origin,s.destination,s.departure_date,s.departure_at,s.arrival_at,source,observedAt,observedAt,observedAt).run();
 const row=await db.prepare('SELECT id,departure_at,arrival_at FROM flights WHERE flight_key=?').bind(s.key).first();
 if(!row)throw Error('FLIGHT_CREATE_FAILED');
 // Source data only fills missing schedule fields; never silently override curated schedules.
 if(!row.departure_at&&s.departure_at){
  await db.prepare('UPDATE flights SET departure_at=?,arrival_at=?,schedule_source=?,schedule_observed_at=?,updated_at=? WHERE id=?')
   .bind(s.departure_at,s.arrival_at,source,observedAt,observedAt,row.id).run();
 }
 return row.id;
}
export async function importIgnavResponse(db,payload,requested,importDirect) {
 const parsed=parseIgnavResponse(payload,requested);
 let imported=0,duplicate=0,rejected=0;
 for(const quote of parsed.accepted){
  try{
   const segments=quote.segments;
   if(segments.length===1){
    const s=segments[0];
    const record={...s,...quote.price,observed_at:quote.observed_at,fare_brand:quote.cabin_class};
    const outcome=await importDirect(db,record,'ignav',new Date().toISOString());
    if(outcome!=='accepted'){rejected++;continue;}
    if(quote.source_reference){
     const offer=await db.prepare(`SELECT o.id FROM flight_offers o JOIN flights f ON f.id=o.flight_id
        WHERE f.flight_key=? AND o.provider='ignav' AND o.fare_brand=? AND o.currency=?`).bind(s.key,quote.cabin_class,quote.price.currency).first();
     if(offer)await db.prepare(`INSERT INTO flight_ignav_references(offer_id,ignav_id,observed_at) VALUES(?,?,?) ON CONFLICT(offer_id) DO UPDATE SET ignav_id=excluded.ignav_id,observed_at=excluded.observed_at`).bind(offer.id,quote.source_reference,quote.observed_at).run();
    }
    imported++;continue;
   }
   const key='segments:'+await fingerprint(canonicalKey(segments));
   let row=await db.prepare('SELECT id FROM flight_itineraries WHERE itinerary_key=?').bind(key).first();
   const first=segments[0],last=segments.at(-1),now=new Date().toISOString();
   if(!row){
    await db.prepare(`INSERT OR IGNORE INTO flight_itineraries(id,itinerary_key,origin,destination,departure_date,segment_count,stop_count,detail_status,source,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(key,key,first.origin,last.destination,first.departure_date,segments.length,segments.length-1,'complete','ignav',now,now).run();
    row=await db.prepare('SELECT id FROM flight_itineraries WHERE itinerary_key=?').bind(key).first();
   }else duplicate++;
   for(let i=0;i<segments.length;i++){
    const fid=await ensurePhysicalFlight(db,segments[i],'ignav',quote.observed_at);
    await db.prepare('INSERT OR IGNORE INTO flight_itinerary_segments(itinerary_id,segment_order,flight_id,transfer_type) VALUES(?,?,?,?)')
     .bind(row.id,i,fid,'unknown').run();
   }
   const scope='api_observed_not_bookable';
   let offer=await db.prepare(`SELECT id,amount_minor,checked_at FROM flight_itinerary_bundle_offers WHERE itinerary_id=? AND provider='ignav' AND fare_brand=? AND adults=1 AND children=0 AND infants=0 AND currency=?`)
    .bind(row.id,quote.cabin_class,quote.price.currency).first();
   if(!offer){
    await db.prepare(`INSERT OR IGNORE INTO flight_itinerary_bundle_offers(id,itinerary_id,provider,source_reference,fare_brand,amount_minor,currency,price_scope,checked_at,created_at,updated_at)
      VALUES(?,?,'ignav',?,?,?,?,?,?,?,?)`).bind(uid(),row.id,quote.source_reference,quote.cabin_class,quote.price.amount_minor,quote.price.currency,scope,quote.observed_at,now,now).run();
    offer=await db.prepare(`SELECT id,amount_minor,checked_at FROM flight_itinerary_bundle_offers WHERE itinerary_id=? AND provider='ignav' AND fare_brand=? AND adults=1 AND children=0 AND infants=0 AND currency=?`)
     .bind(row.id,quote.cabin_class,quote.price.currency).first();
    await db.prepare('INSERT INTO flight_itinerary_bundle_history(id,bundle_offer_id,amount_minor,currency,observed_at,provider) VALUES(?,?,?,?,?,?)')
     .bind(uid(),offer.id,quote.price.amount_minor,quote.price.currency,quote.observed_at,'ignav').run();
   }else if(Date.parse(offer.checked_at)<=Date.parse(quote.observed_at)){
    if(offer.amount_minor!==quote.price.amount_minor){
     await db.prepare('INSERT INTO flight_itinerary_bundle_history(id,bundle_offer_id,amount_minor,currency,observed_at,provider) VALUES(?,?,?,?,?,?)')
      .bind(uid(),offer.id,quote.price.amount_minor,quote.price.currency,quote.observed_at,'ignav').run();
    }
    await db.prepare(`UPDATE flight_itinerary_bundle_offers SET amount_minor=?,checked_at=?,source_reference=?,updated_at=? WHERE id=?`)
     .bind(quote.price.amount_minor,quote.observed_at,quote.source_reference,now,offer.id).run();
   }
   imported++;
  }catch(error){rejected++;console.error('IGNAV_ITINERARY_REJECTED',String(error.message).slice(0,120));}
 }
 return {imported,duplicate,rejected,skipped:parsed.skipped};
}
function aviaRecords(payload){
 const data=payload?.data??payload;
 return Array.isArray(data)?data:(data&&typeof data==='object'?Object.values(data).flatMap(x=>Array.isArray(x)?x:[x]):[]);
}
export function parseAviasales(payload){
 const records=[];
 for(const raw of aviaRecords(payload).slice(0,250)){
  if(!raw||typeof raw!=='object')continue;
  const origin=clean(raw.origin_airport||raw.origin),destination=clean(raw.destination_airport||raw.destination);
  const depart=utc(raw.departure_at),date=String(raw.departure_at||'').slice(0,10);
  if(!validUmrahRoute(origin,destination)||!eligibleFlightDay(date))continue;
  const transfers=Number(raw.transfers??raw.number_of_changes??0);
  if(!Number.isInteger(transfers)||transfers<0||transfers>5)continue;
  const currency=clean(raw.currency||payload?.currency||'USD');
  const amount=Number(raw.price),money=moneyMinor({amount,currency});
  const foundAt=utc(raw.found_at)||utc(payload?.observed_at)||new Date().toISOString();
  const sourceExpired=utc(raw.expires_at);
  const expiresAt=new Date(Math.min(Date.parse(foundAt)+48*3600000,sourceExpired?Date.parse(sourceExpired):Infinity)).toISOString();
  if(Date.parse(expiresAt)<=Date.now())continue;
  const airline=clean(raw.airline),flightNumber=toNumberFlight(airline,raw.flight_number);
  let knownFlightKey=null;
  if(transfers===0){
   try{knownFlightKey=normaliseFlight({airline_code:airline,flight_number:flightNumber,origin,destination,departure_date:date},'ignav').key;}catch{}
  }
  records.push({origin,destination,departure_date:date,transfer_count:transfers,raw_price_minor:money?.amount_minor??null,currency:money?.currency??null,
    observed_at:foundAt,expires_at:expiresAt,airline:airline||null,flight_number:raw.flight_number||null,
    departure_at:depart,known_flight_key:knownFlightKey,detail_status:'needs_confirmation',duration_minutes:Number.isInteger(raw.duration)?raw.duration:null,
    // Only source-documented URL path. Never convert price-cache link into booking confirmation.
    source_link:typeof raw.link==='string'&&raw.link.startsWith('/search/')?raw.link.slice(0,1000):null});
 }
 return records;
}
export async function importAviasalesCache(db,payload) {
 const rows=parseAviasales(payload),at=new Date().toISOString();let stored=0,linked=0;
 for(const row of rows){
  let itineraryID=null;
  if(row.known_flight_key){
   const f=await db.prepare('SELECT id FROM flights WHERE flight_key=?').bind(row.known_flight_key).first();
   if(f){const i=await db.prepare('SELECT id FROM flight_itineraries WHERE id=?').bind('direct:'+f.id).first();if(i)itineraryID=i.id;}
  }
  // For a connecting result, link ONLY when independently verified segment identity
  // yields exactly one matching whole itinerary. Never infer intermediate airports
  // or join on route + date alone: many different connections share those fields.
  if(!itineraryID && row.transfer_count>0 && row.airline && row.flight_number && row.departure_at){
   const firstNumber=toNumberFlight(row.airline,row.flight_number);
   const matches=await db.prepare(`SELECT DISTINCT i.id,f.departure_at
     FROM flight_itineraries i
     JOIN flight_itinerary_segments s ON s.itinerary_id=i.id AND s.segment_order=0
     JOIN flights f ON f.id=s.flight_id
     WHERE i.origin=? AND i.destination=? AND i.departure_date=? AND i.stop_count=?
       AND f.airline_code=? AND f.flight_number=? AND f.departure_at IS NOT NULL
     LIMIT 20`).bind(row.origin,row.destination,row.departure_date,row.transfer_count,row.airline,firstNumber).all();
   const exact=(matches.results||[]).filter(m=>Math.abs(Date.parse(m.departure_at)-Date.parse(row.departure_at))<=10*60*1000);
   if(exact.length===1)itineraryID=exact[0].id;
  }
  const hash=await fingerprint([row.origin,row.destination,row.departure_date,row.airline,row.flight_number,row.departure_at,row.transfer_count].join('|'));
  const detail=JSON.stringify({airline:row.airline,flight_number:row.flight_number,departure_at:row.departure_at,duration_minutes:row.duration_minutes,source_link:row.source_link,price_status:'cached_not_confirmed',source:'aviasales_data'});
  const id='avia:'+hash;
  await db.prepare(`INSERT INTO flight_discovery_cache(source,discovery_key,origin,destination,departure_date,transfer_count,raw_price_minor,currency,observed_at,expires_at,segment_details_complete,linked_itinerary_id)
    VALUES('aviasales_data',?,?,?,?,?,?,?,?,?,0,?) ON CONFLICT(source,discovery_key) DO UPDATE SET raw_price_minor=excluded.raw_price_minor,currency=excluded.currency,observed_at=excluded.observed_at,expires_at=excluded.expires_at,linked_itinerary_id=excluded.linked_itinerary_id
    WHERE excluded.observed_at>=flight_discovery_cache.observed_at`).bind(id,row.origin,row.destination,row.departure_date,row.transfer_count,row.raw_price_minor,row.currency,row.observed_at,row.expires_at,itineraryID).run();
  await db.prepare(`INSERT INTO flight_discovery_details(source,discovery_key,route_signature,quality,details_json,received_at)
   VALUES('aviasales_data',?,NULL,'partial',?,?) ON CONFLICT(source,discovery_key) DO UPDATE SET details_json=excluded.details_json,received_at=excluded.received_at`).bind(id,detail,at).run();
  stored++;if(itineraryID)linked++;
 }
 return {stored,linked,skipped:Math.max(0,aviaRecords(payload).length-rows.length)};
}
