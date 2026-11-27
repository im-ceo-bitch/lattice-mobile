import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {kelvinAdmin,kelvinInternal,snapshot} from '../../HotelsWorker/src/kelvin.js';
import {resolveBackendRoute} from '../src/router.js';
function db(){const sql=new DatabaseSync(':memory:');function wrap(query,args=[]){return {bind:(...v)=>wrap(query,v),run:async()=>({meta:sql.prepare(query).run(...args)}),first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({results:sql.prepare(query).all(...args)})}}return {sql,prepare:wrap,batch:async list=>{for(const x of list)await x.run();}}}
const owner={login:'Owner',role:'superadmin'}, session={session_id:'test'};
function request(path,body,token){return new Request('https://example.test'+path,{method:body===undefined?'GET':'POST',headers:{...(token?{authorization:'Bearer '+token}:{}),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
const app=(env,path,body,user=owner,sess=session)=>kelvinAdmin(request('/api/admin/hotels/kelvin/'+path,body),env,user,sess);
const mac=(env,path,body,token)=>kelvinInternal(request('/api/internal/kelvin/'+path,body,token),env);
async function paired(env){return (await (await app(env,'pair',{})).json()).token;}
test('route separation and strict role/device auth',async()=>{assert.equal(resolveBackendRoute('/api/internal/kelvin/claim'),'kelvin');assert.equal(resolveBackendRoute('/api/admin/hotels/kelvin/history'),'hotels');const env={HOTELS_DB:db()};assert.equal((await app(env,'history',undefined,{login:'Owner',role:'admin'})).status,403);assert.equal((await app(env,'history',undefined,owner,null)).status,403);assert.equal((await mac(env,'claim',{},'a'.repeat(64))).status,401);});
test('one shared history, deduplication, sequential claim, scoped note and result',async()=>{const env={HOTELS_DB:db(),BOOKINGS_DB:db(),FLIGHTS_DB:db()};const token=await paired(env);assert.match(token,/^[a-f0-9]{64}$/);assert.notEqual(env.HOTELS_DB.sql.prepare('SELECT token_hash FROM kelvin_links').get().token_hash,token);await app(env,'remember',{id:'note-123456',content:'Цель 20 поездок'});await app(env,'message',{id:'app-123456',prompt:'Первый вопрос'});await app(env,'message',{id:'app-123456',prompt:'Первый вопрос'});assert.equal((await app(env,'message',{id:'app-123456',prompt:'Другой'})).status,409);await mac(env,'message',{id:'tg-123456',prompt:'Продолжи',voice:true},token);const claim=await (await mac(env,'claim',{},token)).json();assert.equal(claim.job.id,'app-123456');assert.equal(claim.memory[0].content,'Цель 20 поездок');assert.equal((await (await mac(env,'claim',{},token)).json()).job,null);assert.equal((await mac(env,'finish',{id:claim.job.id,lease:'wrong',status:'done',answer:'x'},token)).status,409);assert.equal((await mac(env,'finish',{id:claim.job.id,lease:claim.job.lease,status:'done',answer:'Ответ из Mac'},token)).status,200);const next=await (await mac(env,'claim',{},token)).json();assert.equal(next.job.id,'tg-123456');assert.equal(next.job.voice,true);assert.equal(next.history[0].answer,'Ответ из Mac');const h=await (await app(env,'history')).json();assert.equal(h.turns.length,2);assert.equal(h.online,true);assert.equal(h.turns[0].answer,'Ответ из Mac');assert.equal((await (await app(env,'history',undefined,{login:'other',role:'superadmin'})).json()).turns.length,0);});
test('key rotation fences old claim, requeues, revoke and secrets rejected',async()=>{const env={HOTELS_DB:db()};const old=await paired(env);await app(env,'message',{id:'job-123456',prompt:'test'});const first=await (await mac(env,'claim',{},old)).json();const replacement=await paired(env);assert.equal((await mac(env,'finish',{id:first.job.id,lease:first.job.lease,status:'done',answer:'bad'},old)).status,401);const second=await (await mac(env,'claim',{},replacement)).json();assert.equal(second.job.id,first.job.id);assert.notEqual(second.job.lease,first.job.lease);assert.equal((await app(env,'message',{id:'job-987654',prompt:'a'.repeat(64)})).status,400);await app(env,'revoke',{});assert.equal((await mac(env,'claim',{},replacement)).status,401);});
test('aggregate query uses real schema columns, excludes personal fields and missing is unknown',async()=>{const env={HOTELS_DB:db(),BOOKINGS_DB:db(),FLIGHTS_DB:db()};env.BOOKINGS_DB.sql.exec(`CREATE TABLE bookings(id TEXT,status TEXT,created_at TEXT,updated_at TEXT,start_date TEXT,end_date TEXT,origin_code TEXT,outbound_destination TEXT,return_origin TEXT,traveler_count INTEGER,rooms INTEGER,total_cents INTEGER,flight_name TEXT,makkah_hotel TEXT,madinah_hotel TEXT,passport TEXT); INSERT INTO bookings VALUES('IUM-2026-ABCDEFG','paid','2099-01-01','2099-01-01','2099-01-01','2099-02-01','TAS','JED','MED',2,1,200000,'flight','hotel','hotel','PRIVATE'); CREATE TABLE telegram_care_threads(mode TEXT,topic TEXT); INSERT INTO telegram_care_threads VALUES('human','price');`);const result=await snapshot(env,'Проверь IUM-2026-ABCDEFG');assert.equal(result.data.bookingsByStatus.rows[0].count,1);assert.equal(result.data.requestedBooking.rows[0].id,'IUM-2026-ABCDEFG');assert.equal(result.data.telegramCareThreads.rows[0].count,1);assert.equal(result.data.hotels.available,false);assert.ok(!JSON.stringify(result).includes('PRIVATE'));});

test('migration preserves legacy history; new threads have independent titles and model context',async()=>{
 const env={HOTELS_DB:db()};
 env.HOTELS_DB.sql.exec(`CREATE TABLE kelvin_turns (seq INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, request_id TEXT NOT NULL, source TEXT NOT NULL, prompt TEXT NOT NULL, voice INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'queued', answer TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, UNIQUE(owner,request_id)); INSERT INTO kelvin_turns(owner,request_id,source,prompt,status,answer,created_at,updated_at) VALUES('owner','old-123456','telegram','Старая переписка','done','Старый ответ',1,2);`);
 const token=await paired(env);
 const a='thread-alpha',b='thread-beta';
 const send=(id,prompt,threadId)=>app(env,'message',{id,prompt,threadId});
 assert.equal((await send('alpha-12345','Стратегия',a)).status,200);
 assert.equal((await send('beta-123456','Маркетинг',b)).status,200);
 assert.equal((await send('alpha-67890','Продолжи',a)).status,200);
 assert.equal((await send('alpha-12345','Стратегия',b)).status,409);
 assert.equal((await send('invalid-123','Ошибка','!')).status,400);
 const all=await (await app(env,'history')).json();
 assert.equal(all.turns.length,4); assert.equal(all.turns[0].threadId,'legacy');
 assert.deepEqual(new Set(all.threads.map(t=>t.id)),new Set(['legacy',a,b]));
 assert.equal(all.threads.find(t=>t.id===a).title,'Стратегия');
 const filtered=await (await app(env,'history?thread='+a)).json();
 assert.deepEqual(filtered.turns.map(t=>t.id),['alpha-12345','alpha-67890']);
 const first=await (await mac(env,'claim',{},token)).json();assert.equal(first.job.threadId,a);assert.equal(first.history.length,0);
 assert.equal((await mac(env,'finish',{id:first.job.id,lease:first.job.lease,status:'done',answer:'Стратегический ответ'},token)).status,200);
 const second=await (await mac(env,'claim',{},token)).json();assert.equal(second.job.threadId,b);assert.equal(second.history.length,0);
 assert.equal((await mac(env,'finish',{id:second.job.id,lease:second.job.lease,status:'done',answer:'Ответ маркетинга'},token)).status,200);
 const third=await (await mac(env,'claim',{},token)).json();assert.equal(third.job.threadId,a);assert.deepEqual(third.history.map(t=>t.answer),['Стратегический ответ']);
 const other=await (await app(env,'history?thread='+a,undefined,{login:'other',role:'superadmin'})).json();assert.equal(other.turns.length,0);assert.equal(other.threads.length,0);
});
test('cancel only own queued turn, leave history intact and never claim it',async()=>{
 const env={HOTELS_DB:db()},token=await paired(env);
 await app(env,'message',{id:'cancel-123456',prompt:'Отменить',threadId:'thread-cancel'});
 assert.equal((await app(env,'cancel',{id:'cancel-123456'},{login:'other',role:'superadmin'})).status,409);
 assert.equal((await app(env,'cancel',{id:'cancel-123456'})).status,200);
 assert.equal((await (await mac(env,'claim',{},token)).json()).job,null);
 assert.equal((await (await app(env,'history?thread=thread-cancel')).json()).turns[0].status,'cancelled');
 assert.equal((await app(env,'cancel',{id:'cancel-123456'})).status,409);
});
