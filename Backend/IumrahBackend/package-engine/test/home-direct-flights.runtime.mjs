import test from 'node:test';
import assert from 'node:assert/strict';
import { publicStorefrontFlightBoard } from '../.runtime-dist/storefront.js';
const endpoint='https://iumrah.app/api/package/storefront/flights?origin=TAS';
const day='2099-11-25';
function row(id,origin,destination,{pair=false,stops=0,published=1,date=day,cabin='economy'}={}) {
 const leg=(a,b,d,s)=>({airline:'Test',airline_code:'HY',flight_number:'HY123',origin:a,destination:b,departure_at:d+'T10:00:00Z',arrival_at:d+'T15:00:00Z',duration_minutes:300,stops:s,cabin_class:cabin});
 const legs=[leg(origin,destination,date,stops)]; if(pair)legs.push(leg('MED',origin,'2099-12-02',0));
 return {id,outbound_origin:origin,outbound_destination:destination,inbound_origin:pair?'MED':null,inbound_destination:pair?origin:null,outbound_date:date,inbound_date:pair?'2099-12-02':null,itinerary_json:JSON.stringify({legs}),total_fare:200,per_traveler_fare:100,currency:'USD',traveler_count:2,observed_at:'2026-11-25',priority:100,published};
}
function database(rows){const queries=[];return {queries,prepare(sql){let args=[];return {bind(...values){args=values;return this},async run(){return {success:true}},async all(){if(!sql.includes('SELECT id, outbound_origin'))return {results:[]};queries.push(sql);assert.match(sql,/WHERE published = 1/);assert.match(sql,/outbound_date >= \?/);assert.equal(args.length,1);let filtered=rows.filter(r=>r.published===1&&r.outbound_date>=args[0]&&(r.inbound_origin?['JED','MED'].includes(r.outbound_destination)&&['JED','MED'].includes(r.inbound_origin):['JED','MED'].includes(r.outbound_origin)||['JED','MED'].includes(r.outbound_destination)));if(/LIMIT 300/.test(sql))filtered=filtered.slice(0,300);return {results:filtered}}}}}}
test('complete home board returns more than 300 publications across airports, cabins and directions',async()=>{
 const rows=Array.from({length:350},(_,i)=>row('pub-'+i,i%2?'TAS':'FEG','JED',{cabin:i%2?'economy':'business'}));
 rows.push(row('return','MED','SKD'),row('pair','NMA','JED',{pair:true}),row('draft','TAS','JED',{published:0}),row('old','TAS','JED',{date:'2000-01-01'}),row('connection','TAS','JED',{stops:1}));
 const db=database(rows),res=await publicStorefrontFlightBoard(new URL(endpoint+'&all=1'),db),data=await res.json();
 assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');assert.equal(data.catalogComplete,true);assert.equal(data.options.length,352);assert.equal(new Set(data.options.map(o=>o.id)).size,352);assert.equal(data.options.find(o=>o.id==='return').outbound.origin,'MED');assert.equal(data.options.find(o=>o.id==='pair').inbound.destination,'NMA');assert.ok(data.options.some(o=>o.outbound.cabin_class==='business'));assert.doesNotMatch(db.queries[0],/LIMIT\s+\d+/);
});
test('legacy storefront keeps old cap and response contract; empty complete catalogue is explicit',async()=>{
 const db=database(Array.from({length:350},(_,i)=>row(String(i),'TAS','JED')));const data=await (await publicStorefrontFlightBoard(new URL(endpoint),db)).json();assert.equal(data.options.length,300);assert.equal(data.catalogComplete,undefined);assert.match(db.queries[0],/LIMIT 300/);
 const empty=await (await publicStorefrontFlightBoard(new URL(endpoint+'&all=1'),database([]))).json();assert.equal(empty.catalogComplete,true);assert.deepEqual(empty.options,[]);
});
