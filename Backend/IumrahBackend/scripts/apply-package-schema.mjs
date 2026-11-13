// Additive schema bootstrap for existing, explicitly discovered D1 resources.
// Only DDL from the reviewed final schema is executed; no legacy reset migrations or data copy.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const snapshot=JSON.parse(fs.readFileSync(new URL('../schema/bootstrap-v21.json',import.meta.url),'utf8'));
const ident=s=>{if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s))throw Error('INVALID_SCHEMA_IDENTIFIER');return '"'+s+'"';};
const constant=s=>s===null||/^(?:NULL|[-+]?\d+(?:\.\d+)?|'(?:[^']|'')*')$/i.test(s);
export async function ensureSchema(query, schema, binding) {
 const existing=new Set((await query("SELECT name FROM sqlite_master WHERE type='table'")).map(x=>x.name));
 let created=0,added=0;
 for(const table of schema.tables){
  if(!existing.has(table.name)) {await query(table.sql);created++;continue;}
  const actual=new Map((await query(`PRAGMA table_info(${ident(table.name)})`)).map(x=>[x.name,x]));
  for(const col of table.columns){
   if(actual.has(col.name))continue;
   // Never weaken a key or invent required values for existing rows.
   if(col.pk||!constant(col.default)||(col.notnull&&col.default===null)||! /^(?:TEXT|INTEGER|REAL|BLOB|NUMERIC|)$/i.test(col.type))throw Error(`SCHEMA_INCOMPATIBLE:${binding}.${table.name}.${col.name}: explicit migration needed`);
   const definition=[ident(col.name),col.type,col.notnull?'NOT NULL':'',col.default!==null?'DEFAULT '+col.default:''].filter(Boolean).join(' ');
   await query(`ALTER TABLE ${ident(table.name)} ADD COLUMN ${definition}`);added++;
  }
 }
 for(const idx of schema.indexes)await query(idx.sql);
 // Actual SQL, not binding presence alone.
 if(binding==='HOTELS_DB')for(const sql of ['SELECT id,status FROM hotels LIMIT 0','SELECT hotel_id,nightly_price_usd FROM hotel_price_cache LIMIT 0','SELECT hotel_id FROM primary_hotels LIMIT 0','SELECT id FROM pilgrims LIMIT 0'])await query(sql);
 if(binding==='BOOKINGS_DB')for(const sql of ['SELECT id,access_token_hash FROM bookings LIMIT 0','SELECT booking_id FROM booking_events LIMIT 0','SELECT booking_id FROM booking_documents LIMIT 0'])await query(sql);
 return {created,added};
}
export async function applyPackageSchema(env=process.env,fetcher=fetch,config=JSON.parse(fs.readFileSync(new URL('../wrangler.generated.jsonc',import.meta.url),'utf8'))){
 if(config.name!=='iumrah-backend'||!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID||'')||!env.CLOUDFLARE_API_TOKEN)throw Error('INVALID_SCHEMA_DEPLOY_TARGET');
 for(const [binding,schema] of Object.entries(snapshot)){
  const db=config.d1_databases?.find(x=>x.binding===binding);
  if(!db||db.database_id!==env[`${binding}_ID`]||! /^[a-f0-9-]{36}$/i.test(db.database_id))throw Error(`SCHEMA_TARGET_MISMATCH:${binding}`);
  const endpoint=`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${db.database_id}/query`;
  const query=async sql=>{
   const res=await fetcher(endpoint,{method:'POST',headers:{Authorization:`Bearer ${env.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({sql})});
   const data=await res.json().catch(()=>null);
   if(!res.ok||!data?.success||!data.result?.[0]?.success)throw Error(`SCHEMA_D1_FAILED:${binding}: HTTP ${res.status}; ${String(data?.errors?.[0]?.message||'query failed').slice(0,300)}`);
   return data.result[0].results||[];
  };
  const result=await ensureSchema(query,schema,binding);
  console.log(`${binding}: schema verified, created ${result.created} tables, added ${result.added} columns; existing rows preserved.`);
 }
 console.log('Schema readiness only; existing user/booking data parity and R2 migration are NOT verified. Core cutover remains gated.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await applyPackageSchema().catch(e=>{console.error(e.message);process.exitCode=1;});
