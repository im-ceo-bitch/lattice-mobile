// New-account activation, explicitly distinct from migration parity. Read-only
// resource inspection; the only remote mutation is a bulk update of gate secrets.
import {resourceFingerprint} from './resource-fingerprint.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
const snapshot=JSON.parse(readFileSync(new URL('../schema/bootstrap-v21.json',import.meta.url),'utf8'));
const policy=JSON.parse(readFileSync(new URL('../../CloudflareMigration/policy.json',import.meta.url),'utf8')).databases;
const validId=x=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(x||'');
const ident=x=>{if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(x))throw Error('INVALID_TABLE_IDENTIFIER');return '"'+x+'"';};
// Catalog, staff configuration, price/cache tables and sequence watermarks may
// already exist. A nonempty customer table requires reconciliation, not deletion.
const sensitive=name=>/^(iumrah_(?!public)|pilgrims$|pilgrim_trips$|bookings$|booking_(?!number_sequence$)|business_chat_(threads|messages|attachments)$|chat_(threads|messages)$|client_(push_subscriptions|notification_devices|system_notification_reads)$|trip_(flights|assignments)$|telegram_booking_consents$|operation_notification_receipts$|package_quote_audits$|pending_package_pricing_reports$|esim_access_inventory$|client_system_notifications$)/.test(name);
const allowedByBinding={HOTELS_DB:new Set([...snapshot.HOTELS_DB.tables.map(t=>t.name),...policy['iumrah-hotels'].allow]),BOOKINGS_DB:new Set([...snapshot.BOOKINGS_DB.tables.map(t=>t.name),...policy['iumrah-web-db'].allow])};
const gateNames=new Set(['IUMRAH_CORE_CUTOVER_READY','IUMRAH_CORE_PARITY_ATTESTATION','IUMRAH_CORE_CLEAN_ATTESTATION']);
export function eligiblePending(cut){return cut?.service==='iumrah-backend'&&cut.cleanLaunchSupported===true&&cut.schemaReady===true&&cut.coreHandlersInstalled===true&&cut.coreCutoverEnabled===false&&cut.securityConfigurationReady===true&&Array.isArray(cut.missing)&&cut.missing.length>0&&cut.missing.every(k=>gateNames.has(k));}
export function cleanLaunchPolicy(config){return config?.mode==='new-account-no-legacy-source'&&config?.operatorConfirmedSourceUnavailable===true&&config?.worker==='iumrah-backend'&&config?.subdomain==='helloiumrah'&&config?.databases?.HOTELS_DB==='iumrah-hotels'&&config?.databases?.BOOKINGS_DB==='iumrah-core'&&config?.databases?.FLIGHTS_DB==='iumrah-flights'&&config?.buckets?.HOTELS_MEDIA==='iumrah-hotels-media'&&config?.buckets?.PASSPORTS==='iumrah-passports';}
export async function inspectCleanLaunch(env,fetcher,config){
 if(!cleanLaunchPolicy(config))throw Error('CLEAN_LAUNCH_OPERATOR_POLICY_REQUIRED');
 if(!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID||'')||!env.CLOUDFLARE_API_TOKEN)throw Error('CLEAN_LAUNCH_CLOUDFLARE_ACCESS_MISSING');
 const origin=`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}`;
 const headers={Authorization:`Bearer ${env.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'};
 async function api(p,body){const r=await fetcher(origin+p,{headers, ...(body?{method:'POST',body:JSON.stringify(body)}:{})});const j=await r.json().catch(()=>null);if(!r.ok||j?.success!==true)throw Error(`CLEAN_LAUNCH_API_FAILED:${p.split('/').filter(Boolean).slice(0,2).join('/')}:HTTP_${r.status}`);return j.result;}
 const sub=await api('/workers/subdomain');if(sub?.subdomain!==config.subdomain)throw Error('CLEAN_LAUNCH_WRONG_ACCOUNT');
 async function settings(){const s=await api('/workers/scripts/iumrah-backend/settings');if(!Array.isArray(s?.bindings))throw Error('CLEAN_LAUNCH_SETTINGS_INVALID');return s.bindings;}
 function binding(b,name,type,field){const matches=b.filter(x=>x.name===name&&x.type===type);if(matches.length!==1||!matches[0][field])throw Error('CLEAN_LAUNCH_BINDING_MISSING:'+name);return matches[0][field];}
 const b=await settings();const dbs={},buckets={};
 for(const [name,expected] of Object.entries(config.databases)){
  const id=binding(b,name,'d1','id');if(!validId(id)||id!==env[name+'_ID'])throw Error('CLEAN_LAUNCH_D1_ID_MISMATCH:'+name);
  const d=await api('/d1/database/'+id);if(d?.name!==expected)throw Error('CLEAN_LAUNCH_D1_NAME_MISMATCH:'+name);dbs[name]=id;
 }
 if(new Set(Object.values(dbs)).size!==3)throw Error('CLEAN_LAUNCH_D1_NOT_DISTINCT');
 for(const [name,expected] of Object.entries(config.buckets)){
  const bucket=binding(b,name,'r2_bucket','bucket_name');if(bucket!==expected)throw Error('CLEAN_LAUNCH_R2_MISMATCH:'+name);
  const p='/r2/buckets/'+encodeURIComponent(bucket);if((await api(p))?.name!==bucket)throw Error('CLEAN_LAUNCH_R2_NOT_FOUND:'+name);
  const managed=await api(p+'/domains/managed'),custom=await api(p+'/domains/custom');
  if(managed?.enabled!==false||!Array.isArray(custom?.domains)||custom.domains.some(x=>x.enabled!==false))throw Error('CLEAN_LAUNCH_R2_PUBLIC_OR_UNVERIFIED:'+name);
  buckets[name]=bucket;
 }
 if(new Set(Object.values(buckets)).size!==2)throw Error('CLEAN_LAUNCH_R2_NOT_DISTINCT');
 const counts={};const issues=[];
 for(const [name,id] of Object.entries(dbs)){
  const query=async sql=>{const result=await api('/d1/database/'+id+'/query',{sql});if(!Array.isArray(result)||result[0]?.success!==true||!Array.isArray(result[0].results))throw Error('CLEAN_LAUNCH_D1_QUERY_FAILED:'+name);return result[0].results;};
  const rows=await query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'");
  const names=new Set(rows.map(r=>r.name));
  if(snapshot[name])for(const t of snapshot[name].tables)if(!names.has(t.name))throw Error('CLEAN_LAUNCH_SCHEMA_MISSING:'+name+'.'+t.name);
  // Foreign key checks return no personal data to logs.
  if((await query('PRAGMA foreign_key_check')).length)throw Error('CLEAN_LAUNCH_FOREIGN_KEYS_INVALID:'+name);
  const relevant=[...names].filter(t=>sensitive(t)||(name!=='FLIGHTS_DB'&&allowedByBinding[name==='HOTELS_DB'?'BOOKINGS_DB':'HOTELS_DB'].has(t)&&!allowedByBinding[name].has(t)));
  counts[name]={};
  for(let i=0;i<relevant.length;i+=20){
   const tables=relevant.slice(i,i+20);const results=await query(tables.map(t=>`SELECT '${t}' AS name, COUNT(*) AS n FROM ${ident(t)}`).join(' UNION ALL '));
   if(results.length!==tables.length)throw Error('CLEAN_LAUNCH_COUNT_INCOMPLETE:'+name);
   for(const row of results){if(!tables.includes(row.name)||Object.hasOwn(counts[name],row.name)||!Number.isSafeInteger(row.n)||row.n<0)throw Error('CLEAN_LAUNCH_INVALID_COUNT:'+name);counts[name][row.name]=row.n;if(row.n>0)issues.push(`${name}.${row.name}=${row.n}`);}
  }
 }
 if(issues.length)throw Error('CLEAN_LAUNCH_EXISTING_DATA_REVIEW_REQUIRED:'+issues.join(','));
 // Verify bindings a second time before the one-time activation.
 const after=await settings();for(const [name,id] of Object.entries(dbs))if(binding(after,name,'d1','id')!==id)throw Error('CLEAN_LAUNCH_BINDINGS_CHANGED');for(const [name,bucket] of Object.entries(buckets))if(binding(after,name,'r2_bucket','bucket_name')!==bucket)throw Error('CLEAN_LAUNCH_BINDINGS_CHANGED');
 return {attestation:'v22-clean:'+resourceFingerprint(env.CLOUDFLARE_ACCOUNT_ID,dbs,buckets),checkedTables:Object.values(counts).reduce((n,x)=>n+Object.keys(x).length,0)};
}
export function setCleanSecrets(attestation,env){
 if(!/^v22-clean:[a-f0-9]{64}$/.test(attestation))throw Error('INVALID_CLEAN_ATTESTATION');
 const dir=mkdtempSync(join(tmpdir(),'iumrah-clean-'));try{
  const file=join(dir,'gate.json');writeFileSync(file,JSON.stringify({IUMRAH_CORE_CLEAN_ATTESTATION:attestation,IUMRAH_CORE_CUTOVER_READY:'1'}),{mode:0o600});
  // No values in stdout, arguments, or repository. Existing Wrangler config and account only.
  execFileSync('npx',['--no-install','wrangler','secret','bulk',file,'--config','wrangler.generated.jsonc'],{env,stdio:['ignore','ignore','ignore'],timeout:120000});
 }catch{throw Error('CLEAN_LAUNCH_GATE_SECRET_UPDATE_FAILED');}finally{rmSync(dir,{recursive:true,force:true});}
}
