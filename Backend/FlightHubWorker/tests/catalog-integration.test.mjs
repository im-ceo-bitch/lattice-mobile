import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import {eligibleFlightDay,tashkentDay,isPriceAnomaly} from '../src/core.js';

function makeDB() {
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;');
  for (const file of ['0001_flight_hub.sql','0002_fare_reconciliation.sql']) {
    db.exec(fs.readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  }
  return {
    raw:db,
    prepare(sql) {
      const statement=db.prepare(sql);
      return {
        first: async()=>statement.get()??null,
        all: async()=>({results:statement.all()}),
        run: async()=>statement.run(),
        bind(...params) {
        return {
          first: async()=>statement.get(...params)??null,
          all: async()=>({results:statement.all(...params)}),
          run: async()=>statement.run(...params)
        };
      }};
    }
  };
}
function nextDate(days) {
  const base=new Date(tashkentDay()+'T00:00:00Z');
  base.setUTCDate(base.getUTCDate()+days);
  return base.toISOString().slice(0,10);
}
function record(date=nextDate(10),amount=30000) {
  return {airline_code:'C6',flight_number:'C6 401',origin:'TAS',destination:'JED',departure_date:date,
    amount_minor:amount,currency:'USD',fare_brand:'Optimal',observed_at:new Date().toISOString(),adults:1};
}
function request(path, method='GET',body,token='') {
  return new Request('https://flight-hub.example'+path,{method,headers:method==='GET'?{Authorization:'Bearer '+token}:
    {'Content-Type':'application/json',Authorization:'Bearer '+token},body:body===undefined?undefined:JSON.stringify(body)});
}
async function call(env,path,method='GET',body,token='') {
  const response=await worker.fetch(request(path,method,body,token),env);
  return {code:response.status,json:await response.json()};
}

test('future-flight window uses Tashkent date and never includes expired',()=>{
 assert.equal(eligibleFlightDay(nextDate(-1)),false);
 assert.equal(eligibleFlightDay(nextDate(30)),true);
 assert.equal(eligibleFlightDay(nextDate(31)),false);
 assert.equal(isPriceAnomaly(10000,4900),true);
 assert.equal(isPriceAnomaly(10000,16000),false);
});

test('catalog is stable, exact match only, updates prices and quarantines implausible changes',async()=>{
 const db=makeDB();const env={FLIGHTS_DB:db,ADMIN_TOKEN:'admin',BOT_INGEST_TOKEN:'bot'};
 const seed=await call(env,'/v1/ingest/legacy_import','POST',
   {records:[{...record(),amount_minor:undefined}],status:'ok'},'admin');
 assert.equal(seed.json.accepted,1,JSON.stringify(seed.json));
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM flights').get().n,1);
 const noMaster=await call(env,'/v1/ingest/centrum','POST',
   {records:[{...record(),flight_number:'C6 999'}],status:'ok'},'bot');
 assert.equal(noMaster.json.unmatched,1);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM flights').get().n,1);
 const price=await call(env,'/v1/ingest/centrum','POST',{records:[record()],status:'ok'},'bot');
 assert.equal(price.json.accepted,1,JSON.stringify(price.json));
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM flight_offers').get().n,1);
 let offers=await call(env,'/v1/public/flights?airline=C6&limit=1&page=0');
 assert.equal(offers.json.total,1);
 assert.equal(offers.json.flights[0].offers[0].amount_minor,30000);
 assert.equal(offers.json.flights[0].offers[0].fresh,true);
 const updated=await call(env,'/v1/ingest/centrum','POST',{records:[record(nextDate(10),27000)],status:'ok'},'bot');
 assert.equal(updated.json.accepted,1);
 offers=await call(env,'/v1/public/flights?airline=C6');
 assert.equal(offers.json.flights[0].offers[0].amount_minor,27000);
 assert.equal(offers.json.flights[0].offers[0].previous_amount_minor,30000);
 const anomaly=await call(env,'/v1/ingest/centrum','POST',{records:[record(nextDate(10),99000)],status:'ok'},'bot');
 assert.equal(anomaly.json.review,1);
 assert.equal(anomaly.json.status,'partial');
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM fare_review_queue').get().n,1);
 offers=await call(env,'/v1/public/flights?airline=C6');
 assert.equal(offers.json.flights[0].offers[0].amount_minor,27000,'outlier must not overwrite fare');
 const status=await call(env,'/v1/public/status');
 assert.equal(status.json.counts.flights,1);
 assert.equal(status.json.counts.priced_flights,1);
 assert.equal(status.json.counts.review,1);
 assert.equal(status.json.sources.find(s=>s.name==='centrum').tracked_flights,1);
 db.raw.close();
});

test('bot is read-only for master flight list, rejects expired offers and unauthorized writes',async()=>{
 const db=makeDB();const env={FLIGHTS_DB:db,ADMIN_TOKEN:'admin',BOT_INGEST_TOKEN:'bot'};
 assert.equal((await call(env,'/v1/ingest/centrum','POST',{records:[record()],status:'ok'},'wrong')).code,401);
 const rejected=await call(env,'/v1/ingest/legacy_import','POST',{records:[{...record(nextDate(-2)),amount_minor:undefined}],status:'ok'},'admin');
 assert.equal(rejected.json.rejected,1);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM flights').get().n,0);
 db.raw.close();
});

test('scheduled cleanup deletes past inventory and history but preserves active flights',async()=>{
 const db=makeDB();const env={FLIGHTS_DB:db,ADMIN_TOKEN:'admin',BOT_INGEST_TOKEN:'bot'};
 const seed=await call(env,'/v1/ingest/legacy_import','POST',
   {records:[{...record(),amount_minor:undefined}],status:'ok'},'admin');
 assert.equal(seed.json.accepted,1);
 db.raw.prepare("INSERT INTO flights(id,flight_key,airline_code,flight_number,origin,destination,departure_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
   .run('past','C6|C6999|TAS|JED|2001-01-01','C6','C6999','TAS','JED','2001-01-01','2001-01-01','2001-01-01');
 db.raw.prepare("INSERT INTO flight_offers(id,flight_id,provider,fare_brand,adults,children,infants,amount_minor,currency,price_scope,checked_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
   .run('old-offer','past','centrum','',1,0,0,25000,'USD','test','2001-01-01','2001-01-01','2001-01-01');
 db.raw.prepare("INSERT INTO price_history(id,offer_id,amount_minor,currency,observed_at,provider) VALUES(?,?,?,?,?,?)")
   .run('old-history','old-offer',25000,'USD','2001-01-01','centrum');
 await worker.scheduled({},env);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM flights').get().n,1);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM price_history').get().n,0);
 db.raw.close();
});
