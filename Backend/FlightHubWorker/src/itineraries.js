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
  return presentItinerary(row,s.results||[],o.results||[]);
}
export async function listItineraries(request,env) {
  const u=new URL(request.url), origin=(u.searchParams.get('origin')||'').trim().toUpperCase();
  const destination=(u.searchParams.get('destination')||'').trim().toUpperCase();
  const date=(u.searchParams.get('date')||'').trim();
  if (origin && !isIata(origin) || destination && !isIata(destination) || date && !isoDate(date))
    return json({ok:false,error:'INVALID_QUERY'},400);
  const limit=Math.min(50,Math.max(1,Number.parseInt(u.searchParams.get('limit')||'20',10)||20));
  const page=Math.min(1000,Math.max(0,Number.parseInt(u.searchParams.get('page')||'0',10)||0));
  let where="departure_date BETWEEN date('now','+5 hours') AND date('now','+5 hours','+30 days')";
  const args=[];
  if (origin) {where+=' AND origin=?';args.push(origin);}
  if (destination) {where+=' AND destination=?';args.push(destination);}
  if (date) {where+=' AND departure_date=?';args.push(date);}
  const count=await env.FLIGHTS_DB.prepare(`SELECT count(*) AS total FROM flight_itineraries WHERE ${where}`).bind(...args).first();
  const data=await env.FLIGHTS_DB.prepare(`SELECT * FROM flight_itineraries WHERE ${where} ORDER BY departure_date,id LIMIT ? OFFSET ?`).bind(...args,limit,page*limit).all();
  const itineraries=[];
  for (const row of data.results||[]) itineraries.push(await detail(env.FLIGHTS_DB,row));
  return json({ok:true,itineraries,page,limit,total:count?.total||0,has_more:(page+1)*limit<(count?.total||0)});
}
export async function getItinerary(_request,env,id) {
  if (!id || id.length>128 || !/^[a-zA-Z0-9:._-]+$/.test(id)) return json({ok:false,error:'INVALID_ID'},400);
  const row=await env.FLIGHTS_DB.prepare('SELECT * FROM flight_itineraries WHERE id=?').bind(id).first();
  if (!row) return json({ok:false,error:'NOT_FOUND'},404);
  return json({ok:true,itinerary:await detail(env.FLIGHTS_DB,row)});
}
