// Add only missing auxiliary PackageEngine tables. Never create replacement
// identity/booking databases or rebuild/drop existing tables.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const config = new URL('../wrangler.generated.jsonc',import.meta.url);
const cfg=JSON.parse(fs.readFileSync(config,'utf8'));
const hotel=cfg.d1_databases?.find(x=>x.binding==='HOTELS_DB');
const booking=cfg.d1_databases?.find(x=>x.binding==='BOOKINGS_DB');
if(cfg.name!=='iumrah-backend'||hotel?.database_name!=='iumrah-hotels'||!booking?.database_id||hotel.database_id===booking.database_id) throw Error('PACKAGE_SCHEMA_UNEXPECTED_DATABASE_TARGET');
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!/^[a-f0-9]{32}$/i.test(account||'')||!token) throw Error('PACKAGE_SCHEMA_CLOUDFLARE_ACCESS_REQUIRED');
async function query(db,sql){
 const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${db.database_id}/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql})});
 const data=await r.json().catch(()=>null);
 if(!r.ok||!data?.success||!data.result?.[0]?.success) throw Error(`PACKAGE_SCHEMA_READ_FAILED: ${db.binding} HTTP ${r.status}: ${sql}`);
 return data.result[0].results||[];
}
for(const [db,sql] of [[hotel,'SELECT id,status FROM hotels LIMIT 0'],[hotel,'SELECT id,phone,email FROM pilgrims LIMIT 0'],[hotel,'SELECT pilgrim_id,password_hash,password_iterations FROM iumrah_accounts LIMIT 0'],[hotel,'SELECT token_hash,pilgrim_id,expires_at,revoked_at FROM iumrah_account_sessions LIMIT 0'],[hotel,'SELECT pilgrim_id,booking_id FROM pilgrim_trips LIMIT 0'],[booking,'SELECT id,access_token_hash,payload_json FROM bookings LIMIT 0']]) await query(db,sql);
const source=fileURLToPath(new URL('../migrations/0001_package_compatibility_additive.sql',import.meta.url));
const result=spawnSync('npx',['wrangler','d1','execute','HOTELS_DB','--remote','--file',source,'--config',fileURLToPath(config)],{stdio:'inherit',cwd:fileURLToPath(new URL('../',import.meta.url)),shell:false});
if(result.status!==0) throw Error(`PACKAGE_ADDITIVE_SCHEMA_FAILED:${result.status}`);
console.log('Package compatibility tables verified on existing HOTELS_DB; no row migration or new databases.');
