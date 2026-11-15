import test from 'node:test';
import assert from 'node:assert/strict';
import { rankSmartPublished, rankSmartData, smartConfiguratorPlan, validSmartQuery } from '../.runtime-dist/smart-configurator.js';
const q={origin:'TAS',month:'2026-12',durationDays:10,both:true,firstCity:'MED'};
const leg=(origin,destination,day,stops=0)=>({origin,destination,departure_at:day+'T08:00:00+05:00',arrival_at:day+'T12:00:00+05:00',stops});
const complete=(id,out,back)=>({id,outbound:out,inbound:back,nonstop:true,offerType:'round_trip',journeyRole:'complete'});
test('smart ranks exact direct open jaw ahead of flexible dates and rejects wrong routes/month',()=>{
 const rows=[complete('flex',leg('TAS','MED','2026-12-05'),leg('JED','TAS','2026-12-17')),complete('exact',leg('TAS','MED','2026-12-23'),leg('JED','TAS','2027-01-01')),complete('wrong',leg('TAS','MED','2026-12-05'),leg('MED','TAS','2026-12-14')),complete('outside',leg('TAS','MED','2027-01-05'),leg('JED','TAS','2027-01-14')),complete('stops',leg('TAS','MED','2026-12-05',1),leg('JED','TAS','2026-12-14'))];
 assert.deepEqual(rankSmartPublished(rows,q,'2026-11-15').map(x=>x.completeID),['exact','flex']);
});
test('smart joins independent published one-ways without mixing the return airport',()=>{
 const a={id:'a',outbound:leg('TAS','MED','2026-12-01'),inbound:null,nonstop:true,offerType:'one_way',journeyRole:'outbound'};
 const b={...a,id:'b',outbound:leg('JED','TAS','2026-12-10'),journeyRole:'return'};
 const wrong={...b,id:'wrong',outbound:leg('MED','TAS','2026-12-10')};
 assert.deepEqual(rankSmartPublished([a,b,wrong],q,'2026-11-15').map(x=>[x.outboundID,x.returnID]),[['a','b']]);
});
const offer=(id,origin,destination,day,transfers=0)=>({id,origin,destination,departureAt:day+'T08:00:00+03:00',arrivalAt:null,returnAt:null,airlineCode:'HY',flightNumber:'123',durationMinutes:240,price:200,transfers});
test('cached Data ranks direct over closer connecting pairs and handles next month',()=>{
 const out=[offer('out','TAS','MED','2026-12-23'),offer('wrong','TAS','JED','2026-12-23')];
 const back=[offer('direct','JED','TAS','2027-01-04'),offer('connection','JED','TAS','2027-01-01',1),offer('outside','JED','TAS','2027-01-09'),offer('wrong','MED','TAS','2027-01-01')];
 assert.deepEqual(rankSmartData(out,back,q,'2026-11-15').map(x=>x.inbound.id),['direct','connection']);
 assert.equal(rankSmartData(out,back,q,'2026-12-24').length,0);
 assert.equal(validSmartQuery({...q,month:'2026-10'},'2026-11-15'),false);
});
test('cached Data rejects missing flight number, invalid fare and round-trip rows',()=>{
 const out=offer('out','TAS','MED','2026-12-23');
 const back=offer('back','JED','TAS','2027-01-01');
 for(const bad of [{...out,flightNumber:''},{...out,price:0},{...out,returnAt:'2027-01-01'}]) assert.equal(rankSmartData([bad],[back],q,'2026-11-15').length,0);
});
test('Smart Data fallback calls only Travelpayouts cached data, direct before connections',async()=>{
 const current=new Date();current.setUTCMonth(current.getUTCMonth()+2);const month=current.toISOString().slice(0,7);const query={...q,month,source:'data'};
 const seen=[]; const previous=globalThis.fetch;
 globalThis.fetch=async input=>{
  const u=new URL(input);seen.push(u);assert.equal(u.hostname,'api.travelpayouts.com');assert.equal(u.pathname,'/aviasales/v3/prices_for_dates');
  const o=u.searchParams.get('origin'),d=u.searchParams.get('destination'),m=u.searchParams.get('departure_at'),direct=u.searchParams.get('direct');
  const rows=direct==='true'||m!==month?[]:[{origin:o,destination:d,departure_at:m+(o==='TAS'?'-05':'-14')+'T08:00:00+03:00',airline:'HY',flight_number:'123',price:200,duration_to:240,transfers:o==='TAS'?1:0}];
  return new Response(JSON.stringify({success:true,currency:'usd',data:rows}));
 };
 try {const res=await smartConfiguratorPlan(new Request('https://example.test/api/package/smart/plan',{method:'POST',body:JSON.stringify(query)}),{TRAVELPAYOUTS_API_TOKEN:'test'});assert.equal(res.status,200);const body=await res.json();assert.equal(body.dataPairs.length,1);assert.equal(body.dataPairs[0].stops,1);assert.equal(seen.length,6);assert.ok(seen.slice(0,3).every(u=>u.searchParams.get('direct')==='true'));assert.ok(seen.slice(3).every(u=>u.searchParams.get('direct')==='false'));}finally{globalThis.fetch=previous;}
});
