import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackendRouter,resolveBackendRoute} from '../src/router.js';
import {cutoverStatus} from '../src/cutover.js';
const packagePaths=['/api/package/health','/api/package/flights/detail','/api/admin/package/flights/curated','/.well-known/apple-app-site-association','/hotel/123','/h/123'];
test('package contracts are served by a module of the unified Worker, without changing hotel or flight routing',async()=>{
 const calls=[];
 const handler=name=>({fetch:async(req,env)=>{calls.push([name,new URL(req.url).pathname,env]);return new Response(name)}});
 const env={HOTELS_DB:{},BOOKINGS_DB:{},FLIGHTS_DB:{}};
 const router=createBackendRouter({hotels:handler('hotels'),flights:handler('flights'),packages:handler('packages'),requestAeroDataBox:async(actual,url)=>({actual,url})});
 for(const p of packagePaths){assert.equal(resolveBackendRoute(p),'packages');const res=await router.fetch(new Request('https://example.test'+p),env);assert.equal(await res.text(),'packages');assert.equal(calls.at(-1)[2].HOTELS_DB,env.HOTELS_DB)}
 for(const p of ['/api/admin/hotels','/api/flight-hub/v1/public/flights']){await router.fetch(new Request('https://example.test'+p),env);const routed=calls.at(-1)[2];assert.equal((await routed.IUMRAH_AERO_REQUEST('test')).actual,env)}
 for(const p of ['/api/packages-misleading','/api/admin/package-malicious'])assert.equal(resolveBackendRoute(p),'missing');
});
test('cutover never falsely declares the missing core implemented or old data safe to delete',async()=>{
 const db=names=>({prepare:sql=>{assert.match(sql,/^SELECT/);return {all:async()=>({results:names.map(name=>({name}))})}}});
 const status=await cutoverStatus({HOTELS_DB:db(['hotels','primary_hotels','hotel_price_cache']),BOOKINGS_DB:db([]),FLIGHTS_DB:db(['flights','flight_offers'])});
 assert.equal(status.readiness.catalog,true);assert.equal(status.readiness.operations,false);assert.equal(status.readiness.bookingStore,false);assert.equal(status.readiness.flightCatalog,true);assert.equal(status.coreHandlersInstalled,false);assert.equal(status.dataParityVerified,false);assert.equal(status.legacyRetirementAllowed,false);
});
test('package cron starts only with core cutover and explicit scheduler enablement',async()=>{
 let n=0;const module={fetch(){},scheduled(){n++}};const router=createBackendRouter({hotels:module,flights:module,packages:module,core:module});
 const event={cron:'*/5 * * * *',scheduledTime:Date.UTC(2026,10,13,5,0)};
 const env={IUMRAH_CORE_CUTOVER_READY:'1',IUMRAH_CORE_PARITY_ATTESTATION:'v21:'+'a'.repeat(64),HOTELS_MEDIA:{},BOOKINGS_DB:{},HOTELS_DB:{},FLIGHTS_DB:{},PASSPORTS:{},IUMRAH_SESSION_SECRET:'test',IUMRAH_SUPERADMIN_PASSWORD:'test',PACKAGE_QUOTE_SEAL_KEY:'test'};
 await router.scheduled(event,{},{});assert.equal(n,0);
 await router.scheduled(event,env,{});assert.equal(n,0);
 await router.scheduled(event,{...env,IUMRAH_PACKAGE_CRON_ENABLED:'1'},{});assert.equal(n,1);
});

test('newly imported account and booking mutations cannot write to an unverified Core',async()=>{
 let called=false;const module={fetch(){called=true;return new Response('unexpected')}};
 const router=createBackendRouter({hotels:module,flights:module,packages:module});
 for(const path of ['/api/package/quote','/api/package/quote/commit/123','/api/package/client/account/login','/api/package/booking/123','/api/admin/package/booking/123','/api/package/storefront/quote']){
   const result=await router.fetch(new Request('https://example.test'+path,{method:'POST'}),{},{});
   assert.equal(result.status,503);assert.equal((await result.json()).error,'CORE_CUTOVER_PENDING');
 }
 assert.equal(called,false);
});

test('legacy activation flag alone cannot unlock private data or mutations',async()=>{
 const module={fetch(){throw Error('must not dispatch')}};
 const router=createBackendRouter({hotels:module,flights:module,packages:module,core:module});
 const env={IUMRAH_CORE_CUTOVER_READY:'1',BOOKINGS_DB:{},HOTELS_DB:{},FLIGHTS_DB:{},HOTELS_MEDIA:{},PASSPORTS:{},IUMRAH_SESSION_SECRET:'test',IUMRAH_SUPERADMIN_PASSWORD:'test',PACKAGE_QUOTE_SEAL_KEY:'test'};
 for(const path of ['/api/bookings','/api/package/client/account/login','/api/package/quote']) {
  const res=await router.fetch(new Request('https://example.test'+path,{method:'POST'}),env,{});assert.equal(res.status,503);
 }
});
