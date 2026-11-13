import test from 'node:test';
import assert from 'node:assert/strict';
import {buildConfig} from '../scripts/render-config.mjs';
const IDs={HOTELS_DB_ID:'11111111-1111-1111-1111-111111111111',BOOKINGS_DB_ID:'22222222-2222-2222-2222-222222222222',FLIGHTS_DB_ID:'33333333-3333-3333-3333-333333333333',BOOKINGS_DB_NAME:'iumrah-core'};
test('one worker, three bound D1 databases and staging without destructive route takeover',()=>{
  const cfg=buildConfig(IDs);
  assert.equal(cfg.name,'iumrah-backend');
  assert.equal(cfg.main,'src/index.js');
  assert.equal(cfg.d1_databases.length,3);
  assert.deepEqual(cfg.d1_databases.map(x=>x.binding),['HOTELS_DB','BOOKINGS_DB','FLIGHTS_DB']);
  assert.deepEqual(cfg.routes,[]);
  assert.deepEqual(cfg.triggers.crons,[]);
  assert.equal(cfg.workflows[0].class_name,'HotelImportWorkflow');
  assert.equal(cfg.workflows[0].name,'iumrah-backend-hotel-import');
});
test('rejects missing, duplicate and malformed production database IDs',()=>{
  assert.throws(()=>buildConfig({...IDs,BOOKINGS_DB_ID:undefined}),/BOOKINGS_DB_ID/);
  assert.throws(()=>buildConfig({...IDs,FLIGHTS_DB_ID:IDs.HOTELS_DB_ID}),/DISTINCT/);
  assert.throws(()=>buildConfig({...IDs,BOOKINGS_DB_NAME:'bad database'}),/BOOKINGS_DB_NAME/);
});
test('missing media bucket is supported for staging without R2 binding',()=>{
  const cfg=buildConfig({...IDs,HOTELS_MEDIA_BUCKET:'none'});
  assert.equal(cfg.r2_buckets.length,0);
});
test('route cutover requires zone ID; crons remain explicit opt in',()=>{
  assert.throws(()=>buildConfig({...IDs,IUMRAH_ENABLE_ROUTE_CUTOVER:'1'}),/CLOUDFLARE_ZONE_ID/);
  const cfg=buildConfig({...IDs,IUMRAH_ENABLE_ROUTE_CUTOVER:'1',CLOUDFLARE_ZONE_ID:'a'.repeat(32),IUMRAH_ENABLE_SCHEDULED_JOBS:'1'});
  assert.ok(cfg.routes.some(x=>x.pattern.includes('/api/flight-hub')));
  assert.deepEqual(cfg.triggers.crons,['*/5 * * * *']);
});
