import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {registerHooks} from 'node:module';
import fs from 'node:fs';
import {ensureSchema} from '../scripts/apply-package-schema.mjs';
import {carePushTargets,accountChatKey,staffChatScope} from '../../HotelsWorker/src/care-identity.js';
const hook=registerHooks({resolve(specifier,context,next){if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export class WorkflowEntrypoint {}',shortCircuit:true};return next(specifier,context);}});
const {default:worker}=await import('../../HotelsWorker/src/index.js');hook.deregister();
const schema=JSON.parse(fs.readFileSync(new URL('../schema/bootstrap-v21.json',import.meta.url),'utf8')).HOTELS_DB;
const sha=s=>createHash('sha256').update(s).digest('hex');
const stamp='2026-01-01T00:00:00Z',expires='2099-01-01T00:00:00Z';
const base='https://iumrah-backend.helloiumrah.workers.dev';
const C='/api/catalog/hotels/client/chats/',A='/api/admin/hotels/chats/',N='/api/catalog/hotels/client/notifications/devices';
const tokenA='a'.repeat(64), tokenB='b'.repeat(64), guest='guest-proof';
const staff={cookie:'iumrah_staff_session=fixture'},accountA={authorization:`Bearer ${tokenA}`},accountB={authorization:`Bearer ${tokenB}`},guestA={'x-booking-token':guest};
async function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');await ensureSchema(async q=>sql.prepare(q).all(),schema,'HOTELS_DB');
 const db={prepare(q){let a=[];const st={bind(...args){a=args;return st},async first(){return sql.prepare(q).get(...a)||null},async all(){return {results:sql.prepare(q).all(...a)}},async run(){return {meta:sql.prepare(q).run(...a)}}};return st},async batch(stmts){sql.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.run());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
 for(const [id,name] of [[1,'First'],[2,'Second'],[3,'Guest']])sql.prepare('INSERT INTO pilgrims(id,display_name) VALUES(?,?)').run(id,name);
 for(const [id,owner] of [['a',1],['b',1],['foreign',2],['guest',3]])sql.prepare('INSERT INTO pilgrim_trips(id,booking_id,pilgrim_id) VALUES(?,?,?)').run('trip-'+id,id,owner);
 for(const [id,t] of [[1,tokenA],[2,tokenB]]){
  sql.prepare('INSERT INTO iumrah_accounts(pilgrim_id,password_salt,password_hash,activated_at,password_updated_at) VALUES(?,?,?,?,?)').run(id,'fixture','fixture',stamp,stamp);
  sql.prepare('INSERT INTO iumrah_account_sessions(token_hash,pilgrim_id,created_at,expires_at,last_used_at) VALUES(?,?,?,?,?)').run(sha(t),id,stamp,expires,stamp);
 }
 const env={HOTELS_DB:db,HOTELS_MEDIA:{async get(key){return {body:new TextEncoder().encode(key)}}},IUMRAH_CORE_FETCH:async (url,init)=>{
   const u=new URL(url);if(u.pathname.endsWith('/staff/session'))return Response.json({user:{login:'operator',role:'superadmin',displayName:'Care'}});
   const id=u.pathname.split('/').at(-1);return init.headers['x-booking-token']===guest&&['a','guest'].includes(id)?Response.json({booking:{id}}):Response.json({error:'NOT_FOUND'},{status:404});
 }};
 const go=(path,headers={},method='GET',body)=>worker.fetch(new Request(base+path,{method,headers:{...headers,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env);
 const add=(key,id,body=id)=>{sql.prepare('INSERT OR IGNORE INTO business_chat_threads(booking_id,last_message_preview,last_sender_type,unread_for_staff) VALUES(?,?,?,1)').run(key,body,'client');sql.prepare('INSERT INTO business_chat_messages(id,booking_id,sender_type,body,read_by_staff) VALUES(?,?,?,?,0)').run(id,key,'client',body);};
 const register=(id,token,headers)=>go(N,headers,'POST',{installationID:id,deviceToken:token,environment:'production',appBundleID:'com.iumrah.app',locale:'ru',hasTrip:true});
 return {sql,db,env,go,add,register};
}
const data=async res=>{assert.ok(res.ok,`${res.status} ${await res.clone().text()}`);return res.json()};
test('real worker: one account conversation, old booking messages, staff list deduplicates, guest token stays scoped',async()=>{const {sql,go,add}=await fixture();try{
 add('a','old-a');add('b','old-b');add('foreign','other');
 const newMessage=await data(await go(C+'account/messages',accountA,'POST',{body:'new account message',clientMessageID:'unique-one'}));
 const retry=await data(await go(C+'account/messages',accountA,'POST',{body:'new account message',clientMessageID:'unique-one'}));assert.equal(newMessage.message.id,retry.message.id);
 assert.equal(newMessage.message.bookingID,accountChatKey(1));
 const account=await data(await go(C+'account/messages?after=0',accountA));assert.deepEqual(account.messages.map(m=>m.id),['old-a','old-b',newMessage.message.id]);
 const next=await data(await go(C+`account/messages?after=${account.nextCursor}&scope=${account.scopeVersion}`,accountA));assert.equal(next.messages.length,0);assert.equal(next.reset,false);
 const guestHistory=await data(await go(C+'a/messages?after=0',guestA));assert.deepEqual(guestHistory.messages.map(x=>x.id),['old-a']);
 assert.equal((await go(C+'account/messages',guestA)).status,401);assert.equal((await go(C+'foreign/messages',accountA)).status,403);
 assert.equal((await go(C+'a/messages',guestA,'POST',{body:'no'})).status,401);
 const other=await data(await go(C+'account/messages?after=0',accountB));assert.deepEqual(other.messages.map(x=>x.id),['other']);
 const threads=await data(await go(A,staff));assert.equal(threads.threads.length,2);const first=threads.threads.find(x=>x.pilgrimID==='00000001');assert.equal(first.conversationID,accountChatKey(1));assert.equal(first.tripCount,2);
 const reply=await data(await go(A+first.conversationID+'/messages',staff,'POST',{body:'reply',clientMessageID:'staff-one'}));assert.equal(reply.message.bookingID,accountChatKey(1));
 const later=await data(await go(C+`account/messages?after=${account.nextCursor}&scope=${account.scopeVersion}`,accountA));assert.deepEqual(later.messages.map(x=>x.id),[reply.message.id]);
 await data(await go(A+first.conversationID+'/read',staff,'POST'));assert.equal(sql.prepare("SELECT SUM(read_by_staff) AS n FROM business_chat_messages WHERE sender_type='client' AND booking_id IN ('a','b','care-pilgrim:1')").get().n,3);
 assert.equal(sql.prepare("SELECT read_by_staff FROM business_chat_messages WHERE id='other'").get().read_by_staff,0);
 }finally{sql.close()}});
test('real worker: claim exposes old guest messages without rewriting them and resets cursor on ownership change',async()=>{const {sql,go,add}=await fixture();try{
 const sent=await data(await go(C+'guest/messages',guestA,'POST',{body:'before signup'}));
 const first=await data(await go(C+'account/messages?after=0',accountA));
 sql.exec("UPDATE pilgrim_trips SET pilgrim_id=1 WHERE booking_id='guest'");
 const next=await data(await go(C+`account/messages?after=${first.nextCursor}&scope=${first.scopeVersion}`,accountA));assert.equal(next.reset,true);assert.ok(next.messages.some(x=>x.id===sent.message.id));assert.equal(sql.prepare('SELECT booking_id FROM business_chat_messages WHERE id=?').get(sent.message.id).booking_id,'guest');
 sql.exec("UPDATE pilgrim_trips SET pilgrim_id=2 WHERE booking_id='guest'");
 const moved=await data(await go(C+`account/messages?after=${next.nextCursor}&scope=${next.scopeVersion}`,accountA));assert.equal(moved.reset,true);assert.ok(!moved.messages.some(x=>x.id===sent.message.id));
 }finally{sql.close()}});
test('real worker: private media requires owning account, preserves original R2 key',async()=>{const {sql,go,add}=await fixture();try{
 add('b','image');sql.prepare('INSERT INTO business_chat_attachments(id,booking_id,object_key) VALUES(?,?,?)').run('photo','b','chat/b/legacy.webp');sql.exec("UPDATE business_chat_messages SET message_type='image',attachment_id='photo' WHERE id='image'");
 const page=await data(await go(C+'account/messages?after=0',accountA));assert.equal(page.messages[0].attachmentURL,C+'account/media/photo');
 const media=await go(page.messages[0].attachmentURL,accountA);assert.equal(await media.text(),'chat/b/legacy.webp');assert.equal((await go(page.messages[0].attachmentURL,accountB)).status,404);assert.equal((await go(page.messages[0].attachmentURL,guestA)).status,401);
 }finally{sql.close()}});
test('real worker: account chat without trips survives booking deletion and appears in Business',async()=>{const {sql,go}=await fixture();try{
 const sent=await data(await go(C+'account/messages',accountA,'POST',{body:'permanent'}));sql.exec('DELETE FROM pilgrim_trips WHERE pilgrim_id=1');
 const list=await data(await go(A,staff));assert.equal(list.threads[0].tripCount,0);assert.equal(list.threads[0].conversationID,accountChatKey(1));
 const page=await data(await go(C+'account/messages?after=0',accountA));assert.deepEqual(page.messages.map(x=>x.id),[sent.message.id]);
 }finally{sql.close()}});
test('real worker: register two devices, push only to current account sessions, revoke/logout prevents delivery',async()=>{const {sql,db,env,go,register}=await fixture();const originalFetch=globalThis.fetch;try{
 const d1='1'.repeat(64),d2='2'.repeat(64),d3='3'.repeat(64),d4='4'.repeat(64);
 await data(await register('installation-00001',d1,accountA));await data(await register('installation-00002',d2,accountA));await data(await register('installation-00003',d3,accountB));await data(await register('installation-00004',d4,{}));
 const targets=await carePushTargets(db,'a','com.iumrah.app');assert.deepEqual(new Set(targets.rows.map(r=>r.device_token)),new Set([d1,d2]));
 const {privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});env.APNS_PRIVATE_KEY=privateKey.export({format:'pem',type:'pkcs8'});env.APNS_KEY_ID='fixture';env.APPLE_TEAM_ID='fixture';
 const delivered=[];globalThis.fetch=async(url,init)=>{delivered.push({url:String(url),payload:JSON.parse(init.body)});return new Response('',{status:200})};
 await data(await go(A+accountChatKey(1)+'/messages',staff,'POST',{body:'push test'}));assert.equal(delivered.length,2);assert.ok(delivered.every(x=>x.payload.bookingID==='account'&&x.payload.pilgrimID==='00000001'));
 await data(await register('installation-00001',d1,{}));assert.deepEqual((await carePushTargets(db,'b','com.iumrah.app')).rows.map(x=>x.device_token),[d2]);
 sql.prepare('UPDATE iumrah_account_sessions SET revoked_at=? WHERE token_hash=?').run(stamp,sha(tokenA));assert.equal((await carePushTargets(db,'b','com.iumrah.app')).rows.length,0);assert.equal((await go(C+'account/messages',accountA)).status,401);
 assert.ok((await carePushTargets(db,'foreign','com.iumrah.app')).rows.some(x=>x.device_token===d3));
 }finally{globalThis.fetch=originalFetch;sql.close()}});
test('guest booking keeps its own push; claiming it switches delivery to authenticated account devices',async()=>{const {sql,db,go,register}=await fixture();try{
 const guestDevice='7'.repeat(64),accountDevice='8'.repeat(64);
 const reg=await go('/api/catalog/hotels/client/push/devices',guestA,'POST',{bookingID:'guest',deviceToken:guestDevice,environment:'production',appBundleID:'com.iumrah.app',locale:'ru'});await data(reg);
 assert.deepEqual((await carePushTargets(db,'guest','com.iumrah.app')).rows.map(r=>r.device_token),[guestDevice]);
 await data(await register('installation-00008',accountDevice,accountA));
 sql.exec("UPDATE pilgrim_trips SET pilgrim_id=1 WHERE booking_id='guest'");
 assert.deepEqual((await carePushTargets(db,'guest','com.iumrah.app')).rows.map(r=>r.device_token),[accountDevice]);
 }finally{sql.close()}});
