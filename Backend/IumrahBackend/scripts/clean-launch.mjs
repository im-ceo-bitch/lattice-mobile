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
 const headers={Authorization:`Bearer ${env.CLOUDFLARE_API_TOKEN}`};
 // Do not print tokens, account/database IDs, raw SQL results or raw provider responses.
 // Preserve a safe stage, HTTP status, and numeric Cloudflare error codes.
 async function api(p,body,stage='resource'){
  const options=body?{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)}:{headers};
  let r;try{r=await fetcher(origin+p,options);}catch{throw Error('CLEAN_LAUNCH_NETWORK_FAILED:'+stage);}
  const j=await r.json().catch(()=>null);
  if(!r.ok||j?.success!==true){
   const errors=Array.isArray(j?.errors)?j.errors:[];
   const codes=errors.map(e=>e?.code).filter(Number.isSafeInteger).join(',')||'none';
   const message=errors.map(e=>typeof e?.message==='string'?e.message:'').join(' ');
   const reason=[[/not authorized|authorization|permission|forbidden/i,'authorization'],[/foreign key mismatch/i,'foreign-key-schema'],[/no such table/i,'missing-table'],[/no such column/i,'missing-column'],[/too many|limit exceeded/i,'limit'],[/syntax error|incomplete input/i,'sql-syntax'],[/invalid|malformed/i,'invalid-request']].find(([pattern])=>pattern.test(message))?.[1]||'unspecified';
   const error=Error(`CLEAN_LAUNCH_API_FAILED:${stage}:HTTP_${r.status}:CF_${codes}:${reason}`);error.httpStatus=r.status;throw error;
  }
  return j.result;
 }
 const sub=await api('/workers/subdomain',null,'account-subdomain');if(sub?.subdomain!==config.subdomain)throw Error('CLEAN_LAUNCH_WRONG_ACCOUNT');
 async function settings(){const s=await api('/workers/scripts/iumrah-backend/settings',null,'worker-bindings');if(!Array.isArray(s?.bindings))throw Error('CLEAN_LAUNCH_SETTINGS_INVALID');return s.bindings;}
 function binding(b,name,type,field){const matches=b.filter(x=>x.name===name&&x.type===type);if(matches.length!==1||!matches[0][field])throw Error('CLEAN_LAUNCH_BINDING_MISSING:'+name);return matches[0][field];}
 const b=await settings();const dbs={},buckets={};
 for(const [name,expected] of Object.entries(config.databases)){
  const id=binding(b,name,'d1','id');if(!validId(id)||id!==env[name+'_ID'])throw Error('CLEAN_LAUNCH_D1_ID_MISMATCH:'+name);
  const d=await api('/d1/database/'+id,null,name+'.metadata');if(d?.name!==expected)throw Error('CLEAN_LAUNCH_D1_NAME_MISMATCH:'+name);dbs[name]=id;
 }
 if(new Set(Object.values(dbs)).size!==3)throw Error('CLEAN_LAUNCH_D1_NOT_DISTINCT');
 for(const [name,expected] of Object.entries(config.buckets)){
  const bucket=binding(b,name,'r2_bucket','bucket_name');if(bucket!==expected)throw Error('CLEAN_LAUNCH_R2_MISMATCH:'+name);
  const p='/r2/buckets/'+encodeURIComponent(bucket);if((await api(p,null,name+'.metadata'))?.name!==bucket)throw Error('CLEAN_LAUNCH_R2_NOT_FOUND:'+name);
  const managed=await api(p+'/domains/managed',null,name+'.managed-domain'),custom=await api(p+'/domains/custom',null,name+'.custom-domains');
  if(managed?.enabled!==false||!Array.isArray(custom?.domains)||custom.domains.some(x=>x.enabled!==false))throw Error('CLEAN_LAUNCH_R2_PUBLIC_OR_UNVERIFIED:'+name);
  buckets[name]=bucket;
 }
 if(new Set(Object.values(buckets)).size!==2)throw Error('CLEAN_LAUNCH_R2_NOT_DISTINCT');
 const counts={};const issues=[];
 for(const [name,id] of Object.entries(dbs)){
  const endpoint='/d1/database/'+id+'/query';
  // Use the same simple catalog query as the successful deployment preflight.
  // The API permits batches; if it rejects a read-only batch, retry statements
  // individually so the exact failing table is reported, never skip a check.
  const unpack=(result,checks)=>{
   if(!Array.isArray(result)||result.length!==checks.length)throw Error('CLEAN_LAUNCH_D1_RESULT_INCOMPLETE:'+name);
   return result.map((r,i)=>{if(r?.success!==true||!Array.isArray(r.results))throw Error('CLEAN_LAUNCH_D1_QUERY_FAILED:'+name+'.'+checks[i].stage);return r.results;});
  };
  const single=async check=>unpack(await api(endpoint,{sql:check.sql},name+'.'+check.stage),[check])[0];
  async function readChecks(checks){
   const results=[];
   for(let i=0;i<checks.length;i+=10){
    const group=checks.slice(i,i+10);
    if(group.length===1){results.push(await single(group[0]));continue;}
    try{results.push(...unpack(await api(endpoint,{batch:group.map(({sql})=>({sql}))},name+'.batch-'+group[0].stage),group));}
    catch(error){
     if(error.httpStatus!==400&&error.httpStatus!==422)throw error;
     // All operations in this batch are SELECT / table-scoped read-only PRAGMA.
     // Fallback preserves every check and identifies a rejected statement.
     for(const check of group)results.push(await single(check));
    }
   }
   return results;
  }
  const rows=await single({stage:'catalog',sql:"SELECT name FROM sqlite_master WHERE type='table'"});
  if(rows.some(r=>typeof r.name!=='string'))throw Error('CLEAN_LAUNCH_INVALID_CATALOG:'+name);
  const names=new Set(rows.map(r=>r.name).filter(t=>!t.startsWith('sqlite_')&&!t.startsWith('_cf_')));
  if(snapshot[name])for(const t of snapshot[name].tables)if(!names.has(t.name))throw Error('CLEAN_LAUNCH_SCHEMA_MISSING:'+name+'.'+t.name);
  // D1 has internal tables. Avoid database-wide PRAGMA foreign_key_check;
  // check each application table explicitly, including tables not in snapshot.
  const foreignChecks=[...names].sort().map(t=>({stage:'foreign-keys.'+t,sql:`PRAGMA foreign_key_check(${ident(t)})`}));
  const foreignResults=await readChecks(foreignChecks);
  for(let i=0;i<foreignChecks.length;i++)if(foreignResults[i].length)throw Error('CLEAN_LAUNCH_FOREIGN_KEYS_INVALID:'+name+'.'+foreignChecks[i].stage);
  const relevant=[...names].filter(t=>sensitive(t)||(name!=='FLIGHTS_DB'&&allowedByBinding[name==='HOTELS_DB'?'BOOKINGS_DB':'HOTELS_DB'].has(t)&&!allowedByBinding[name].has(t))).sort();
  counts[name]={};
  const countResults=await readChecks(relevant.map(t=>({stage:'count.'+t,sql:`SELECT COUNT(*) AS n FROM ${ident(t)}`})));
  for(let i=0;i<relevant.length;i++){
   const t=relevant[i],result=countResults[i];
   if(result.length!==1||!Number.isSafeInteger(result[0].n)||result[0].n<0)throw Error('CLEAN_LAUNCH_INVALID_COUNT:'+name+'.'+t);
   counts[name][t]=result[0].n;if(result[0].n>0)issues.push(`${name}.${t}=${result[0].n}`);
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
