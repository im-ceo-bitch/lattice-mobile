import { flightExpired } from "../package-engine/src/flight-expiration.mjs";
// Explicit, non-destructive repair for legacy CloudflareMigration routing.
// Default is read-only diagnosis. --apply copies ONLY existing approved rows.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const table='curated_flight_offers';
const ddl=fs.readFileSync(new URL('./curated-recovery-schema.sql',import.meta.url),'utf8');
const required=['id','source_candidate_id','source_provider','outbound_origin','outbound_destination','inbound_origin','inbound_destination','outbound_date','inbound_date','cabin_class','airline_codes_json','airline_names_json','flight_numbers_json','itinerary_json','total_fare','per_traveler_fare','currency','traveler_count','observed_at','published','priority','created_by','created_at','updated_at'];
const optional=['offer_type','journey_role','fingerprint'];
const hasTable=async(q)=>Boolean((await q("SELECT name FROM sqlite_master WHERE type='table' AND name=?",[table])).length);
const todayUTC=(now)=>now.toISOString().slice(0,10);
function validDay(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
function eligible(row,day,now){
 if(flightExpired(row,now.getTime()))return false;
 if(Number(row.published)!==1||!validDay(row.outbound_date)||row.outbound_date<day||
   (row.inbound_date!==null&&(!validDay(row.inbound_date)||row.inbound_date<day)))return false;
 if(!row.id||!Number.isFinite(Number(row.total_fare))||Number(row.total_fare)<=0||!Number.isFinite(Number(row.per_traveler_fare))||Number(row.per_traveler_fare)<=0||!/^[A-Z]{3}$/.test(row.currency)||!Number.isInteger(Number(row.traveler_count))||Number(row.traveler_count)<1||!Number.isFinite(Date.parse(row.observed_at)))return false;
 try {const i=JSON.parse(row.itinerary_json);return Array.isArray(i.legs)&&i.legs.length>0&&i.legs.every(l=>l.flight_number&&/^[A-Z]{3}$/.test(l.origin)&&/^[A-Z]{3}$/.test(l.destination)&&Number.isFinite(Date.parse(l.departure_at))&&Number.isFinite(Date.parse(l.arrival_at))&&Date.parse(l.departure_at)<Date.parse(l.arrival_at)&&l.departure_at.slice(0,10)>=day);} catch{return false;}
}
export async function recoverCurated({source,target,apply=false,now=new Date()}){
 const day=todayUTC(now);
 const sourceExists=await hasTable(source),targetExists=await hasTable(target);
 const targetCount=targetExists?Number((await target(`SELECT COUNT(*) n FROM ${table}`))[0].n):0;
 if(!sourceExists)return {status:'source_missing',targetCount,eligible:0,copied:0};
 const sourceCols=new Set((await source(`PRAGMA table_info(${table})`)).map(c=>c.name));
 if(required.some(c=>!sourceCols.has(c)))throw Error('LEGACY_CURATED_SCHEMA_INCOMPATIBLE');
 const cols=[...required,...optional.filter(c=>sourceCols.has(c))];
 const rows=await source(`SELECT ${cols.join(',')} FROM ${table} WHERE published=1 AND outbound_date>=? ORDER BY id LIMIT 1001`,[day]);
 if(rows.length>1000)throw Error('RECOVERY_LIMIT_EXCEEDED_REVIEW_REQUIRED');
 const candidates=rows.filter(r=>eligible(r,day,now));
 const result={status:'diagnosed',targetCount,eligible:candidates.length,invalidOrExpired:rows.length-candidates.length,copied:0};
 if(!apply||!candidates.length)return result;
 // Recovery is an operator action, not a live fallback that could resurrect
 // deleted flights. Refuse a destination containing any unrelated rows.
 if(!targetExists)await target(ddl);
 const targetCols=new Set((await target(`PRAGMA table_info(${table})`)).map(c=>c.name));
 if(required.some(c=>!targetCols.has(c)))throw Error('TARGET_CURATED_SCHEMA_INCOMPATIBLE');
 const writeCols=cols.filter(c=>targetCols.has(c));
 const expected=new Map(candidates.map(r=>[r.id,r]));
 const existing=await target(`SELECT ${writeCols.join(',')} FROM ${table} LIMIT 1001`);
 if(existing.length>1000||existing.some(r=>!expected.has(r.id)||required.some(c=>r[c]!==expected.get(r.id)[c])))throw Error('TARGET_NOT_EMPTY_OR_CHANGED: recovery refused, no overwrite');
 const existingIDs=new Set(existing.map(r=>r.id));
 for(const row of candidates){
  if(existingIDs.has(row.id))continue;
  await target(`INSERT INTO ${table} (${writeCols.join(',')}) VALUES (${writeCols.map(()=>'?').join(',')})`,writeCols.map(c=>row[c]));
  result.copied++;
 }
 const after=Number((await target(`SELECT COUNT(*) n FROM ${table}`))[0].n);
 if(after!==candidates.length)throw Error('RECOVERY_COUNT_MISMATCH: inspect destination before continuing');
 return {...result,status:'recovered',targetCount:after};
}
export async function runRecovery(env=process.env,fetcher=fetch,config=JSON.parse(fs.readFileSync(new URL('../wrangler.generated.jsonc',import.meta.url),'utf8')),apply=false){
 if(config.name!=='iumrah-backend'||!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID||'')||!env.CLOUDFLARE_API_TOKEN)throw Error('RECOVERY_TARGET_INVALID');
 function db(binding,name){
  const item=config.d1_databases?.find(x=>x.binding===binding);
  if(!item||item.database_name!==name||item.database_id!==env[`${binding}_ID`]||!/^[a-f0-9-]{36}$/i.test(item.database_id))throw Error('RECOVERY_BINDING_MISMATCH:'+binding);
  return item;
 }
 const source=db('BOOKINGS_DB','iumrah-core'),target=db('HOTELS_DB','iumrah-hotels');
 if(source.database_id===target.database_id)throw Error('RECOVERY_SAME_DB');
 function query(item){return async(sql,params=[])=>{
  const response=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${item.database_id}/query`,{method:'POST',headers:{Authorization:`Bearer ${env.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data?.success||!data.result?.[0]?.success)throw Error('RECOVERY_D1_QUERY_FAILED:'+item.binding+':HTTP_'+response.status);
  return data.result[0].results||[];
 };}
 return recoverCurated({source:query(source),target:query(target),apply});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log('Curated catalog recovery:',JSON.stringify(await runRecovery(process.env,fetch,undefined,process.argv.includes('--apply'))));}
 catch(e){console.error('CURATED_RECOVERY_FAILED:',e.message);process.exitCode=1;}
}
