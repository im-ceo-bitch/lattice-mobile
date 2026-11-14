import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { incrementalChatPage } from '../../HotelsWorker/src/chat-incremental.js';
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE business_chat_messages(id TEXT PRIMARY KEY,booking_id TEXT,sender_type TEXT,read_by_staff INTEGER,created_at TEXT);`);
 const add=(id,booking='a',read=0)=>sql.prepare('INSERT INTO business_chat_messages VALUES(?,?,?,?,?)').run(id,booking,'client',read,'2026-11-14T00:00:00Z');
 const db={prepare(q){return {bind(...args){return {async all(){return {results:sql.prepare(q).all(...args)}}}}}}};
 return {sql,add,db};
}
const url=(after,extra='')=>`https://example.test/messages?after=${after}${extra}`;
test('initial and subsequent page return only messages newer than cursor, even same timestamp',async()=>{const {sql,add,db}=fixture();try{
 add('one');add('other','b');add('two'); const first=await incrementalChatPage(db,'a',url(0));assert.deepEqual(first.page.map(x=>x.id),['one','two']);assert.equal(first.hasMore,false);
 const empty=await incrementalChatPage(db,'a',url(first.nextCursor));assert.equal(empty.page.length,0);assert.equal(empty.nextCursor,first.nextCursor);
 add('three'); const later=await incrementalChatPage(db,'a',url(first.nextCursor));assert.deepEqual(later.page.map(x=>x.id),['three']);
 }finally{sql.close()}});
test('pages preserve full histories beyond 500, no duplicates or gaps',async()=>{const {sql,add,db}=fixture();try{
 for(let i=0;i<601;i++)add('m'+i);let cursor='0',ids=[];for(let i=0;i<4;i++){const r=await incrementalChatPage(db,'a',url(cursor));ids.push(...r.page.map(x=>x.id));cursor=r.nextCursor;if(i<3)assert.equal(r.hasMore,true);else assert.equal(r.hasMore,false);}
 assert.equal(ids.length,601);assert.equal(new Set(ids).size,601);
 }finally{sql.close()}});
test('read receipts only for this booking; no full content on empty delta',async()=>{const {sql,add,db}=fixture();try{
 add('mine','a',1);add('foreign','b',1);const r=await incrementalChatPage(db,'a',url(99,'&unread=mine&unread=foreign'));assert.equal(r.page.length,0);assert.deepEqual(r.staffReadMessageIDs,['mine']);
 }finally{sql.close()}});
test('invalid cursor rejected, legacy contract remains available',async()=>{const {sql,db}=fixture();try{
 assert.equal(await incrementalChatPage(db,'a','https://example.test/messages'),null);
 for(const v of ['-1','NaN','1.5','9999999999999999'])await assert.rejects(incrementalChatPage(db,'a',url(v)),/INVALID_CHAT_CURSOR/);
 }finally{sql.close()}});
