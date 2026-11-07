// Official AeroDataBox flight-number response via RapidAPI. Verification, never fare pricing.
import { normaliseFlight } from './core.js';
const normalizeNo = x => String(x||'').toUpperCase().replace(/[\s-]/g,'');
const iata = x => String(x?.iata || '').toUpperCase();
function timestamp(movement) {
  const local=String(movement?.scheduledTime?.local || '').replace(' ','T');
  // Local time without explicit offset is unsafe: omit, never guess a timezone.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(local) && /(?:Z|[+-]\d\d:\d\d)$/.test(local)) return local;
  return null;
}
export function mapAero(flight,item) {
  if (normalizeNo(item?.number)!==flight.flight_number) return null;
  if (iata(item?.departure?.airport)!==flight.origin || iata(item?.arrival?.airport)!==flight.destination) return null;
  const dt=timestamp(item.departure),at=timestamp(item.arrival);
  if (dt && dt.slice(0,10)!==flight.departure_date) return null;
  const candidate={...flight,departure_at:dt,arrival_at:at,operational_status:String(item.status||'').slice(0,50)};
  try {normaliseFlight(candidate,'aerodatabox');return candidate;}catch{return null;}
}
export async function fetchAeroCandidate(flight,key) {
  const url=`https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flight.flight_number)}/${encodeURIComponent(flight.departure_date)}?withAircraftImage=false&withLocation=false&dateLocalRole=Departure`;
  const response=await fetch(url,{headers:{Accept:'application/json','X-RapidAPI-Key':key,'X-RapidAPI-Host':'aerodatabox.p.rapidapi.com'}});
  if(!response.ok) throw Error(`AERODATABOX_HTTP_${response.status}`);
  const results=await response.json();
  if(!Array.isArray(results)) throw Error('AERODATABOX_INVALID_RESPONSE');
  return results.map(row=>mapAero(flight,row)).find(Boolean)||null;
}
