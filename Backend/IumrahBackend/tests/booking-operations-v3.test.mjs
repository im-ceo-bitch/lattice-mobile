import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import * as helpers from '../../HotelsWorker/src/booking-foundation.js';
const base=new URL('../../HotelsWorker/',import.meta.url);
const src=readFileSync(new URL('src/index.js',base),'utf8').replace(/^import .*;\n/gm,'').replace('export default {','const worker = {').replace(/export (async function|class) /g,'$1 ').replace('export { sendStaffPush };','');
const names=['updateOperationsBooking','saveServiceOperation','saveBookingManager','recordBookingRefund','requestBookingCancellation','dismissCancellationRequest','saveItineraryExecution','saveBookingItinerary','operationsCenterData','bookingItineraryDetail','withBookingMutation','submitTravelFeedback','closeTravelFinance','issueTravelCertificate','travelFinancialClose','travelCertificates','travelFeedback','clientNotificationCopy','reconcileHistoricalPayment','correctTravelCertificate','foundationPayment','retryBookingPushOutbox','queueBookingPush'];
const api=new Function('WorkflowEntrypoint',...Object.keys(helpers),src+`\noperationsBookingDetail=async()=>json({ok:true});sendClientStatusPush=async()=>{};sendStaffPush=async()=>{};apnsJWT=async()=>"test-jwt";const carePushTargets=async db=>({scope:{},rows:db.testDevices||[]});const persistCarePushResult=async()=>{};\nreturn {${names.join(',')}};`)(class {},...Object.values(helpers));
const req=body=>new Request('https://test.local',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),staff={login:'manager'};
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE bookings(id TEXT PRIMARY KEY,total_cents INTEGER,status TEXT,payload_json TEXT,updated_at TEXT);
 CREATE TABLE pilgrim_trips(booking_id TEXT PRIMARY KEY,status TEXT,payment_status TEXT,updated_at TEXT,booking_snapshot_json TEXT,pilgrim_id INTEGER,created_at TEXT,confirmation_number TEXT,internal_notes TEXT,completed_at TEXT,availability_started_at TEXT,availability_deadline_at TEXT,price_lock_started_at TEXT,price_lock_expires_at TEXT,payment_received_at TEXT,payment_confirmation_deadline_at TEXT,documents_started_at TEXT,documents_deadline_at TEXT,start_date TEXT,end_date TEXT);
 CREATE TABLE trip_flights(booking_id TEXT,direction TEXT,flight_number TEXT,departure_airport_iata TEXT,arrival_airport_iata TEXT,scheduled_departure_local TEXT,scheduled_arrival_local TEXT);
 CREATE TABLE trip_assignments(booking_id TEXT,makkah_hotel_id TEXT,madinah_hotel_id TEXT,guide_team_member_id TEXT);
 CREATE TABLE team_members(id TEXT PRIMARY KEY,first_name TEXT,last_name TEXT,active INTEGER,role_kind TEXT);
 CREATE TABLE booking_payment_receipts(id TEXT PRIMARY KEY,booking_id TEXT,review_status TEXT);
 CREATE TABLE booking_travelers(booking_id TEXT,position INTEGER,first_name TEXT,last_name TEXT,middle_name TEXT,completed INTEGER);
 INSERT INTO booking_travelers VALUES('b',1,'First','Last','',1),('b',2,'Second','Last','',0);
 CREATE TABLE booking_payment_instructions(booking_id TEXT,visa_card_number TEXT,humo_card_number TEXT,payme_qr_object_key TEXT);
 CREATE TABLE booking_status_history(id TEXT,booking_id TEXT,old_status TEXT,new_status TEXT,changed_by TEXT,created_at TEXT);
 INSERT INTO bookings VALUES('b',100000,'AVAILABILITY_CHECK','{}',NULL);
 INSERT INTO pilgrim_trips(booking_id,status,payment_status,booking_snapshot_json,pilgrim_id,start_date,end_date) VALUES('b','availability_check','awaiting_payment','{"includedServices":["flight","visa"],"input":{"travelers":{"adults":2}}}',1,'2026-11-20','2026-12-03');
 INSERT INTO team_members VALUES('m','Manager','One',1,'manager'),('g','Guide','One',1,'guide'),('off','Inactive','One',0,'manager');
 INSERT INTO trip_flights VALUES('b','outbound','HY1','TAS','MED','2026-11-20T11:00','2026-11-20T15:00');
 INSERT INTO booking_payment_instructions VALUES('b','1234',NULL,NULL);`);
 for(const file of ['migrations/0014_booking_itinerary.sql','migrations/0044_business_intelligence.sql','migrations/0044_business_intelligence.sql'])db.exec(readFileSync(new URL(file,base),'utf8'));
 const d1={prepare(sql){const s=db.prepare(sql);const wrap=v=>({first:async()=>s.get(...v)||null,all:async()=>({results:s.all(...v)}),run:async()=>({meta:{changes:Number(s.run(...v).changes)}})});return {...wrap([]),bind:(...v)=>wrap(v)}},async batch(stmts){db.exec('BEGIN');try{const result=[];for(const s of stmts)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e}}};
 return {db,env:{HOTELS_DB:d1,BOOKINGS_DB:d1},trip:()=>db.prepare('SELECT * FROM pilgrim_trips WHERE booking_id=\'b\'').get()};
}
test('package scope and deadline queue: only selected services, both directions, overdue tasks first',()=>{
 const r=helpers.serviceRequirements({includedServices:['flight','visa'],hotelNames:{makkah:'unused'}});assert.deepEqual(r.map(x=>x.key),['flight:outbound','flight:inbound','visa']);
 const now=new Date('2026-11-17T10:31:00Z');const q=helpers.queueFor('availability_check',{createdAt:'2026-11-17T10:00:00Z'},now);assert.equal(q[0].priority,0);assert.equal(q[0].dueAt,'2026-11-17T10:30:00.000Z');assert.ok(q.some(x=>x.key==='unassigned'));
 assert.equal(helpers.queueFor('booking_confirmed',{documentsDue:'2026-11-17T09:00:00Z',manager:'m'},now)[0].priority,0);
 assert.equal(helpers.queueFor('payment_pending',{submitted:1,manager:'m'},now)[0].key,'receipt');assert.deepEqual(helpers.queueFor('cancelled',{},now),[]);
});
test('service gate prevents premature confirmation; flight changes invalidate previous confirmation; manager is validated',async()=>{
 const {db,env,trip}=fixture();const set=(key,availability='confirmed',execution)=>api.saveServiceOperation(req({key,availability,execution}),env,'b',staff);const status=()=>api.updateOperationsBooking(req({status:'payment_pending'}),env,'b',staff);
 assert.equal((await status()).status,409);assert.equal((await set('foreign')).status,400);assert.equal((await set('flight:outbound','confirmed','completed')).status,409);assert.equal((await set('flight:outbound','unavailable')).status,400);
 for(const key of ['flight:outbound','flight:inbound','visa'])assert.equal((await set(key)).status,200);
 assert.equal((await api.saveBookingManager(req({memberID:'g'}),env,'b',staff)).status,400);assert.equal((await api.saveBookingManager(req({memberID:'off'}),env,'b',staff)).status,400);assert.equal((await api.saveBookingManager(req({memberID:'m'}),env,'b',staff)).status,200);
 db.exec("UPDATE trip_flights SET flight_number='HY2' WHERE booking_id='b'");assert.equal((await api.operationsCenterData(env,'b',trip())).services[0].availability,'pending');assert.equal((await status()).status,409);
 await set('flight:outbound');assert.equal((await status()).status,200);assert.equal(trip().status,'payment_pending');assert.equal(db.prepare('SELECT status FROM bookings').get().status,'PAYMENT_PENDING');db.close();
});
test('cancellation is idempotent request, reason required, review pending receipts first, refunds retain ledger and cannot exceed payment',async()=>{
 const {db,env,trip}=fixture();const cancel=reason=>api.updateOperationsBooking(req({status:'cancelled',cancellationReason:reason}),env,'b',staff);const refund=(amountUsd,reference)=>api.recordBookingRefund(req({amountUsd,reference}),env,'b',staff);
 assert.equal((await api.requestBookingCancellation(env,'b',trip())).status,200);assert.equal((await api.requestBookingCancellation(env,'b',trip())).status,200);assert.equal(db.prepare("SELECT COUNT(*) n FROM booking_operations_audit_v3 WHERE action='cancellation_requested'").get().n,1);
 assert.equal((await api.dismissCancellationRequest(req({reason:''}),env,'b',staff)).status,400);assert.equal((await api.dismissCancellationRequest(req({reason:'Client changed mind'}),env,'b',staff)).status,200);
 assert.equal((await api.requestBookingCancellation(env,'b',trip())).status,200);assert.equal((await cancel('')).status,400);assert.equal((await refund(10,'before')).status,409);
 db.exec("INSERT INTO booking_payment_receipts VALUES('r','b','submitted')");assert.equal((await cancel('Client request')).status,409);
 db.exec("UPDATE booking_payment_receipts SET review_status='approved'; INSERT INTO booking_receipt_reviews_v3 VALUES('r','b',50000,'USD','approved','','manager','2026-11-17')");
 assert.equal((await cancel('Client request')).status,200);assert.equal(db.prepare('SELECT status FROM bookings').get().status,'CANCELLED');assert.equal(trip().status,'cancelled');assert.equal(db.prepare('SELECT COUNT(*) n FROM booking_payment_receipts').get().n,1);
 assert.equal((await refund(300,'bank-1')).status,200);assert.equal((await refund(100,'bank-1')).status,409);assert.equal((await refund(201,'bank-2')).status,409);assert.equal((await refund(200,'bank-2')).status,200);assert.equal((await refund(1,'bank-3')).status,409);
 const c=(await api.operationsCenterData(env,'b',trip())).cancellation;assert.equal(c.paidCents,50000);assert.equal(c.refundedCents,50000);assert.equal(c.refunds.length,2);assert.equal((await api.requestBookingCancellation(env,'b',trip())).status,409);db.close();
});
test('itinerary is not completed by time; staff marks actual execution and changing a plan resets it',async()=>{
 const {db,env}=fixture();const item={id:'event-1',dateLocal:'2026-11-20',title:'Airport',subtitle:'',icon:'calendar',location:'',notes:'',sortOrder:0};
 const save=items=>api.saveBookingItinerary(req({items}),env,'b',staff);const mark=state=>api.saveItineraryExecution(req({state}),env,'b','event-1',staff);
 assert.equal((await save([item])).status,200);assert.equal((await save([])).status,400);assert.equal((await mark('completed')).status,409);
 db.exec("UPDATE pilgrim_trips SET status='in_trip'");assert.equal((await mark('completed')).status,200);assert.equal((await (await api.bookingItineraryDetail(env,'b')).json()).items[0].executionState,'completed');
 assert.equal((await save([{...item,title:'New airport transfer'}])).status,200);let data=await (await api.bookingItineraryDetail(env,'b')).json();assert.equal(data.managed,true);assert.equal(data.items[0].executionState,'planned');assert.equal(db.prepare("SELECT COUNT(*) n FROM booking_operations_audit_v3 WHERE action='itinerary_completed'").get().n,1);
 assert.equal((await api.updateOperationsBooking(req({status:'completed'}),env,'b',staff)).status,409);db.close();
});
test('mutation lease rejects competing writes and releases on success or failure',async()=>{
 const {db,env}=fixture();let release;const hold=new Promise(r=>release=r);const first=api.withBookingMutation(env,'b',()=>hold);await new Promise(r=>setImmediate(r));const second=await api.withBookingMutation(env,'b',()=>{throw Error('must not run')});assert.equal(second.status,409);release('ok');assert.equal(await first,'ok');await assert.rejects(api.withBookingMutation(env,'b',async()=>{throw Error('test')}));assert.equal(db.prepare('SELECT COUNT(*) n FROM booking_mutation_lock_v3').get().n,0);db.close();
});

test('feedback only after trip completion, valid rating, single durable review',async()=>{
 const {db,env}=fixture();const send=(rating,comment='')=>api.submitTravelFeedback(req({rating,comment}),env,'b');
 assert.equal((await send(5)).status,409);db.exec("UPDATE pilgrim_trips SET status='completed'");
 assert.equal((await send(6)).status,400);assert.equal((await send(4,'x'.repeat(1501))).status,400);
 assert.equal((await send(5,'Great')).status,200);const again=await (await send(1,'changed')).json();assert.equal(again.feedback.rating,5);assert.equal(again.feedback.comment,'Great');assert.equal(db.prepare('SELECT COUNT(*) n FROM booking_travel_feedback_v3').get().n,1);db.close();
});
test('financial closing preserves external refunds, explicit costs/retention and blocks duplicate or later refunds',async()=>{
 const {db,env}=fixture();const close=(expenseUsd,retainedUsd,reason='Verified expenses',confirmed=true)=>api.closeTravelFinance(req({expenseUsd,retainedUsd,reason,confirmed}),env,'b',staff);
 assert.equal((await close(20,50)).status,409);
 db.exec("INSERT INTO booking_payment_receipts VALUES('r','b','approved'); INSERT INTO booking_receipt_reviews_v3 VALUES('r','b',50000,'USD','approved','','manager','2026-11-17')");
 assert.equal((await api.updateOperationsBooking(req({status:'cancelled',cancellationReason:'Cancelled'}),env,'b',staff)).status,200);
 assert.equal((await api.recordBookingRefund(req({amountUsd:300,reference:'bank-x'}),env,'b',staff)).status,200);
 assert.equal((await close(20,199)).status,409);assert.equal((await close(20,200,'',false)).status,400);
 assert.equal((await close(20,200)).status,200);let row=await api.travelFinancialClose(env,'b');assert.equal(row.netCents,18000);assert.equal(row.paidCents,50000);assert.equal(row.refundedCents,30000);assert.equal((await close(20,200)).status,409);
 assert.equal((await api.recordBookingRefund(req({amountUsd:10,reference:'bank-y'}),env,'b',staff)).status,409);db.close();
});
test('completed travel without verified payments cannot be financially closed',async()=>{
 const {db,env}=fixture();db.exec("UPDATE pilgrim_trips SET status='completed'");
 const close=()=>api.closeTravelFinance(req({expenseUsd:800,retainedUsd:1000,reason:'All settled',confirmed:true}),env,'b',staff);
 assert.equal((await close()).status,409);
 db.exec("INSERT INTO booking_payment_receipts VALUES('r','b','approved'); INSERT INTO booking_receipt_reviews_v3 VALUES('r','b',100000,'USD','approved','','manager','2026-11-17')");
 assert.equal((await close()).status,200);assert.equal((await api.travelFinancialClose(env,'b')).netCents,20000);db.close();
});
test('certificate requires actual explicit staff confirmation, completed trip and named complete pilgrim; idempotent',async()=>{
 const {db,env}=fixture();const issue=(position,ritualConfirmed=true)=>api.issueTravelCertificate(req({position,ritualConfirmed}),env,'b',staff);
 assert.equal((await issue(1)).status,409);db.exec("UPDATE pilgrim_trips SET status='completed'");
 assert.equal((await issue(1,false)).status,400);assert.equal((await issue(2)).status,409);assert.equal((await issue(3)).status,409);
 assert.equal((await issue(1)).status,200);const cert=(await api.travelCertificates(env,'b'))[0];assert.equal(cert.name,'First Last');assert.equal((await issue(1)).status,200);assert.equal((await api.travelCertificates(env,'b')).length,1);assert.equal((await api.travelCertificates(env,'b'))[0].id,cert.id);db.close();
});
test('manager schedule time persists, validates, legacy edits preserve it and time changes reset execution',async()=>{
 const {db,env}=fixture();const event={id:'event-time',dateLocal:'2026-11-20',title:'Airport',sortOrder:0,timeLocal:'10:00',endTimeLocal:'12:00'};const save=item=>api.saveBookingItinerary(req({items:[item]}),env,'b',staff);
 assert.equal((await save({...event,timeLocal:'25:00'})).status,400);assert.equal((await save({...event,endTimeLocal:'09:00'})).status,400);
 assert.equal((await save(event)).status,200);assert.equal((await (await api.bookingItineraryDetail(env,'b')).json()).items[0].timeLocal,'10:00');
 db.exec("UPDATE pilgrim_trips SET status='in_trip'");assert.equal((await api.saveItineraryExecution(req({state:'completed'}),env,'b','event-time',staff)).status,200);
 const {timeLocal,endTimeLocal,...legacy}=event;assert.equal((await save(legacy)).status,200);assert.equal((await (await api.bookingItineraryDetail(env,'b')).json()).items[0].executionState,'completed');
 assert.equal((await save({...event,timeLocal:'11:00'})).status,200);assert.equal((await (await api.bookingItineraryDetail(env,'b')).json()).items[0].executionState,'planned');
 assert.equal((await save({...event,timeLocal:'',endTimeLocal:''})).status,200);assert.equal((await (await api.bookingItineraryDetail(env,'b')).json()).items[0].timeLocal,null);db.close();
});
test('travel notification copies use four languages and distinct schedule/certificate events',()=>{
 for(const lang of ['ru','en','uz','uz-cyrl']){const schedule=api.clientNotificationCopy(lang,'itinerary_update'),certificate=api.clientNotificationCopy(lang,'umrah_certificate');assert.ok(schedule.title&&schedule.body&&certificate.title&&certificate.body);assert.notEqual(schedule.title,certificate.title);}
});

test('historic payments require explicit privileged reconciliation before close; original receipts retained',async()=>{
 const {db,env}=fixture();db.exec("UPDATE pilgrim_trips SET status='completed'; INSERT INTO booking_payment_receipts VALUES('legacy','b','approved')");
 const reconcile=(addedUsd,user={login:'owner',role:'superadmin'})=>api.reconcileHistoricalPayment(req({addedUsd,reference:'bank-ledger-1',reason:'Verified bank statement',confirmed:true}),env,'b',user);
 assert.equal((await reconcile(1000,staff)).status,403);assert.equal((await reconcile(999)).status,409);assert.equal((await reconcile(1000)).status,200);assert.equal((await reconcile(1000)).status,409);
 const payment=await api.foundationPayment(env,'b');assert.equal(payment.paidCents,100000);assert.equal(payment.reconciliationRequired,false);assert.equal(db.prepare('SELECT COUNT(*) n FROM booking_payment_receipts').get().n,1);
 assert.equal((await api.closeTravelFinance(req({expenseUsd:800,retainedUsd:1000,reason:'Settled',confirmed:true}),env,'b',staff)).status,200);db.close();
});
test('certificate corrections retire old identity and record reason; revoked certificates disappear from active list',async()=>{
 const {db,env}=fixture();db.exec("UPDATE pilgrim_trips SET status='completed'");await api.issueTravelCertificate(req({position:1,ritualConfirmed:true}),env,'b',staff);const old=(await api.travelCertificates(env,'b'))[0];
 const correct=(certificateID,action='correct',reason='Correct spelling')=>api.correctTravelCertificate(req({certificateID,action,reason,correctedName:'First Corrected',confirmed:true}),env,'b',staff);
 assert.equal((await correct(old.id,'correct','')).status,400);assert.equal((await correct('other')).status,404);assert.equal((await correct(old.id)).status,200);
 const current=(await api.travelCertificates(env,'b'))[0];assert.notEqual(current.id,old.id);assert.equal(current.name,'First Corrected');assert.equal((await correct(old.id)).status,404);
 assert.equal((await correct(current.id,'revoke')).status,200);assert.deepEqual(await api.travelCertificates(env,'b'),[]);assert.equal(db.prepare('SELECT COUNT(*) n FROM booking_certificate_history_v3').get().n,2);db.close();
});

test('APNs queue retries only unsuccessful current targets, rejects stale status and expires exhausted attempts',async()=>{
 const {db,env}=fixture();Object.assign(env,{APNS_PRIVATE_KEY:'test',APNS_KEY_ID:'test',APPLE_TEAM_ID:'test'});env.HOTELS_DB.testDevices=[{device_token:'device1',locale:'ru',environment:'development'},{device_token:'device2',locale:'en',environment:'development'}];
 const oldFetch=globalThis.fetch,calls=[];let retry=false;globalThis.fetch=async(url,init)=>{calls.push({url,id:init.headers['apns-id'],payload:JSON.parse(init.body)});return new Response(null,{status:url.endsWith('device1')||retry?200:503});};
 try{
  const result=await api.queueBookingPush(env,'b','availability_check','booking_status');assert.equal(result.sent,1);assert.equal(result.total,2);assert.equal(calls.length,2);assert.equal(db.prepare("SELECT COUNT(*) n FROM booking_push_delivery_v3 WHERE state='pending'").get().n,1);
  const failed=calls.find(c=>c.url.endsWith('device2'));retry=true;db.exec("UPDATE booking_push_delivery_v3 SET next_attempt_at='2000-01-01' WHERE state='pending'");assert.equal((await api.retryBookingPushOutbox(env)).sent,1);assert.equal(calls.length,3);assert.equal(calls[2].id,failed.id);
  retry=false;await api.queueBookingPush(env,'b','availability_check','booking_status');const count=calls.length;db.exec("UPDATE pilgrim_trips SET status='payment_pending'; UPDATE booking_push_delivery_v3 SET next_attempt_at='2000-01-01' WHERE state='pending'");await api.retryBookingPushOutbox(env);assert.equal(calls.length,count);assert.equal(db.prepare("SELECT COUNT(*) n FROM booking_push_delivery_v3 WHERE state='skipped'").get().n,1);
  await api.queueBookingPush(env,'b',null,'travel_document');env.HOTELS_DB.testDevices=[env.HOTELS_DB.testDevices[0]];db.exec("UPDATE booking_push_delivery_v3 SET next_attempt_at='2000-01-01' WHERE state='pending'");const before=calls.length;await api.retryBookingPushOutbox(env);assert.equal(calls.length,before);assert.equal(db.prepare("SELECT COUNT(*) n FROM booking_push_delivery_v3 WHERE state='skipped'").get().n,2);
 }finally{globalThis.fetch=oldFetch;db.close();}
});
