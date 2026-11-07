import { AIRLINES, BOT_PROVIDERS, normaliseFlight, normaliseOffer, allowCreateFlight, needsPrice, publicOfferIsFresh, sanitiseError } from './core.js';
import { fetchAeroCandidate } from './aerodatabox.js';

const json = (body, code = 200) => new Response(JSON.stringify(body), { status: code, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const noCache = response => response;
const nowISO = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
function bearer(request, value) {
  const provided = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!value || !provided || provided.length !== value.length) return false;
  let diff = 0; for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ value.charCodeAt(i);
  return diff === 0;
}
function tokenFor(provider, env) {
  if (provider === 'ignav') return env.IGNAV_INGEST_TOKEN;
  if (provider === 'aerodatabox') return env.AERODATABOX_INGEST_TOKEN;
  if (BOT_PROVIDERS.has(provider)) return env.BOT_INGEST_TOKEN;
  if (provider === 'legacy_import') return env.ADMIN_TOKEN;
  return undefined;
}
function preview(value, length = 90) { return String(value ?? '').slice(0, length); }

async function importRecord(db, raw, provider, checkedAt) {
  const identity = normaliseFlight(raw, provider);
  let row = await db.prepare('SELECT id,departure_at,arrival_at FROM flights WHERE flight_key=?').bind(identity.key).first();
  if (!row && !allowCreateFlight(provider)) {
    await db.prepare(`INSERT INTO unmatched_observations(id,provider,flight_key,airline_code,flight_number,origin,destination,departure_date,reason,observed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(uid(),provider,identity.key,identity.airline_code,identity.flight_number,identity.origin,identity.destination,identity.departure_date,'NO_MASTER_FLIGHT',checkedAt).run();
    return 'unmatched';
  }
  if (!row) {
    const id = uid();
    await db.prepare(`INSERT OR IGNORE INTO flights(id,flight_key,airline_code,flight_number,origin,destination,departure_date,departure_at,arrival_at,schedule_source,schedule_observed_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, identity.key, identity.airline_code, identity.flight_number, identity.origin,
      identity.destination, identity.departure_date, identity.departure_at, identity.arrival_at,
      identity.departure_at ? provider : null, identity.departure_at ? checkedAt : null, checkedAt, checkedAt).run();
    row = await db.prepare('SELECT id,departure_at,arrival_at FROM flights WHERE flight_key=?').bind(identity.key).first();
  }
  // ADB enriches schedule; price bot/ignav cannot silently override an existing schedule.
  if (provider === 'aerodatabox' && identity.departure_at) {
    await db.prepare(`UPDATE flights SET departure_at=?,arrival_at=COALESCE(?,arrival_at),schedule_source='aerodatabox',schedule_observed_at=?,updated_at=? WHERE id=?`)
      .bind(identity.departure_at, identity.arrival_at,checkedAt,checkedAt,row.id).run();
  } else if (!row.departure_at && identity.departure_at) {
    await db.prepare(`UPDATE flights SET departure_at=?,arrival_at=?,schedule_source=?,schedule_observed_at=?,updated_at=? WHERE id=?`)
      .bind(identity.departure_at,identity.arrival_at,provider,checkedAt,checkedAt,row.id).run();
  }
  if (provider === 'aerodatabox' && raw.operational_status) {
    await db.prepare('UPDATE flights SET operational_status=?,operational_observed_at=?,updated_at=? WHERE id=?')
      .bind(preview(raw.operational_status,50),checkedAt,checkedAt,row.id).run();
  }
  if (!needsPrice(provider) && raw.amount_minor == null) return 'accepted';
  const fare = normaliseOffer(raw, provider, checkedAt);
  let offer = await db.prepare(`SELECT id,amount_minor,checked_at FROM flight_offers WHERE flight_id=? AND provider=? AND fare_brand=? AND adults=? AND children=? AND infants=? AND currency=?`)
    .bind(row.id,provider,fare.fare_brand,fare.adults,fare.children,fare.infants,fare.currency).first();
  // Older observations must never roll back the latest price.
  if (offer && Date.parse(offer.checked_at) > Date.parse(fare.checked_at)) return 'accepted';
  if (!offer) {
    await db.prepare(`INSERT OR IGNORE INTO flight_offers(id,flight_id,provider,fare_brand,adults,children,infants,amount_minor,currency,price_scope,checked_at,expires_at,baggage_checked_kg,baggage_cabin_kg,seats_left,source_url,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(uid(),row.id,provider,fare.fare_brand,fare.adults,fare.children,fare.infants,
       fare.amount_minor,fare.currency,fare.price_scope,fare.checked_at,null,fare.baggage_checked_kg,fare.baggage_cabin_kg,
       fare.seats_left,fare.source_url,checkedAt,checkedAt).run();
    offer = await db.prepare(`SELECT id,amount_minor,checked_at FROM flight_offers WHERE flight_id=? AND provider=? AND fare_brand=? AND adults=? AND children=? AND infants=? AND currency=?`)
      .bind(row.id,provider,fare.fare_brand,fare.adults,fare.children,fare.infants,fare.currency).first();
    await db.prepare('INSERT INTO price_history(id,offer_id,amount_minor,currency,observed_at,provider) VALUES(?,?,?,?,?,?)')
      .bind(uid(),offer.id,fare.amount_minor,fare.currency,fare.checked_at,provider).run();
  } else {
    if (offer.amount_minor !== fare.amount_minor) {
      await db.prepare('INSERT INTO price_history(id,offer_id,amount_minor,currency,observed_at,provider) VALUES(?,?,?,?,?,?)')
        .bind(uid(),offer.id,fare.amount_minor,fare.currency,fare.checked_at,provider).run();
    }
    await db.prepare(`UPDATE flight_offers SET amount_minor=?,price_scope=?,checked_at=?,baggage_checked_kg=?,baggage_cabin_kg=?,seats_left=?,source_url=?,updated_at=? WHERE id=?`)
      .bind(fare.amount_minor,fare.price_scope,fare.checked_at,fare.baggage_checked_kg,fare.baggage_cabin_kg,
        fare.seats_left,fare.source_url,checkedAt,offer.id).run();
  }
  return 'accepted';
}

async function ingest(request, env, provider) {
  if (!tokenFor(provider,env)) return json({ok:false,error:'SOURCE_NOT_CONFIGURED'},503);
  if (!bearer(request,tokenFor(provider,env))) return json({ok:false,error:'UNAUTHORIZED'},401);
  if (Number(request.headers.get('Content-Length') || 0) > 1000000) return json({ok:false,error:'REQUEST_TOO_LARGE'},413);
  let payload;
  try { payload = await request.json(); } catch { return json({ok:false,error:'INVALID_JSON'},400); }
  if (!payload || !Array.isArray(payload.records) || payload.records.length > 100 ||
    (payload.records.length === 0 && !['ok','blocked','failed','site_changed','no_verified_fares','no_tasks'].includes(payload.status))) {
    return json({ok:false,error:'INVALID_RECORDS'},400);
  }
  const date = nowISO();
  let accepted=0, unmatched=0, rejected=0;
  const errors=[];
  for (const entry of payload.records) {
    try {
      const outcome = await importRecord(env.FLIGHTS_DB,entry,provider,date);
      if (outcome === 'accepted') accepted++; else unmatched++;
    } catch (e) { rejected++; if (errors.length < 5) errors.push(sanitiseError(e)); }
  }
  const status = ['blocked','failed','site_changed','no_verified_fares','no_tasks'].includes(payload.status) ? payload.status : rejected ? 'partial' : 'ok';
  await env.FLIGHTS_DB.prepare('INSERT INTO monitor_runs(id,provider,checked_at,status,accepted,unmatched,rejected,message) VALUES(?,?,?,?,?,?,?,?)')
    .bind(uid(),provider,date,status,accepted,unmatched,rejected,
      preview(payload.message || errors.join('; '),280)).run();
  return json({ok:rejected===0,provider,accepted,unmatched,rejected,errors,status},rejected?207:200);
}
async function tasks(request, env) {
  if (!env.BOT_INGEST_TOKEN) return json({ok:false,error:'NOT_CONFIGURED'},503);
  if (!bearer(request,env.BOT_INGEST_TOKEN)) return json({ok:false,error:'UNAUTHORIZED'},401);
  const url = new URL(request.url);
  const provider = url.searchParams.get('provider') || '';
  const code = Object.keys(AIRLINES).find(k => AIRLINES[k]===provider);
  if (!code) return json({ok:false,error:'INVALID_AIRLINE'},400);
  const limit = Math.min(35,Math.max(1,Number.parseInt(url.searchParams.get('limit') || '14',10) || 14));
  const sql = `SELECT f.airline_code,f.flight_number,f.origin,f.destination,f.departure_date,
        MAX(o.checked_at) AS last_price_check
      FROM flights f LEFT JOIN flight_offers o ON o.flight_id=f.id AND o.provider=?
      WHERE f.airline_code=? AND f.departure_date > date('now','+5 hours') AND f.departure_date <= date('now','+5 hours','+30 days')
      AND ((f.origin IN ('TAS','FEG','NMA','AZN','SKD','BHK','KSQ','TMJ','UGC') AND f.destination IN ('JED','MED','TIF'))
       OR (f.destination IN ('TAS','FEG','NMA','AZN','SKD','BHK','KSQ','TMJ','UGC') AND f.origin IN ('JED','MED','TIF')))
      GROUP BY f.id ORDER BY CASE WHEN last_price_check IS NULL THEN 0 ELSE 1 END,last_price_check ASC,f.departure_date ASC LIMIT ?`;
  const result = await env.FLIGHTS_DB.prepare(sql).bind(provider,code,limit).all();
  return json({ok:true,provider,tasks:result.results || [],count:(result.results || []).length});
}
async function publicStatus(env) {
  const counts = await env.FLIGHTS_DB.prepare(`SELECT
    (SELECT COUNT(*) FROM flights WHERE departure_date >= date('now')) AS flights,
    (SELECT COUNT(*) FROM flight_offers) AS offers,
    (SELECT COUNT(*) FROM unmatched_observations) AS unmatched`).first();
  const last = await env.FLIGHTS_DB.prepare(`SELECT provider,checked_at,status,accepted,unmatched,rejected,message FROM monitor_runs
    WHERE id IN (SELECT id FROM (SELECT id,ROW_NUMBER() OVER(PARTITION BY provider ORDER BY checked_at DESC) AS rank FROM monitor_runs) WHERE rank=1)
    ORDER BY provider`).all();
  const sources = ['ignav','aerodatabox','centrum','uzbekistan','flynas'].map(name => ({
    name, configured: name === 'ignav' ? Boolean(env.IGNAV_INGEST_TOKEN) : name === 'aerodatabox' ? Boolean(env.AERODATABOX_INGEST_TOKEN) : Boolean(env.BOT_INGEST_TOKEN),
    last_run: (last.results || []).find(r=>r.provider===name) || null
  }));
  return json({ok:true,service:'iumrah-flight-hub',counts,sources,generated_at:nowISO(),ready:true});
}
async function publicFlights(request,env) {
  const u=new URL(request.url);
  const origin=(u.searchParams.get('origin')||'').trim().toUpperCase(), destination=(u.searchParams.get('destination')||'').trim().toUpperCase();
  const limit=Math.min(100,Math.max(1,parseInt(u.searchParams.get('limit')||'40',10)||40));
  const date = u.searchParams.get('date') || '';
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ok:false,error:'INVALID_DATE'},400);
  let where=`f.departure_date>=date('now','+5 hours') AND f.departure_date<=date('now','+5 hours','+30 days')`;
  const bind=[];
  if (date) { where+=' AND f.departure_date=?'; bind.push(date); }
  if (origin && /^[A-Z]{3}$/.test(origin)) { where+=' AND f.origin=?'; bind.push(origin); }
  if (destination && /^[A-Z]{3}$/.test(destination)) { where+=' AND f.destination=?'; bind.push(destination); }
  const flights = await env.FLIGHTS_DB.prepare(`SELECT f.* FROM flights f WHERE ${where} ORDER BY f.departure_date,f.departure_at LIMIT ?`).bind(...bind,limit).all();
  const data = [];
  for (const f of flights.results||[]) {
    const rows=await env.FLIGHTS_DB.prepare(`SELECT provider, fare_brand,amount_minor,currency,checked_at,adults,children,infants,
      price_scope,baggage_checked_kg,baggage_cabin_kg,seats_left FROM flight_offers WHERE flight_id=? ORDER BY checked_at DESC LIMIT 15`).bind(f.id).all();
    const offers=(rows.results||[]).map(o=>({...o, fresh:publicOfferIsFresh(o)}));
    data.push({flight_key:f.flight_key,airline_code:f.airline_code,flight_number:f.flight_number,origin:f.origin,destination:f.destination,
      departure_date:f.departure_date,departure_at:f.departure_at,arrival_at:f.arrival_at,schedule_source:f.schedule_source,operational_status:f.operational_status,offers});
  }
  return json({ok:true,flights:data,generated_at:nowISO()});
}
async function refreshAeroDataBox(request,env) {
  if (!env.ADMIN_TOKEN || !bearer(request,env.ADMIN_TOKEN)) return json({ok:false,error:'UNAUTHORIZED'},401);
  if (!env.AERODATABOX_RAPIDAPI_KEY) return json({ok:false,error:'AERODATABOX_API_KEY_MISSING'},503);
  const body=await request.json().catch(()=>({}));
  const limit=Math.min(10,Math.max(1,Number.parseInt(body.limit || 3,10)||3));
  const rows=await env.FLIGHTS_DB.prepare(`SELECT airline_code,flight_number,origin,destination,departure_date FROM flights
    WHERE departure_date BETWEEN date('now','+5 hours') AND date('now','+5 hours','+30 days')
    ORDER BY COALESCE(schedule_observed_at,'') ASC,departure_date ASC LIMIT ?`).bind(limit).all();
  const results=[];
  for(const flight of rows.results || []) {
    try {
      const candidate=await fetchAeroCandidate(flight,env.AERODATABOX_RAPIDAPI_KEY);
      if (!candidate) {results.push({flight_number:flight.flight_number,match:false});continue;}
      const result=await importRecord(env.FLIGHTS_DB,candidate,'aerodatabox',nowISO());
      results.push({flight_number:flight.flight_number,match:true,result});
    } catch (error) {results.push({flight_number:flight.flight_number,error:sanitiseError(error)});}
  }
  await env.FLIGHTS_DB.prepare('INSERT INTO monitor_runs(id,provider,checked_at,status,accepted,unmatched,rejected,message) VALUES(?,?,?,?,?,?,?,?)')
    .bind(uid(),'aerodatabox',nowISO(),results.some(x=>x.error)?'partial':'ok',results.filter(x=>x.match).length,0,results.filter(x=>x.error).length,'manual refresh').run();
  return json({ok:true,results});
}
async function adminStats(request,env) {
  if (!env.ADMIN_TOKEN || !bearer(request,env.ADMIN_TOKEN)) return json({ok:false,error:'UNAUTHORIZED'},401);
  const unmatched=await env.FLIGHTS_DB.prepare('SELECT provider,airline_code,flight_number,origin,destination,departure_date,reason,observed_at FROM unmatched_observations ORDER BY observed_at DESC LIMIT 60').all();
  return json({ok:true,unmatched:unmatched.results||[]});
}
// Only these public web applications may read the public catalog from browsers.
// Native iOS/Android callers do not require Access-Control-Allow-Origin.
const ALLOWED_PUBLIC_ORIGINS = new Set([
  'https://iumrah.app', 'https://www.iumrah.app',
  'https://iumrah.uz', 'https://www.iumrah.uz',
  'https://iumrahproject.com', 'https://www.iumrahproject.com'
]);
function addCORS(request, response) {
  const origin = request.headers.get('Origin');
  if (!origin || !ALLOWED_PUBLIC_ORIGINS.has(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Vary', 'Origin');
  headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  headers.set('Access-Control-Max-Age', '600');
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request,env) {
    if (request.method==='OPTIONS') {
      const origin = request.headers.get('Origin');
      if (!origin || !ALLOWED_PUBLIC_ORIGINS.has(origin)) return new Response(null,{status:403});
      return addCORS(request,new Response(null,{status:204}));
    }
    const u=new URL(request.url),path=u.pathname.replace(/^\/api\/flight-hub(?=\/)/,'').replace(/\/+$/,'');
    // Health does not imply a configured D1; /v1/public/status does.
    if (path==='/health' && request.method==='GET') return addCORS(request,json({ok:true,service:'iumrah-flight-hub',version:2,database_connected:!!env.FLIGHTS_DB}));
    if (!env.FLIGHTS_DB) return addCORS(request,json({ok:false,error:'FLIGHTS_DB_BINDING_MISSING'},503));
    try {
      let response;
      if (path==='/v1/public/status' && request.method==='GET') response=await publicStatus(env);
      else if (path==='/v1/public/flights' && request.method==='GET') response=await publicFlights(request,env);
      else if (path==='/v1/admin/unmatched' && request.method==='GET') response=await adminStats(request,env);
      else if (path==='/v1/admin/aerodatabox/refresh' && request.method==='POST') response=await refreshAeroDataBox(request,env);
      else if (path==='/v1/monitor/tasks' && request.method==='GET') response=await tasks(request,env);
      else {
        const ing=path.match(/^\/v1\/ingest\/(ignav|aerodatabox|centrum|uzbekistan|flynas|legacy_import)$/);
        response=ing && request.method==='POST' ? await ingest(request,env,ing[1]) : json({ok:false,error:'NOT_FOUND'},404);
      }
      return addCORS(request,response);
    } catch (error) { console.error('flight-hub',sanitiseError(error)); return addCORS(request,json({ok:false,error:'SERVER_ERROR'},500)); }
  },
  async scheduled(_,env) {
    if (!env.FLIGHTS_DB) return;
    await env.FLIGHTS_DB.prepare(`DELETE FROM unmatched_observations WHERE observed_at < datetime('now','-30 days')`).run();
    await env.FLIGHTS_DB.prepare(`DELETE FROM monitor_runs WHERE checked_at < datetime('now','-90 days')`).run();
  }
};
