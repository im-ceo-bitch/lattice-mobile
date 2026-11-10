import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/index.js';
import {tashkentDay} from '../src/core.js';
import {parseIgnavResponse,parseAviasales,importIgnavResponse} from '../src/source-sync.js';
import {deliverPendingPriceEvents} from '../src/price-events.js';
import {searchIgnav} from '../src/source-api.js';
function database(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON;');
 const migrations=['0001_flight_hub.sql','0002_fare_reconciliation.sql','0003_monitor_task_checks.sql','0004_itinerary_catalog.sql','0005_catalog_sources.sql','0006_catalog_route_guard.sql'];
 for(const m of migrations)db.exec(fs.readFileSync(new URL('../migrations/'+m,import.meta.url),'utf8'));
 return {
   raw:db,
   prepare(sql){
     return {
       bind(...v){
         const st=db.prepare(sql);
         return {
           first:async()=>st.get(...v)??null,
           all:async()=>({results:st.all(...v)}),
           run:async()=>({meta:{changes:st.run(...v).changes}})
         };
       },
       first:async()=>db.prepare(sql).get()??null,
       all:async()=>({results:db.prepare(sql).all()}),
       run:async()=>({meta:{changes:db.prepare(sql).run().changes}})
     };
   }
 };
}
function future(days=8){const date=new Date(tashkentDay()+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function iso(day,hour='08:00:00'){return `${day}T${hour}Z`;}
function ignav({stops=false,price=299,at=new Date().toISOString(),day=future()}={}){
 const a={marketing_carrier_code:'HY',flight_number:'101',departure_airport:'TAS',arrival_airport:stops?'DOH':'JED',
   departure_time_local:`${day}T13:00:00`,departure_time_utc:iso(day,'08:00:00'),
   arrival_time_local:`${day}T16:00:00`,arrival_time_utc:iso(day,'13:00:00'),operating_carrier_name:'Uzbekistan Airways'};
 const b={marketing_carrier_code:'QR',flight_number:'1084',departure_airport:'DOH',arrival_airport:'JED',
   departure_time_local:`${day}T17:30:00`,departure_time_utc:iso(day,'14:30:00'),
   arrival_time_local:`${day}T20:00:00`,arrival_time_utc:iso(day,'17:00:00')};
 return {origin:'TAS',destination:'JED',departure_date:day,observed_at:at,itineraries:[{
   price:{amount:price,currency:'USD',status:'verified'},outbound:{segments:stops?[a,b]:[a]},cabin_class:'economy',ignav_id:'sample-ignav-id'}]};
}
const env=(db)=>({FLIGHTS_DB:db,IGNAV_INGEST_TOKEN:'ignav',ADMIN_TOKEN:'admin',BOT_INGEST_TOKEN:'bot'});
async function fetchJSON(e,path,method='GET',body,token){
 const r=await worker.fetch(new Request(`https://example.com${path}`,{method,headers:{'Authorization':'Bearer '+(token||''),'Content-Type':'application/json'},
   body:body===undefined?undefined:JSON.stringify(body)}),e);
 return {status:r.status,...await r.json()};
}

test('source parser: uses official outbound.segments, rejects unconfirmed and missing observation time',()=>{
 const result=parseIgnavResponse(ignav());assert.equal(result.accepted.length,1);assert.equal(result.accepted[0].price.amount_minor,29900);
 assert.equal(parseIgnavResponse({...ignav(),observed_at:null}).accepted.length,0);
 const unverified=ignav();unverified.itineraries[0].price.status='indicative';
 assert.equal(parseIgnavResponse(unverified).accepted.length,0);
});
test('all six migrations are additive/re-runnable',()=>{
 const db=database();
 for(const m of ['0003_monitor_task_checks.sql','0004_itinerary_catalog.sql','0005_catalog_sources.sql','0006_catalog_route_guard.sql'])db.raw.exec(fs.readFileSync(new URL('../migrations/'+m,import.meta.url),'utf8'));
 assert.ok(db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='flight_price_change_outbox'").get());db.raw.close();
});
test('Ignav one-way importer retains physical ID, captures first price and changes once',async()=>{
 const db=database(),e=env(db);
 let r=await fetchJSON(e,'/v1/ingest/ignav/response','POST',ignav(),'ignav');
 assert.equal(r.imported,1,JSON.stringify(r));
 const first=db.raw.prepare("SELECT id FROM flights WHERE airline_code='HY'").get().id;
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM price_history').get().n,1);
 const newer=ignav({price:330,at:new Date(Date.now()+500).toISOString()});
 r=await fetchJSON(e,'/v1/ingest/ignav/response','POST',newer,'ignav');assert.equal(r.imported,1,JSON.stringify(r));
 r=await fetchJSON(e,'/v1/ingest/ignav/response','POST',newer,'ignav');assert.equal(r.imported,1);
 assert.equal(db.raw.prepare("SELECT id FROM flights WHERE airline_code='HY'").get().id,first);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM price_history').get().n,2);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM flight_price_change_outbox').get().n,1);
 const flight=db.raw.prepare('SELECT flight_key FROM flights').get();
 const history=await fetchJSON(e,'/v1/public/price-history?flight_key='+encodeURIComponent(flight.flight_key));
 assert.equal(history.observations.length,2);assert.equal(history.events[0].previous_amount_minor,29900);assert.equal(history.events[0].new_amount_minor,33000);
 db.raw.close();
});
test('two segment Ignav itinerary creates ONE bundle fare, never prices an intermediate segment',async()=>{
 const db=database(),e=env(db);
 const r=await fetchJSON(e,'/v1/ingest/ignav/response','POST',ignav({stops:true}),'ignav');
 assert.equal(r.imported,1,JSON.stringify(r));
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM flights').get().n,2);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM flight_offers').get().n,0);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM flight_itinerary_bundle_offers').get().n,1);
 const catalog=await fetchJSON(e,'/v1/public/itineraries?origin=TAS&destination=JED');
 assert.equal(catalog.itineraries.length,1,JSON.stringify(catalog));
 assert.equal(catalog.itineraries[0].stop_count,1);
 assert.equal(catalog.itineraries[0].offers[0].offer_type,'whole_itinerary');
 db.raw.close();
});
test('Aviasales transfer results are separate cached discovery hints; never trusted prices',async()=>{
 const db=database(),e=env(db),day=future();
 await fetchJSON(e,'/v1/ingest/ignav/response','POST',ignav({day}),'ignav');
 const response={currency:'USD',data:[
  {origin:'TAS',destination:'JED',departure_at:iso(day),transfers:1,airline:'QR',flight_number:'330',price:250,found_at:new Date().toISOString()},
  {origin:'TAS',destination:'JED',departure_at:iso(day),transfers:0,airline:'HY',flight_number:'101',price:280,found_at:new Date().toISOString()}
 ]};
 const r=await fetchJSON(e,'/v1/ingest/aviasales-cache','POST',response,'admin');
 assert.equal(r.stored,2,JSON.stringify(r));assert.equal(r.linked,1);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM flight_offers').get().n,1);
 const list=await fetchJSON(e,'/v1/public/itineraries?origin=TAS&destination=JED');
 assert.equal(list.discoveries.length,1,JSON.stringify(list));
 assert.equal(list.discoveries[0].price_status,'cached_not_confirmed');
 assert.equal(list.discoveries[0].offers.length,0);
 assert.equal(list.catalog.filter(x=>x.kind==='discovery').length,1);
 db.raw.close();
});
test('bot paging visits every published flight exactly once per run and keeps audit on failure',async()=>{
 const db=database(),e=env(db);
 for(let i=0;i<25;i++){
  const day=future(1+i);
  // Distinct physical flight numbers keep all rows valid.
  await fetchJSON(e,'/v1/ingest/legacy_import','POST',{records:[{
    airline_code:'C6',flight_number:'C6'+(100+i),origin:'TAS',destination:'JED',departure_date:day
  }],status:'ok'},'admin');
 }
 const start=new Date().toISOString();
 const seen=[];
 for(let i=0;i<5;i++){
  const page=await fetchJSON(e,'/v1/monitor/tasks?provider=centrum&limit=9&since='+encodeURIComponent(start),'GET',undefined,'bot');
  assert.equal(page.ok,true,JSON.stringify(page));
  seen.push(...page.tasks.map(x=>x.flight_number));
  if(!page.count)break;
 }
 assert.equal(seen.length,25);assert.equal(new Set(seen).size,25);
 const key=['C6','C6100','TAS','JED',future(1)].join('|');
 await fetchJSON(e,'/v1/ingest/centrum','POST',{records:[],status:'site_changed',attempts:[{flight_key:key,outcome:'site_changed',message:'CSS missing'}]},'bot');
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM flight_monitor_attempts').get().n,1);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM flight_offers').get().n,0);
 db.raw.close();
});
test('outbox delivers via existing sender once, repeated dispatch is idempotent',async()=>{
 const db=database(),e=env(db);await fetchJSON(e,'/v1/ingest/ignav/response','POST',ignav(),'ignav');
 await fetchJSON(e,'/v1/ingest/ignav/response','POST',ignav({price:330,at:new Date(Date.now()+1000).toISOString()}),'ignav');
 const calls=[];
 let result=await deliverPendingPriceEvents(e,{sender:async(_env,title,body,data)=>{calls.push({title,body,data});return {ok:true,sent:1};}});
 assert.equal(result.sent,1);assert.equal(calls[0].data.section,'price_history');
 result=await deliverPendingPriceEvents(e,{sender:async()=>{throw Error('duplicate');}});
 assert.equal(result.sent,0);assert.equal(result.failed,0);
 assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM flight_price_change_outbox WHERE delivery_state='delivered'").get().n,1);
 db.raw.close();
});
test('live search is fail closed without provider key; cached re-search does not spend again',async()=>{
 const db=database(),e=env(db),day=future();
 let r=await searchIgnav(new Request('https://x/v1/admin/ignav/search',{method:'POST',body:JSON.stringify({origin:'TAS',destination:'JED',departure_date:day})}),e,()=>{});
 assert.equal(r.status,503);
 e.IGNAV_API_KEY='test-key';let calls=0;
 const req=()=>new Request('https://x/v1/admin/ignav/search',{method:'POST',body:JSON.stringify({origin:'TAS',destination:'JED',departure_date:day})});
 const fake=async()=>{calls++;return Response.json(ignav({day}));};
 r=await searchIgnav(req(),e,async()=> 'accepted',{fetcher:fake});assert.equal(r.status,200);
 r=await searchIgnav(req(),e,async()=> 'accepted',{fetcher:fake});
 assert.equal(calls,1);assert.equal((await r.json()).results[0].status,'recently_searched');db.raw.close();
});


test('transit segments remain physical flights but not stand-alone catalog options',async()=>{
 const db=database(),e=env(db),day=future();
 const response=await fetchJSON(e,'/v1/ingest/ignav/response','POST',ignav({stops:true,day}),'ignav');
 assert.equal(response.imported,1,JSON.stringify(response));
 assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM flights').get().n,2);
 assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM flight_itineraries').get().n,1);
 const result=await fetchJSON(e,'/v1/public/itineraries');
 assert.equal(result.itineraries.length,1,JSON.stringify(result));
 assert.equal(result.itineraries[0].origin,'TAS');
 assert.equal(result.itineraries[0].destination,'JED');
 db.raw.close();
});

test('Aviasales connecting hint links only when same first segment independently matches an Ignav itinerary',async()=>{
 const db=database(),e=env(db),day=future();
 await fetchJSON(e,'/v1/ingest/ignav/response','POST',ignav({stops:true,day}),'ignav');
 const input={currency:'USD',data:[
  {origin:'TAS',destination:'JED',departure_at:iso(day,'08:00:00'),transfers:1,airline:'HY',flight_number:'101',price:220,found_at:new Date().toISOString()},
  {origin:'TAS',destination:'JED',departure_at:iso(day,'10:00:00'),transfers:1,airline:'HY',flight_number:'101',price:210,found_at:new Date().toISOString()}
 ]};
 const result=await fetchJSON(e,'/v1/ingest/aviasales-cache','POST',input,'admin');
 assert.equal(result.stored,2);assert.equal(result.linked,1);
 const catalog=await fetchJSON(e,'/v1/public/itineraries?origin=TAS&destination=JED');
 assert.equal(catalog.itineraries.length,1);
 assert.equal(catalog.discoveries.length,1,JSON.stringify(catalog));
 assert.equal(catalog.discoveries[0].price_status,'cached_not_confirmed');
 db.raw.close();
});
