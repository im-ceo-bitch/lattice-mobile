// Verify ONE deployed Worker and actual Flight Hub D1 queries before retiring the old one.
// Uses existing Cloudflare credentials for the subdomain lookup; no new GitHub secrets.
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {eligiblePending,inspectCleanLaunch,setCleanSecrets} from './clean-launch.mjs';

export async function verifyDeployed(env=process.env, fetcher=fetch, activation=null) {
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
  let health=await getJSON(origin+'/__iumrah/health');
  if(health.service!=='iumrah-backend'||!health.bindings?.FLIGHTS_DB||!health.modules?.core||!health.modules?.packages) throw Error('UNIFIED_WORKER_BINDINGS_NOT_READY');
  const packageHealth=await getJSON(origin+'/api/package/health');
  if(packageHealth.service!=='iumrah-package-engine'||!packageHealth.hotelsDbConfigured||!packageHealth.bookingsDbConfigured) throw Error('PACKAGE_DATABASE_SCHEMA_NOT_READY');
  const services=await getJSON(origin+'/api/services/health');
  if(services.service!=='iumrah-public-services'||services.release!=='v21-rc'||services.advisorLanguages<9||services.audioLanguages<9)throw Error('PUBLIC_SERVICES_NOT_READY');
  let cutover=await getJSON(origin+'/__iumrah/cutover');
  // Report all provider gaps even if the independent Core activation fails.
  // Never print values or silently mark missing integrations as ready.
  const providerGaps=Object.entries(cutover.providers||{}).filter(([,ready])=>ready!==true).map(([name])=>name);
  if(providerGaps.length)console.log('Provider configuration gaps (independent of Core activation): '+providerGaps.join(', '));
  const flightHealth=await getJSON(origin+'/health');
  if(!flightHealth.database_connected) throw Error('FLIGHTS_DB_NOT_CONNECTED');
  const status=await getJSON(origin+'/v1/public/status');
  if(status.ready!==true||!status.counts||!Number.isFinite(status.counts.flights)) throw Error('FLIGHTS_SCHEMA_NOT_READY');
  const catalog=await getJSON(origin+'/v1/public/flights?limit=1');
  if(!Array.isArray(catalog.flights)) throw Error('FLIGHTS_CATALOG_NOT_READY');
  if(activation&&eligiblePending(cutover)) {
    if(status.counts.flights<1||catalog.flights.length<1)throw Error('CLEAN_LAUNCH_FLIGHT_CATALOG_EMPTY');
    const report=await inspectCleanLaunch(env,fetcher,activation.config);
    const latest=await getJSON(origin+'/__iumrah/cutover');
    if(!eligiblePending(latest))throw Error('CLEAN_LAUNCH_PENDING_STATE_CHANGED');
    console.log(`Clean launch: ${report.checkedTables} customer/misplaced tables checked; ${report.preservedGuestDevices} existing guest notification devices preserved; R2 private; no legacy parity claimed.`);
    await activation.set(report.attestation,env);
    for(let i=0;i<15;i++){
      cutover=await getJSON(origin+'/__iumrah/cutover');health=await getJSON(origin+'/__iumrah/health');
      if(cutover.coreCutoverEnabled&&cutover.cleanLaunchAttested&&health.modules?.coreCutoverEnabled)break;
      if(i<14)await new Promise(r=>setTimeout(r,2000));
    }
    if(!cutover.coreCutoverEnabled||!cutover.cleanLaunchAttested)throw Error('CLEAN_LAUNCH_ACTIVATION_NOT_VISIBLE');
    console.log('CORE_ACTIVATED_NEW_ACCOUNT: registration and bookings enabled; separate provider and device tests still required.');
  }
  if(cutover.service!=='iumrah-backend' ||!health.modules?.coreCutoverEnabled||!cutover.coreCutoverEnabled||!cutover.schemaReady||!(cutover.migrationAttested||cutover.cleanLaunchAttested)||!Array.isArray(cutover.missing)||cutover.missing.length) {
    console.error('Flight catalog verified, but core release gate is blocked:', JSON.stringify({missing:cutover.missing,readiness:cutover.readiness}));
    throw Error('CORE_CUTOVER_PENDING: Worker deployed; release NOT ready. Verify D1/R2 and attest migration or verified new-account launch before activation.');
  }
  if(!cutover.providerConfigurationReady)throw Error('CORE_PROVIDER_CONFIGURATION_PENDING: '+(cutover.requiredProviderGaps||Object.entries(cutover.providers||{}).filter(([,ready])=>!ready).map(([name])=>name)).join(', ')+'; credentials not validated against providers.');
  const optionalMissing=(cutover.optionalProviders||[]).filter(name=>cutover.providers?.[name]!==true);
  if(optionalMissing.length)console.log('Optional integrations deferred (not release blockers): '+optionalMissing.join(', '));
  return {url:origin,flights:status.counts.flights,offers:status.counts.offers,health:health.status};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const file=new URL('../clean-launch.json',import.meta.url);const activation=fs.existsSync(file)?{config:JSON.parse(fs.readFileSync(file,'utf8')),set:setCleanSecrets}:null;const result=await verifyDeployed(process.env,fetch,activation);console.log(`iumrah-backend: ${result.url}`);console.log(`Flight API OK: ${result.flights} flights, ${result.offers} offers, worker ${result.health}`);console.log('Core schema and activation attestation present; authenticated production smoke tests still required.');}
  catch(e){console.error('UNIFIED_BACKEND_NOT_READY:',e.message);process.exitCode=1;}
}
