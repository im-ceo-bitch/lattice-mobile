import test from 'node:test';
import assert from 'node:assert/strict';
import {publicServices} from '../src/public-services.js';
import catalog from '../src/advisor-catalog.js';
import {createBackendRouter} from '../src/router.js';
const req=p=>new Request('https://iumrah-backend.helloiumrah.workers.dev'+p);
const fail=()=>{throw Error('Unexpected upstream');};
test('all reviewed advisor entries and exact audio routes are available without Supabase credentials',async()=>{
 for(const [lang,entries] of Object.entries(catalog.translations)){
  const response=await publicServices(req('/api/services/advisor/translations?lang='+lang),fail);
  assert.deepEqual(Object.fromEntries((await response.json()).map(x=>[x.key,x.value])),entries);
 }
 for(const [lang,entries] of Object.entries(catalog.audio)){
  const response=await publicServices(req('/api/services/advisor/audio?lang='+lang),fail);
  for(const row of await response.json()){
   const audio=await publicServices(req(row.url),async(url,options)=>{
    assert.equal(url,entries[row.key]);assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);
    return new Response(new Uint8Array([73,68,51]),{headers:{'content-type':'audio/mpeg','set-cookie':'private=x'}});
   });
   assert.equal(audio.status,200);assert.equal(audio.headers.get('set-cookie'),null);assert.equal((await audio.arrayBuffer()).byteLength,3);
  }
 }
 assert.deepEqual(await (await publicServices(req('/api/services/advisor/audio?lang=fr'),fail)).json(),[]);
});
test('prayer, weather and exchange rates preserve client contract with fixed upstream destinations',async()=>{
 const cases=[['/api/services/prayer?city=makkah&date=13-11-2026','https://api.aladhan.com/v1/timings/13-11-2026?latitude=21.4225&longitude=39.8262&method=4&school=0',{code:200,data:{timings:{Fajr:'05:00'}}}],['/api/services/weather?city=madinah','https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=24.4672&lon=39.6111',{properties:{timeseries:[{}]}}],['/api/services/fx','https://cbu.uz/en/arkhiv-kursov-valyut/json/',[{Ccy:'USD',Rate:'12000'}]]];
 for(const [p,u,d] of cases){const r=await publicServices(req(p),async url=>{assert.equal(url,u);return Response.json(d)});assert.equal(r.status,200);assert.deepEqual(await r.json(),d);}
});
test('rejects invalid inputs, arbitrary audio URLs, provider redirects and invalid responses',async()=>{
 for(const p of ['/api/services/prayer?city=makkah&date=31-02-2026','/api/services/weather?city=constructor','/api/services/advisor/audio?lang=__proto__','/api/services/advisor/audio/en/unknown','/api/services/advisor/audio/xx/tawaf_1']){
  const r=await publicServices(req(p),()=>{assert.fail('unexpected network');});assert.ok([400,404].includes(r.status));
 }
 for(const f of [async()=>Response.redirect('https://evil.example/'),async()=>Response.json({bad:true}),async()=>{throw Error('offline');}])assert.equal((await publicServices(req('/api/services/fx'),f)).status,502);
 assert.equal((await publicServices(req('/api/services/advisor/audio/en/tawaf_1'),async()=>new Response('<html>',{headers:{'content-type':'text/html'}}))).status,502);
 assert.equal((await publicServices(new Request(req('/api/services/fx'),{method:'POST'}),fail)).status,405);
});
test('router preserves public catalog and blocks private HotelsWorker bypass before activation',async()=>{
 const handler={fetch(){return new Response('called')}};const router=createBackendRouter({hotels:handler,flights:handler,packages:handler,core:handler});
 for(const p of ['/api/catalog/hotels/client/trips/1234','/api/catalog/hotels/%63lient/trips/1234','/api/admin/hotels/operations','/api/admin/hotels/chats','/api/admin/hotels/security/sessions/register','/api/admin/hotels/push']){
  for(const method of ['GET','POST'])assert.equal((await router.fetch(new Request(req(p),{method}),{},{})).status,503);
 }
 assert.equal(await (await router.fetch(req('/api/catalog/hotels'),{},{})).text(),'called');
 assert.equal((await router.fetch(req('/api/services/health'),{},{})).status,200);
 const env={IUMRAH_CORE_CUTOVER_READY:'1',IUMRAH_CORE_PARITY_ATTESTATION:'v21:'+'a'.repeat(64),HOTELS_MEDIA:{},BOOKINGS_DB:{},HOTELS_DB:{},FLIGHTS_DB:{},PASSPORTS:{},IUMRAH_SESSION_SECRET:'test',IUMRAH_SUPERADMIN_PASSWORD:'test',PACKAGE_QUOTE_SEAL_KEY:'test'};
 assert.equal(await (await router.fetch(req('/api/catalog/hotels/client/trips/1234'),env,{})).text(),'called');
});
test('live Advisor edits pass through only known keys and safe audio origins; offline catalogue remains available',async()=>{
 const first=Object.keys(catalog.translations.en)[0];
 const fake=async(url,options)=>{
  assert.match(url,/^https:\/\/coaqrsapnpyutsxflsru\.supabase\.co\/rest\/v1\//);
  assert.equal(options.redirect,'error');assert.equal(options.headers.apikey,'test-public-key');
  return Response.json([{key:first,value:'reviewed update'},{key:'unrelated_key',value:'ignored'}]);
 };
 const env={UMRAH_ADVISOR_SUPABASE_ANON_KEY:'test-public-key'};
 const rows=await (await publicServices(req('/api/services/advisor/translations?lang=en'),fake,env)).json();
 assert.equal(rows.find(x=>x.key===first).value,'reviewed update');assert.equal(rows.length,Object.keys(catalog.translations.en).length);
 const offline=await (await publicServices(req('/api/services/advisor/translations?lang=en'),async()=>{throw Error('offline')},env)).json();assert.equal(offline.length,rows.length);
 const audio=await (await publicServices(req('/api/services/advisor/audio?lang=en'),async()=>Response.json([{key:'tawaf_1',url:'https://evil.example/recording.mp3'}]),env)).json();
 assert.ok(audio.some(x=>x.key==='tawaf_1'&&x.url==='/api/services/advisor/audio/en/tawaf_1'));
});
test('Telegram outbox retry uses internal dispatch only after cutover and valid secret',async()=>{
 let calls=0;const handler={fetch(req){if(new URL(req.url).pathname==='/api/internal/telegram/retry'){assert.equal(req.headers.get('authorization'),'Bearer '+'a'.repeat(24));calls++;}return Response.json({ok:true});}};
 const router=createBackendRouter({hotels:handler,flights:handler,packages:handler,core:handler});
 const event={cron:'*/5 * * * *',scheduledTime:Date.UTC(2026,10,13,5,0)};
 const env={IUMRAH_CORE_CUTOVER_READY:'1',IUMRAH_CORE_PARITY_ATTESTATION:'v21:'+'a'.repeat(64),HOTELS_MEDIA:{},BOOKINGS_DB:{},HOTELS_DB:{},FLIGHTS_DB:{},PASSPORTS:{},IUMRAH_SESSION_SECRET:'test',IUMRAH_SUPERADMIN_PASSWORD:'test',PACKAGE_QUOTE_SEAL_KEY:'test',IUMRAH_TELEGRAM_RETRY_SECRET:'a'.repeat(24)};
 await router.scheduled(event,{...env,IUMRAH_CORE_CUTOVER_READY:'0'},{});assert.equal(calls,0);await router.scheduled(event,env,{});assert.equal(calls,1);
});
