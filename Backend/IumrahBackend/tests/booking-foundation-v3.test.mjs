import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { documentRequirements, readinessFor, validatedAmount, paymentSatisfied } from '../../HotelsWorker/src/booking-foundation.js';
import { fcmConfigured } from '../../HotelsWorker/src/fcm.js';
const base = new URL('../../HotelsWorker/',import.meta.url);
const src = readFileSync(new URL('src/index.js',base),'utf8').replace(/^import .*;\n/gm,'').replace('export default {','const worker = {').replace(/export (async function|class) /g,'$1 ').replace('export { sendStaffPush };','');
const {reviewBookingReceipt,foundationPayment,foundationDocuments,updateDocumentPublication,requireBookingToken,uploadBookingTravelDocument,updateDocumentRequirementState,syncPendingPaymentTiming,notifyAvailabilityDelay,clientNotificationCopy} = new Function('WorkflowEntrypoint','documentRequirements','readinessFor','validatedAmount','paymentSatisfied','fcmConfigured',src+'\nreturn {reviewBookingReceipt,foundationPayment,foundationDocuments,updateDocumentPublication,requireBookingToken,uploadBookingTravelDocument,updateDocumentRequirementState,syncPendingPaymentTiming,notifyAvailabilityDelay,clientNotificationCopy};')(class {},documentRequirements,readinessFor,validatedAmount,paymentSatisfied,fcmConfigured);
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE bookings(id TEXT PRIMARY KEY,total_cents INTEGER); CREATE TABLE pilgrim_trips(booking_id TEXT PRIMARY KEY,status TEXT,payment_status TEXT,updated_at TEXT,booking_snapshot_json TEXT,pilgrim_id INTEGER,availability_started_at TEXT,created_at TEXT,payment_received_at TEXT,payment_confirmation_deadline_at TEXT); CREATE TABLE booking_payment_receipts(id TEXT PRIMARY KEY,booking_id TEXT,review_status TEXT,note TEXT,reviewed_at TEXT,reviewed_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP); CREATE TABLE booking_travel_documents(id TEXT PRIMARY KEY,booking_id TEXT,document_kind TEXT,title TEXT,booking_reference TEXT,content_type TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,object_key TEXT,byte_size INTEGER,created_by TEXT); CREATE TABLE booking_travelers(booking_id TEXT); INSERT INTO bookings VALUES('b',100000); INSERT INTO pilgrim_trips(booking_id,status,payment_status,updated_at,booking_snapshot_json,pilgrim_id) VALUES('b','payment_pending','receipt_submitted',NULL,'{"includedServices":["flight","makkahHotel","madinahHotel","visa"],"input":{"travelers":{"adults":2}}}',1); INSERT INTO booking_payment_receipts(id,booking_id,review_status,note,reviewed_at,reviewed_by) VALUES('r1','b','submitted',NULL,NULL,NULL),('r2','b','submitted',NULL,NULL,NULL),('r3','b','submitted',NULL,NULL,NULL),('foreign','other','submitted',NULL,NULL,NULL);`);
 const migration=readFileSync(new URL('migrations/0044_business_intelligence.sql',base),'utf8'); db.exec(migration);db.exec(migration);
 const d1={prepare(sql){const s=db.prepare(sql);const wrap=(v)=>({first:async()=>s.get(...v)||null,all:async()=>({results:s.all(...v)}),run:async()=>({meta:{changes:Number(s.run(...v).changes)}})});return {...wrap([]),bind:(...v)=>wrap(v)}},async batch(stmts){db.exec('BEGIN');try{const result=[];for(const s of stmts)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e}}};
 return {db,env:{HOTELS_DB:d1,BOOKINGS_DB:d1}};
}
const req=(data)=>new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
test('payment is a deliberate staff decision, partial, rejected and duplicate receipts cannot settle a booking',async()=>{
 const {db,env}=fixture();assert.equal((await foundationPayment(env,'b')).paidCents,0);
 const review=(id,body)=>reviewBookingReceipt(req(body),env,'b',id,{login:'manager'});
 assert.equal((await review('foreign',{decision:'approved',amountUsd:1000})).status,409);
 assert.equal((await review('r1',{decision:'approved',amountUsd:400})).status,200);assert.equal((await foundationPayment(env,'b')).satisfied,false);
 assert.equal((await review('r1',{decision:'approved',amountUsd:600})).status,409);
 assert.equal((await review('r2',{decision:'rejected'})).status,400);
 assert.equal((await review('r2',{decision:'rejected',reason:'Not received'})).status,200);
 assert.equal((await review('r3',{decision:'approved',amountUsd:600})).status,200);
 const p=await foundationPayment(env,'b');assert.equal(p.paidCents,100000);assert.equal(p.satisfied,true);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM booking_operations_audit_v3').get().n,3);db.close();
});
test('documents require both directions for each traveler; revoked and unassigned documents never count',async()=>{
 const {db,env}=fixture();db.exec("UPDATE pilgrim_trips SET status='booking_confirmed'; INSERT INTO booking_travel_documents(id,booking_id,document_kind,title,booking_reference,content_type,created_at) VALUES('d','b','ticket','PNR','PNR','application/pdf','2026-11-17'),('v','b','visa','visa','','application/pdf','2026-11-17');");const trip=db.prepare('SELECT * FROM pilgrim_trips').get();
 let data=await foundationDocuments(env,'b',trip);assert.equal(data.requirements.length,8);assert.equal(data.requirements.filter(x=>x.ready).length,0);
 const update=(id,body)=>updateDocumentPublication(req(body),env,'b',id,{login:'manager'});
 assert.equal((await update('d',{publicationStatus:'published',slots:['visa:1']})).status,400);
 assert.equal((await update('d',{publicationStatus:'published',slots:['ticket:outbound:1','ticket:outbound:2']})).status,200);
 assert.equal((await update('v',{publicationStatus:'published',slots:['visa:1']})).status,200);
 data=await foundationDocuments(env,'b',trip);assert.equal(data.requirements.filter(x=>x.ready).length,3);
 assert.equal((await update('d',{publicationStatus:'revoked'})).status,200);
 data=await foundationDocuments(env,'b',trip);assert.equal(data.requirements.filter(x=>x.ready).length,1);db.close();
});
test('guest token must be verified by the source and tied to this booking',async()=>{
 const {db,env}=fixture();env.IUMRAH_CORE_FETCH=async(_url,init)=>new Response(JSON.stringify({booking:{id:init.headers['x-booking-token']==='valid'?'b':'other'}}),{status:200});
 const get=(token)=>new Request('https://example.test',{headers:token?{'x-booking-token':token}:{}});
 assert.equal((await requireBookingToken(get(),env,'b',{syncTrip:false})).ok,false);
 assert.equal((await requireBookingToken(get('wrong'),env,'b',{syncTrip:false})).ok,false);
 assert.equal((await requireBookingToken(get('valid'),env,'b',{syncTrip:false})).ok,true);db.close();
});
test('currency precision and document scope invariants',()=>{
 assert.equal(validatedAmount(12.34),1234);assert.equal(validatedAmount(1.001),null);assert.equal(validatedAmount(-2),null);assert.equal(paymentSatisfied(null,0),false);assert.equal(paymentSatisfied(100,99),false);
 const r=documentRequirements({includedServices:['visa','insurance']},4);assert.equal(r.length,8);assert.equal(readinessFor(r,[{publication_status:'published',document_kind:'visa',slots:['insurance:1','visa:1']}]).filter(x=>x.ready).length,1);
});

test('document replacement preserves coverage, retains history, rejects stale repeat and cleans unused objects',async()=>{
 const {db,env}=fixture();db.exec("UPDATE pilgrim_trips SET status='booking_confirmed'; INSERT INTO booking_travel_documents(id,booking_id,document_kind,title,booking_reference,content_type,created_at) VALUES('old','b','ticket','Old ticket','PNR','application/pdf','2026-11-17'),('foreign-doc','other','ticket','Other','','application/pdf','2026-11-17');");
 const objects=new Map();env.HOTELS_MEDIA={put:async(k,v)=>{objects.set(k,v)},delete:async(k)=>{objects.delete(k)}};
 await updateDocumentPublication(req({publicationStatus:'published',slots:['ticket:outbound:1','ticket:outbound:2']}),env,'b','old',{login:'manager'});
 const upload=(replace,slots,kind='ticket')=>{const url=new URL('https://example.test/documents');url.searchParams.set('kind',kind);url.searchParams.set('title','New ticket');url.searchParams.set('reference','NEWPNR');if(replace)url.searchParams.set('replace',replace);for(const slot of slots)url.searchParams.append('slot',slot);return uploadBookingTravelDocument(new Request(url,{method:'POST',headers:{'content-type':'application/pdf'},body:new TextEncoder().encode('%PDF-test')}),env,'b',{login:'manager'},url);};
 assert.equal((await upload('foreign-doc',['ticket:outbound:1'])).status,409);
 assert.equal((await upload('old',['ticket:outbound:1'])).status,400);
 assert.equal((await upload('old',['visa:1'],'visa')).status,409);
 const good=await upload('old',['ticket:outbound:1','ticket:outbound:2']);assert.equal(good.status,200);const {id}=await good.json();
 assert.equal(db.prepare('SELECT publication_status FROM booking_document_publication_v3 WHERE document_id=?').get('old').publication_status,'revoked');
 assert.equal(db.prepare('SELECT publication_status FROM booking_document_publication_v3 WHERE document_id=?').get(id).publication_status,'published');
 assert.equal(db.prepare("SELECT COUNT(*) n FROM booking_operations_audit_v3 WHERE action='document_replaced'").get().n,1);
 assert.equal((await upload('old',['ticket:outbound:1','ticket:outbound:2'])).status,409);
 assert.equal(objects.size,1);
 const trip=db.prepare('SELECT * FROM pilgrim_trips').get();const data=await foundationDocuments(env,'b',trip);assert.equal(data.requirements.filter(x=>x.ready).length,2);assert.equal(data.documents.length,2);
 db.close();
});

test('per-document progress is scoped to booking requirements, and cannot substitute for published files',async()=>{
 const {db,env}=fixture();db.exec("UPDATE pilgrim_trips SET status='booking_confirmed'; INSERT INTO booking_travel_documents(id,booking_id,document_kind,title,booking_reference,content_type,created_at) VALUES('v','b','visa','Visa','','application/pdf','2026-11-17');");
 const trip=db.prepare('SELECT * FROM pilgrim_trips').get();
 const set=(key,state)=>updateDocumentRequirementState(req({key,state}),env,'b',{login:'manager'});
 assert.equal((await set('visa:99','preparing')).status,400);
 assert.equal((await set('visa:1','published')).status,400);
 assert.equal((await set('visa:1','preparing')).status,200);
 let item=(await foundationDocuments(env,'b',trip)).requirements.find(r=>r.key==='visa:1');assert.equal(item.ready,false);assert.equal(item.state,'preparing');
 assert.equal((await updateDocumentPublication(req({publicationStatus:'published',slots:['visa:1']}),env,'b','v',{login:'manager'})).status,200);
 item=(await foundationDocuments(env,'b',trip)).requirements.find(r=>r.key==='visa:1');assert.equal(item.ready,true);assert.equal(item.state,'published');
 assert.equal((await set('visa:1','needs_correction')).status,409);
 assert.equal((await updateDocumentPublication(req({publicationStatus:'revoked',slots:['visa:1']}),env,'b','v',{login:'manager'})).status,200);
 assert.equal((await set('visa:1','needs_correction')).status,200);
 item=(await foundationDocuments(env,'b',trip)).requirements.find(r=>r.key==='visa:1');assert.equal(item.ready,false);assert.equal(item.state,'needs_correction');db.close();
});

test('replacement racing with a revocation does not publish a stale file',async()=>{
 const {db,env}=fixture();db.exec("UPDATE pilgrim_trips SET status='booking_confirmed'; INSERT INTO booking_travel_documents(id,booking_id,document_kind,title,booking_reference,content_type,created_at) VALUES('old','b','visa','Visa','','application/pdf','2026-11-17');");
 await updateDocumentPublication(req({publicationStatus:'published',slots:['visa:1']}),env,'b','old',{login:'manager'});
 const objects=new Map();env.HOTELS_MEDIA={put:async(k,v)=>{objects.set(k,v);db.exec("UPDATE booking_document_publication_v3 SET publication_status='revoked' WHERE document_id='old'");},delete:async(k)=>{objects.delete(k)}};
 const url=new URL('https://example.test/documents?kind=visa&replace=old&slot=visa%3A1');
 const response=await uploadBookingTravelDocument(new Request(url,{method:'POST',headers:{'content-type':'application/pdf'},body:new TextEncoder().encode('%PDF-test')}),env,'b',{login:'manager'},url);
 assert.equal(response.status,409);assert.equal(objects.size,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM booking_travel_documents').get().n,1);db.close();
});


test('payment review timer follows oldest pending receipt and clears after partial or rejected review',async()=>{
 const {db,env}=fixture();
 db.exec("UPDATE booking_payment_receipts SET created_at='2026-11-17 08:00:00' WHERE id='r1'; UPDATE booking_payment_receipts SET created_at='2026-11-17 08:05:00' WHERE id='r2'; UPDATE booking_payment_receipts SET created_at='2026-11-17 08:10:00' WHERE id='r3';");
 const trip=()=>db.prepare('SELECT * FROM pilgrim_trips').get();
 await syncPendingPaymentTiming(env,'b',await foundationPayment(env,'b'));
 assert.equal(trip().payment_confirmation_deadline_at,'2026-11-17T08:10:00.000Z');
 const review=(id,body)=>reviewBookingReceipt(req(body),env,'b',id,{login:'manager'});
 assert.equal((await review('r1',{decision:'approved',amountUsd:400})).status,200);
 assert.equal(trip().payment_received_at,'2026-11-17T08:05:00.000Z');
 assert.equal((await review('r2',{decision:'rejected',reason:'Not received'})).status,200);
 assert.equal(trip().payment_confirmation_deadline_at,'2026-11-17T08:20:00.000Z');
 assert.equal((await review('r3',{decision:'rejected',reason:'Not received'})).status,200);
 assert.equal(trip().payment_status,'partially_paid');assert.equal(trip().payment_received_at,null);assert.equal(trip().payment_confirmation_deadline_at,null);
 db.exec("INSERT INTO booking_payment_receipts(id,booking_id,review_status,created_at) VALUES('r4','b','submitted','2026-11-17 09:00:00')");
 await syncPendingPaymentTiming(env,'b',await foundationPayment(env,'b'));
 assert.equal(trip().payment_confirmation_deadline_at,'2026-11-17T09:10:00.000Z');
 assert.equal((await review('r4',{decision:'approved',amountUsd:600})).status,200);
 assert.equal(trip().payment_status,'paid');assert.equal(trip().payment_confirmation_deadline_at,null);db.close();
});

test('availability delay requires 30 minutes, current stage, and a staff audit cooldown; no APNs is not success',async()=>{
 const {db,env}=fixture();const set=(status,time)=>db.prepare('UPDATE pilgrim_trips SET status=?,availability_started_at=?').run(status,time);
 const old=new Date(Date.now()-31*60000).toISOString();
 assert.equal((await notifyAvailabilityDelay(env,'b',{login:'manager'})).status,409);
 set('availability_check',new Date().toISOString());assert.equal((await notifyAvailabilityDelay(env,'b',{login:'manager'})).status,409);
 set('availability_check',old);const result=await notifyAvailabilityDelay(env,'b',{login:'manager'});assert.equal(result.status,200);const body=await result.json();assert.equal(body.sent,0);assert.equal(body.skipped,'PUSH_NOT_CONFIGURED');
 assert.equal((await notifyAvailabilityDelay(env,'b',{login:'manager'})).status,409);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM booking_operations_audit_v3 WHERE action LIKE 'availability_delay_%'").get().n,2);
 for(const lang of ['ru','en','uz','uz-cyrl']) assert.ok(clientNotificationCopy(lang,'availability_delay','availability_check').body.length>10);
 db.close();
});
