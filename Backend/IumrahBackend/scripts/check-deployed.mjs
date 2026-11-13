// Verify ONE deployed Worker and actual Flight Hub D1 queries before retiring the old one.
// Uses existing Cloudflare credentials for the subdomain lookup; no new GitHub secrets.
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export async function verifyDeployed(env=process.env, fetcher=fetch) {
  const account=String(env.CLOUDFLARE_ACCOUNT_ID||'');
  const token=String(env.CLOUDFLARE_API_TOKEN||'');
  if(!/^[0-9a-f]{32}$/i.test(account)||!token) throw Error('CLOUDFLARE_ACCESS_MISSING');
  const subResult=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/subdomain`,
    {headers:{Authorization:`Bearer ${token}`}});
  if(!subResult.ok) throw Error(`SUBDOMAIN_LOOKUP_FAILED_${subResult.status}`);
  const body=await subResult.json();
  const subdomain=body?.result?.subdomain;
  if(!body?.success||typeof subdomain!=='string'||!/^[a-z0-9-]{1,63}$/.test(subdomain)) throw Error('WORKERS_DEV_SUBDOMAIN_MISSING');
  const origin=`https://iumrah-backend.${subdomain}.workers.dev`;
  async function getJSON(url) {
    let lastError;
    for(let i=0;i<5;i++) {
      try {
        const response=await fetcher(url,{headers:{Accept:'application/json'}});
        if(!response.ok) throw Error(`HTTP_${response.status}`);
        const data=await response.json();
        if(!data||data.ok!==true) throw Error('SERVICE_NOT_READY');
        return data;
      }catch(e){lastError=e;if(i<4)await new Promise(resolve=>setTimeout(resolve,1300));}
    }
    throw Error(`${new URL(url).pathname}: ${lastError?.message||'FAILED'}`);
  }
  const health=await getJSON(origin+'/__iumrah/health');
  if(health.service!=='iumrah-backend'||!health.bindings?.FLIGHTS_DB||!health.modules?.core||!health.modules?.packages) throw Error('UNIFIED_WORKER_BINDINGS_NOT_READY');
  const packageHealth=await getJSON(origin+'/api/package/health');
  if(packageHealth.service!=='iumrah-package-engine'||!packageHealth.hotelsDbConfigured||!packageHealth.bookingsDbConfigured) throw Error('PACKAGE_DATABASE_SCHEMA_NOT_READY');
  if(!health.modules?.coreCutoverEnabled) console.warn('Core cutover pending: schema is not data parity; preserve old D1/R2.');
  const flightHealth=await getJSON(origin+'/health');
  if(!flightHealth.database_connected) throw Error('FLIGHTS_DB_NOT_CONNECTED');
  const status=await getJSON(origin+'/v1/public/status');
  if(status.ready!==true||!status.counts||!Number.isFinite(status.counts.flights)) throw Error('FLIGHTS_SCHEMA_NOT_READY');
  const catalog=await getJSON(origin+'/v1/public/flights?limit=1');
  if(!Array.isArray(catalog.flights)) throw Error('FLIGHTS_CATALOG_NOT_READY');
  return {url:origin,flights:status.counts.flights,offers:status.counts.offers,health:health.status};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const result=await verifyDeployed();console.log(`iumrah-backend: ${result.url}`);console.log(`Flight API OK: ${result.flights} flights, ${result.offers} offers, worker ${result.health}`);}
  catch(e){console.error('UNIFIED_BACKEND_NOT_READY:',e.message);process.exitCode=1;}
}
