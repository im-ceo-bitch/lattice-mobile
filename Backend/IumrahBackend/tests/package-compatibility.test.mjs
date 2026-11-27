// Supersedes the pre-Core compatibility fixture still present in deployed repos.
// Exercise actual handlers and the same schema used by deployment, not mock 200s.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {registerHooks} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readdirSync, readFileSync, writeFileSync, symlinkSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createBackendRouter,resolveBackendRoute} from '../src/router.js';
import core from '../core/index.js';
import {ensureSchema} from '../scripts/apply-package-schema.mjs';

const schema=JSON.parse(readFileSync(new URL('../schema/bootstrap-v9.json',import.meta.url),'utf8'));
const packageRoot=fileURLToPath(new URL('../package-engine/',import.meta.url));
const origin='https://iumrah-backend.helloiumrah.workers.dev';
let packages,hotels,materializeBookingIdentity,dir;
before(async()=>{
 dir=mkdtempSync(join(tmpdir(),'iumrah-package-compat-'));
 execFileSync('tsc',['-p',join(packageRoot,'tsconfig.json'),'--noEmit','false','--outDir',dir],{stdio:'pipe'});
 writeFileSync(join(dir,'package.json'),'{"type":"module"}');
 for(const f of readdirSync(dir).filter(f=>f.endsWith('.js')))symlinkSync(f,join(dir,f.slice(0,-3)));
 packages=(await import(pathToFileURL(join(dir,'index.js')).href)).default;
 const hook=registerHooks({resolve(specifier,context,next){if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export class WorkflowEntrypoint {}',shortCircuit:true};return next(specifier,context);}});
 try{const module=await import('../../HotelsWorker/src/index.js');hotels=module.default;materializeBookingIdentity=module.materializeBookingIdentity;}finally{hook.deregister();}
});
after(()=>{if(dir)rmSync(dir,{recursive:true,force:true});});
function d1(db){return {prepare(sql){const stmt=db.prepare(sql);const numbered=[...sql.matchAll(/\?(\d+)/g)].map(m=>m[1]);const wrap=values=>{const args=numbered.length?[Object.fromEntries(numbered.map(i=>[i,values[Number(i)-1]]))]:values;return {bind(...v){return wrap(v);},async first(){return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};},async run(){return {meta:stmt.run(...args)};}};};return wrap([]);},async batch(statements){db.exec('BEGIN');try{const results=[];for(const stmt of statements)results.push(await stmt.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}};}
async function fixture(t){
 const h=new DatabaseSync(':memory:'),b=new DatabaseSync(':memory:');t.after(()=>{h.close();b.close();});
 for(const [db,binding] of [[h,'HOTELS_DB'],[b,'BOOKINGS_DB']])await ensureSchema(async sql=>db.prepare(sql).all(),schema[binding],binding);
 const env={HOTELS_DB:d1(h),BOOKINGS_DB:d1(b),FLIGHTS_DB:{},PASSPORTS:{},IUMRAH_CORE_CUTOVER_READY:'1',IUMRAH_CORE_PARITY_ATTESTATION:'v21:'+'a'.repeat(64),HOTELS_MEDIA:{},IUMRAH_SESSION_SECRET:'fixture-session-secret',IUMRAH_SUPERADMIN_PASSWORD:'fixture-password',PACKAGE_QUOTE_SEAL_KEY:'fixture-seal-key'};
 const flights={fetch(){throw Error('Unexpected flight request');}};
 const router=createBackendRouter({hotels,flights,packages,core});
 const call=(path,method='GET',headers={},override={})=>router.fetch(new Request(origin+path,{method,headers}),{...env,...override},{waitUntil(){}});
 return {h,b,env,call};
}
const hash=token=>createHash('sha256').update(token).digest('hex');
const tokens={valid:'fixture-valid-token-123456789',second:'fixture-other-token-123456789',expired:'fixture-expired-token-123456789',revoked:'fixture-revoked-token-123456789'};
function seed(h){
 h.exec("INSERT INTO pilgrims(id,first_name,last_name,display_name,email) VALUES(42,'Fixture','Account','Fixture Account','fixture@example.test'),(43,'Other','Account','Other Account','other@example.test')");
 const insert=h.prepare('INSERT INTO iumrah_account_sessions(token_hash,pilgrim_id,created_at,expires_at,last_used_at,revoked_at) VALUES(?,?,?,?,?,?)');
 const past='2000-01-01T00:00:00.000Z',future='2099-01-01T00:00:00.000Z';
 insert.run(hash(tokens.valid),42,past,future,past,null);insert.run(hash(tokens.second),43,past,future,past,null);insert.run(hash(tokens.expired),42,past,past,past,null);insert.run(hash(tokens.revoked),42,past,future,past,past);
}
const legacy='/api/catalog/hotels/client/account/session',modern='/api/package/client/account/session';
const bearer=token=>({authorization:'Bearer '+token});
test('package route resolves to the actual packages module, not binding health; unknown path stays 404',async t=>{
 const {call}=await fixture(t);
 assert.equal(resolveBackendRoute('/api/package/health'),'packages');
 const health=await call('/api/package/health');assert.equal(health.status,200,await health.clone().text());
 const result=await health.json();assert.equal(result.service,'iumrah-package-engine');assert.equal(result.hotelsDbConfigured,true);assert.equal(result.bookingsDbConfigured,true);
 assert.equal((await call('/api/package/does-not-exist')).status,404);
 const empty=new DatabaseSync(':memory:');t.after(()=>empty.close());
 const unavailable=await call('/api/package/health','GET',{}, {HOTELS_DB:d1(empty)});assert.equal(unavailable.status,503);assert.equal((await unavailable.json()).ok,false);
});
test('both account session paths reject missing, wrong, expired and revoked credentials; valid existing session reads same HOTELS_DB',async t=>{
 const {h,call}=await fixture(t);seed(h);
 for(const path of [legacy,modern]){
  for(const headers of [{},bearer('invalid-token'),bearer(tokens.expired),bearer(tokens.revoked)]){
   const res=await call(path,'GET',headers);assert.equal(res.status,401,`${path}: ${await res.clone().text()}`);
  }
  const res=await call(path,'GET',bearer(tokens.valid));assert.equal(res.status,200,await res.clone().text());const data=await res.json();
  assert.equal(Number(data.account.iumrahID),42);assert.equal(data.account.email,'fixture@example.test');assert.equal(res.headers.get('cache-control'),'no-store');assert.equal('token' in data,false);
 }
 assert.equal(h.prepare('SELECT COUNT(*) n FROM pilgrims').get().n,2);
 assert.equal(h.prepare('SELECT COUNT(*) n FROM iumrah_account_sessions').get().n,4);
 assert.notEqual(h.prepare('SELECT last_used_at FROM iumrah_account_sessions WHERE token_hash=?').get(hash(tokens.valid)).last_used_at,'2000-01-01T00:00:00.000Z');
});
test('package logout revokes exactly the current session; existing legacy session endpoint immediately observes revocation',async t=>{
 const {h,call}=await fixture(t);seed(h);
 const path='/api/package/client/account/logout';
 assert.equal((await call(path,'POST',bearer('invalid-token'))).status,401);
 assert.equal((await call(path,'GET',bearer(tokens.valid))).status,405);
 assert.equal((await call(path,'POST',bearer(tokens.valid))).status,200);
 for(const p of [legacy,modern]){assert.equal((await call(p,'GET',bearer(tokens.valid))).status,401);assert.equal((await call(p,'GET',bearer(tokens.second))).status,200);}
 assert.equal(h.prepare('SELECT COUNT(*) n FROM pilgrims').get().n,2);
});
test('new package session routes preserve the migration safety gate',async t=>{
 const {h,call}=await fixture(t);seed(h);
 for(const [path,method] of [[modern,'GET'],['/api/package/client/account/logout','POST']]){
  const res=await call(path,method,bearer(tokens.valid),{IUMRAH_CORE_CUTOVER_READY:'0'});assert.equal(res.status,503);assert.equal((await res.json()).error,'CORE_CUTOVER_PENDING');
 }
 assert.equal(h.prepare('SELECT revoked_at FROM iumrah_account_sessions WHERE token_hash=?').get(hash(tokens.valid)).revoked_at,null);
});
test('auxiliary deploy schema is additive and idempotent; preserves existing account and session records',async t=>{
 const {h,b}=await fixture(t);seed(h);
 for(const [db,binding] of [[h,'HOTELS_DB'],[b,'BOOKINGS_DB']]){
  for(const item of [...schema[binding].tables,...schema[binding].indexes])assert.match(item.sql,/^CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS\b/i);
  const result=await ensureSchema(async sql=>{if(!sql.startsWith('INSERT INTO booking_number_sequence(id,next_number) VALUES(1,'))assert.doesNotMatch(sql,/^\s*(DELETE|DROP|UPDATE|INSERT|REPLACE)\b/i);return db.prepare(sql).all();},schema[binding],binding);
  assert.deepEqual(result,{created:0,added:0});
 }
 assert.equal(h.prepare('SELECT COUNT(*) n FROM pilgrims').get().n,2);assert.equal(h.prepare('SELECT COUNT(*) n FROM iumrah_account_sessions').get().n,4);
});

// Complete guest checkout -> operational identity -> real password activation and account trips.
test('guest booking API returns server IDs, reopens without login, activates same profile, and links next trip',async t=>{
 const h=new DatabaseSync(':memory:'),b=new DatabaseSync(':memory:');t.after(()=>{h.close();b.close();});
 const current=JSON.parse(readFileSync(new URL('../schema/bootstrap-v21.json',import.meta.url),'utf8'));
 for(const [db,binding] of [[h,'HOTELS_DB'],[b,'BOOKINGS_DB']])await ensureSchema(async sql=>db.prepare(sql).all(),current[binding],binding);
 h.exec('DELETE FROM booking_number_sequence'); // production V25 regression
 const env={HOTELS_DB:d1(h),BOOKINGS_DB:d1(b),FLIGHTS_DB:{},PASSPORTS:{},IUMRAH_CORE_CUTOVER_READY:'1',IUMRAH_CORE_PARITY_ATTESTATION:'v21:'+'a'.repeat(64),HOTELS_MEDIA:{},IUMRAH_SESSION_SECRET:'fixture-session-secret',IUMRAH_SUPERADMIN_PASSWORD:'fixture-password',PACKAGE_QUOTE_SEAL_KEY:'fixture-seal-key'};
 const flights={fetch(){throw Error('Unexpected flight request');}};
 let simulateOutage=false;
 const router=createBackendRouter({hotels,flights,packages,core,materializeBookingIdentity:async(e,booking)=>{if(simulateOutage)throw Error('fixture outage');return materializeBookingIdentity(e,booking);},verifyBookingQuote:async(booking,proof)=>{assert.equal(proof,'fixture-verified');return {quoteId:'fixture',totalUsd:booking.totalUsd,perPilgrimUsd:booking.perPilgrimUsd};}});
 const call=(path,method='GET',body,headers={})=>router.fetch(new Request(origin+path,{method,headers:{...headers,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(){}});
 const booking={planId:'economy',totalUsd:1200,perPilgrimUsd:1200,input:{from:'Tashkent',originCode:'TAS',startDate:'2027-01-10',endDate:'2027-01-17',flexibleDays:0,hotelPreference:'3',includeMadinah:true,travelers:{adults:1,children:0,infants:0,rooms:1}},route:{originCode:'TAS',outboundDestination:'JED',returnOrigin:'MED'},stay:{totalDays:7,totalNights:6},customization:{},hotelNames:{makkah:'Example',madinah:'Example'},flight:'HY 335',pilgrimProfile:{firstName:'Guest',lastName:'Fixture'}};
 const create=()=>call('/api/bookings','POST',{booking,quoteProof:'fixture-verified',lang:'ru'});
 const made=await create();assert.equal(made.status,201,await made.clone().text());const data=await made.json();assert.equal(data.trip.pilgrimID,'00000001');assert.equal(data.trip.bookingDisplayNumber,'#0001');assert.equal(data.trip.startDate,'2027-01-10');
 const token={'x-booking-token':data.accessToken};const path='/api/catalog/hotels/client/trips/'+data.booking.id;
 const detail=await call(path,'GET',undefined,token);assert.equal(detail.status,200,await detail.clone().text());assert.equal((await detail.json()).trip.pilgrimID,'00000001');
 assert.notEqual((await call(path,'GET',undefined,{'x-booking-token':'wrong-token-'.repeat(3)})).status,200);
 const activated=await call('/api/package/client/account/activate','POST',{bookingID:data.booking.id,password:'FixturePass123',device:{installationID:'fixture-installation-001',secret:'a'.repeat(48)}},token);assert.equal(activated.status,200,await activated.clone().text());const account=await activated.json();assert.equal(account.account.iumrahID,'00000001');
 const bearer={authorization:'Bearer '+account.session.token};const trips=await call('/api/catalog/hotels/client/trips','GET',undefined,bearer);assert.equal(trips.status,200);assert.equal((await trips.json()).trips[0].bookingID,data.booking.id);
 const second=await (await create()).json();const link=await call('/api/catalog/hotels/client/account/link-booking','POST',{bookingID:second.booking.id},{...bearer,'x-booking-token':second.accessToken});assert.equal(link.status,200,await link.clone().text());const linked=await link.json();assert.equal(linked.pilgrimID,'00000001');assert.equal(linked.bookingNumber,2);
 // A committed booking that cannot yet obtain identity returns 202 + proof, not false 201 or 500.
 simulateOutage=true;const pending=await create();assert.equal(pending.status,202);const saved=await pending.json();assert.equal(saved.identityReady,false);assert.ok(saved.accessToken);assert.equal(saved.trip,null);
 const repaired=await call('/api/catalog/hotels/client/trips/'+saved.booking.id,'GET',undefined,{'x-booking-token':saved.accessToken});assert.equal(repaired.status,200,await repaired.clone().text());assert.equal((await repaired.json()).trip.bookingDisplayNumber,'#0003');assert.equal(b.prepare('SELECT COUNT(*) n FROM bookings').get().n,3);
});

test('V6 verified checkout commits notification intent, deduplicates replay, dispatches SMS + APNs and signs into the same guest profile',async t=>{
 const {dispatchCreationNotifications}=await import('../core/lib/booking-notifications.js');
 const {sendBookingSMSStatus}=await import(pathToFileURL(join(dir,'booking-sms.js')).href);
 const {sendBookingEmailStatus,ensureBookingMailSchema}=await import(pathToFileURL(join(dir,'booking-email.js')).href);
 const {registerCreationPush}=await import('../../HotelsWorker/src/index.js');
 const {generateKeyPairSync}=await import('node:crypto');
 const h=new DatabaseSync(':memory:'),b=new DatabaseSync(':memory:');t.after(()=>{h.close();b.close();});
 const current=JSON.parse(readFileSync(new URL('../schema/bootstrap-v21.json',import.meta.url),'utf8'));
 for(const [db,binding] of [[h,'HOTELS_DB'],[b,'BOOKINGS_DB']])await ensureSchema(async sql=>db.prepare(sql).all(),current[binding],binding);
 const {privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const env={HOTELS_DB:d1(h),BOOKINGS_DB:d1(b),FLIGHTS_DB:{},PASSPORTS:{},HOTELS_MEDIA:{},IUMRAH_CORE_CUTOVER_READY:'1',IUMRAH_CORE_PARITY_ATTESTATION:'v21:'+'a'.repeat(64),IUMRAH_SESSION_SECRET:'fixture-session-secret-abcdefghijklmnopqrstuvwxyz',IUMRAH_SUPERADMIN_PASSWORD:'fixture-password',PACKAGE_QUOTE_SEAL_KEY:'fixture-seal-key',DEVSMS_API_TOKEN:'fake-sms',RESEND_API_KEY:'fake-email',APNS_KEY_ID:'fixture',APNS_PRIVATE_KEY:privateKey.export({format:'pem',type:'pkcs8'}),APPLE_TEAM_ID:'fixture'};
 const calls=[];const orig=globalThis.fetch;globalThis.fetch=async(url,init)=>{calls.push({url:String(url),headers:init.headers,body:JSON.parse(init.body)});if(String(url).includes('devsms.uz'))return Response.json({success:true,data:{id:123,status:'sent'}});if(String(url).includes('api.resend.com'))return Response.json({id:'fixture-email'});if(String(url).includes('push.apple.com'))return new Response('',{status:200});throw Error('UNEXPECTED_EXTERNAL_REQUEST');};t.after(()=>globalThis.fetch=orig);
 const callbacks={materializeBookingIdentity,ensureBookingMailSchema,sendBookingEmailStatus,sendBookingSMSStatus,registerCreationPush};
 const router=createBackendRouter({hotels,flights:{fetch(){throw Error('unexpected flight');}},packages,core,materializeBookingIdentity,verifyBookingQuote:async booking=>({quoteId:'fixture',totalUsd:booking.totalUsd,perPilgrimUsd:booking.perPilgrimUsd}),dispatchCreationNotifications:(e,id)=>dispatchCreationNotifications(e,callbacks,id)});
 let tasks=[];
 const call=(path,method,body,headers={})=>router.fetch(new Request(origin+path,{method,headers:{...headers,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(p){tasks.push(p);}});
 const booking={planId:'economy',totalUsd:1200,perPilgrimUsd:1200,input:{from:'Tashkent',originCode:'TAS',startDate:'2027-01-10',endDate:'2027-01-17',flexibleDays:0,hotelPreference:'3',includeMadinah:true,travelers:{adults:1,children:0,infants:0,rooms:1}},route:{originCode:'TAS',outboundDestination:'JED',returnOrigin:'MED'},stay:{totalDays:7,totalNights:6},customization:{},hotelNames:{makkah:'Example',madinah:'Example'},flight:'HY 335',includedServices:['visa','transfer','accompaniment'],pilgrimProfile:{firstName:'Guest',lastName:'Fixture'}};
 const now=new Date().toISOString(),future=new Date(Date.now()+900000).toISOString();
 const proof='a'.repeat(64),phone='+998901234567',deviceToken='1'.repeat(64);
 h.prepare('INSERT INTO iumrah_guest_booking_phone_challenges(id,phone,salt,code_hash,created_at,expires_at,verified_at,verification_token_hash,proof_expires_at) VALUES(?,?,?,?,?,?,?,?,?)').run('proof1',phone,'fixture','fixture',now,future,now,hash(proof),future);
 const intent={requestID:'f2c85e0e-1a41-4d10-bc43-2ed9bbaf3333',event:'booking_created',contactChannel:'sms',contact:phone,verificationToken:proof,locale:'ru',pushDeviceToken:deviceToken,pushEnvironment:'production',appBundleID:'com.iumrah.app',soundMode:'iumrah'};
 const envelope={booking,quoteProof:'fixture-verified',lang:'ru',notificationIntent:intent};
 const bad=await call('/api/bookings','POST',{...envelope,notificationIntent:{...intent,contact:'+998901234568'}});assert.equal(bad.status,400);assert.equal(b.prepare('SELECT COUNT(*) n FROM bookings').get().n,0);
 const created=await call('/api/bookings','POST',envelope);assert.equal(created.status,201,await created.clone().text());const result=await created.json();await Promise.all(tasks);tasks=[];
 assert.equal(result.booking.pilgrimProfile.phone,phone);assert.ok(result.booking.pilgrimProfile.phoneVerifiedAt);assert.equal(result.trip.pilgrimID,'00000001');
 assert.equal(b.prepare('SELECT COUNT(*) n FROM booking_creation_delivery_v1').get().n,1);assert.equal(b.prepare('SELECT contact_done FROM booking_creation_delivery_v1').get().contact_done,1);
 assert.equal(calls.filter(c=>c.url.includes('devsms')).length,1);assert.equal(calls.filter(c=>c.url.includes('push.apple.com')).length,1);assert.match(calls.find(c=>c.url.includes('devsms')).headers['Idempotency-Key'],/^[a-f0-9-]{36}$/);assert.equal(calls.find(c=>c.url.includes('push.apple.com')).body.type,'booking_created');assert.equal(calls.find(c=>c.url.includes('push.apple.com')).body.aps.sound,'iumrah-notification.wav');assert.equal(calls.find(c=>c.url.includes('push.apple.com')).body.bookingID,result.booking.id);assert.match(calls.find(c=>c.url.includes('devsms')).body.message,/6 ночей/);assert.match(calls.find(c=>c.url.includes('devsms')).body.message,/\+998508898845/);assert.ok(calls.find(c=>c.url.includes('devsms')).body.message.includes('/booking/'+result.booking.id));
 const replay=await call('/api/bookings','POST',envelope);assert.equal(replay.status,200,await replay.clone().text());const repeated=await replay.json();await Promise.all(tasks);assert.equal(repeated.accessToken,result.accessToken);assert.equal(repeated.booking.id,result.booking.id);assert.equal(b.prepare('SELECT COUNT(*) n FROM bookings').get().n,1);assert.equal(calls.length,2);
 const other=await call('/api/bookings','POST',{...envelope,notificationIntent:{...intent,requestID:'a2c85e0e-1a41-4d10-bc43-2ed9bbaf3333'}});assert.equal(other.status,400);
 const headers={'x-booking-token':result.accessToken};
 const attached=await call(`/api/package/booking/${result.booking.id}/verified-phone`,'POST',{verificationToken:proof},headers);assert.equal(attached.status,200,await attached.clone().text());assert.equal(calls.length,2);
 const exchange={bookingID:result.booking.id,verificationToken:proof,channel:'sms',device:{installationID:'fixture-installation-001',secret:'a'.repeat(48)}};
 const denied=await call('/api/package/client/account/booking-session','POST',{...exchange,verificationToken:'b'.repeat(64)},headers);assert.equal(denied.status,403);
 const profile=await call('/api/package/client/account/booking-session','POST',exchange,headers);assert.equal(profile.status,200,await profile.clone().text());const account=await profile.json();assert.equal(account.account.iumrahID,'00000001');assert.equal(h.prepare('SELECT COUNT(*) n FROM iumrah_accounts').get().n,1);
 const loginHeaders={authorization:'Bearer '+account.session.token};
 const linked=await call('/api/catalog/hotels/client/account/link-booking','POST',{bookingID:result.booking.id},{...loginHeaders,...headers});assert.equal(linked.status,200,await linked.clone().text());
 // A second checkout via the same verified contact keeps the original account.
 const secondProof='b'.repeat(64);h.prepare('INSERT INTO iumrah_guest_booking_phone_challenges(id,phone,salt,code_hash,created_at,expires_at,verified_at,verification_token_hash,proof_expires_at) VALUES(?,?,?,?,?,?,?,?,?)').run('proof2',phone,'fixture','fixture',now,future,now,hash(secondProof),future);
 const second=await call('/api/bookings','POST',{...envelope,notificationIntent:{...intent,requestID:'b2c85e0e-1a41-4d10-bc43-2ed9bbaf3333',verificationToken:secondProof,pushDeviceToken:null}});assert.equal(second.status,201,await second.clone().text());const s=await second.json();await Promise.all(tasks);tasks=[];
 const next=await call('/api/package/client/account/booking-session','POST',{...exchange,bookingID:s.booking.id,verificationToken:secondProof},{'x-booking-token':s.accessToken});assert.equal(next.status,200,await next.clone().text());const a=await next.json();assert.equal(a.account.iumrahID,'00000001');
 const nextLink=await call('/api/catalog/hotels/client/account/link-booking','POST',{bookingID:s.booking.id},{'x-booking-token':s.accessToken,authorization:'Bearer '+a.session.token});assert.equal(nextLink.status,200,await nextLink.clone().text());assert.equal(h.prepare('SELECT COUNT(*) n FROM iumrah_accounts').get().n,1);assert.equal(h.prepare('SELECT COUNT(*) n FROM pilgrim_trips WHERE pilgrim_id=1').get().n,2);
 // Email path dispatches without a separate contact-attachment request.
 const emailProof='c'.repeat(64),email='fixture@example.test';h.prepare('INSERT INTO iumrah_guest_booking_email_challenges(id,email,salt,code_hash,created_at,expires_at,verified_at,verification_token_hash,proof_expires_at) VALUES(?,?,?,?,?,?,?,?,?)').run('proof3',email,'fixture','fixture',now,future,now,hash(emailProof),future);
 const third=await call('/api/bookings','POST',{...envelope,notificationIntent:{...intent,requestID:'c2c85e0e-1a41-4d10-bc43-2ed9bbaf3333',contactChannel:'email',contact:email,verificationToken:emailProof,pushDeviceToken:null}});assert.equal(third.status,201,await third.clone().text());const e=await third.json();await Promise.all(tasks);tasks=[];
 const mail=calls.find(c=>c.url.includes('api.resend.com'));assert.ok(mail);assert.deepEqual(mail.body.to,[email]);assert.match(mail.body.html,/Персональный трансфер/);assert.match(mail.body.html,/Индивидуальное сопровождение/);assert.match(mail.body.html,/#0003/);assert.equal(e.booking.pilgrimProfile.email,email);assert.doesNotMatch(b.prepare('SELECT payload_json FROM bookings WHERE id=?').get(e.booking.id).payload_json,new RegExp(emailProof));
 // Run the deployed operational schema, then delete the unconfirmed request through the real route.
 h.exec(readFileSync(new URL('../../HotelsWorker/migrations/0044_business_intelligence.sql',import.meta.url),'utf8'));
 const del=await call(`/api/catalog/hotels/client/bookings/${s.booking.id}`,'DELETE',null,{'x-booking-token':s.accessToken});assert.equal(del.status,200,await del.clone().text());
 assert.equal(b.prepare('SELECT id FROM bookings WHERE id=?').get(s.booking.id),undefined);
 assert.equal(h.prepare('SELECT booking_id FROM pilgrim_trips WHERE booking_id=?').get(s.booking.id),undefined);
 assert.ok(h.prepare('SELECT booking_id FROM booking_tombstones WHERE booking_id=?').get(s.booking.id));
 assert.ok(b.prepare('SELECT id FROM bookings WHERE id=?').get(result.booking.id));
 const deletedReplay=await call('/api/bookings','POST',{...envelope,notificationIntent:{...intent,requestID:'b2c85e0e-1a41-4d10-bc43-2ed9bbaf3333',verificationToken:secondProof,pushDeviceToken:null}});assert.notEqual(deletedReplay.status,201);assert.equal(b.prepare('SELECT id FROM bookings WHERE id=?').get(s.booking.id),undefined);
 h.prepare("UPDATE pilgrim_trips SET status='payment_pending' WHERE booking_id=?").run(result.booking.id);
 const protectedDelete=await call(`/api/catalog/hotels/client/bookings/${result.booking.id}`,'DELETE',null,headers);assert.equal(protectedDelete.status,409);assert.ok(b.prepare('SELECT id FROM bookings WHERE id=?').get(result.booking.id));
 const accountProtected=await call('/api/catalog/hotels/client/account/profile','DELETE',null,{authorization:'Bearer '+a.session.token});assert.equal(accountProtected.status,409);

});

test('account deletion removes only the authenticated trip-free identity and revokes access',async t=>{
 const {h,call}=await fixture(t);seed(h);
 const res=await call('/api/catalog/hotels/client/account/profile','DELETE',bearer(tokens.valid));assert.equal(res.status,200,await res.clone().text());
 assert.equal(h.prepare('SELECT id FROM pilgrims WHERE id=42').get(),undefined);
 assert.ok(h.prepare('SELECT id FROM pilgrims WHERE id=43').get());
 assert.equal((await call(legacy,'GET',bearer(tokens.valid))).status,401);
 assert.equal((await call(legacy,'GET',bearer(tokens.second))).status,200);
});

test('booking links route to a private-safe app landing page and AASA',async t=>{
 const {call}=await fixture(t); const id='IUM-2027-EXAMPLE';
 assert.equal(resolveBackendRoute('/booking/'+id),'packages');
 const landing=await call('/booking/'+id);assert.equal(landing.status,200);assert.equal(landing.headers.get('cache-control'),'no-store');
 assert.match(await landing.text(),/iumrah:\/\/widget\/booking\/IUM-2027-EXAMPLE/);
 const aasa=await (await call('/.well-known/apple-app-site-association')).json();assert.ok(aasa.applinks.details[0].components.some(c=>c['/']==='/booking/*'));
});
