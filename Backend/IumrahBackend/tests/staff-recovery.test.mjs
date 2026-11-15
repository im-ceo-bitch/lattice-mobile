import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import core from '../core/index.js';
import {STAFF_RECOVERY_SCHEMA} from '../core/lib/staff-recovery.js';
import {readFileSync} from 'node:fs';
const origin='https://iumrah-backend.helloiumrah.workers.dev';
const address='owner@example.test';
const originalPassword='original-test-password';
const newPassword='new-long-test-password';
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(STAFF_RECOVERY_SCHEMA);
 const db={prepare(query){let values=[];const api={bind(...args){values=args;return api;},async run(){return {meta:sql.prepare(query).run(...values)};},async first(){return sql.prepare(query).get(...values)||null;}};return api;}};
 const env={BOOKINGS_DB:db,IUMRAH_SUPERADMIN_PASSWORD:originalPassword,IUMRAH_SESSION_SECRET:'s'.repeat(48),IUMRAH_ADMIN_RECOVERY_EMAIL:address,RESEND_API_KEY:'test'};
 const go=(p,body,headers={},overrides={})=>core.fetch(new Request(origin+'/api/auth/staff/'+p,{method:body===undefined?'GET':'POST',headers:{...headers,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{...env,...overrides},{},()=>{throw Error('unexpected dispatch');});
 return {sql,go,env};
}
async function withMail(fn){const saved=globalThis.fetch;const mails=[];let status=200;globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.resend.com/emails');mails.push(JSON.parse(init.body));return new Response(JSON.stringify({id:'test-message-id'}),{status});};try{await fn(mails,x=>{status=x;});}finally{globalThis.fetch=saved;}}
const codeFrom=mail=>mail.text.match(/\d{6}/)[0];
const cookieFrom=response=>response.headers.get('set-cookie')?.split(';')[0];
const login=(go,password,login='superadmin')=>go('login',{login,password});
async function issue(go,mails){const res=await go('recovery/start',{email:address});assert.equal(res.status,200,await res.clone().text());const data=await res.json();assert.deepEqual(mails.at(-1).to,[address]);assert.equal(data.expiresIn,600);assert.equal(data.code,undefined);return {email:address,challengeID:data.challengeID,code:codeFrom(mails.at(-1)),password:newPassword};}

test('owner recovery is routed, hashes credentials, consumes code, revokes old cookies and preserves canonical staff identity',async()=>withMail(async mails=>{
 const {go,sql}=fixture();const old=await login(go,originalPassword);assert.equal(old.status,200);const oldCookie=cookieFrom(old);
 const proof=await issue(go,mails);const row=sql.prepare('SELECT * FROM staff_recovery_state').get();assert.notEqual(row.code_hash,proof.code);assert.equal(row.password_hash,null);
 const result=await go('recovery/confirm',proof);assert.equal(result.status,200,await result.clone().text());assert.equal(result.headers.get('set-cookie'),null);
 const after=sql.prepare('SELECT * FROM staff_recovery_state').get();assert.equal(after.credential_version,1);assert.equal(after.code_hash,null);assert.equal(after.password_hash.length,64);assert.notEqual(after.password_hash,newPassword);
 assert.equal((await go('session',undefined,{cookie:oldCookie})).status,401);
 assert.equal((await login(go,originalPassword)).status,401);
 const fresh=await login(go,newPassword,address.toUpperCase());assert.equal(fresh.status,200);assert.equal((await fresh.json()).login,'superadmin');
 assert.equal((await go('session',undefined,{cookie:cookieFrom(fresh)})).status,200);
 assert.equal((await login(go,newPassword)).status,200);
 assert.equal((await go('recovery/confirm',proof)).status,400);
 // Removing the recovery address cannot restore the bootstrap password.
 assert.equal((await go('login',{login:'superadmin',password:originalPassword},{},{IUMRAH_ADMIN_RECOVERY_EMAIL:''})).status,401);
}));
test('only configured owner can initiate or finish; missing configuration fails closed',async()=>withMail(async mails=>{
 const {go}=fixture();assert.equal((await go('recovery/start',{email:'attacker@example.test'})).status,400);assert.equal(mails.length,0);
 assert.equal((await go('recovery/start',{email:address},{},{IUMRAH_ADMIN_RECOVERY_EMAIL:''})).status,503);
 const proof=await issue(go,mails);assert.equal((await go('recovery/confirm',{...proof,email:'attacker@example.test'})).status,400);
 assert.equal((await go('recovery/confirm',{...proof,password:'short'})).status,400);
 assert.equal((await go('recovery/confirm',proof)).status,200);
}));
test('OTP lockout is atomic and correct code cannot bypass five wrong guesses',async()=>withMail(async mails=>{
 const {go,sql}=fixture();const proof=await issue(go,mails);const wrong=proof.code==='000000'?'000001':'000000';
 const outcomes=await Promise.all(Array.from({length:8},()=>go('recovery/confirm',{...proof,code:wrong})));
 assert.ok(outcomes.every(x=>x.status===400));assert.equal(sql.prepare('SELECT attempts FROM staff_recovery_state').get().attempts,5);
 assert.equal((await go('recovery/confirm',proof)).status,400);assert.equal((await login(go,originalPassword)).status,200);
}));
test('concurrent issue and confirm cannot send or consume twice; expiry enforced',async()=>withMail(async mails=>{
 const {go,sql}=fixture();const results=await Promise.all([go('recovery/start',{email:address}),go('recovery/start',{email:address})]);assert.deepEqual(results.map(x=>x.status).sort(),[200,429]);assert.equal(mails.length,1);
 const proof={email:address,challengeID:(await results.find(x=>x.ok).json()).challengeID,code:codeFrom(mails[0]),password:newPassword};
 const confirms=await Promise.all([go('recovery/confirm',proof),go('recovery/confirm',proof)]);assert.deepEqual(confirms.map(x=>x.status).sort(),[200,400]);
 sql.exec('UPDATE staff_recovery_state SET sent_at=0');const next=await issue(go,mails);sql.exec('UPDATE staff_recovery_state SET expires_at=0');assert.equal((await go('recovery/confirm',next)).status,400);
}));
test('provider failure invalidates code without clearing rate limits; hourly limit stays enforced',async()=>withMail(async(mails,setStatus)=>{
 const {go,sql}=fixture();setStatus(500);assert.equal((await go('recovery/start',{email:address})).status,503);assert.equal(sql.prepare('SELECT code_hash FROM staff_recovery_state').get().code_hash,null);assert.equal((await go('recovery/start',{email:address})).status,429);
 setStatus(200);for(let i=0;i<4;i++){sql.exec('UPDATE staff_recovery_state SET sent_at=0');await issue(go,mails);}
 sql.exec('UPDATE staff_recovery_state SET sent_at=0');assert.equal((await go('recovery/start',{email:address})).status,429);assert.equal(mails.length,5);
}));
test('additive schema includes recovery table in core DB only',()=>{const schema=JSON.parse(readFileSync(new URL('../schema/bootstrap-v21.json',import.meta.url),'utf8'));assert.ok(schema.BOOKINGS_DB.tables.some(t=>t.name==='staff_recovery_state'&&t.sql===STAFF_RECOVERY_SCHEMA));assert.ok(!schema.HOTELS_DB.tables.some(t=>t.name==='staff_recovery_state'));});

test('V37 recovery traverses the real unified router with core enabled, not only the core handler',async()=>withMail(async mails=>{
 const {go,env}=fixture();
 const {createBackendRouter}=await import('../src/router.js');
 const unused={fetch(){throw Error('unexpected route');}};
 const router=createBackendRouter({core,hotels:unused,flights:unused,packages:unused});
 const active={...env,HOTELS_DB:{},FLIGHTS_DB:{},HOTELS_MEDIA:{},PASSPORTS:{},PACKAGE_QUOTE_SEAL_KEY:'test',IUMRAH_CORE_CUTOVER_READY:'1',IUMRAH_CORE_PARITY_ATTESTATION:'v21:'+'a'.repeat(64)};
 const request=(path,body)=>router.fetch(new Request(origin+'/api/auth/staff/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),active,{});
 const start=await request('recovery/start',{email:' '+address.toUpperCase()+' '});
 assert.equal(start.status,200,await start.clone().text());const challenge=await start.json();assert.equal(mails.length,1);
 const reset=await request('recovery/confirm',{email:address,challengeID:challenge.challengeID,code:codeFrom(mails[0]),password:newPassword});assert.equal(reset.status,200);
 assert.equal((await login(go,newPassword)).status,200);
}));
test('V37 distinguishes missing config and missing D1 schema without sending email or leaking values',async()=>withMail(async mails=>{
 const {go,sql,env}=fixture();const {staffRecoveryReadiness}=await import('../core/lib/staff-recovery.js');
 for(const [override,code] of [[{IUMRAH_ADMIN_RECOVERY_EMAIL:''},'STAFF_RECOVERY_OWNER_MISSING'],[{RESEND_API_KEY:'  '},'STAFF_RECOVERY_MAIL_KEY_MISSING'],[{IUMRAH_SESSION_SECRET:'short'},'STAFF_RECOVERY_SECURITY_MISSING'],[{IUMRAH_ADMIN_RECOVERY_FROM:'bad'},'STAFF_RECOVERY_SENDER_INVALID']]){
  const response=await go('recovery/start',{email:address},{},override);assert.equal(response.status,503);assert.equal((await response.json()).error,code);
  assert.deepEqual(await staffRecoveryReadiness({...env,...override}),{ready:false,error:code});
 }
 assert.deepEqual(await staffRecoveryReadiness(env),{ready:true,deliveryVerified:false});
 sql.exec('DROP TABLE staff_recovery_state');
 const response=await go('recovery/start',{email:address});assert.equal(response.status,503);assert.equal((await response.json()).error,'STAFF_RECOVERY_DB_UNAVAILABLE');assert.equal(mails.length,0);
 assert.deepEqual(await staffRecoveryReadiness(env),{ready:false,error:'STAFF_RECOVERY_DB_UNAVAILABLE'});
}));
test('V37 mail rejection reports safe reason; provider success without id is not success',async()=>{
 const saved=globalThis.fetch;
 try {
 for(const [status,body,code] of [[401,{},'STAFF_RECOVERY_MAIL_AUTH'],[403,{message:'private details'},'STAFF_RECOVERY_MAIL_AUTH'],[429,{},'STAFF_RECOVERY_MAIL_RATE_LIMIT'],[422,{},'STAFF_RECOVERY_MAIL_REJECTED'],[200,{},'STAFF_RECOVERY_MAIL_UNCONFIRMED']]){
  const {go,sql}=fixture();globalThis.fetch=async()=>Response.json(body,{status});
  const response=await go('recovery/start',{email:address});assert.equal(response.status,503);assert.deepEqual(await response.json(),{ok:false,error:code});
  assert.equal(sql.prepare('SELECT code_hash FROM staff_recovery_state').get().code_hash,null);
 }
 }finally{globalThis.fetch=saved;}
});
test('V37 uses explicitly configured sender but never caller-selected recipient or sender',async()=>withMail(async mails=>{
 const {go}=fixture();const response=await go('recovery/start',{email:address,to:'attacker@example.test',from:'attacker@example.test'},{},{IUMRAH_ADMIN_RECOVERY_FROM:'security@verified.example'});
 assert.equal(response.status,200);assert.deepEqual(mails[0].to,[address]);assert.equal(mails[0].from,'iumrah Business <security@verified.example>');
}));
