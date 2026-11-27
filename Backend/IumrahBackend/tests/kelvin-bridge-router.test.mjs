import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createBackendRouter} from '../src/router.js';
import {kelvinAdmin} from '../../HotelsWorker/src/kelvin.js';
const base='https://iumrah-backend.helloiumrah.workers.dev';
const appBase='/api/admin/hotels/kelvin/';
const macBase='/api/internal/kelvin/';
const user={role:'superadmin',login:'owner'};
const session={session_id:'fixture'};
function fixture(){
 const sql=new DatabaseSync(':memory:');
 function wrap(query,args=[]){return {bind:(...v)=>wrap(query,v),run:async()=>({meta:sql.prepare(query).run(...args)}),first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({results:sql.prepare(query).all(...args)})}}
 const db={prepare:wrap,batch:async xs=>{for(const x of xs)await x.run();}};
 const env={HOTELS_DB:db,BOOKINGS_DB:db,FLIGHTS_DB:db,HOTELS_MEDIA:{},PASSPORTS:{},IUMRAH_SESSION_SECRET:'fixture',IUMRAH_SUPERADMIN_PASSWORD:'fixture',PACKAGE_QUOTE_SEAL_KEY:'fixture',IUMRAH_CORE_CUTOVER_READY:'1',IUMRAH_CORE_PARITY_ATTESTATION:'v21:'+'a'.repeat(64)};
 // Simulate the existing staff middleware boundary. Actual admin handler and
 // actual unified router / internal service authorization run below.
 const hotels={fetch:(req,e)=>kelvinAdmin(req,e,req.headers.get('authorization')==='Bearer fixture-staff'?user:null,req.headers.get('authorization')==='Bearer fixture-staff'?session:null)};
 const router=createBackendRouter({hotels,flights:{fetch(){throw Error('wrong route')}},core:{fetch(){throw Error('wrong route')}}});
 const call=(path,body,token,origin,environment=env)=>router.fetch(new Request(base+path,{method:body===undefined?'GET':'POST',headers:{...(token?{authorization:'Bearer '+token}:{}),...(origin?{origin}:{}),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),environment,{});
 return {call,env,sql};
}
function trace(r,stage){assert.equal(r.headers.get('x-kelvin-bridge-revision'),'kelvin-bridge-diagnostics-v5');assert.match(r.headers.get('x-kelvin-request-id'),/^[a-f0-9-]{36}$/);assert.equal(r.headers.get('x-kelvin-stage'),stage);}
test('real router heartbeat: origin rejection is 403, missing/invalid service token is 401, readiness is 503',async()=>{
 const {call,env}=fixture();
 let r=await call(macBase+'heartbeat',{},'a'.repeat(64),'https://not-allowed.example'); assert.equal(r.status,403);trace(r,'origin');assert.equal((await r.json()).error,'CROSS_ORIGIN_REQUEST');
 r=await call(macBase+'heartbeat',{},'a'.repeat(64));assert.equal(r.status,401);trace(r,'service-auth-handler');assert.equal((await r.json()).error,'UNAUTHORIZED');
 r=await call(macBase+'heartbeat',{});assert.equal(r.status,401);trace(r,'service-auth-handler');
 r=await call(macBase+'heartbeat',{},undefined,undefined,{...env,IUMRAH_CORE_CUTOVER_READY:'0'});assert.equal(r.status,503);trace(r,'core-readiness');
 r=await call(appBase+'pair',{});assert.equal(r.status,403);trace(r,'staff-auth-handler');
});
test('pair -> heartbeat -> app/Telegram memory + queue through actual unified router; key rotation preserves memory',async()=>{
 const {call,sql}=fixture(); const staff='fixture-staff';
 let r=await call(appBase+'pair',{},staff);assert.equal(r.status,200);trace(r,'staff-auth-handler');const {token}=await r.json();assert.match(token,/^[a-f0-9]{64}$/);assert.notEqual(sql.prepare('SELECT token_hash FROM kelvin_links').get().token_hash,token);
 r=await call(macBase+'heartbeat',{},token);assert.equal(r.status,200);trace(r,'service-auth-handler');assert.deepEqual(await r.json(),{ok:true});
 assert.equal((await (await call(appBase+'history',undefined,staff)).json()).online,true);
 assert.equal((await call(appBase+'remember',{id:'note-app-123',content:'Test memory'},staff)).status,200);
 assert.equal((await (await call(macBase+'memory',{},token)).json()).notes[0].content,'Test memory');
 assert.equal((await call(macBase+'remember',{id:'note-tg-123',content:'Test Telegram note'},token)).status,200);
 assert.equal((await (await call(appBase+'memory',undefined,staff)).json()).notes.length,2);
 assert.equal((await call(appBase+'message',{id:'test-app-123',prompt:'Test prompt'},staff)).status,200);
 const claim=await (await call(macBase+'claim',{},token)).json();assert.equal(claim.job.id,'test-app-123');assert.equal(claim.memory.length,2);
 assert.equal((await call(macBase+'finish',{id:claim.job.id,lease:claim.job.lease,status:'done',answer:'Test response'},token)).status,200);
 assert.equal((await call(macBase+'message',{id:'test-tg-123',prompt:'Continue'},token)).status,200);
 const next=await (await call(macBase+'claim',{},token)).json();assert.equal(next.history[0].answer,'Test response');
 const newer=(await (await call(appBase+'pair',{},staff)).json()).token;
 assert.equal((await call(macBase+'heartbeat',{},token)).status,401);
 assert.equal((await call(macBase+'heartbeat',{},newer)).status,200);
 assert.equal((await (await call(macBase+'memory',{},newer)).json()).notes.length,2);
});
test('trace does not change other routes or permit an invalid origin with a valid key',async()=>{
 const {call}=fixture(); const token=(await (await call(appBase+'pair',{},'fixture-staff')).json()).token;
 const r=await call(macBase+'heartbeat',{},token,'null');assert.equal(r.status,403);trace(r,'origin');
 const unrelated=await call('/api/admin/hotels/other',{},undefined,'https://not-allowed.example');assert.equal(unrelated.status,403);assert.equal(unrelated.headers.get('x-kelvin-bridge-revision'),null);
});
