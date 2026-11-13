// Discover existing Cloudflare resources without provisioning or mutating them.
// Prefer exact D1 names over table-based guessing: modern deployments may have
// different schemas. Schema compatibility is reported separately by preflight.
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

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

  // Preserve exact existing Worker R2 bindings on redeploy. A missing config
  // file must not silently detach a private passport bucket from production.
  const file=new URL('../core-bindings.json',import.meta.url);
  const local=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
  const settingsResponse=await fetcher(`${origin}/workers/scripts/iumrah-backend/settings`,{headers});
  let previous=[];
  if(settingsResponse.status!==404){
    if(!settingsResponse.ok)throw Error('WORKER_BINDINGS_LOOKUP_FAILED: cannot safely preserve existing R2 bindings');
    const settings=await settingsResponse.json();
    if(!settings.success||!Array.isArray(settings.result?.bindings))throw Error('WORKER_BINDINGS_RESPONSE_INVALID');
    previous=settings.result.bindings;
  }
  const priorBucket=name=>{
    const matches=previous.filter(x=>x.name===name&&x.type==='r2_bucket');
    if(matches.length>1||matches.some(x=>!nameOK(x.bucket_name)))throw Error('AMBIGUOUS_EXISTING_R2_BINDING:'+name);
    return matches[0]?.bucket_name;
  };
  const findBucket=async(bucket)=>{
    if(!nameOK(bucket))throw Error('INVALID_R2_BUCKET_NAME');
    const response=await fetcher(`${origin}/r2/buckets/${encodeURIComponent(bucket)}`,{headers});
    if(response.status===404)return false;
    if(!response.ok)throw Error(`R2 lookup returned HTTP ${response.status}; cannot safely verify existing bucket`);
    const data=await response.json();if(!data.success||data.result?.name!==bucket)throw Error('R2_BUCKET_MISMATCH');
    return true;
  };
  const explicitMedia=env.HOTELS_MEDIA_BUCKET||local.hotelsMediaBucket||priorBucket('HOTELS_MEDIA');
  const explicitPassports=env.PASSPORTS_BUCKET||local.passportsBucket||priorBucket('PASSPORTS');
  for(const [name,explicit] of [['HOTELS_MEDIA',explicitMedia],['PASSPORTS',explicitPassports]]){
    const prior=priorBucket(name);
    if(prior&&explicit&&explicit!==prior)throw Error(`R2_BINDING_CHANGE_REFUSED:${name}; review migration and explicitly rebind in Cloudflare first`);
  }
  if(explicitMedia&&explicitMedia!=='none'){
    if(!await findBucket(explicitMedia))throw Error('HOTELS_MEDIA_BUCKET_NOT_FOUND');
    outputs.HOTELS_MEDIA_BUCKET=explicitMedia;
  } else if(explicitMedia==='none')outputs.HOTELS_MEDIA_BUCKET='none';
  else {
    const found=[];
    for(const bucket of ['iumrah-hotels-media','iumrah-operations-media'])if(await findBucket(bucket))found.push(bucket);
    if(found.length>1)throw Error('HOTELS_MEDIA_BUCKET_AMBIGUOUS: set exact hotelsMediaBucket in core-bindings.json');
    outputs.HOTELS_MEDIA_BUCKET=found[0]||'none';
  }
  if(explicitPassports&&explicitPassports!=='none'){
    if(!await findBucket(explicitPassports))throw Error('PASSPORTS_BUCKET_NOT_FOUND');
    outputs.PASSPORTS_BUCKET=explicitPassports;
  }else outputs.PASSPORTS_BUCKET='none';

  return outputs;
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const outputs=await discover();
    for (const [key,value] of Object.entries(outputs)) console.log(`${key}=${value}`);
    console.error(`D1 found: ${outputs.HOTELS_DB_NAME}, ${outputs.BOOKINGS_DB_NAME}, ${outputs.FLIGHTS_DB_NAME}. R2: ${outputs.HOTELS_MEDIA_BUCKET}. No resources modified.`);
  } catch(error){ console.error('DISCOVERY_BLOCKED:',error.message);process.exitCode=1; }
}
