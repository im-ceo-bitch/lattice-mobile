import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {recoverGuestBooking} from '../.runtime-dist/booking-recovery.js';
import {bookingGrantRead} from '../.runtime-dist/booking-grants.js';
import {bookingGrantRead as coreGrant} from '../../core/lib/booking-grants.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
test('guest recovery is contact-bound, one-time, booking-scoped and does not rotate primary credential',async()=>{
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE bookings(id TEXT PRIMARY KEY,access_token_hash TEXT,payload_json TEXT,status TEXT,created_at TEXT,updated_at TEXT);
 CREATE TABLE pilgrim_trips(booking_id TEXT,booking_number INTEGER);
 CREATE TABLE iumrah_guest_booking_email_challenges(email TEXT,verification_token_hash TEXT,consumed_at TEXT,booking_id TEXT,verified_at TEXT,proof_expires_at TEXT);
 CREATE TABLE iumrah_guest_booking_phone_challenges(phone TEXT,verification_token_hash TEXT,consumed_at TEXT,booking_id TEXT,verified_at TEXT,proof_expires_at TEXT);`);
 const d1={prepare(sql){const s=db.prepare(sql);const wrap=v=>({first:async()=>s.get(...v)||null,run:async()=>({meta:{changes:Number(s.run(...v).changes)}})});return {...wrap([]),bind:(...v)=>wrap(v)}}};
 const id='IUM-2026-ABCDEFG',primary='a'.repeat(64),payload={pilgrimProfile:{email:'ali@example.com',emailVerifiedAt:'2026-01-01',phone:'+998901234567',phoneVerifiedAt:'2026-01-01'}};
 db.prepare('INSERT INTO bookings VALUES(?,?,?,?,?,?)').run(id,hash(primary),JSON.stringify(payload),'PAYMENT_PENDING','2026-01-01','2026-01-01');db.prepare('INSERT INTO pilgrim_trips VALUES(?,?)').run(id,1234);
 const proof=(n,channel,contact,expired=false)=>{const t=n.repeat(64);db.prepare(`INSERT INTO iumrah_guest_booking_${channel==='sms'?'phone':'email'}_challenges VALUES(?,?,NULL,NULL,?,?)`).run(contact,hash(t),'2026-01-01',new Date(Date.now()+(expired?-60000:60000)).toISOString());return t;};
 const call=(verificationToken,channel='email',bookingNumber='#1234')=>recoverGuestBooking(new Request('https://test.local',{method:'POST',body:JSON.stringify({verificationToken,channel,bookingNumber})}),{HOTELS_DB:d1,BOOKINGS_DB:d1});
 const email=proof('b','email','ali@example.com');const first=await call(email);assert.equal(first.status,200);const t=(await first.json()).accessToken;assert.equal((await call(email)).status,403);
 const sql='SELECT id FROM bookings WHERE id=? AND access_token_hash=?';for(const auth of [bookingGrantRead,coreGrant]){assert.equal((await auth(d1,sql,id,hash(t))).id,id);assert.equal((await auth(d1,sql,id,hash(primary))).id,id);assert.equal(await auth(d1,sql,'OTHER',hash(t)),null);}
 const phone=await call(proof('c','sms','+998901234567'),'sms');assert.equal(phone.status,200);const pt=(await phone.json()).accessToken;assert.notEqual(pt,t);
 assert.equal((await call(proof('d','email','wrong@example.com'))).status,403);const wrong=proof('e','email','ali@example.com');assert.equal((await call(wrong,'email','9999')).status,403);assert.equal((await call(wrong)).status,403);assert.equal((await call(proof('f','email','ali@example.com',true))).status,403);
 payload.pilgrimProfile.email='new@example.com';db.prepare('UPDATE bookings SET payload_json=?').run(JSON.stringify(payload));assert.equal(await coreGrant(d1,sql,id,hash(t)),null);assert.equal((await coreGrant(d1,sql,id,hash(pt))).id,id);assert.equal((await coreGrant(d1,sql,id,hash(primary))).id,id);db.close();
});
