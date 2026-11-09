import {normaliseFlight,eligibleFlightDay} from './core.js';

// Converts published legacy Business offers into stable flight identities only.
// No historic price is ever treated as a live fare.
export function extractCuratedFlightIdentities(rows, now = new Date()) {
  const known=new Set();const records=[];
  const stats={rows:0,accepted:0,duplicates:0,expired:0,unreadable:0};
  for(const row of rows) {
    stats.rows++;
    let itinerary;
    try {
      itinerary = typeof row.itinerary_json==='string' ? JSON.parse(row.itinerary_json) :
        row.itinerary || row;
    } catch {stats.unreadable++;continue;}
    const legs=itinerary?.legs || itinerary?.itinerary?.legs;
    if(!Array.isArray(legs) || !legs.length) {stats.unreadable++;continue;}
    for(const leg of legs) {
      try {
        const departure_at=leg.departure_at||leg.departureAt||null;
        const arrival_at=leg.arrival_at||leg.arrivalAt||null;
        const departure_date=String(departure_at||'').slice(0,10);
        if(!eligibleFlightDay(departure_date,now)) {stats.expired++;continue;}
        const flight_number=leg.flight_number||leg.flightNumber;
        const obj={airline_code:leg.airline_code||leg.airlineCode||String(flight_number||'').slice(0,2),
          flight_number,origin:leg.origin,destination:leg.destination,departure_date,
          departure_at,arrival_at};
        const normal=normaliseFlight(obj,'legacy_import');
        if(known.has(normal.key)) {stats.duplicates++;continue;}
        known.add(normal.key);records.push(obj);stats.accepted++;
      } catch {stats.unreadable++;}
    }
  }
  return {records,stats};
}
