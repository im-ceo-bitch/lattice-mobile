import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';import {ensureSchema,applyPackageSchema} from '../scripts/apply-package-schema.mjs';
const schema=JSON.parse(fs.readFileSync(new URL('../schema/bootstrap-v9.json',import.meta.url)));
function fixture(){const db=new DatabaseSync(':memory:');const query=async sql=>{assert.doesNotMatch(sql,/^\s*(DELETE|DROP|UPDATE|INSERT|REPLACE)\b/i);return db.prepare(sql).all();};return {db,query};}
test('new hotel D1 with intelligence tables only is bootstrapped, not reset',async()=>{const {db,query}=fixture();db.exec(fs.readFileSync(new URL('../../HotelsWorker/migrations/0044_business_intelligence.sql',import.meta.url),'utf8'));await ensureSchema(query,schema.HOTELS_DB,'HOTELS_DB');db.exec("INSERT INTO hotels(id,slug,name,city) VALUES('keep','keep','Keep','Makkah')");const result=await ensureSchema(query,schema.HOTELS_DB,'HOTELS_DB');assert.equal(result.created,0);assert.equal(result.added,0);assert.equal(db.prepare('SELECT name FROM hotels').get().name,'Keep');});
test('new bookings D1 schema includes booking documents and room columns; repeat is safe',async()=>{const {db,query}=fixture();await ensureSchema(query,schema.BOOKINGS_DB,'BOOKINGS_DB');assert.ok(db.prepare('PRAGMA table_info(bookings)').all().some(x=>x.name==='makkah_room_id'));assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='booking_documents'").get());assert.equal((await ensureSchema(query,schema.BOOKINGS_DB,'BOOKINGS_DB')).created,0);});
test('non-additive changes are rejected rather than fabricated',async()=>{const {db,query}=fixture();db.exec('CREATE TABLE hotels(id TEXT PRIMARY KEY)');await assert.rejects(ensureSchema(query,schema.HOTELS_DB,'HOTELS_DB'),/SCHEMA_INCOMPATIBLE/);});

// Exercise the exact deployment entry point against a local Cloudflare-shaped
// query transport. IDs must match discovery; two runs must preserve real rows.
test('remote schema deploy path repairs the discovered partial databases and is safe on retry',async()=>{
 const hotels=new DatabaseSync(':memory:'),bookings=new DatabaseSync(':memory:');
 try {
  hotels.exec(fs.readFileSync(new URL('../../HotelsWorker/migrations/0044_business_intelligence.sql',import.meta.url),'utf8'));
  const ids=['11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222'];
  const bindings=['HOTELS_DB','BOOKINGS_DB'];
  const config={name:'iumrah-backend',d1_databases:bindings.map((binding,i)=>({binding,database_id:ids[i]}))};
  const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'fixture',HOTELS_DB_ID:ids[0],BOOKINGS_DB_ID:ids[1]};
  const databases=new Map([[ids[0],hotels],[ids[1],bookings]]);let calls=0;
  const transport=async(url,init)=>{
   assert.equal(init.method,'POST');assert.equal(init.headers.Authorization,'Bearer fixture');
   const db=databases.get(url.split('/').at(-2));assert.ok(db);const {sql}=JSON.parse(init.body);calls++;
   assert.doesNotMatch(sql,/^\s*(DELETE|DROP|UPDATE|INSERT|REPLACE)\b/i);
   return Response.json({success:true,result:[{success:true,results:db.prepare(sql).all()}]});
  };
  await applyPackageSchema(env,transport,config);
  hotels.exec("INSERT INTO pilgrims(id,display_name) VALUES(42,'Existing account')");
  await applyPackageSchema(env,transport,config);
  assert.equal(hotels.prepare('SELECT display_name FROM pilgrims WHERE id=42').get().display_name,'Existing account');
  assert.ok(bookings.prepare("SELECT name FROM sqlite_master WHERE name='bookings'").get());
  const before=calls;await assert.rejects(applyPackageSchema({...env,HOTELS_DB_ID:ids[1]},transport,config),/SCHEMA_TARGET_MISMATCH/);assert.equal(calls,before);
 } finally {hotels.close();bookings.close();}
});
