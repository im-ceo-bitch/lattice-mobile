import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyDeployed} from '../scripts/check-deployed.mjs';
const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'safe-test-token'};
function fake(url) {
 if(url.endsWith('/workers/subdomain')) return Promise.resolve({ok:true,json:async()=>({success:true,result:{subdomain:'helloiumrah'}})});
 const path=new URL(url).pathname;
 let data;
 if(path==='/__iumrah/health') data={ok:true,service:'iumrah-backend',bindings:{FLIGHTS_DB:true},modules:{core:true,packages:true,coreCutoverEnabled:true},status:'degraded'};
 else if(path==='/__iumrah/cutover') data={ok:true,service:'iumrah-backend',coreCutoverEnabled:true,schemaReady:true,migrationAttested:true,providerConfigurationReady:true,missing:[]};
 else if(path==='/api/services/health') data={ok:true,service:'iumrah-public-services',release:'v21-rc',advisorLanguages:9,audioLanguages:9};
 else if(path==='/api/package/health') data={ok:true,service:'iumrah-package-engine',hotelsDbConfigured:true,bookingsDbConfigured:true};
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

test('published Worker must not report success when core is pending',async()=>{
 await assert.rejects(verifyDeployed(env,async url=>url.endsWith('/__iumrah/cutover')?Response.json({ok:true,service:'iumrah-backend',coreCutoverEnabled:false,schemaReady:true,migrationAttested:false,missing:['IUMRAH_CORE_PARITY_ATTESTATION']}):fake(url)),/CORE_CUTOVER_PENDING/);
});

test('release check refuses missing provider configuration, without blocking core request handling',async()=>{
 await assert.rejects(verifyDeployed(env,async url=>url.endsWith('/__iumrah/cutover')?Response.json({ok:true,service:'iumrah-backend',coreCutoverEnabled:true,schemaReady:true,migrationAttested:true,missing:[],providerConfigurationReady:false,providers:{sms:false,email:true}}):fake(url)),/CORE_PROVIDER_CONFIGURATION_PENDING: sms/);
});

test('deferred eSIM and Telegram OAuth do not fail deployment while configured core services remain required',async()=>{
 const result=await verifyDeployed(env,async url=>url.endsWith('/__iumrah/cutover')?Response.json({ok:true,service:'iumrah-backend',coreCutoverEnabled:true,schemaReady:true,migrationAttested:true,missing:[],providerConfigurationReady:true,providers:{email:true,telegram:true,esim:false,telegramOAuth:false},optionalProviders:['esim','telegramOAuth'],requiredProviderGaps:[]}):fake(url));assert.equal(result.flights,12);
});

test('configured Telegram is switched and verified by existing CI credential',async()=>{let setup=0;const e={...env,ADMIN_TOKEN:'ci-secret'};const f=async(url,init)=>{if(url.endsWith('/__iumrah/cutover'))return Response.json({ok:true,service:'iumrah-backend',coreCutoverEnabled:true,schemaReady:true,migrationAttested:true,providerConfigurationReady:true,missing:[],providers:{telegram:true}});if(url.endsWith('/api/internal/telegram/setup')){setup++;assert.equal(init.method,'POST');assert.equal(init.headers.authorization,'Bearer ci-secret');return Response.json({ok:true,webhook:'https://iumrah-backend.helloiumrah.workers.dev/api/telegram/webhook',miniApp:'https://iumrah-backend.helloiumrah.workers.dev/telegram/mini'});}return fake(url);};await verifyDeployed(e,f);assert.equal(setup,1);await assert.rejects(verifyDeployed(e,(url,init)=>url.endsWith('/api/internal/telegram/setup')?Response.json({ok:false},{status:502}):f(url,init)),/TELEGRAM_WEBHOOK_CUTOVER_FAILED/);});

test('release check exposes safe setup stage and provider code, never raw response',async()=>{
 const e={...env,ADMIN_TOKEN:'ci-secret'};
 const f=async(url)=>url.endsWith('/__iumrah/cutover')?Response.json({ok:true,service:'iumrah-backend',coreCutoverEnabled:true,schemaReady:true,migrationAttested:true,providerConfigurationReady:true,missing:[],providers:{telegram:true}}):url.endsWith('/api/internal/telegram/setup')?Response.json({ok:false,error:'TELEGRAM_WEBHOOK_SETUP_FAILED',stage:'MENU',detail:'TELEGRAM_setChatMenuButton_HTTP_400',description:'PRIVATE_SECRET'},{status:502}):fake(url);
 await assert.rejects(verifyDeployed(e,f),err=>err.message.includes('HTTP_502 stage=MENU')&&err.message.includes('TELEGRAM_setChatMenuButton_HTTP_400')&&!err.message.includes('PRIVATE_SECRET'));
});
