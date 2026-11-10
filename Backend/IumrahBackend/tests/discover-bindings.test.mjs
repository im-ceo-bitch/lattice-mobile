import test from 'node:test';
import assert from 'node:assert/strict';
import {discover} from '../scripts/discover-bindings.mjs';

const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'token'};
const databases=[
  {name:'iumrah-hotels',uuid:'11111111-1111-1111-1111-111111111111',tables:['hotels','intelligence_events']},
  {name:'iumrah-web-db',uuid:'22222222-2222-2222-2222-222222222222',tables:['bookings']},
  {name:'iumrah-flights',uuid:'33333333-3333-3333-3333-333333333333',tables:['flights','flight_offers']}
];
const ok=result=>({ok:true,status:200,json:async()=>({success:true,result})});
function mockFetch(dbs=databases, bucket='iumrah-hotels-media'){
  return async (url,opts={})=>{
    if (url.includes('/d1/database?')) return ok(dbs.map(({name,uuid})=>({name,uuid})));
    if (url.includes('/d1/database/') && url.endsWith('/query')){
      assert.equal(opts.method,'POST');
      assert.match(opts.body,/sqlite_master/);
      const db=dbs.find(x=>url.includes(x.uuid));
      return ok([{results:(db?.tables||[]).map(name=>({name}))}]);
    }
    if (url.includes('/r2/buckets/')){
      const name=url.split('/').at(-1);
      return name===bucket?ok({name}):{ok:false,status:404};
    }
    throw Error(`Unexpected URL ${url}`);
  };
}

test('discovers UUIDs from Cloudflare by name+schema with no extra GitHub secrets',async()=>{
  const result=await discover(env,mockFetch());
  assert.equal(result.HOTELS_DB_ID,databases[0].uuid);
  assert.equal(result.BOOKINGS_DB_ID,databases[1].uuid);
  assert.equal(result.FLIGHTS_DB_ID,databases[2].uuid);
  assert.equal(result.HOTELS_MEDIA_BUCKET,'iumrah-hotels-media');
});
test('fallback to existing operations bucket without creating R2',async()=>{
  const result=await discover(env,mockFetch(databases,'iumrah-operations-media'));
  assert.equal(result.HOTELS_MEDIA_BUCKET,'iumrah-operations-media');
});
test('blocks when hotel database schema was stripped during migration',async()=>{
  const noHotels=databases.map((db,i)=>i?db:{...db,tables:['bookings']});
  await assert.rejects(discover(env,mockFetch(noHotels)),/HOTELS_DB.*found 0/);
});
test('blocks ambiguous bookings rather than selecting wrong production database',async()=>{
  const extra=[...databases,{name:'iumrah-core',uuid:'44444444-4444-4444-4444-444444444444',tables:['bookings']}];
  await assert.rejects(discover(env,mockFetch(extra)),/BOOKINGS_DB.*found 2/);
});
test('honors optional nonsecret DB name override',async()=>{
  const extra=[...databases,{name:'iumrah-core',uuid:'44444444-4444-4444-4444-444444444444',tables:['bookings']}];
  const result=await discover({...env,BOOKINGS_DB_NAME:'iumrah-web-db'},mockFetch(extra));
  assert.equal(result.BOOKINGS_DB_NAME,'iumrah-web-db');
});
