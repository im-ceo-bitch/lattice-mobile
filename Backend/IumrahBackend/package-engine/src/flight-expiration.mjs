// Catalog only. Never touch booking snapshots, financial audit or provider APIs.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
function timestamp(value, origin) {
  if (typeof value !== 'string' || !value.includes('T')) return NaN;
  // Legacy local timestamps without offsets: only infer a timezone on supported routes.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    const zone = ['JED','MED','TIF','RUH','DMM'].includes(origin) ? '+03:00' :
      ['TAS','FEG','NMA','AZN','SKD','BHK','KSQ','TMJ','UGC','NCU','NVI'].includes(origin) ? '+05:00' : '';
    if (!zone) return NaN;
    value += zone;
  }
  return Date.parse(value);
}
export function departureDay(now, origin) {
  const offset = ['JED','MED','TIF','RUH','DMM'].includes(origin) ? 3 :
    ['TAS','FEG','NMA','AZN','SKD','BHK','KSQ','TMJ','UGC','NCU','NVI'].includes(origin) ? 5 : 0;
  return new Date(now + offset * 3600000).toISOString().slice(0,10);
}
export function flightExpired(value, now = Date.now()) {
  if (!value || typeof value !== 'object') return false;
  let itinerary = value.itinerary ?? value;
  if (typeof value.itinerary_json === 'string') {
    try { itinerary = JSON.parse(value.itinerary_json); } catch { itinerary = {}; }
  }
  const legs = Array.isArray(itinerary?.legs) ? itinerary.legs : [];
  if (legs.some(leg => timestamp(leg?.departure_at ?? leg?.departureAt, leg?.origin) <= now)) return true;
  // Date-only legacy items: use origin-local midnight AFTER that date, not UTC midnight before it.
  // A valid precise departure always takes precedence over stale date metadata.
  const days = [value.outbound_date ?? value.date ?? value.outboundDate, value.inbound_date ?? value.inboundDate];
  const origins = [value.outbound_origin ?? value.from ?? value.origin, value.inbound_origin ?? value.inbound_from];
  return days.some((day, i) => !Number.isFinite(timestamp(legs[i]?.departure_at ?? legs[i]?.departureAt, legs[i]?.origin)) &&
    typeof day === 'string' && DAY.test(day) && day < departureDay(now, origins[i]));
}
async function tableExists(db, name) {
  return Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(name).first());
}
function checked(result) {
  if (result?.success === false) throw Error('FLIGHT_EXPIRATION_D1_FAILED');
  return Number(result?.meta?.changes ?? 0);
}
export async function purgeExpiredFlightCatalog(db, now = Date.now()) {
  const counts = {offers:0, snapshotOffers:0, searchCache:0, calendarCache:0};
  if (!db?.prepare) return counts;
  if (await tableExists(db,'curated_flight_offers')) {
    // Keyset pages avoid silently truncating a large catalogue. CAS guards a concurrent fare refresh.
    let cursor = '';
    for (;;) {
      const page = await db.prepare('SELECT id, itinerary_json, outbound_date, inbound_date, outbound_origin, inbound_origin, updated_at FROM curated_flight_offers WHERE id>? ORDER BY id LIMIT 200').bind(cursor).all();
      if (page?.success === false || !Array.isArray(page?.results)) throw Error('FLIGHT_EXPIRATION_READ_FAILED');
      const rows = page.results;
      const statements = rows.filter(row => flightExpired(row,now)).map(row => db.prepare('DELETE FROM curated_flight_offers WHERE id=? AND itinerary_json=? AND updated_at=?').bind(row.id,row.itinerary_json,row.updated_at));
      // D1 batch is atomic per page; small chunks also work under per-query limits.
      for (let i=0;i<statements.length;i+=50) {
        const chunk=statements.slice(i,i+50);
        const results=typeof db.batch==='function' ? await db.batch(chunk) : await Promise.all(chunk.map(s=>s.run()));
        for (const result of results) counts.offers+=checked(result);
      }
      if (rows.length<200) break;
      cursor=rows.at(-1).id;
    }
  }
  if (await tableExists(db,'business_flight_sync_feeds')) {
    const page=await db.prepare('SELECT owner_login,snapshot_json FROM business_flight_sync_feeds').all();
    if (page?.success===false || !Array.isArray(page?.results)) throw Error('FLIGHT_SNAPSHOT_EXPIRATION_READ_FAILED');
    for (const row of page.results) {
      let snap;try {snap=JSON.parse(row.snapshot_json);} catch {continue;}
      if (!Array.isArray(snap?.flights)) continue;
      const flights=snap.flights.filter(f=>!flightExpired(f,now));
      if (flights.length===snap.flights.length) continue;
      const result=await db.prepare('UPDATE business_flight_sync_feeds SET snapshot_json=?, flight_count=?, updated_at=? WHERE owner_login=? AND snapshot_json=?').bind(JSON.stringify({...snap,flights}),flights.length,new Date(now).toISOString(),row.owner_login,row.snapshot_json).run();
      if (checked(result)) counts.snapshotOffers+=snap.flights.length-flights.length;
    }
  }
  // Provider search cache is transient, not booking history. Remove departed
  // itineraries while retaining unrelated future results in the same cached search.
  if (await tableExists(db,'flight_search_cache')) {
    let cursor='';
    for (;;) {
      const page=await db.prepare('SELECT cache_key,response_json,outbound_date,inbound_date,outbound_origin,inbound_origin,fresh_until FROM flight_search_cache WHERE cache_key>? ORDER BY cache_key LIMIT 200').bind(cursor).all();
      if(page?.success===false || !Array.isArray(page?.results)) throw Error('FLIGHT_CACHE_EXPIRATION_READ_FAILED');
      for(const row of page.results){
        let payload;try{payload=JSON.parse(row.response_json);}catch{/* TTL handles corrupt payload */}
        const items=Array.isArray(payload?.itineraries)?payload.itineraries:[];
        const active=items.filter(item=>!flightExpired(item,now));
        if(flightExpired(row,now) || Date.parse(row.fresh_until)<=now || (items.length>0 && !active.length)) {
          counts.searchCache+=checked(await db.prepare('DELETE FROM flight_search_cache WHERE cache_key=? AND response_json=? AND fresh_until=?').bind(row.cache_key,row.response_json,row.fresh_until).run());
        } else if(active.length<items.length) {
          counts.searchCache+=checked(await db.prepare('UPDATE flight_search_cache SET response_json=? WHERE cache_key=? AND response_json=? AND fresh_until=?').bind(JSON.stringify({...payload,itineraries:active}),row.cache_key,row.response_json,row.fresh_until).run());
        }
      }
      if(page.results.length<200)break;
      cursor=page.results.at(-1).cache_key;
    }
  }
  if (await tableExists(db,'flight_calendar_fares')) {
    // These aggregates have dates only. Do not delete a whole same-day route
    // just because one of its flights has departed.
    const day=new Date(now).toISOString().slice(0,10);
    counts.calendarCache+=checked(await db.prepare('DELETE FROM flight_calendar_fares WHERE outbound_date<? OR (inbound_date IS NOT NULL AND inbound_date<?) OR delete_after<?').bind(day,day,day).run());
  }
  return counts;
}
