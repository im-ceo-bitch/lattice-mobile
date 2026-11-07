// One-time seed of flight IDENTITIES from old iumrah Business Flight Sync / curated export.
// Never copies hotel data, prices or passengers. No side effects without --push.
import fs from 'node:fs';
import {normaliseFlight} from '../src/core.js';
const path=process.argv[2];
if (!path) { console.error('Usage: node scripts/import-curated.mjs old-flight-feed.json [--push]'); process.exit(2); }
const body=JSON.parse(fs.readFileSync(path,'utf8'));
const items=Array.isArray(body) ? body : body.offers || body.flights || [];
const records=[]; const seen=new Set(); let skipped=0;
for(const entry of items) {
  const legs=entry?.itinerary?.legs || entry?.legs || [];
  if(!Array.isArray(legs)||!legs.length) {skipped++;continue;}
  for (const leg of legs) {
    try {
      const number=String(leg.flight_number || leg.flightNumber || '').replace(/[\s-]/g,'').toUpperCase();
      const code=String(leg.airline_code || leg.airlineCode || number.slice(0,2)).toUpperCase();
      const start=String(leg.departure_at || leg.departureAt || '');
      const date=start.slice(0,10);
      const data={airline_code:code,flight_number:number,origin:leg.origin,destination:leg.destination,
        departure_date:date,departure_at:start || null,arrival_at:leg.arrival_at || leg.arrivalAt || null};
      const valid=normaliseFlight(data,'legacy_import');
      if(!seen.has(valid.key)) {seen.add(valid.key);records.push(data);}
    } catch { skipped++; }
  }
}
console.log(JSON.stringify({unique_master_flights:records.length,skipped,preview:records.slice(0,3)},null,2));
if (!process.argv.includes('--push')) {console.log('Dry run only. Add --push after new Cloudflare D1 deploy.');process.exit(0);}
const endpoint=String(process.env.FLIGHT_HUB_URL||'').replace(/\/$/,'');
const token=process.env.FLIGHT_HUB_ADMIN_TOKEN||'';
if(!endpoint.startsWith('https://')||!token) throw Error('Set FLIGHT_HUB_URL and FLIGHT_HUB_ADMIN_TOKEN (new account), then retry');
let accepted=0,rejected=0;
for(let i=0;i<records.length;i+=100) {
 const response=await fetch(endpoint+'/v1/ingest/legacy_import', {method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
  body:JSON.stringify({records:records.slice(i,i+100),status:'ok'})});
 if(!response.ok)throw Error('Import failed ('+response.status+'): '+(await response.text()).slice(0,300));
 const result=await response.json(); accepted+=result.accepted;rejected+=result.rejected;
}
console.log({accepted,rejected}); if(rejected)process.exitCode=1;
