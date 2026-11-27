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

const rec=(env,b,user=owner)=>app(env,'records',b,user);
const recMac=(env,b,token)=>mac(env,'records',b,token);
const kindList=['personal','business','episodic','decision','task','research'];
test('typed memory: 100 records, paginated; idempotent, owner scoped, source and version',async()=>{
 const env={HOTELS_DB:db()},token=await paired(env);
 for(let i=0;i<100;i++){const b={action:'save',id:`record-${String(i).padStart(3,'0')}`,kind:kindList[i%6],content:`Факт номер ${i}`};assert.equal((await rec(env,b)).status,200);if(i<10)assert.equal((await recMac(env,b,token)).status,200);}
 const first=await (await rec(env,{action:'list'})).json();assert.equal(first.records.length,50);assert.ok(first.next);const second=await(await recMac(env,{action:'list',after:first.next},token)).json();assert.equal(second.records.length,50);assert.equal(second.next,null);assert.equal(new Set([...first.records,...second.records].map(x=>x.id)).size,100);
 assert.ok(first.records.every(x=>x.version===1&&x.trust==='owner'&&x.source==='app'));
 assert.equal((await (await rec(env,{action:'list'},{login:'other',role:'superadmin'})).json()).records.length,0);
 assert.equal((await rec(env,{action:'save',id:'record-000',kind:'personal',content:'different'})).status,409);
 assert.equal(env.HOTELS_DB.sql.prepare('SELECT COUNT(*) n FROM kelvin_memory_audit').get().n,100);
});
test('20 corrections/deletions: optimistic version, tombstones, no replay; audit and legacy migration',async()=>{
 const env={HOTELS_DB:db()},token=await paired(env);const sql=env.HOTELS_DB.sql;
 for(let i=0;i<20;i++){const id=`legacy-${i}`;sql.prepare('INSERT INTO kelvin_memory VALUES(?,?,?,?)').run('owner',id,'старый факт '+i,1);}
 await app(env,'message',{id:'app-before-reset',prompt:'старый факт 0'});let job=(await(await mac(env,'claim',{},token)).json()).job;
 await mac(env,'finish',{id:job.id,lease:job.lease,status:'done',answer:'старый факт 0'},token);
 for(let i=0;i<20;i++){const id=`legacy-${i}`;assert.equal((await rec(env,{action:'correct',id,version:1,kind:'decision',content:'новый факт '+i})).status,200);assert.equal((await rec(env,{action:'correct',id,version:1,kind:'decision',content:'stale'})).status,409);assert.equal((await recMac(env,{action:'delete',id,version:2},token)).status,200);assert.equal((await rec(env,{action:'save',id,kind:'personal',content:'старый факт '+i})).status,409);}
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM kelvin_memory').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM kelvin_memory_records WHERE deleted=1 AND content=\'\'').get().n,20);
 await mac(env,'message',{id:'tg-after-reset',prompt:'Что я говорил?'},token);const claim=await(await mac(env,'claim',{},token)).json();assert.equal(claim.history.length,0);assert.equal(claim.typedMemory.length,0);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM kelvin_memory_audit').get().n,60);
});
test('20 alternating channels, 10 duplicate events, 3 expired leases; same history and no duplicate turns',async()=>{
 const env={HOTELS_DB:db()},token=await paired(env);
 for(let i=0;i<20;i++){
  const id=`turn-${String(i).padStart(4,'0')}`,body={id,prompt:'owner message '+i};const send=()=>i%2===0?app(env,'message',body):mac(env,'message',body,token);
  assert.equal((await send()).status,200);if(i<10)assert.equal((await send()).status,200);
  let claim=await(await mac(env,'claim',{},token)).json();assert.equal(claim.job.id,id);assert.equal(claim.history.length,i);
  if([2,7,13].includes(i)){const old=claim.job.lease;env.HOTELS_DB.sql.prepare('UPDATE kelvin_turns SET lease_until=0 WHERE request_id=?').run(id);claim=await(await mac(env,'claim',{},token)).json();assert.notEqual(claim.job.lease,old);assert.equal((await mac(env,'finish',{id,lease:old,status:'done',answer:'stale'},token)).status,409);}
  assert.equal((await mac(env,'finish',{id,lease:claim.job.lease,status:'done',answer:'answer '+i},token)).status,200);
 }
 const history=await(await app(env,'history')).json();assert.equal(history.turns.length,20);assert.ok(history.turns.every(t=>t.status==='done'));
});
test('candidate source, owner confirmation, role/token/lease fencing; no candidate auto trust',async()=>{
 const env={HOTELS_DB:db()},token=await paired(env);const quote='Моя цель — семейные поездки';await app(env,'message',{id:'app-candidate',prompt:quote});let claim=await(await mac(env,'claim',{},token)).json();
 const b={action:'candidate',id:'candidate-01',kind:'personal',content:quote,job:claim.job.id,lease:claim.job.lease};
 assert.equal((await rec(env,b)).status,403);assert.equal((await recMac(env,{...b,content:'Вымышленный факт'},token)).status,403);assert.equal((await recMac(env,{...b,lease:'bad'},token)).status,409);assert.equal((await recMac(env,b,token)).status,200);
 assert.equal((await rec(env,{action:'confirm',id:b.id,version:1})).status,409);assert.equal((await (await rec(env,{action:'list'})).json()).records[0].trust,'candidate');
 await mac(env,'finish',{id:claim.job.id,lease:claim.job.lease,status:'done',answer:'ok'},token);
 assert.equal((await rec(env,{action:'confirm',id:b.id,version:1})).status,200);assert.equal((await (await rec(env,{action:'list'})).json()).records[0].trust,'owner');
 for(let i=0;i<15;i++){
  assert.equal((await rec(env,{action:'save',id:`secret-${i}`,kind:'personal',content:'a'.repeat(64)})).status,400);
  assert.equal((await rec(env,{action:'save',id:`customer-${i}`,kind:'customer',content:'client private'})).status,400);
 }
 assert.equal((await rec(env,{action:'delete',id:b.id,version:2},{login:'other',role:'superadmin'})).status,404);
 await app(env,'revoke',{});assert.equal((await recMac(env,{action:'list'},token)).status,401);
});
test('autonomy archive is separate from conversation, owner scoped, idempotent, read only snapshot',async()=>{
 const env={HOTELS_DB:db()},token=await paired(env);
 const other={login:'Other',role:'superadmin'};
 const snap=await(await mac(env,'autonomy',{action:'snapshot'},token)).json();assert.equal(snap.ok,true);assert.equal(snap.snapshot.data.supportThreads.available,false);
 for(let i=1;i<=20;i++){
  const id=`kelvin-auto-2026-11-${String(i).padStart(2,'0')}-research-a`,b={action:'publish',id,kind:'research-a',text:'Архивное исследование '+i};
  assert.equal((await mac(env,'autonomy',b,token)).status,200);assert.equal((await mac(env,'autonomy',b,token)).status,200);assert.equal((await mac(env,'autonomy',{...b,text:'changed'},token)).status,409);
 }
 assert.equal((await (await app(env,'insights')).json()).insights.length,20);
 assert.equal((await (await app(env,'history')).json()).turns.length,0);
 assert.equal((await (await app(env,'insights',undefined,other)).json()).insights.length,0);
 assert.equal((await app(env,'insights',undefined,{login:'Owner',role:'admin'})).status,403);
 assert.equal((await mac(env,'autonomy',{action:'publish',id:'kelvin-auto-2026-11-21-morning',kind:'morning',text:'X'.repeat(901)},token)).status,400);
 assert.equal((await mac(env,'autonomy',{action:'publish',id:'kelvin-auto-2026-11-21-morning',kind:'evening',text:'X'},token)).status,400);
 assert.equal((await mac(env,'autonomy',{action:'publish',id:'kelvin-auto-2026-11-21-morning',kind:'morning',text:'a'.repeat(64)},token)).status,400);
 await app(env,'message',{id:'app-insights-001',prompt:'Что нового?'});const claim=await(await mac(env,'claim',{},token)).json();assert.equal(claim.insights.length,3);assert.equal(claim.history.length,0);
 await app(env,'revoke',{});assert.equal((await mac(env,'autonomy',{action:'snapshot'},token)).status,401);assert.equal((await mac(env,'autonomy',{action:'publish',id:'kelvin-auto-2026-11-21-morning',kind:'morning',text:'X'},token)).status,401);
});
test('voice turn lookup is exact, owner scoped, idempotent, independent of recent history',async()=>{
 const env={HOTELS_DB:db()}, token=await paired(env), other={login:'Other',role:'superadmin'};
 const message={id:'voice-000001',prompt:'Сколько заявок?',voice:true};
 assert.equal((await app(env,'message',message)).status,200);
 assert.equal((await app(env,'message',message)).status,200);
 assert.equal((await app(env,'message',{...message,prompt:'Изменённый вопрос'})).status,409);
 const get=async(user=owner,id=message.id)=>app(env,'turn',{id},user);
 const queued=(await(await get()).json()).turn;assert.equal(queued.status,'queued');assert.equal(queued.voice,true);
 assert.equal((await get(other)).status,404);
 assert.equal((await get({login:'Owner',role:'admin'})).status,403);
 assert.equal((await get(owner,'../bad')).status,400);
 assert.equal((await get(owner,'voice-missing')).status,404);
 const job=(await(await mac(env,'claim',{},token)).json()).job;
 assert.equal(job.voice,true);assert.equal((await(await get()).json()).turn.status,'running');
 assert.equal((await mac(env,'finish',{id:job.id,lease:job.lease,status:'done',answer:'Проверенный ответ'},token)).status,200);
 // The original turn must remain addressable after falling out of the 60-turn UI window.
 for(let i=0;i<70;i++)env.HOTELS_DB.sql.prepare("INSERT INTO kelvin_turns(owner,request_id,source,prompt,status,answer,created_at,updated_at) VALUES('owner',?,'telegram','x','done','x',1,1)").run('later-'+String(i).padStart(4,'0'));
 assert.equal((await(await app(env,'history')).json()).turns.some(x=>x.id===message.id),false);
 const result=(await(await get()).json()).turn;assert.equal(result.answer,'Проверенный ответ');assert.equal(result.id,message.id);
 assert.equal((await get(other)).status,404);
 assert.equal(env.HOTELS_DB.sql.prepare('SELECT COUNT(*) n FROM kelvin_turns WHERE request_id=?').get(message.id).n,1);
});

test('block 07 diagnostics exposes only owner queue counts, not credentials or text',async()=>{
 const env={HOTELS_DB:db()}, token=await paired(env), other={login:'Other',role:'superadmin'};
 const otherToken=(await(await app(env,'pair',{},other)).json()).token;
 await app(env,'message',{id:'owner-diag-01',prompt:'PRIVATE OWNER TEXT'});
 await app(env,'message',{id:'other-diag-01',prompt:'OTHER PRIVATE TEXT'},other);
 const r=await(await mac(env,'diagnostics',{},token)).json();assert.equal(r.protocol,7);assert.deepEqual(r.queue,{queued:1});assert.ok(!JSON.stringify(r).includes('PRIVATE'));
 assert.deepEqual((await(await mac(env,'diagnostics',{},otherToken)).json()).queue,{queued:1});
 await app(env,'revoke',{});assert.equal((await mac(env,'diagnostics',{},token)).status,401);
});
test('block 07 exact completion replay after lost HTTP response; changed or rotated lease rejected',async()=>{
 const env={HOTELS_DB:db()},token=await paired(env);
 await app(env,'message',{id:'replay-test-001',prompt:'Привет'});
 const {job}=await(await mac(env,'claim',{},token)).json();
 const b={id:job.id,lease:job.lease,status:'done',answer:'Привет!'};
 assert.equal((await mac(env,'finish',b,token)).status,200);
 assert.equal((await(await mac(env,'finish',b,token)).json()).replay,true);
 assert.equal((await mac(env,'finish',{...b,answer:'другое'},token)).status,409);
 assert.equal((await mac(env,'finish',{...b,lease:'a'.repeat(64)},token)).status,409);
 assert.equal((await mac(env,'claim',{},token).then(x=>x.json())).job,null);
 const newToken=await paired(env);assert.equal((await mac(env,'finish',b,token)).status,401);
 // A new paired device is authorized for the same owner, but never gets an old lease via API.
 assert.equal((await mac(env,'diagnostics',{},newToken)).status,200);
});

test('merged native voice and protocol 7 coexist in the same authenticated owner database',async()=>{
 const env={HOTELS_DB:db(),KELVIN_GEMINI_API_KEY:'fixture-key'},token=await paired(env);
 const voice=await(await app(env,'speech')).json();assert.equal(voice.configured,true);
 assert.equal((await mac(env,'speech',{},token)).status,404);
 assert.equal((await app(env,'speech',undefined,owner,null)).status,403);
 assert.equal((await app(env,'records',{action:'save',id:'merged-native-note',kind:'decision',content:'Тестовое решение'})).status,200);
 await app(env,'message',{id:'merged-native-turn',prompt:'Тестовый запрос',voice:true});
 const {job,typedMemory}=await(await mac(env,'claim',{},token)).json();assert.equal(job.voice,true);assert.ok(typedMemory.some(r=>r.id==='merged-native-note'));
 assert.equal((await mac(env,'finish',{id:job.id,lease:job.lease,status:'done',answer:'Тестовый ответ'},token)).status,200);
 const result=await(await app(env,'turn',{id:job.id})).json();assert.equal(result.turn.answer,'Тестовый ответ');
 assert.equal((await app(env,'turn',{id:job.id},{login:'Other',role:'superadmin'})).status,404);
 assert.equal((await mac(env,'autonomy',{action:'publish',id:'kelvin-auto-2026-11-27-morning',kind:'morning',text:'Тестовый обзор'},token)).status,200);
 assert.equal((await(await app(env,'insights')).json()).insights.length,1);
 assert.equal((await(await app(env,'speech')).json()).configured,true);
});
