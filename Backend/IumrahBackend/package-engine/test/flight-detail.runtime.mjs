import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchingFlightDetail, flightDetailResponse } from '../.runtime-dist/flight-detail.js';
const now = Date.parse('2026-11-12T08:10:00Z');
const row = {number:'HY 335', status:'EnRoute', departure:{airport:{iata:'TAS'},scheduledTime:{local:'2026-11-12 09:30+05:00'},terminal:'2'},arrival:{airport:{iata:'JED'},scheduledTime:{local:'2026-11-12 13:00+03:00'}},aircraft:{model:'Boeing 787'},location:{lat:35,lon:55,reportedAtUtc:'2026-11-12T08:05:00Z',altitude:{feet:32000}}};
const match = (rows, time='09:30') => matchingFlightDetail(rows,'HY335','2026-11-12','TAS','JED',time,now);
test('selects exact flight and returns fresh verified position',()=>{const x=match([row]);assert.equal(x.aircraft,'Boeing 787');assert.equal(x.departureTerminal,'2');assert.equal(x.position.altitudeFeet,32000);});
test('wrong route, minute, date and ambiguous same flight do not enrich',()=>{assert.equal(match([row],'09:31'),null);assert.equal(match([row,row]),null);assert.equal(match([{...row,arrival:{airport:{iata:'MED'}}}]),null);assert.equal(match([{...row,departure:{...row.departure,scheduledTime:{local:'2026-11-13 09:30+05:00'}}}]),null);});
test('stale or non-airborne position is omitted',()=>{assert.equal(match([{...row,location:{...row.location,reportedAtUtc:'2026-11-12T07:00:00Z'}}]).position,undefined);assert.equal(match([{...row,status:'Expected'}]).position,undefined);});
const url=new URL('https://iumrah.app/api/package/flights/detail?number=HY335&date=2026-11-12&origin=TAS&destination=JED&time=09:30');
test('disabled configuration falls back and bad date is rejected',async()=>{assert.deepEqual(await (await flightDetailResponse(url,{})).json(),{detail:null,reason:'not_configured'});const invalid=new URL(url);invalid.searchParams.set('date','2026-02-30');assert.equal((await flightDetailResponse(invalid,{})).status,400);});
test('exhausted D1 quota does not call provider',async()=>{const env={AERODATABOX_RAPIDAPI_KEY:'test',AERODATABOX_DAILY_REQUEST_LIMIT:'1',HOTELS_DB:{prepare:()=>({run:async()=>{},bind:()=>({first:async()=>null})})}};const old=globalThis.fetch;let called=false;globalThis.fetch=()=>{called=true;throw Error('unexpected fetch')};try {assert.deepEqual(await (await flightDetailResponse(url,env)).json(),{detail:null,reason:'quota_exhausted'});assert.equal(called,false);}finally{globalThis.fetch=old;}});
test('configured endpoint sends provider key only upstream and normalizes response',async()=>{const env={AERODATABOX_RAPIDAPI_KEY:'test-secret',AERODATABOX_DAILY_REQUEST_LIMIT:'2',HOTELS_DB:{prepare:()=>({run:async()=>{},bind:()=>({first:async()=>({requests:1}),run:async()=>{}})})}};const old=globalThis.fetch;let called=false;globalThis.fetch=async (u,opts)=>{called=true;assert.equal(u.hostname,'aerodatabox.p.rapidapi.com');assert.equal(opts.headers['X-RapidAPI-Key'],'test-secret');return new Response(JSON.stringify([row]));};try{const body=await (await flightDetailResponse(url,env)).text();assert.ok(called);assert.equal(JSON.parse(body).detail.aircraft,'Boeing 787');assert.ok(!body.includes('test-secret'));}finally{globalThis.fetch=old;}});

test('provider failure is visible without leaking the key',async()=>{const env={AERODATABOX_RAPIDAPI_KEY:'test-secret',AERODATABOX_DAILY_REQUEST_LIMIT:'5',HOTELS_DB:{prepare:()=>({run:async()=>{},bind:()=>({first:async()=>({requests:1}),run:async()=>{}})})}};const old=globalThis.fetch;globalThis.fetch=async()=>new Response('test-secret',{status:403});try{const body=await (await flightDetailResponse(url,env)).text();assert.deepEqual(JSON.parse(body),{detail:null,reason:'provider_error'});assert.ok(!body.includes('test-secret'));}finally{globalThis.fetch=old;}});

// Exercise the actual SQL with SQLite, rather than faking per-key accounting.
import { DatabaseSync } from 'node:sqlite';
import { aeroDataBoxConfiguration } from '../.runtime-dist/flight-detail.js';
function sqliteEnv(overrides={}) {
  const db=new DatabaseSync(':memory:');
  const prepare=sql=>{
    const stmt=db.prepare(sql);stmt.setAllowBareNamedParameters(true);
    // SQLite's numbered parameters are named for Node's binding API.
    const bindValues=values=>Object.fromEntries(values.map((v,i)=>[String(i+1),v]));
    const wrap=values=>({async run(){return values.length?stmt.run(bindValues(values)):stmt.run()},async first(){return (values.length?stmt.get(bindValues(values)):stmt.get())??null},bind(...next){return wrap(next)}});
    return wrap([]);
  };
  return {db,env:{AERODATABOX_RAPIDAPI_KEY:'primary-test',AERODATABOX_RAPIDAPI_KEY_BACKUP:'backup-test',AERODATABOX_DAILY_REQUEST_LIMIT:'2',AERODATABOX_BACKUP_DAILY_REQUEST_LIMIT:'2',HOTELS_DB:{prepare},...overrides}};
}
async function scenario(overrides, handler, exercise) {
  const {db,env}=sqliteEnv(overrides),old=globalThis.fetch,calls=[];
  globalThis.fetch=async (u,opts)=>{const key=opts.headers['X-RapidAPI-Key'];calls.push(key);return handler(key,calls.length)};
  try {await exercise({db,env,calls,request:async()=> (await flightDetailResponse(url,env)).json()})} finally {globalThis.fetch=old;db.close()}
}
const success=()=>new Response(JSON.stringify([row]));
test('primary budget is retained, backup budget is separate and both are enforced',async()=>{
  await scenario({},success,async({db,calls,request})=>{
    for(let i=0;i<4;i++) assert.equal((await request()).detail.aircraft,'Boeing 787');
    assert.equal((await request()).reason,'quota_exhausted');
    assert.deepEqual(calls,['primary-test','primary-test','backup-test','backup-test']);
    assert.deepEqual(db.prepare('SELECT requests FROM aerodatabox_daily_usage ORDER BY day').all().map(x=>x.requests),[2,2]);
  });
});
test('primary 429 switches immediately, persists cooldown and resumes after reset',async()=>{
  await scenario({AERODATABOX_DAILY_REQUEST_LIMIT:'5'},(key,n)=>key==='primary-test'&&n===1?new Response(null,{status:429,headers:{'Retry-After':'60'}}):success(),async({db,calls,request})=>{
    assert.ok((await request()).detail);assert.ok((await request()).detail);
    assert.deepEqual(calls,['primary-test','backup-test','backup-test']);
    assert.ok(db.prepare('SELECT until_ms FROM aerodatabox_provider_cooldown WHERE slot=\'primary\'').get().until_ms>Date.now());
    db.prepare('UPDATE aerodatabox_provider_cooldown SET until_ms=0').run();
    assert.ok((await request()).detail);assert.equal(calls.at(-1),'primary-test');
  });
});
test('last included request is returned without retry; next request goes to backup',async()=>{
  await scenario({},key=>key==='primary-test'?new Response(JSON.stringify([row]),{headers:{'x-ratelimit-requests-remaining':'0','x-ratelimit-requests-reset':'259200'}}):success(),async({db,calls,request})=>{
    assert.ok((await request()).detail);assert.deepEqual(calls,['primary-test']);
    assert.ok((await request()).detail);assert.deepEqual(calls,['primary-test','backup-test']);
    assert.ok(db.prepare('SELECT until_ms FROM aerodatabox_provider_cooldown').get().until_ms>Date.now()+258000000);
  });
});
test('authorization failure uses backup; both rejected never expose keys',async()=>{
  await scenario({},key=>new Response(key,{status:403}),async({calls,request})=>{
    const body=await request();assert.equal(body.reason,'provider_error');assert.ok(!JSON.stringify(body).includes('-test'));
    assert.deepEqual(calls,['primary-test','backup-test']);assert.equal((await request()).reason,'quota_exhausted');assert.equal(calls.length,2);
  });
});
test('no flight, malformed provider request and upstream outage never consume backup',async()=>{
  for(const status of [404,400,500]) await scenario({},()=>new Response(null,{status}),async({calls,request})=>{await request();assert.deepEqual(calls,['primary-test']);});
});
test('backup alone works, duplicate keys cannot increase limits, default cap stays conservative',async()=>{
  await scenario({AERODATABOX_RAPIDAPI_KEY:undefined},success,async({env,calls,request})=>{
    assert.deepEqual(aeroDataBoxConfiguration(env),{aerodataBoxConfigured:true,aerodataBoxPrimaryConfigured:false,aerodataBoxBackupConfigured:true});assert.ok((await request()).detail);assert.deepEqual(calls,['backup-test']);
  });
  await scenario({AERODATABOX_RAPIDAPI_KEY_BACKUP:'primary-test',AERODATABOX_DAILY_REQUEST_LIMIT:undefined},success,async({env,calls,request})=>{
    assert.equal(aeroDataBoxConfiguration(env).aerodataBoxBackupConfigured,false);for(let i=0;i<5;i++)assert.ok((await request()).detail);assert.equal((await request()).reason,'quota_exhausted');assert.equal(calls.length,5);
  });
});
test('parallel requests cannot exceed independently reserved daily caps',async()=>{
  await scenario({AERODATABOX_DAILY_REQUEST_LIMIT:'1',AERODATABOX_BACKUP_DAILY_REQUEST_LIMIT:'1'},success,async({calls,request})=>{
    const results=await Promise.all(Array.from({length:10},request));assert.equal(results.filter(x=>x.detail).length,2);assert.deepEqual(calls,['primary-test','backup-test']);
  });
});
test('existing V5 primary usage remains counted when backup is introduced',async()=>{
  await scenario({},success,async({db,calls,request})=>{
    db.exec('CREATE TABLE aerodatabox_daily_usage (day TEXT PRIMARY KEY, requests INTEGER NOT NULL)');
    db.prepare('INSERT INTO aerodatabox_daily_usage VALUES (?,?)').run(new Date().toISOString().slice(0,10),2);
    assert.ok((await request()).detail);assert.deepEqual(calls,['backup-test']);
  });
});

import { requestAeroDataBox } from '../.runtime-dist/flight-detail.js';
test('admin and detail share the same daily budget and refuse untrusted upstream host',async()=>{
 await scenario({AERODATABOX_DAILY_REQUEST_LIMIT:'1',AERODATABOX_BACKUP_DAILY_REQUEST_LIMIT:'1'},success,async({env,calls,request})=>{
  const admin=await requestAeroDataBox(env,'https://aerodatabox.p.rapidapi.com/flights/number/HY335/2026-11-12?withLocation=false');
  assert.ok(Array.isArray(admin.payload));assert.ok((await request()).detail);assert.deepEqual(calls,['primary-test','backup-test']);
  assert.equal((await request()).reason,'quota_exhausted');
  assert.equal((await requestAeroDataBox(env,'https://not-aerodatabox.example/flights/number/HY335/2026-11-12')).reason,'invalid_request');
  assert.equal(calls.length,2);
 });
});
