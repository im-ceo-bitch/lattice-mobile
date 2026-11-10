// Read-only discovery of existing Cloudflare D1 databases and R2 buckets.
// IDs are public resource metadata, NOT repository secrets. Never create resources.
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const targets = [
  {binding:'HOTELS_DB',id:'HOTELS_DB_ID',name:'HOTELS_DB_NAME',candidates:['iumrah-hotels','iumrah-core'],tables:['hotels']},
  {binding:'BOOKINGS_DB',id:'BOOKINGS_DB_ID',name:'BOOKINGS_DB_NAME',candidates:['iumrah-web-db','iumrah-core'],tables:['bookings']},
  {binding:'FLIGHTS_DB',id:'FLIGHTS_DB_ID',name:'FLIGHTS_DB_NAME',candidates:['iumrah-flights'],tables:['flights','flight_offers']}
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
    const response=await fetcher(url,{headers, ...options,headers:{...headers,...(options.headers||{})}});
    if (!response.ok) throw Error(`Cloudflare API HTTP ${response.status} while reading metadata (check account/permissions)`);
    const body=await response.json();
    if (!body.success) throw Error('Cloudflare rejected read-only metadata lookup');
    return body;
  };
  const databases=[];
  for (let page=1;page<=100;page++) {
    const body=await get(`${origin}/d1/database?page=${page}&per_page=100`);
    if (!Array.isArray(body.result)) throw Error('Unexpected Cloudflare D1 list response');
    databases.push(...body.result);
    if (body.result.length<100 || (body.result_info?.total_pages && page>=body.result_info.total_pages)) break;
    if (page===100) throw Error('Too many Cloudflare D1 pages; safe discovery aborted');
  }
  const outputs={}; const used=new Set();
  const available=databases.filter(db=>nameOK(db.name) && uuid(db.uuid));
  const schemaCache=new Map();
  async function tablesOf(db) {
    if (!schemaCache.has(db.uuid)) {
      const body=await get(`${origin}/d1/database/${encodeURIComponent(db.uuid)}/query`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({sql:"SELECT name FROM sqlite_master WHERE type='table'"})
      });
      schemaCache.set(db.uuid,new Set((body.result?.[0]?.results||[]).map(row=>String(row.name||''))));
    }
    return schemaCache.get(db.uuid);
  }
  for (const target of targets) {
    const configuredName=env[target.name];
    if (configuredName && !nameOK(configuredName)) throw Error(`Invalid ${target.name}`);
    const candidates=configuredName ? [configuredName] : target.candidates;
    const matches=[];
    for (const db of available.filter(x=>candidates.includes(x.name) && !used.has(x.uuid))) {
      const schema=await tablesOf(db);
      if (target.tables.every(t=>schema.has(t))) matches.push(db);
    }
    if (matches.length!==1) {
      const names=available.map(db=>db.name).join(', ') || '(no D1 databases)';
      throw Error(`${target.binding}: expected exactly ONE matching existing D1, found ${matches.length}. Account databases: ${names}. No resources modified.`);
    }
    const db=matches[0]; used.add(db.uuid);
    outputs[target.id]=db.uuid;
    outputs[target.name]=db.name;
  }
  // Prefer the bucket used by the existing HotelsWorker, fall back to the known operations bucket.
  const bucketCandidates=env.HOTELS_MEDIA_BUCKET ? [env.HOTELS_MEDIA_BUCKET] : ['iumrah-hotels-media','iumrah-operations-media'];
  for (const bucket of bucketCandidates) if (!nameOK(bucket)) throw Error('Invalid R2 bucket name');
  let selectedBucket;
  for (const bucket of bucketCandidates) {
    const response=await fetcher(`${origin}/r2/buckets/${encodeURIComponent(bucket)}`,{headers});
    if (response.status===404) continue;
    if (!response.ok) throw Error(`R2 bucket check returned HTTP ${response.status}`);
    const body=await response.json();
    if (!body.success) throw Error('R2 bucket check failed');
    if (body.result?.name!==bucket) throw Error('R2 bucket name mismatch');
    selectedBucket=bucket; break;
  }
  if (!selectedBucket) throw Error('No existing hotel R2 bucket found in this account; no new bucket was created');
  outputs.HOTELS_MEDIA_BUCKET=selectedBucket;
  return outputs;
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const outputs=await discover();
    // stdout goes straight to GITHUB_ENV; never print tokens or other secrets.
    for (const [key,value] of Object.entries(outputs)) console.log(`${key}=${value}`);
    console.error(`Discovery OK: ${outputs.HOTELS_DB_NAME}, ${outputs.BOOKINGS_DB_NAME}, ${outputs.FLIGHTS_DB_NAME}; R2 ${outputs.HOTELS_MEDIA_BUCKET}. No resources modified.`);
  } catch(error){ console.error('DISCOVERY_BLOCKED:',error.message);process.exitCode=1; }
}
