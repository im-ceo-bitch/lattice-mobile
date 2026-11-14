import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {ensureSchema} from '../scripts/apply-package-schema.mjs';
import {allocateBookingNumber,ensureBookingIdentity} from '../../HotelsWorker/src/booking-identity.js';
const schema=JSON.parse(fs.readFileSync(new URL('../schema/bootstrap-v21.json',import.meta.url),'utf8')).HOTELS_DB;
async function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 await ensureSchema(async q=>sql.prepare(q).all(),schema,'HOTELS_DB');
 const db={prepare(q){let a=[];const st={bind(...args){a=args;return st},async first(){return sql.prepare(q).get(...a)||null},async run(){return sql.prepare(q).run(...a)}};return st},async batch(stmts){sql.exec('BEGIN');try{for(const s of stmts)await s.run();sql.exec('COMMIT')}catch(e){sql.exec('ROLLBACK');throw e}}};
 return {sql,db};
}
const args=(id)=>({bookingID:id,identity:{firstName:'Guest',lastName:'Fixture'},status:'availability_check',startDate:'2027-01-01',endDate:'2027-01-05',snapshot:'{}',now:'2026-11-14T00:00:00Z',tripID:'trip-'+id});
test('fresh bootstrap has empty counter; first guest gets both IDs and retries preserve them',async()=>{const {sql,db}=await fixture();try{
 assert.equal(sql.prepare('SELECT next_number FROM booking_number_sequence').get().next_number,1);
 // Simulate the already-deployed V25 schema without the seed.
 sql.exec('DELETE FROM booking_number_sequence');
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM booking_number_sequence').get().n,0);
 const a=await ensureBookingIdentity(db,args('a'));assert.equal(a.booking_number,1);assert.equal(a.pilgrim_id,1);
 const again=await ensureBookingIdentity(db,args('a'));assert.equal(again.pilgrim_id,a.pilgrim_id);assert.equal(again.booking_number,a.booking_number);
 const b=await ensureBookingIdentity(db,args('b'));assert.equal(b.booking_number,2);assert.notEqual(b.pilgrim_id,a.pilgrim_id);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM pilgrims').get().n,2);
 }finally{sql.close()}});
test('missing or stale counter starts above real existing booking numbers, never renumbers',async()=>{const {sql,db}=await fixture();try{
 await ensureBookingIdentity(db,args('a'));sql.exec('UPDATE pilgrim_trips SET booking_number=87; DELETE FROM booking_number_sequence');
 assert.equal(await allocateBookingNumber(db),88);sql.exec('UPDATE booking_number_sequence SET next_number=1');assert.equal(await allocateBookingNumber(db),88);
 // 88 was allocated but never committed to a trip; this fixture deliberately corrupted the counter. Existing 87 remains.
 assert.equal(sql.prepare('SELECT booking_number FROM pilgrim_trips').get().booking_number,87);
 }finally{sql.close()}});
test('repair existing trip without number keeps original pilgrim and booking',async()=>{const {sql,db}=await fixture();try{
 const a=await ensureBookingIdentity(db,args('a'));sql.exec('UPDATE pilgrim_trips SET booking_number=NULL');
 const fixed=await ensureBookingIdentity(db,args('a'));assert.equal(fixed.pilgrim_id,a.pilgrim_id);assert.equal(fixed.booking_number,2);assert.equal(sql.prepare('SELECT COUNT(*) n FROM pilgrims').get().n,1);
 }finally{sql.close()}});
test('trip insertion failure rolls back provisional profile, retry succeeds',async()=>{const {sql,db}=await fixture();try{
 await assert.rejects(ensureBookingIdentity(db,{...args('a'),status:'invalid'}));assert.equal(sql.prepare('SELECT COUNT(*) n FROM pilgrims').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM pilgrim_trips').get().n,0);
 const a=await ensureBookingIdentity(db,args('a'));assert.equal(a.booking_number,2);assert.equal(sql.prepare('SELECT COUNT(*) n FROM pilgrims').get().n,1);
 }finally{sql.close()}});
