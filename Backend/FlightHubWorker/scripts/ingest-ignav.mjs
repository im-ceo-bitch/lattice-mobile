// Ingest verified one-way results already returned to Business by Ignav.
// Does NOT call or scrape Ignav, and does NOT split a round-trip total price across legs.
// Run after new D1 is created; supply an actual response JSON from existing curation-search.
import fs from 'node:fs';
import {normaliseFlight,normaliseOffer} from '../src/core.js';
const input=process.argv[2];
if(!input){console.error('Usage: node scripts/ingest-ignav.mjs curation-response.json [--push]');process.exit(2);}
const data=JSON.parse(fs.readFileSync(input,'utf8'));
const items=Array.isArray(data)?data:data.itineraries||[];
const now=new Date().toISOString();
const records=[];let skipped=0;
for(const item of items){
 try {
  if(item.legs?.length!==1){skipped++;continue;}
  const leg=item.legs[0];
  const amount=Number(item.price?.amount);
  const currency=String(item.price?.currency||'').toUpperCase();
  if(!Number.isFinite(amount)||amount<=0||!['UZS','USD','SAR'].includes(currency)){skipped++;continue;}
  const sourceTime=item.observed_at;
  if (!sourceTime) {skipped++;continue;}
  const obj={airline_code:leg.airline_code,flight_number:leg.flight_number,origin:leg.origin,
    destination:leg.destination,departure_date:leg.departure_at?.slice(0,10),
    departure_at:leg.departure_at,arrival_at:leg.arrival_at,
    amount_minor:Math.round(amount*(currency==='UZS'?1:100)),currency,
    observed_at:sourceTime,price_scope:'ignav_search_result_not_checkout_verified',
    adults:1,children:0,infants:0,
  };
  normaliseFlight(obj,'ignav'); normaliseOffer(obj,'ignav',now);
  records.push(obj);
 }catch{skipped++;}
}
console.log({source:'ignav',valid_one_way_offers:records.length,skipped});
if(!process.argv.includes('--push')){console.log('Dry run. Add --push for ingestion.');process.exit(0);}
const url=String(process.env.FLIGHT_HUB_URL||'').replace(/\/$/,'');
const token=process.env.FLIGHT_HUB_IGNAV_TOKEN;
if(!url.startsWith('https://')||!token)throw Error('Set FLIGHT_HUB_URL and FLIGHT_HUB_IGNAV_TOKEN');
for(let i=0;i<records.length;i+=100){
 const r=await fetch(url+'/v1/ingest/ignav',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({records:records.slice(i,i+100),status:'ok'})});
 if(!r.ok)throw Error('Request failed '+r.status+' '+(await r.text()).slice(0,300));
 console.log(await r.json());
}
