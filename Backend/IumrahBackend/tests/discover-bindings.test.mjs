import test from 'node:test';
import assert from 'node:assert/strict';
import {discover} from '../scripts/discover-bindings.mjs';

const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'token'};
const databases=[
  {name:'iumrah-hotels',uuid:'11111111-1111-1111-1111-111111111111'},
  {name:'iumrah-core',uuid:'22222222-2222-2222-2222-222222222222'},
  {name:'iumrah-flights',uuid:'33333333-3333-3333-3333-333333333333'}
];
const ok=result=>({ok:true,status:200,json:async()=>({success:true,result})});
function mockFetch(dbs=databases,bucket='iumrah-hotels-media'){
  return async(url,opts={})=>{
    if (url.includes('/d1/database?')) return ok(dbs);
    if (url.includes('/d1/database/') && url.endsWith('/query')) throw Error('Discovery must not inspect schemas');
    if (url.includes('/r2/buckets/')){
      const name=url.split('/').at(-1);
      return name===bucket?ok({name}):{ok:false,status:404};
    }
    throw Error(`Unexpected URL ${url}`);
  };
}
test('discovers the three exact D1 names shown in the Cloudflare account',async()=>{
 const result=await discover(env,mockFetch());
 assert.equal(result.HOTELS_DB_ID,databases[0].uuid);
 assert.equal(result.BOOKINGS_DB_NAME,'iumrah-core');
 assert.equal(result.FLIGHTS_DB_ID,databases[2].uuid);
 assert.equal(result.HOTELS_MEDIA_BUCKET,'iumrah-hotels-media');
});
test('does not exclude existing hotel DB when old hotels table is absent',async()=>{
 const result=await discover(env,mockFetch());
 assert.equal(result.HOTELS_DB_NAME,'iumrah-hotels');
});
test('discovers the other previously known existing R2 bucket',async()=>{
 const result=await discover(env,mockFetch(databases,'iumrah-operations-media'));
 assert.equal(result.HOTELS_MEDIA_BUCKET,'iumrah-operations-media');
});
test('allows deployment preview with an absent R2 bucket',async()=>{
 const result=await discover(env,mockFetch(databases,'does-not-exist'));
 assert.equal(result.HOTELS_MEDIA_BUCKET,'none');
});
test('stops rather than creating a missing existing D1 database',async()=>{
 const withoutHotels=databases.filter(x=>x.name!=='iumrah-hotels');
 await assert.rejects(discover(env,mockFetch(withoutHotels)),/HOTELS_DB.*iumrah-hotels/);
});
test('stops when duplicate D1 names make identity ambiguous',async()=>{
 await assert.rejects(discover(env,mockFetch([...databases,{...databases[0],uuid:'44444444-4444-4444-4444-444444444444'}])),/HOTELS_DB.*found 2/);
});
test('supports optional non-secret exact name overrides',async()=>{
 const result=await discover({...env,BOOKINGS_DB_NAME:'new-bookings'},mockFetch([...databases,{name:'new-bookings',uuid:'44444444-4444-4444-4444-444444444444'}]));
 assert.equal(result.BOOKINGS_DB_NAME,'new-bookings');
});
