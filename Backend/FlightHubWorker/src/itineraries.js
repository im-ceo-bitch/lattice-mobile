// Versioned, read-only itinerary API for iumrah-backend.
// Existing /v1/public/flights contract and flight IDs remain unchanged.
import { publicOfferIsFresh } from './core.js';

const json = (body, code=200) => new Response(JSON.stringify(body), {status:code,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const isIata = s => /^[A-Z]{3}$/.test(s);
const isoDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);

export function presentationStatus(itinerary, segments) {
  if (!segments?.length || segments.length !== Number(itinerary.segment_count)) return 'needs_confirmation';
  if (segments.some(s => !s.departure_at || !s.arrival_at || !s.flight_number || !s.origin || !s.destination)) return 'needs_confirmation';
  if (segments[0].origin !== itinerary.origin || segments.at(-1).destination !== itinerary.destination) return 'needs_confirmation';
  if (segments.some(s => !Number.isFinite(Date.parse(s.departure_at)) || !Number.isFinite(Date.parse(s.arrival_at)) || Date.parse(s.arrival_at)<=Date.parse(s.departure_at))) return 'needs_confirmation';
  for (let i=1; i<segments.length; i++) {
    if (segments[i-1].destination !== segments[i].origin) return 'needs_confirmation';
    if (Date.parse(segments[i].departure_at) <= Date.parse(segments[i-1].arrival_at)) return 'needs_confirmation';
  }
  return 'complete';
}
export function presentItinerary(row,segments,offers) {
  return {
    id:row.id, origin:row.origin, destination:row.destination,
    departure_date:row.departure_date, stop_count:row.stop_count,
    segment_count:row.segment_count, detail_status:presentationStatus(row,segments),
    segments:segments.map(s=>({order:s.segment_order,airline_code:s.airline_code,
      flight_number:s.flight_number,operating_carrier:s.operating_carrier||null,
      origin:s.origin,destination:s.destination,departure_at:s.departure_at,arrival_at:s.arrival_at,
      transfer_type:s.transfer_type||'unknown'})),
    offers:offers.map(o=>({provider:o.provider,fare_brand:o.fare_brand,adults:o.adults,
      children:o.children,infants:o.infants,amount_minor:o.amount_minor,currency:o.currency,
      price_scope:o.price_scope,checked_at:o.checked_at,expires_at:o.expires_at,
      fresh:publicOfferIsFresh(o),baggage_checked_kg:o.baggage_checked_kg,
      baggage_cabin_kg:o.baggage_cabin_kg,seats_left:o.seats_left,source_url:o.source_url})),
    // This endpoint never treats Aviasales cache hints as purchasable offers.
  };
}
async function detail(db,row) {
  const s=await db.prepare(`SELECT s.segment_order,s.transfer_type,
    f.airline_code,f.flight_number,f.origin,f.destination,f.departure_at,f.arrival_at
    FROM flight_itinerary_segments s JOIN flights f ON f.id=s.flight_id
    WHERE s.itinerary_id=? ORDER BY s.segment_order`).bind(row.id).all();
  const o=await db.prepare(`SELECT o.provider,o.fare_brand,o.adults,o.children,o.infants,
    o.amount_minor,o.currency,o.price_scope,o.checked_at,o.expires_at,o.baggage_checked_kg,
    o.baggage_cabin_kg,o.seats_left,o.source_url
    FROM flight_itinerary_offers link JOIN flight_offers o ON o.id=link.offer_id
    WHERE link.itinerary_id=? ORDER BY o.checked_at DESC LIMIT 30`).bind(row.id).all();
  const b=await db.prepare(`SELECT provider,fare_brand,adults,children,infants,amount_minor,currency,
     price_scope,checked_at,expires_at,source_reference FROM flight_itinerary_bundle_offers
     WHERE itinerary_id=? ORDER BY checked_at DESC LIMIT 20`).bind(row.id).all();
  const value=presentItinerary(row,s.results||[],o.results||[]);
  value.offers.push(...(b.results||[]).map(x=>({...x,fresh:publicOfferIsFresh(x),offer_type:'whole_itinerary',
    baggage_checked_kg:null,baggage_cabin_kg:null,seats_left:null,source_url:null})));
  return value;
}
export async function listItineraries(request,env) {
  const u=new URL(request.url), origin=(u.searchParams.get('origin')||'').trim().toUpperCase();
  const destination=(u.searchParams.get('destination')||'').trim().toUpperCase();
  const date=(u.searchParams.get('date')||'').trim();
  if (origin && !isIata(origin) || destination && !isIata(destination) || date && !isoDate(date))
    return json({ok:false,error:'INVALID_QUERY'},400);
  const limit=Math.min(50,Math.max(1,Number.parseInt(u.searchParams.get('limit')||'20',10)||20));
  const page=Math.min(1000,Math.max(0,Number.parseInt(u.searchParams.get('page')||'0',10)||0));
  // Segment flights on a connection (for example TAS->DOH) are physical flights,
  // not complete bookable Uzbekistan/Saudi itineraries. Never expose them alone.
  let where=`departure_date BETWEEN date('now','+5 hours') AND date('now','+5 hours','+30 days')
    AND ((origin IN ('TAS','FEG','NMA','AZN','SKD','BHK','KSQ','TMJ','UGC') AND destination IN ('JED','MED','TIF'))
      OR (destination IN ('TAS','FEG','NMA','AZN','SKD','BHK','KSQ','TMJ','UGC') AND origin IN ('JED','MED','TIF')))`;
  const args=[];
  if (origin) {where+=' AND origin=?';args.push(origin);}
  if (destination) {where+=' AND destination=?';args.push(destination);}
  if (date) {where+=' AND departure_date=?';args.push(date);}
  const count=await env.FLIGHTS_DB.prepare(`SELECT count(*) AS total FROM flight_itineraries WHERE ${where}`).bind(...args).first();
  const data=await env.FLIGHTS_DB.prepare(`SELECT * FROM flight_itineraries WHERE ${where} ORDER BY departure_date,id LIMIT ? OFFSET ?`).bind(...args,limit,page*limit).all();
  const itineraries=[];
  for (const row of data.results||[]) itineraries.push(await detail(env.FLIGHTS_DB,row));
  // Combined public catalog remains backward compatible: existing consumers use itineraries;
  // updated consumers read `catalog` containing both real itineraries and optional hints.
  const discoveryResponse=await listDiscoveries(new Request(u.toString()),env);
  const discoveryBody=discoveryResponse.ok?await discoveryResponse.json():{discoveries:[]};
  const discoveries=discoveryBody.discoveries||[];
  return json({ok:true,itineraries,discoveries,catalog:[...itineraries.map(x=>({...x,kind:'itinerary'})),...discoveries],
   page,limit,total:count?.total||0,has_more:(page+1)*limit<(count?.total||0)});
}
export async function getItinerary(_request,env,id) {
  if (!id || id.length>128 || !/^[a-zA-Z0-9:._-]+$/.test(id)) return json({ok:false,error:'INVALID_ID'},400);
  const row=await env.FLIGHTS_DB.prepare('SELECT * FROM flight_itineraries WHERE id=?').bind(id).first();
  if (!row) return json({ok:false,error:'NOT_FOUND'},404);
  return json({ok:true,itinerary:await detail(env.FLIGHTS_DB,row)});
}

// Cached search hints share the catalog search filters but never masquerade as full offers.
export async function listDiscoveries(request,env) {
  const u=new URL(request.url),origin=(u.searchParams.get('origin')||'').trim().toUpperCase();
  const destination=(u.searchParams.get('destination')||'').trim().toUpperCase();
  const date=(u.searchParams.get('date')||'').trim();
  if(origin&&!isIata(origin)||destination&&!isIata(destination)||date&&!isoDate(date))return json({ok:false,error:'INVALID_QUERY'},400);
  let where="c.source='aviasales_data' AND julianday(c.expires_at)>julianday('now') AND c.departure_date BETWEEN date('now','+5 hours') AND date('now','+5 hours','+30 days') AND c.linked_itinerary_id IS NULL";
  const binds=[];
  if(origin){where+=' AND c.origin=?';binds.push(origin);}
  if(destination){where+=' AND c.destination=?';binds.push(destination);}
  if(date){where+=' AND c.departure_date=?';binds.push(date);}
  const limit=Math.min(50,Math.max(1,Number(u.searchParams.get('limit')||20)||20));
  const page=Math.min(100,Math.max(0,Number(u.searchParams.get('page')||0)||0));
  const r=await env.FLIGHTS_DB.prepare(`SELECT c.discovery_key,c.origin,c.destination,c.departure_date,c.transfer_count,
    c.raw_price_minor,c.currency,c.observed_at,c.expires_at,d.details_json,d.quality
    FROM flight_discovery_cache c LEFT JOIN flight_discovery_details d ON d.source=c.source AND d.discovery_key=c.discovery_key
    WHERE ${where} ORDER BY c.departure_date,c.observed_at DESC LIMIT ? OFFSET ?`).bind(...binds,limit,page*limit).all();
  const result=(r.results||[]).map(v=>{
   let details={};try{details=JSON.parse(v.details_json||'{}');}catch{}
   return {id:v.discovery_key,kind:'discovery',origin:v.origin,destination:v.destination,
     departure_date:v.departure_date,stop_count:v.transfer_count,segment_count:null,detail_status:'needs_confirmation',
     airline_code:details.airline||null,flight_number:details.flight_number||null,
     departure_at:details.departure_at||null,arrival_at:null,duration_minutes:details.duration_minutes||null,
     source:'aviasales_data',source_link:details.source_link||null,
     indicative_price_minor:v.raw_price_minor,currency:v.currency,observed_at:v.observed_at,expires_at:v.expires_at,
     price_status:'cached_not_confirmed',offers:[],segments:[]};
  });
  return json({ok:true,discoveries:result,page,limit});
}
