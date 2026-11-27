import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { generateKeyPairSync } from 'node:crypto';
import { registerHooks } from 'node:module';
import { saveNotificationSound, seedNotificationSound, loadNotificationSounds, appleNotificationSound } from '../../HotelsWorker/src/notification-sound.js';
const hook=registerHooks({resolve(specifier,context,next){if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export class WorkflowEntrypoint {}',shortCircuit:true};return next(specifier,context);}});
const {sendStaffPush}=await import('../../HotelsWorker/src/index.js');hook.deregister();
const token='a'.repeat(64), token2='b'.repeat(64), client='com.iumrah.app', staff='com.iumrah.root';
function fixture(){const sql=new DatabaseSync(':memory:');const db={prepare(query){let args=[];const st={bind(...a){args=a;return st},async run(){return {meta:sql.prepare(query).run(...args)}},async first(){return sql.prepare(query).get(...args)||null},async all(){return {results:sql.prepare(query).all(...args)}}};return st}};return {sql,db};}
test('device choice survives legacy registrations and is scoped to topic and environment',async()=>{const {sql,db}=fixture();try{
 const device={device_token:token,environment:'production'};
 assert.equal(appleNotificationSound(await loadNotificationSounds(db,[device]),device,client),'default');
 assert.equal(await seedNotificationSound(db,token,client,'production','iumrah'),'iumrah');
 assert.equal(await saveNotificationSound(db,token,client,'production','system'),'system');
 assert.equal(await seedNotificationSound(db,token,client,'production','iumrah'),'system');
 assert.equal(await saveNotificationSound(db,token,client,'production',undefined),null);
 assert.equal(await saveNotificationSound(db,token,client,'production','../../file.wav'),null);
 await saveNotificationSound(db,token,staff,'production','iumrah');
 await saveNotificationSound(db,token,client,'development','iumrah');
 const sounds=await loadNotificationSounds(db,[device]);
 assert.equal(appleNotificationSound(sounds,device,client),'default');
 assert.equal(appleNotificationSound(sounds,device,staff),'iumrah-notification.wav');
 assert.equal(appleNotificationSound(sounds,{...device,environment:'development'},client),'iumrah-notification.wav');
 assert.equal(appleNotificationSound(sounds,{...device,device_token:token2},client),'default');
 assert.equal(await saveNotificationSound(db,'android-fcm-token',client,'production','iumrah'),null);
 }finally{sql.close()}});
test('Business APNs sends different sounds to each device; switching back updates next notification',async()=>{const {sql,db}=fixture();const oldFetch=globalThis.fetch;try{
 sql.exec(`CREATE TABLE business_push_devices(device_token TEXT PRIMARY KEY,environment TEXT,app_bundle_id TEXT,enabled INTEGER,last_success_at TEXT,last_error TEXT,updated_at TEXT)`);
 for(const t of [token,token2])sql.prepare('INSERT INTO business_push_devices(device_token,environment,app_bundle_id,enabled) VALUES(?,?,?,1)').run(t,'production',staff);
 await saveNotificationSound(db,token,staff,'production','iumrah');await saveNotificationSound(db,token2,staff,'production','system');
 const {privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});const env={HOTELS_DB:db,APNS_PRIVATE_KEY:privateKey.export({format:'pem',type:'pkcs8'}),APNS_KEY_ID:'fixture',APPLE_TEAM_ID:'fixture'};
 const calls=[];globalThis.fetch=async(url,init)=>{calls.push({url:String(url),topic:init.headers['apns-topic'],payload:JSON.parse(init.body)});return new Response('',{status:200})};
 assert.equal((await sendStaffPush(env,'New booking','test',{type:'booking_created'})).sent,2);
 assert.equal(calls.find(x=>x.url.endsWith(token)).payload.aps.sound,'iumrah-notification.wav');assert.equal(calls.find(x=>x.url.endsWith(token2)).payload.aps.sound,'default');assert.ok(calls.every(x=>x.topic===staff));
 await saveNotificationSound(db,token,staff,'production','system');calls.length=0;assert.equal((await sendStaffPush(env,'New message','test',{type:'chat_message'})).sent,2);assert.ok(calls.every(x=>x.payload.aps.sound==='default'));
 }finally{globalThis.fetch=oldFetch;sql.close()}});
