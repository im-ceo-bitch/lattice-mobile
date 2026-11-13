import test from 'node:test';
import assert from 'node:assert/strict';
import { handleNuiteeHotelRequest } from '../.runtime-dist/nuitee-hotels.js';

function environment() {
  const cache = new Map([['catalog:v1:makkah', { payload: JSON.stringify([{id:'lp123',name:'Hotel'}]), updated_at: Date.now(), expires_at: Date.now()+600000 }]]);
  return { NUITEE_API_KEY:'sand_fixture', HOTELS_DB:{prepare(sql) {
    let args=[];
    return {bind(...values){args=values;return this;},async first(){return cache.get(args[0])??null;},async run(){
      if(sql.includes('INSERT INTO')) cache.set(args[0],{payload:args[1],updated_at:args[2],expires_at:args[3]});
      return {success:true};
    }};
  }}};
}
function request(children) {
  const start=new Date(Date.now()+10*86400000).toISOString().slice(0,10);
  const end=new Date(Date.now()+12*86400000).toISOString().slice(0,10);
  return new Request('https://fixture/api/package/nuitee/rates',{method:'POST',body:JSON.stringify({hotelId:'lp123',checkin:start,checkout:end,adults:2,children})});
}
test('Nuitee forwards exact child ages and never shares adult-only cached rates',async()=>{
  const env=environment(), old=globalThis.fetch, calls=[];
  globalThis.fetch=async(_,init)=>{
    calls.push(JSON.parse(init.body));
    return Response.json({data:[{hotelId:'lp123',roomTypes:[{offerId:'offer',rates:[{mappedRoomId:'r',name:'Room',retailRate:{total:[{amount:240,currency:'USD'}]}}]}]}]});
  };
  try {
    for(const ages of [[],[0,7],[0,7],[0,8]]){
      const req=request(ages),res=await handleNuiteeHotelRequest(req,env,new URL(req.url));
      assert.equal(res.status,200);
      assert.equal((await res.json()).rates[0].price,240); // full stay, not multiplied by nights
    }
    assert.deepEqual(calls.map(x=>x.occupancies),[[{adults:2,children:[]}],[{adults:2,children:[0,7]}],[{adults:2,children:[0,8]}]]);
  } finally {globalThis.fetch=old;}
});
test('Nuitee rejects missing, fractional and out-of-range child ages',async()=>{
  for(const ages of [[-1],[18],[2.5],['7'],{}]){
    const req=request(ages),res=await handleNuiteeHotelRequest(req,environment(),new URL(req.url));
    assert.equal(res.status,400);
    assert.equal((await res.json()).error,'INVALID_CHILD_AGES');
  }
});
