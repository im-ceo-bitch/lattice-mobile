// Discover existing Cloudflare resources without provisioning or mutating them.
// Prefer exact D1 names over table-based guessing: modern deployments may have
// different schemas. Schema compatibility is reported separately by preflight.
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const targets = [
  {binding:'HOTELS_DB',id:'HOTELS_DB_ID',name:'HOTELS_DB_NAME',defaultName:'iumrah-hotels'},
  {binding:'BOOKINGS_DB',id:'BOOKINGS_DB_ID',name:'BOOKINGS_DB_NAME',defaultName:'iumrah-core'},
  {binding:'FLIGHTS_DB',id:'FLIGHTS_DB_ID',name:'FLIGHTS_DB_NAME',defaultName:'iumrah-flights'}
];
const uuid = s => /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(s || '');
const nameOK = s => /^[a-z0-9][a-z0-9-]{0,62}$/.test(s || '');

export async function discover(env=process.env, fetcher=fetch) {
  const accountID=String(env.CLOUDFLARE_ACCOUNT_ID||'');
  const token=String(env.CLOUDFLARE_API_TOKEN||'');
  if (!/^[a-f0-9]{32}$/i.test(accountID) || !token) throw Error('Existing Cloudflare account ID and API token required');
  const origin=`https://api.cloudflare.com/client/v4/accounts/${accountID}`;
  const headers={Authorization:`Bearer ${token}`};
  const get=async(url,options={})=>{
    const response=await fetcher(url,{...options,headers:{...headers,...(options.headers||{})}});
    if (!response.ok) throw Error(`Cloudflare API HTTP ${response.status} while reading resources (check account/permissions)`);
    const body=await response.json();
    if (!body.success) throw Error('Cloudflare rejected read-only resource lookup');
    return body;
  };
  const databases=[];
  for (let page=1;page<=100;page++) {
    const body=await get(`${origin}/d1/database?page=${page}&per_page=100`);
    if (!Array.isArray(body.result)) throw Error('Unexpected Cloudflare D1 list response');
    databases.push(...body.result);
    if (body.result.length<100 || (body.result_info?.total_pages && page>=body.result_info.total_pages)) break;
    if (page===100) throw Error('Too many Cloudflare D1 pages; discovery stopped');
  }
  const outputs={}; const used=new Set();
  const available=databases.filter(db=>nameOK(db.name) && uuid(db.uuid));
  for (const target of targets) {
    const requested=String(env[target.name]||target.defaultName);
    if (!nameOK(requested)) throw Error(`Invalid ${target.name}`);
    const matches=available.filter(db=>db.name===requested);
    if (matches.length!==1) {
      const names=available.map(db=>db.name).join(', ') || '(none)';
      throw Error(`${target.binding}: expected exactly one existing D1 named "${requested}"; found ${matches.length}. Available: ${names}. No databases created or changed.`);
    }
    const db=matches[0];
    if (used.has(db.uuid)) throw Error('The same existing D1 cannot be assigned to multiple bindings');
    used.add(db.uuid);
    outputs[target.id]=db.uuid;
    outputs[target.name]=db.name;
  }

  // A missing R2 media bucket must not prevent a staging Worker from being
  // deployed. Its media endpoints will remain unavailable until connected.
  const bucketCandidates=env.HOTELS_MEDIA_BUCKET ? [env.HOTELS_MEDIA_BUCKET] : ['iumrah-hotels-media','iumrah-operations-media'];
  for (const bucket of bucketCandidates) if (!nameOK(bucket)) throw Error('Invalid R2 bucket name');
  let selectedBucket='';
  for (const bucket of bucketCandidates) {
    const response=await fetcher(`${origin}/r2/buckets/${encodeURIComponent(bucket)}`,{headers});
    if (response.status===404) continue;
    if (response.status===403) {
      console.error('Warning: Cloudflare token cannot read R2; deploying without HOTELS_MEDIA binding.');
      break;
    }
    if (!response.ok) throw Error(`R2 lookup returned HTTP ${response.status}`);
    const body=await response.json();
    if (!body.success) throw Error('R2 bucket lookup failed');
    if (body.result?.name!==bucket) throw Error('R2 bucket name mismatch');
    selectedBucket=bucket; break;
  }
  outputs.HOTELS_MEDIA_BUCKET=selectedBucket||'none';
  return outputs;
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const outputs=await discover();
    for (const [key,value] of Object.entries(outputs)) console.log(`${key}=${value}`);
    console.error(`D1 found: ${outputs.HOTELS_DB_NAME}, ${outputs.BOOKINGS_DB_NAME}, ${outputs.FLIGHTS_DB_NAME}. R2: ${outputs.HOTELS_MEDIA_BUCKET}. No resources modified.`);
  } catch(error){ console.error('DISCOVERY_BLOCKED:',error.message);process.exitCode=1; }
}
