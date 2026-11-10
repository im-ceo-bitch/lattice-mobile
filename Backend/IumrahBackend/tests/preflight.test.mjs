import test from 'node:test';
import assert from 'node:assert/strict';
import {check} from '../scripts/preflight.mjs';
const env={
 CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'test-token',
 HOTELS_DB_ID:'11111111-1111-1111-1111-111111111111',BOOKINGS_DB_ID:'22222222-2222-2222-2222-222222222222',
 FLIGHTS_DB_ID:'33333333-3333-3333-3333-333333333333',BOOKINGS_DB_NAME:'iumrah-core',HOTELS_MEDIA_BUCKET:'iumrah-hotels-media'
};
const names=new Map([[env.HOTELS_DB_ID,'iumrah-hotels'],[env.BOOKINGS_DB_ID,'iumrah-core'],[env.FLIGHTS_DB_ID,'iumrah-flights']]);
function fakeFetch(url,init={}) {
 if (url.endsWith('/query')) {
   const id=url.split('/').at(-2);
   const tables=id===env.HOTELS_DB_ID?[]:id===env.BOOKINGS_DB_ID?['bookings']:['flights','flight_offers'];
   return Promise.resolve({ok:true,status:200,json:async()=>({success:true,result:[{results:tables.map(name=>({name}))}]})});
 }
 const id=url.split('/').pop();
 const name=names.get(id)||(url.includes('/r2/buckets/')?'iumrah-hotels-media':null);
 return Promise.resolve({ok:!!name,status:name?200:404,json:async()=>({success:true,result:{name}})});
}
test('missing old hotels table yields a visible warning, not false discovery failure',async()=>{
 const result=await check(env,fakeFetch);
 assert.ok(result.some(x=>x.includes('WARNING HOTELS_DB')));
 assert.ok(result.some(x=>x.includes('BOOKINGS_DB: confirmed')));
});
test('an unavailable R2 may be omitted in staging but is explicitly reported',async()=>{
 const result=await check({...env,HOTELS_MEDIA_BUCKET:'none'},fakeFetch);
 assert.ok(result.some(x=>x.includes('WARNING HOTELS_MEDIA')));
});
test('missing D1 blocks publishing and no replacement database is created',async()=>{
 await assert.rejects(check({...env,FLIGHTS_DB_ID:'44444444-4444-4444-4444-444444444444'},fakeFetch),/HTTP 404/);
});
test('D1 name mismatch blocks publishing',async()=>{
 await assert.rejects(check({...env,BOOKINGS_DB_NAME:'other'},fakeFetch),/not named/);
});

test('allows only known schedules for a single unified Worker',async()=>{
 const result=await check({...env, IUMRAH_ENABLE_SCHEDULED_JOBS:'1'}, fakeFetch);
 assert.ok(result.some(x=>x.includes('HOTELS_DB: confirmed')));
});
