// Read-only snapshot of published flight identities from the old D1 to the new Flight Hub.
// Does not export passenger, booking, hotel, or historic price data. No pushes without --push.
// Required source: OLD_CLOUDFLARE_ACCOUNT_ID, OLD_CLOUDFLARE_API_TOKEN
// Required destination for --push: NEW_CLOUDFLARE_ACCOUNT_ID, NEW_CLOUDFLARE_API_TOKEN
import {extractCuratedFlightIdentities} from '../src/curated.js';
import {tashkentDay} from '../src/core.js';
import {deriveServiceCredentials} from './ci-secret-derivation.mjs';
import { seedLocalFlightArtifactIfAvailable } from './seed-from-flight-artifact.mjs';

if (await seedLocalFlightArtifactIfAvailable()) {
  console.log('Used local kepler-ios flight artifact; no old account or feed credentials necessary.');
} else {

const oldAccount=process.env.OLD_CLOUDFLARE_ACCOUNT_ID;
const oldToken=process.env.OLD_CLOUDFLARE_API_TOKEN;
const oldName=process.env.OLD_CLOUDFLARE_D1_NAME || 'iumrah-hotels';
if(!/^[a-f0-9]{32}$/i.test(oldAccount||'')||!oldToken) throw Error('Old Cloudflare read credentials missing');
if(!/^[a-z0-9-]{2,90}$/.test(oldName)) throw Error('Invalid source D1 name');
const apiRoot=`https://api.cloudflare.com/client/v4/accounts/${oldAccount}/d1/database`;
const headers={'Authorization':'Bearer '+oldToken,'Content-Type':'application/json'};
async function api(url, options={}) {
  const r=await fetch(url,{...options,headers});
  if(!r.ok)throw Error('OLD_D1_HTTP_'+r.status);
  const json=await r.json();
  if(!json.success)throw Error('OLD_D1_API_ERROR');
  return json;
}
let db=null;
for(let page=1;page<=10;page++) {
  const payload=await api(`${apiRoot}?page=${page}&per_page=100`);
  db=(payload.result||[]).find(x=>x.name===oldName) || db;
  if(db||(payload.result||[]).length<100)break;
}
if(!db)throw Error('OLD_D1_SOURCE_MISSING');
const uuid=db.uuid||db.id;
const rows=[];
for(let offset=0;offset<20000;offset+=200) {
  const cutoff=tashkentDay();
  const query={sql:'SELECT itinerary_json FROM curated_flight_offers WHERE published = 1 AND (outbound_date >= ? OR inbound_date >= ?) ORDER BY outbound_date LIMIT 200 OFFSET ?',params:[cutoff,cutoff,offset]};
  const payload=await api(`${apiRoot}/${uuid}/query`,{method:'POST',body:JSON.stringify(query)});
  const page=payload?.result?.[0]?.results;
  if(!Array.isArray(page))throw Error('OLD_D1_QUERY_MALFORMED');
  rows.push(...page);
  if(page.length<200)break;
}
const {records,stats}=extractCuratedFlightIdentities(rows);
console.log(JSON.stringify({source:oldName,reviewed:stats.rows,eligible:stats.accepted,expired:stats.expired,
  duplicates:stats.duplicates,unreadable:stats.unreadable,price_data_copied:false},null,2));
if(!process.argv.includes('--push')){console.log('Dry-run only. --push is required to seed new D1.');process.exit(0);}
const newAccount=process.env.NEW_CLOUDFLARE_ACCOUNT_ID;
const newToken=process.env.NEW_CLOUDFLARE_API_TOKEN;
const endpoint=String(process.env.FLIGHT_HUB_URL||'').replace(/\/$/,'');
if(!endpoint.startsWith('https://'))throw Error('FLIGHT_HUB_URL missing');
const {admin}=deriveServiceCredentials(newAccount,newToken);
let accepted=0,unmatched=0,rejected=0;
for(let i=0;i<records.length;i+=100) {
  const r=await fetch(endpoint+'/v1/ingest/legacy_import',{method:'POST',headers:{Authorization:'Bearer '+admin,'Content-Type':'application/json'},
    body:JSON.stringify({records:records.slice(i,i+100),status:'ok'})});
  if(!r.ok)throw Error('HUB_SEED_FAILED_'+r.status);
  const result=await r.json();accepted+=result.accepted;unmatched+=result.unmatched;rejected+=result.rejected;
}
console.log(JSON.stringify({seeded:accepted,unmatched,rejected,source_rows:rows.length}));
if(rejected||unmatched)process.exitCode=1;

}
