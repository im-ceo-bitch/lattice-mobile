import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {flightExpired,purgeExpiredFlightCatalog,departureDay} from '../package-engine/src/flight-expiration.mjs';
import {createBackendRouter} from '../src/router.js';
const cutoff=Date.parse('2026-11-25T12:00:00Z');
const ddl=fs.readFileSync(new URL('../scripts/curated-recovery-schema.sql',import.meta.url),'utf8');
const feedDDL=fs.readFileSync(new URL('../../HotelsWorker/migrations/0036_business_flight_sync.sql',import.meta.url),'utf8');
const leg=(departure_at,origin='TAS')=>({origin,destination:origin==='TAS'?'JED':'TAS',departure_at});
const past=leg('2026-11-25T16:59:59+05:00'), boundary=leg('2026-11-25T17:00:00+05:00'), future=leg('2026-11-25T17:01:00+05:00');
function d1(){
 const raw=new DatabaseSync(':memory:');
 const api={prepare(sql){let args=[];return {bind(...v){args=v;return this;},async first(){return raw.prepare(sql).get(...args)??null;},async all(){return {success:true,results:raw.prepare(sql).all(...args)};},async run(){return {success:true,meta:{changes:Number(raw.prepare(sql).run(...args).changes)}};}};},async batch(statements){return Promise.all(statements.map(s=>s.run()));}};
 return {raw,api};
}
function add(raw,id,legs,day='2026-11-25',published=1){
 raw.prepare('INSERT INTO curated_flight_offers(id,source_candidate_id,outbound_origin,outbound_destination,outbound_date,itinerary_json,total_fare,per_traveler_fare,currency,traveler_count,observed_at,published,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,id,'TAS','JED',day,JSON.stringify({legs}),100,100,'USD',1,'2026-11-01',published,'2026-11-01','2026-11-01');
}
test('exact instant, airport timezone, midnight and both legs; date metadata does not override an exact timestamp',()=>{
 assert.equal(flightExpired({legs:[past]},cutoff),true);
 assert.equal(flightExpired({legs:[boundary]},cutoff),true);
 assert.equal(flightExpired({legs:[future]},cutoff),false);
 assert.equal(flightExpired({legs:[past,leg('2026-12-10T00:00:00Z','JED')]},cutoff),true);
 assert.equal(flightExpired({legs:[leg('2026-11-25T15:00:00','JED')]},cutoff),true);
 assert.equal(flightExpired({outbound_date:'2026-11-24',itinerary_json:JSON.stringify({legs:[future]})},cutoff),false);
 assert.equal(flightExpired({from:'TAS',date:'2026-11-24'},cutoff),true);
 assert.equal(flightExpired({from:'JED',date:'2026-11-25'},cutoff),false);
 assert.equal(departureDay(Date.parse('2026-11-25T19:30:00Z'),'TAS'),'2026-11-26');
 assert.equal(departureDay(Date.parse('2026-11-25T19:30:00Z'),'JED'),'2026-11-25');
});
test('physically removes expired published and draft rows; prunes all snapshots and caches; preserves bookings, live results, tokens; rerun is idempotent',async()=>{
 const {raw,api}=d1();raw.exec(ddl);raw.exec(feedDDL);
 raw.exec(`CREATE TABLE trip_flights(id TEXT PRIMARY KEY, flight_number TEXT); INSERT INTO trip_flights VALUES('paid-booking','HY337');
 CREATE TABLE flight_search_cache(cache_key TEXT PRIMARY KEY,response_json TEXT,outbound_date TEXT,inbound_date TEXT,outbound_origin TEXT,inbound_origin TEXT,fresh_until TEXT);
 CREATE TABLE flight_calendar_fares(outbound_date TEXT,inbound_date TEXT,delete_after TEXT);`);
 add(raw,'past',[past]);add(raw,'boundary',[boundary]);add(raw,'future',[future]);add(raw,'draft-past',[past],'2026-11-25',0);add(raw,'future-draft',[future],'2026-11-25',0);
 add(raw,'old-date-but-future',[future],'2026-11-24');add(raw,'past-roundtrip',[past,leg('2026-12-10T00:00:00Z','JED')]);
 for(let i=0;i<203;i++)add(raw,'page-'+String(i).padStart(3,'0'),[past]);
 const snap={version:1,flights:[{id:'past',legs:[past]},{id:'future',legs:[future]}]};
 const feed=raw.prepare('INSERT INTO business_flight_sync_feeds(owner_login,token_hash,enabled,snapshot_json,flight_count,created_at,updated_at,snapshot_updated_at) VALUES(?,?,?,?,?,?,?,?)');
 feed.run('active','token-a',1,JSON.stringify(snap),2,'old','old','old');feed.run('disabled','token-b',0,JSON.stringify({flights:[{id:'past',legs:[past]}]}),1,'old','old','old');
 const cache=raw.prepare('INSERT INTO flight_search_cache VALUES(?,?,?,?,?,?,?)');
 cache.run('mixed',JSON.stringify({itineraries:[{id:'past',legs:[past]},{id:'future',legs:[future]}]}),'2026-11-25',null,'TAS',null,'2026-11-26T00:00:00Z');
 cache.run('expired',JSON.stringify({itineraries:[{legs:[past]}]}),'2026-11-25',null,'TAS',null,'2026-11-26T00:00:00Z');
 cache.run('future',JSON.stringify({itineraries:[{legs:[future]}]}),'2026-11-25',null,'TAS',null,'2026-11-26T00:00:00Z');
 raw.exec("INSERT INTO flight_calendar_fares VALUES('2026-11-24',NULL,'2026-12-01'),('2026-11-25',NULL,'2026-12-01')");
 assert.deepEqual(await purgeExpiredFlightCatalog(api,cutoff),{offers:207,snapshotOffers:2,searchCache:2,calendarCache:1});
 assert.deepEqual(raw.prepare('SELECT id FROM curated_flight_offers ORDER BY id').all().map(x=>x.id),['future','future-draft','old-date-but-future']);
 assert.equal(raw.prepare('SELECT flight_number FROM trip_flights').get().flight_number,'HY337');
 const snapshots=raw.prepare('SELECT * FROM business_flight_sync_feeds ORDER BY owner_login').all();assert.equal(snapshots[0].token_hash,'token-a');assert.equal(snapshots[0].flight_count,1);assert.deepEqual(JSON.parse(snapshots[0].snapshot_json).flights.map(x=>x.id),['future']);assert.equal(snapshots[1].flight_count,0);assert.equal(snapshots[1].enabled,0);
 assert.deepEqual(raw.prepare('SELECT cache_key FROM flight_search_cache ORDER BY cache_key').all().map(x=>x.cache_key),['future','mixed']);assert.deepEqual(JSON.parse(raw.prepare("SELECT response_json FROM flight_search_cache WHERE cache_key='mixed'").get().response_json).itineraries.map(x=>x.id),['future']);
 assert.equal(raw.prepare('SELECT count(*) n FROM flight_calendar_fares').get().n,1);
 assert.deepEqual(await purgeExpiredFlightCatalog(api,cutoff),{offers:0,snapshotOffers:0,searchCache:0,calendarCache:0});raw.close();
});
test('unified cron runs hard delete in both catalog bindings without invoking a supplier or hotel scheduler',async()=>{
 const a=d1(),b=d1();for(const db of [a,b]){db.raw.exec(ddl);add(db.raw,'old',[leg('2020-01-01T00:00:00Z')],'2020-01-01');add(db.raw,'future',[leg('2099-01-01T00:00:00Z')],'2099-01-01');}
 let providers=0;const stub={fetch(){providers++;throw Error('unexpected');},scheduled(){providers++;}};
 const router=createBackendRouter({hotels:stub,flights:stub});
 const event={cron:'*/5 * * * *',scheduledTime:Date.parse('2026-11-25T12:15:00Z')};
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{providers++;throw Error('unexpected external call');};
 try{await router.scheduled(event,{HOTELS_DB:a.api,BOOKINGS_DB:b.api},{});assert.equal(providers,0);for(const db of [a,b])assert.deepEqual(db.raw.prepare('SELECT id FROM curated_flight_offers').all().map(x=>x.id),['future']);}
 finally{globalThis.fetch=originalFetch;a.raw.close();b.raw.close();}
});
