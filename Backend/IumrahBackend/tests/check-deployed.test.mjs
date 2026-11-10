import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyDeployed} from '../scripts/check-deployed.mjs';
const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'safe-test-token'};
function fake(url) {
 if(url.endsWith('/workers/subdomain')) return Promise.resolve({ok:true,json:async()=>({success:true,result:{subdomain:'helloiumrah'}})});
 const path=new URL(url).pathname;
 let data;
 if(path==='/__iumrah/health') data={ok:true,service:'iumrah-backend',bindings:{FLIGHTS_DB:true},status:'degraded'};
 else if(path==='/health') data={ok:true,database_connected:true};
 else if(path==='/v1/public/status') data={ok:true,ready:true,counts:{flights:12,offers:3}};
 else if(path==='/v1/public/flights') data={ok:true,flights:[]};
 else throw Error(`Unexpected ${url}`);
 return Promise.resolve({ok:true,json:async()=>data});
}
test('verifies all required endpoints on only iumrah-backend',async()=>{
 const result=await verifyDeployed(env,fake);
 assert.equal(result.url,'https://iumrah-backend.helloiumrah.workers.dev');
 assert.equal(result.flights,12);
});
