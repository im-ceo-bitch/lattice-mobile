import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackendRouter,resolveBackendRoute} from '../src/router.js';
const hotelRoutes = ['/api/admin/hotels','/api/admin/hotels/intelligence','/api/catalog/hotels/intelligence/events','/api/catalog/ziyarats','/api/admin/ziyarats/123','/flights-feed/latest','/.well-known/oauth-authorization-server'];
const flightRoutes = ['/api/flight-hub/v1/public/flights','/api/flight-hub/health','/v1/public/flights','/v1/ingest/ignav','/health'];
test('preserves exact existing hotel endpoints',()=>hotelRoutes.forEach(p=>assert.equal(resolveBackendRoute(p),'hotels',p)));
test('routes old and unified flight API into same flight handler',()=>flightRoutes.forEach(p=>assert.equal(resolveBackendRoute(p),'flights',p)));
test('does not intercept unrelated website authentication and bookings',()=>{
  for(const p of ['/api/bookings','/api/auth/staff/session','/api/catalog/hotels-malicious','/api/flight-hubby/v1/public/flights','/favicon.ico']) assert.equal(resolveBackendRoute(p),'missing',p);
});
test('existing handlers receive original request and environment unchanged',async()=>{
  const calls=[];
  const service = name=>({fetch:async(request,env,ctx)=>{calls.push([name,new URL(request.url).pathname,env,ctx]);return new Response(name);},scheduled:async()=>calls.push(['cron',name])});
  const router=createBackendRouter({hotels:service('hotels'),flights:service('flights')});
  const env={HOTELS_DB:{},FLIGHTS_DB:{},BOOKINGS_DB:{},HOTELS_MEDIA:{}};
  const ctx={waitUntil(){}};
  const res=await router.fetch(new Request('https://iumrah-backend.example.workers.dev/api/flight-hub/v1/public/flights'),env,ctx);
  assert.equal(await res.text(),'flights');
  assert.deepEqual(calls[0],['flights','/api/flight-hub/v1/public/flights',env,ctx]);
  const res2=await router.fetch(new Request('https://iumrah.app/api/admin/hotels/intelligence'),env,ctx);
  assert.equal(await res2.text(),'hotels');
});
test('health distinguishes presence of bindings from actual DB health',async()=>{
  const router=createBackendRouter({hotels:{fetch(){}},flights:{fetch(){}}});
  const missing=await router.fetch(new Request('https://example.com/__iumrah/health'),{HOTELS_DB:{}});
  assert.equal(missing.status,503);
  assert.equal((await missing.json()).kind,'binding-presence-only');
  const ready=await router.fetch(new Request('https://example.com/__iumrah/health'),{HOTELS_DB:{},BOOKINGS_DB:{},FLIGHTS_DB:{},HOTELS_MEDIA:{}});
  assert.equal(ready.status,200);
});
test('cron executes exactly one relevant subsystem',async()=>{
  const seen=[];
  const router=createBackendRouter({hotels:{fetch(){},scheduled:async()=>seen.push('gemini')},flights:{fetch(){},scheduled:async()=>seen.push('cleanup')}});
  await router.scheduled({cron:'0 3 * * *'},{},{});
  await router.scheduled({cron:'15 1 * * *'},{},{});
  await router.scheduled({cron:'0 * * * *'},{},{});
  assert.deepEqual(seen,['gemini','cleanup']);
});
