import test from 'node:test';
import assert from 'node:assert/strict';
import { handleNuiteeHotelRequest } from '../.runtime-dist/nuitee-hotels.js';
function environment() {
  const cache = new Map([['catalog:v2:makkah', {payload:JSON.stringify([{id:'lp123',name:'Hotel',city:'Makkah',previewImages:['https://example.com/photo.jpg']}]),updated_at:Date.now(),expires_at:Date.now()+600000}]]);
  return {cache, NUITEE_API_KEY:'sand_fixture',HOTELS_DB:{prepare(sql){let args=[];return {
    bind(...v){args=v;return this;},async first(){return cache.get(args[0])??null;},async run(){
      if(sql.includes('INSERT INTO')) cache.set(args[0],{payload:args[1],updated_at:args[2],expires_at:args[3]});return {success:true};
    }
  };}}};
}
function url(extra='') {
  const a=new Date(Date.now()+10*86400000).toISOString().slice(0,10);
  const b=new Date(Date.now()+12*86400000).toISOString().slice(0,10);
  return new URL(`https://fixture/api/package/nuitee/hotels?city=makkah&checkin=${a}&checkout=${b}&adults=2${extra}`);
}
async function get(env,extra=''){const u=url(extra);return (await handleNuiteeHotelRequest(new Request(u),env,u)).json();}
test('cached catalog and photos do not depend on rates',async()=>{
  const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('must not call supplier');};
  try {const r=await get(environment(),'&catalogOnly=1');assert.equal(r.hotels.length,1);assert.equal(r.hotels[0].rateStatus,'not_requested');assert.equal(r.rateError,null);assert.ok(r.hotels[0].previewImages.length);}
  finally{globalThis.fetch=old;}
});
test('no availability 2001 is an empty result, not API failure',async()=>{
  const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({error:{code:2001,message:'no availability found'}});
  try {const r=await get(environment());assert.equal(r.rateError,null);assert.equal(r.hotels[0].rateStatus,'no_availability');}
  finally{globalThis.fetch=old;}
});
test('429 persists Retry-After cooldown across requests and preserves catalog',async()=>{
  const env=environment(),old=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({error:{code:4290}},{status:429,headers:{'retry-after':'120'}});};
  try{for(let i=0;i<2;i++){const r=await get(env);assert.equal(r.rateError,'NUITEE_RATE_LIMIT');assert.equal(r.hotels.length,1);}assert.equal(calls,1);assert.ok(env.cache.get('provider:cooldown:v1').expires_at>Date.now()+110000);}
  finally{globalThis.fetch=old;}
});
test('parallel identical requests coalesce and dates use separate caches',async()=>{
  const env=environment(),old=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;await new Promise(r=>setTimeout(r,10));return Response.json({data:[{hotelId:'lp123',price:250,offerId:'real'}]});};
  try{const responses=await Promise.all(Array.from({length:10},()=>get(env)));assert.equal(calls,1);assert.ok(responses.every(r=>r.hotels[0].minimumRate.price===250));await get(env);assert.equal(calls,1);
    const u=url();u.searchParams.set('adults','3');await handleNuiteeHotelRequest(new Request(u),env,u);assert.equal(calls,2);
  }finally{globalThis.fetch=old;}
});
test('stale exact-search prices are labelled and expire after six hours',async()=>{
  const env=environment(),old=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({data:[{hotelId:'lp123',price:250}]});
  try{await get(env);const entry=[...env.cache.entries()].find(([k])=>k.startsWith('minimum:v2:'))[1];entry.expires_at=0;entry.updated_at=Date.now()-3600000;
    globalThis.fetch=async()=>Response.json({error:{code:4011}},{status:500});
    let r=await get(env);assert.equal(r.pricesStale,true);assert.equal(r.rateError,'NUITEE_SUPPLIER_TIMEOUT');assert.equal(r.hotels[0].minimumRate.price,250);
    entry.updated_at=Date.now()-7*3600000;r=await get(env);assert.equal(r.hotels[0].minimumRate,null);assert.equal(r.rateError,'NUITEE_SUPPLIER_TIMEOUT');
  }finally{globalThis.fetch=old;}
});

test('cold catalog merges supplier pages, invalidates the old cap and paginates filtered results',async()=>{
  const env=environment(),old=globalThis.fetch;env.cache.clear();let calls=0;
  const rows=Array.from({length:237},(_,i)=>({id:`lp${i}`,name:`Hotel ${i}`,city:'Makkah',stars:i<200?5:4,main_photo:`https://example.com/${i}.jpg`}));
  env.cache.set('catalog:v1:makkah',{payload:JSON.stringify(rows.slice(0,5)),updated_at:Date.now(),expires_at:Date.now()+600000});
  globalThis.fetch=async(input)=>{calls++;const u=new URL(input);const offset=Number(u.searchParams.get('offset'));const limit=Number(u.searchParams.get('limit'));return Response.json({data:rows.slice(offset,offset+limit),total:rows.length});};
  try {
    const ids=[];
    for(const offset of [0,12,24,36]){
      const r=await get(env,`&catalogOnly=1&stars=4&pageSize=12&offset=${offset}`);
      assert.equal(r.total,37);assert.equal(r.hotels.length,Math.min(12,37-offset));assert.equal(r.nextOffset,offset+12<37?offset+12:null);
      assert.ok(r.hotels.every(h=>h.stars===4 && h.coverImageURL.startsWith('https://')));ids.push(...r.hotels.map(h=>h.id));
    }
    assert.equal(new Set(ids).size,37);assert.equal(calls,4); // both spellings, two pages each; no repeat requests
    const all=await get(env,'&catalogOnly=1');assert.equal(all.hotels.length,237);
  } finally{globalThis.fetch=old;}
});
test('supplier short pages and alternative city spelling do not silently hide hotels',async()=>{
  const env=environment(),old=globalThis.fetch;env.cache.clear();const calls=[];
  const first=Array.from({length:17},(_,i)=>({id:`lp${i}`,name:`Hotel ${i}`,stars:4}));
  const second=[...first.slice(0,5),{id:'lpExtra',name:'Extra',stars:4}];
  globalThis.fetch=async(input)=>{const u=new URL(input),name=u.searchParams.get('cityName'),offset=Number(u.searchParams.get('offset'));calls.push([name,offset]);return Response.json({data:(name==='Makkah'?first:second).slice(offset,offset+5)});};
  try {const a=await get(env,'&catalogOnly=1&stars=4&pageSize=12&offset=0'),b=await get(env,'&catalogOnly=1&stars=4&pageSize=12&offset=12');assert.equal(a.total,18);assert.equal(a.nextOffset,12);assert.equal(b.hotels.length,6);assert.equal(b.nextOffset,null);assert.equal(new Set([...a.hotels,...b.hotels].map(h=>h.id)).size,18);assert.ok(calls.some(([name,offset])=>name==='Makkah'&&offset===5));}
  finally{globalThis.fetch=old;}
});
test('prices are cached per page, not reused for other hotels',async()=>{
  const env=environment(),old=globalThis.fetch;const rows=Array.from({length:25},(_,i)=>({id:`lp${i}`,name:`Hotel ${i}`,stars:4}));
  env.cache.set('catalog:v2:makkah',{payload:JSON.stringify(rows),updated_at:Date.now(),expires_at:Date.now()+600000});
  const calls=[];globalThis.fetch=async(_,init)=>{const ids=JSON.parse(init.body).hotelIds;calls.push(ids);return Response.json({data:ids.map(id=>({hotelId:id,price:250}))});};
  try {for(const offset of [0,12,0]){const r=await get(env,`&stars=4&pageSize=12&offset=${offset}`);assert.equal(r.hotels.length,12);assert.ok(r.hotels.every(h=>h.minimumRate.hotelId===h.id));}assert.equal(calls.length,2);assert.equal(new Set(calls.flat()).size,24);}
  finally{globalThis.fetch=old;}
});

test('delayed price result remains pending and retains supplier prices without app deadlines', async () => {
  const env=environment(), old=globalThis.fetch;let release;let complete=false;
  globalThis.fetch=async(_url,init)=>{
    assert.equal(init.signal,undefined,'do not abort hotel price requests at 22 seconds');
    assert.equal(JSON.parse(init.body).timeout,undefined,'do not impose the former 10-second supplier deadline');
    await new Promise(resolve=>{release=resolve;});
    return Response.json({data:[{hotelId:'lp123',price:375.5,offerId:'priced'}]});
  };
  try {
    const request=get(env).then(value=>{complete=true;return value;});
    for(let i=0;i<20&&!release;i++) await new Promise(resolve=>setTimeout(resolve,0));
    assert.ok(release);assert.equal(complete,false);
    release();const result=await request;
    assert.equal(result.hotels[0].minimumRate.price,375.5);
    assert.equal(result.hotels[0].rateStatus,'available');
    assert.equal(result.sandbox,true,'preserve test provenance rather than erasing price');
  } finally {globalThis.fetch=old;}
});

test('unrated hotels appear under every star filter without fabricated rating', async()=>{
 const env=environment(),old=globalThis.fetch;
 env.cache.set('catalog:v2:makkah',{payload:JSON.stringify([{id:'a',name:'Four',stars:4},{id:'b',name:'Unknown'},{id:'c',name:'Zero',stars:0},{id:'d',name:'Five',stars:5}]),updated_at:Date.now(),expires_at:Date.now()+600000});
 globalThis.fetch=async()=>{throw Error('catalog must not fetch rates');};
 try{for(let stars=1;stars<=5;stars++){const r=await get(env,`&catalogOnly=1&stars=${stars}`); assert.ok(r.hotels.some(h=>h.id==='b'&&h.stars===undefined));assert.ok(r.hotels.some(h=>h.id==='c'&&h.stars===0));assert.equal(r.hotels.some(h=>h.id==='a'),stars===4);}}
 finally{globalThis.fetch=old;}
});
test('price-only responses reuse scoped per-property prices across filters without metadata',async()=>{
 const env=environment(),old=globalThis.fetch;let calls=0;
 env.cache.set('catalog:v2:makkah',{payload:JSON.stringify([{id:'a',name:'Four',stars:4},{id:'b',name:'Unknown'},{id:'c',name:'Five',stars:5}]),updated_at:Date.now(),expires_at:Date.now()+600000});
 globalThis.fetch=async(_,init)=>{calls++;const ids=JSON.parse(init.body).hotelIds;return Response.json({data:ids.filter(id=>id!=='c').map(id=>({hotelId:id,price:250}))});};
 try{let r=await get(env,'&ratesOnly=1&hotelIds=a,b&pageSize=2');assert.equal(r.hotels.length,2);assert.ok(r.hotels.every(h=>h.name===undefined&&h.minimumRate.price===250));r=await get(env,'&ratesOnly=1&stars=4&hotelIds=b&pageSize=1');assert.equal(calls,1);assert.equal(r.hotels[0].minimumRate.price,250);r=await get(env,'&ratesOnly=1&hotelIds=c&pageSize=1');assert.equal(r.hotels[0].rateStatus,'not_returned');assert.equal(r.rateError,null);const u=url('&ratesOnly=1&hotelIds=b&pageSize=1');u.searchParams.set('adults','3');await handleNuiteeHotelRequest(new Request(u),env,u);assert.equal(calls,3);}
 finally{globalThis.fetch=old;}
});
