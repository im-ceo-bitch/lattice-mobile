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
 return {sql,go};
}
async function withMail(fn){const saved=globalThis.fetch;const mails=[];let status=200;globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.resend.com/emails');mails.push(JSON.parse(init.body));return new Response('{}',{status});};try{await fn(mails,x=>{status=x;});}finally{globalThis.fetch=saved;}}
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
