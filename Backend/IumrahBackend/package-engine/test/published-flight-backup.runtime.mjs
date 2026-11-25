import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../.runtime-dist/index.js';
import { exportPublishedFlightsAdmin } from '../.runtime-dist/curated-flights.js';

const endpoint='https://iumrah.app/api/admin/package/flights/curated/export';
const row=(id,extra={})=>({id,source_candidate_id:'offer-'+id,source_provider:'ignav',outbound_origin:'TAS',outbound_destination:'JED',inbound_origin:null,inbound_destination:null,outbound_date:'2027-12-10',inbound_date:null,cabin_class:'economy',airline_codes_json:'["HY"]',airline_names_json:'["Uzbekistan Airways"]',flight_numbers_json:'["HY 333"]',itinerary_json:JSON.stringify({id,legs:[{origin:'TAS',destination:'JED',flight_number:'HY333',departure_at:'2027-12-10T10:00:00Z',arrival_at:'2027-12-10T15:00:00Z'}],price_type:'one_way',fare_scope:'regular'}),total_fare:500,per_traveler_fare:250,currency:'USD',traveler_count:2,observed_at:'2026-11-15T10:00:00Z',published:1,priority:100,created_by:'private-staff-login',created_at:'2026-11-15',updated_at:'2026-11-15',offer_type:'one_way',journey_role:'outbound',fingerprint:null,...extra});
function db(rows=[],snapshots={},options={}){
 const queries=[];
 return {queries,prepare(sql){
  queries.push(sql); assert.match(sql,/^SELECT /,'backup must be read-only');
  let args=[];return {bind(...a){args=a;return this;},async first(){
    if(sql.includes('sqlite_master')) {if(options.fail)throw Error('D1 unavailable');return options.missing?null:{name:'curated_flight_offers'};}
    if(sql.includes('business_flight_sync_feeds'))return snapshots[args[0]]||null;
    throw Error('Unexpected SQL '+sql);
  },async all(){
    if(options.failPage && args.length)throw Error('second page failed');
    assert.match(sql,/WHERE published=1/);
    return {results:rows.filter(r=>r.published===1&&(!args.length||r.id>args[0])).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,200)};
  },async run(){throw Error('write forbidden');}};
 }};
}
const snap={snapshot_json:JSON.stringify({version:1,flights:[{id:'saved-1',from:'TAS',to:'JED',price:{amount:123,currency:'USD'}}]}),snapshot_updated_at:'2026-11-13T10:00:00Z'};

test('exports all published rows without UI limit, excluding past rows, excludes drafts and private staff login',async()=>{
 const rows=Array.from({length:521},(_,i)=>row(String(i).padStart(4,'0')));
 rows.push(row('past',{outbound_date:'2020-01-01',itinerary_json:JSON.stringify({legs:[{departure_at:'2020-01-01T01:00:00Z',origin:'TAS'}]})}),row('draft',{published:0}));
 const canonical=db(rows); const legacy=db([row('legacy')]);
 const result=await exportPublishedFlightsAdmin(canonical,legacy,'owner');const data=await result.json();
 assert.equal(result.status,200);assert.match(result.headers.get('content-disposition'),/attachment/);assert.equal(result.headers.get('cache-control'),'no-store');
 assert.equal(data.export_source,'canonical_database');assert.equal(data.flight_count,521);assert.equal(new Set(data.flights.map(f=>f.id)).size,521);
 assert.equal(data.flights.some(f=>f.id==='past'),false);
 assert.ok(data.flights.every(f=>f.expired===false));assert.equal(data.flights.some(f=>f.id==='draft'),false);
 assert.equal(data.flights[0].price.amount,250);assert.equal(data.flights[0].total_fare,500);assert.equal(data.flights[0].legs[0].flight_number,'HY333');
 assert.equal(JSON.stringify(data).includes('private-staff-login'),false);assert.equal(legacy.queries.length,0);assert.equal(data.requires_price_recheck,true);
});

test('empty canonical export does not resurrect legacy D1',async()=>{
 const result=await exportPublishedFlightsAdmin(db(),db([row('legacy')]),'owner');const data=await result.json();
 assert.equal(data.export_source,'canonical_database');assert.equal(data.flight_count,0);
});

test('failed canonical page never exports partial catalogue; fallback is labeled',async()=>{
 const rows=Array.from({length:250},(_,i)=>row(String(i).padStart(4,'0')));
 const result=await exportPublishedFlightsAdmin(db(rows,{}, {failPage:true}),db([row('legacy')]),'owner');const data=await result.json();
 assert.equal(data.export_source,'legacy_database');assert.equal(data.flight_count,1);
});

test('saved feed snapshot can be downloaded with sync disabled and without public token',async()=>{
 const result=await exportPublishedFlightsAdmin(db([],{owner:snap},{missing:true}),db([],{}, {missing:true}),' OWNER ');const data=await result.json();
 assert.equal(data.export_source,'saved_sync_snapshot');assert.equal(data.scope,'last_saved_snapshot');assert.equal(data.snapshot_updated_at,snap.snapshot_updated_at);assert.deepEqual(data.flights,JSON.parse(snap.snapshot_json).flights);
});

test('snapshot fallback also works when canonical D1 is unavailable and snapshot is in legacy D1',async()=>{
 const result=await exportPublishedFlightsAdmin(db([],{}, {fail:true}),db([],{owner:snap},{missing:true}),'owner');const data=await result.json();assert.equal(data.export_source,'saved_sync_snapshot');assert.equal(data.flight_count,1);
});

test('no source, corrupt snapshot, or another owner snapshot yields error, never empty success',async()=>{
 for(const canonical of [db([],{}, {missing:true}),db([],{other:snap},{missing:true}),db([],{owner:{...snap,snapshot_json:'broken'}},{missing:true}),db([],{owner:{...snap,snapshot_json:'{"flights":[]}' }},{missing:true})]){
  const result=await exportPublishedFlightsAdmin(canonical,db([],{}, {missing:true}),'owner');assert.equal(result.status,503);assert.equal((await result.json()).error,'PUBLISHED_FLIGHTS_BACKUP_UNAVAILABLE');
 }
});

test('export route requires staff admin cookie and refuses writes',async()=>{
 const canonical=db([row('authorized')]);
 const denied=await worker.fetch(new Request(endpoint),{HOTELS_DB:canonical});assert.equal(denied.status,401);assert.equal(canonical.queries.length,0);
 const originalFetch=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response(JSON.stringify({user:{login:'owner',role:'staff'}}));
  const headers={cookie:'staff_session=fixture'};
  const forbidden=await worker.fetch(new Request(endpoint,{headers}),{HOTELS_DB:canonical});assert.equal(forbidden.status,403);assert.equal(canonical.queries.length,0);
  globalThis.fetch=async()=>new Response(JSON.stringify({user:{login:'owner',role:'superadmin'}}));
  const response=await worker.fetch(new Request(endpoint,{headers}),{HOTELS_DB:canonical});assert.equal(response.status,200);assert.equal((await response.json()).flight_count,1);
  const write=await worker.fetch(new Request(endpoint,{method:'DELETE',headers}),{HOTELS_DB:canonical});assert.equal(write.status,405);
 }finally{globalThis.fetch=originalFetch;}
});
