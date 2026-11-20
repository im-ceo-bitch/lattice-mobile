import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { stripTypeScriptTypes } from 'node:module';
import { ensurePublicShareSchema } from '../scripts/apply-package-schema.mjs';
import { createBackendRouter, isPublicTripSharePath } from '../src/router.js';

// Execute the exact production TypeScript module without needing a test-only fork.
const source = fs.readFileSync(new URL('../package-engine/src/booking-share.ts', import.meta.url), 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source,{mode:'strip'})).toString('base64'));
const { handleBookingShare, publicBookingProjection } = mod;
const id = 'IUM-2026-AB23456';
const ownerToken = 'owner-secret-token-123456789012345678901234';
const accountToken = 'current-account-session-token-123456789';
const hash = s => createHash('sha256').update(s).digest('hex');

function wrap(db) {
  return {
    prepare(sql) {
      return {
        bind(...values) { this.values=values; return this; },
        first() { return db.prepare(sql.replace(/\?\d+/g,'?')).get(...(this.values||[])) ?? null; },
        all() { return {results:db.prepare(sql.replace(/\?\d+/g,'?')).all(...(this.values||[]))}; },
        run() { return db.prepare(sql.replace(/\?\d+/g,'?')).run(...(this.values||[])); },
      };
    },
  };
}
async function fixture() {
  const bookings = new DatabaseSync(':memory:');
  const hotels = new DatabaseSync(':memory:');
  bookings.exec('PRAGMA foreign_keys=ON; CREATE TABLE bookings(id TEXT PRIMARY KEY,status TEXT,payload_json TEXT,access_token_hash TEXT);');
  hotels.exec(`
    CREATE TABLE pilgrim_trips(booking_id TEXT, pilgrim_id INTEGER, status TEXT);
    CREATE TABLE iumrah_account_sessions(token_hash TEXT, pilgrim_id INTEGER, revoked_at TEXT, expires_at TEXT);
    CREATE TABLE trip_flights(booking_id TEXT,direction TEXT,airline_name TEXT,flight_number TEXT,departure_airport_iata TEXT, arrival_airport_iata TEXT,scheduled_departure_local TEXT,scheduled_arrival_local TEXT,verified_at TEXT);
    CREATE TABLE booking_travel_documents(id TEXT,booking_id TEXT,document_kind TEXT);
    CREATE TABLE booking_document_publication_v3(document_id TEXT, booking_id TEXT, publication_status TEXT,slots_json TEXT);
    CREATE TABLE booking_travelers(booking_id TEXT,position INTEGER);
  `);
  await ensurePublicShareSchema(async sql=>{bookings.prepare(sql).all();return []});
  const payload={booking:{
    input:{startDate:'2027-02-01',endDate:'2027-02-12',originCode:'TAS',travelers:[{name:'Private Pilgrim'}]},
    route:{originCode:'TAS',outboundDestination:'MED',returnOrigin:'JED'},
    hotelNames:{makkah:'Hotel Makkah',madinah:'Hotel Madinah'},
    stay:{makkahCheckIn:'2027-02-05',makkahCheckOut:'2027-02-11',makkahNights:6, madinahCheckIn:'2027-02-01',madinahCheckOut:'2027-02-05',madinahNights:4},
    selection:{makkahHotelId:'hotel-makkah',madinahHotelId:'hotel-madinah'},
    generatorTrace:{outbound:{airline:'Flight Co',flightNumbers:'HY 100',origin:'TAS',destination:'MED',departureAt:'2027-02-01T10:00:00Z',arrivalAt:'2027-02-01T13:00:00Z'},inbound:{airline:'Flight Co',flightNumbers:'HY 200',origin:'JED',destination:'TAS',departureAt:'2027-02-12T16:00:00Z'}},
    documents:{visa:{status:'issued',type:'tourist_multiple',name:'Private Pilgrim',visaDocument:'REDACTED_PRIVATE_VISA'},tickets:{status:'issued',pnr:'SECRET-PNR',ticketNumber:'ETKT-123'}},
    customization:{accompaniment:true,ziyaratMakkah:true},
    firstName:'Private Pilgrim',email:'user-private@example.com',phone:'+998000000',passport:'PRIVATE-PASSPORT',card:'4111111111111111',totalUsd:3000,
  }};
  bookings.prepare('INSERT INTO bookings VALUES(?,?,?,?)').run(id,'booking_confirmed',JSON.stringify(payload),hash(ownerToken));
  hotels.prepare('INSERT INTO pilgrim_trips VALUES(?,?,?)').run(id,123,'ready_to_travel');
  hotels.prepare('INSERT INTO iumrah_account_sessions VALUES(?,?,?,?)').run(hash(accountToken),123,null,'2030-01-01T00:00:00.000Z');
  hotels.prepare('INSERT INTO booking_travelers VALUES(?,?)').run(id,1);
  hotels.prepare('INSERT INTO booking_travelers VALUES(?,?)').run(id,2);
  hotels.prepare('INSERT INTO trip_flights VALUES(?,?,?,?,?,?,?,?,?)').run(id,'outbound','Verified Airlines','SV 222','TAS','MED','2027-02-01T10:00:00+05:00','2027-02-01T13:00:00+03:00','2026-11-20T00:00:00Z');
  hotels.prepare('INSERT INTO trip_flights VALUES(?,?,?,?,?,?,?,?,?)').run(id,'return','UNVERIFIED','AB 999','JED','TAS','2027-02-12T13:00:00+03:00','2027-02-12T18:00:00+05:00',null);
  let serial=0;
  const addDoc=(kind,slots,state='published')=>{
    serial++;const docId='doc'+serial;
    hotels.prepare('INSERT INTO booking_travel_documents VALUES(?,?,?)').run(docId,id,kind);
    hotels.prepare('INSERT INTO booking_document_publication_v3 VALUES(?,?,?,?)').run(docId,id,state,JSON.stringify(slots));
    return docId;
  };
  const env={BOOKINGS_DB:wrap(bookings),HOTELS_DB:wrap(hotels)};
  return { bookings,hotels,env,addDoc,close(){bookings.close();hotels.close()}};
}
function makeReq(path, method='GET', headers={}) {
  return new Request(`https://iumrah-backend.helloiumrah.workers.dev${path}`,{method,headers});
}
const controlPath=`/api/package/booking/${id}/share`;
async function call(env,path,method='GET',headers={}) {
  const r=makeReq(path,method,headers);
  return handleBookingShare(r,env,new URL(r.url));
}

// D1 schema and ownership tests use an isolated real SQLite engine.
test('D1 share schema is additive, repeat-safe and references the canonical booking table', async()=>{
 const f=await fixture();
 try {
  assert.equal((await ensurePublicShareSchema(async sql=>{f.bookings.prepare(sql).all(); return []})),3);
  assert.equal(f.bookings.prepare("SELECT name FROM sqlite_master WHERE name='booking_public_shares'").get().name,'booking_public_shares');
  const fields=f.bookings.prepare('PRAGMA table_info(booking_public_shares)').all().map(x=>x.name);
  assert.deepEqual(fields,['token_hash','booking_id','created_at','expires_at','revoked_at']);
  assert.ok(f.bookings.prepare('SELECT id FROM bookings WHERE id=?').get(id));
 }finally{f.close()}
});

test('owner create, public read-only status and audited document readiness, revocation',async()=>{
 const f=await fixture();
 try {
  assert.equal((await call(f.env,controlPath,'POST')).status,404);
  assert.equal((await call(f.env,controlPath,'POST',{'x-booking-token':'x'.repeat(40)})).status,404);
  // Client-supplied 'issued' fields cannot claim ready if operations did not publish files.
  const made=await call(f.env,controlPath,'POST',{'x-booking-token':ownerToken});
  assert.equal(made.status,201);const {shareURL}=await made.json();
  assert.match(shareURL,/^https:\/\/iumrah\.app\/s\/[A-Za-z0-9_-]{43}$/);
  const token=shareURL.split('/').at(-1);const readPath=`/api/package/shares/${token}`;
  assert.equal((await call(f.env,readPath,'DELETE')).status,405);
  assert.equal((await call(f.env,readPath,'POST')).status,405);
  const notReady=(await (await call(f.env,readPath)).json()).trip;
  assert.equal(notReady.status,'ready_to_travel');
  assert.equal(notReady.flights.outbound.number,'SV 222'); // Staff verified amendment
  assert.equal(notReady.flights.inbound.number,'HY 200');  // Unverified amendments ignored
  assert.equal(notReady.documents.visa.status,'not_confirmed');
  assert.equal(notReady.documents.flightTickets.status,'not_confirmed');
  assert.equal(notReady.hotels[0].name,'Hotel Makkah');
  const visaOne=f.addDoc('visa',['visa:1']);
  const visaTwo=f.addDoc('visa',['visa:2']);
  const ticketOne=f.addDoc('ticket',['ticket:outbound:1','ticket:inbound:1']);
  const ticketTwo=f.addDoc('ticket',['ticket:outbound:2','ticket:inbound:2'],'revoked');
  assert.equal((await (await call(f.env,readPath)).json()).trip.documents.visa.status,'ready');
  assert.equal((await (await call(f.env,readPath)).json()).trip.documents.flightTickets.status,'not_confirmed');
  f.hotels.prepare("UPDATE booking_document_publication_v3 SET publication_status='published' WHERE document_id=?").run(ticketTwo);
  const publicResponse=await call(f.env,readPath);
  assert.equal(publicResponse.status,200);
  const data=await publicResponse.json();
  assert.equal(data.trip.documents.visa.status,'ready');
  assert.equal(data.trip.documents.visa.type,'tourist_multiple');
  assert.equal(data.trip.documents.flightTickets.status,'ready');
  assert.deepEqual(data.trip.permissions,{viewer:true,canManage:false,canPay:false,canEdit:false,canViewDocuments:false});
  const publicText=JSON.stringify(data);
  for(const secret of ['Private Pilgrim','user-private@example.com','SECRET-PNR','ETKT-123','REDACTED_PRIVATE_VISA','PRIVATE-PASSPORT','4111111111111111',ownerToken,'access_token_hash','payload_json','bookingId']) assert.equal(publicText.includes(secret),false,secret);
  assert.equal(f.bookings.prepare('SELECT token_hash FROM booking_public_shares').get().token_hash,hash(token));
  assert.equal((await call(f.env,controlPath,'DELETE',{'x-booking-token':ownerToken})).status,200);
  assert.equal((await call(f.env,readPath)).status,404);
 }finally{f.close()}
});

test('account session ownership checked by HOTELS_DB, not any public share token',async()=>{
 const f=await fixture();
 try{
  const header={authorization:'Bearer '+accountToken};
  assert.equal((await call(f.env,controlPath,'POST',header)).status,201);
  f.hotels.prepare('UPDATE pilgrim_trips SET pilgrim_id=321 WHERE booking_id=?').run(id);
  assert.equal((await call(f.env,controlPath,'POST',header)).status,404);
  f.hotels.prepare('UPDATE pilgrim_trips SET pilgrim_id=123 WHERE booking_id=?').run(id);
  f.hotels.prepare('UPDATE iumrah_account_sessions SET revoked_at=?').run('2026-11-20T00:00:00Z');
  assert.equal((await call(f.env,controlPath,'POST',header)).status,404);
 }finally{f.close()}
});

test('expired opaque tokens and methods are rejected, regardless of query parameters',async()=>{
 const f=await fixture();
 try {
  const {shareURL}=await (await call(f.env,controlPath,'POST',{'x-booking-token':ownerToken})).json();
  const token=shareURL.split('/').at(-1);
  assert.equal((await call(f.env,'/api/package/shares/'+token+'E')).status,404);
  f.bookings.prepare("UPDATE booking_public_shares SET expires_at='2020-01-01T00:00:00Z'").run();
  assert.equal((await call(f.env,'/api/package/shares/'+token)).status,404);
 }finally{f.close()}
});

test('unified router forwards only the share endpoints without opening other pending booking mutations',async()=>{
 const calls=[];
 const handler={fetch:async request=>{calls.push(new URL(request.url).pathname);return Response.json({ok:true})}};
 const router=createBackendRouter({hotels:handler,flights:handler,packages:handler});
 const env={BOOKINGS_DB:{},HOTELS_DB:{},FLIGHTS_DB:{}};
 assert.equal(isPublicTripSharePath(controlPath),true);
 assert.equal(isPublicTripSharePath('/api/package/shares/'+'x'.repeat(43)),true);
 assert.equal(isPublicTripSharePath('/api/package/booking/'+id+'/update'),false);
 assert.equal((await router.fetch(makeReq(controlPath,'POST'),env,{})).status,200);
 assert.equal((await router.fetch(makeReq('/api/package/shares/'+'x'.repeat(43)),env,{})).status,200);
 assert.equal((await router.fetch(makeReq('/api/package/booking/'+id+'/customization','PATCH'),env,{})).status,503);
 assert.deepEqual(calls,[controlPath,'/api/package/shares/'+'x'.repeat(43)]);
});

test('public projection itself never treats a client supplied visa flag as proof',()=>{
 const projected=publicBookingProjection({status:'paid',payload_json:JSON.stringify({booking:{documents:{visa:{status:'issued'},tickets:{status:'ticketed'}},name:'Private Person'}})});
 assert.equal(projected.documents.visa.status,'not_confirmed');
 assert.equal(projected.documents.flightTickets.status,'not_confirmed');
 assert.equal(JSON.stringify(projected).includes('Private Person'),false);
});
