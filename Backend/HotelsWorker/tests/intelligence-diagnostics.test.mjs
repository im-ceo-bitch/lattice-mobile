import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { intelligenceAdmin, intelligenceIngest } from '../src/intelligence.js';
import { ensureIntelligenceSchema } from '../src/intelligence-schema.js';

function fakeD1() {
  const sql = new DatabaseSync(':memory:');
  const handle={
    prepare(query){
      const statement = sql.prepare(query);
      const binder=(args=[])=>({
        bind(...values){return binder(values)},
        async first(){return statement.get(...args)||null},
        async all(){return {results:statement.all(...args)}},
        async run(){let r=statement.run(...args);return {meta:{changes:Number(r.changes)}}}
      });
      return binder();
    },
    async batch(stmts){return Promise.all(stmts.map(st=>st.run()))}
  };
  return {sql, db:handle};
}

test('automatic additive schema repair creates only Intelligence tables', async()=>{
  const {sql,db}=fakeD1();
  sql.exec('CREATE TABLE protected_bookings (id TEXT PRIMARY KEY, label TEXT); INSERT INTO protected_bookings VALUES (\'b1\', \'keep\')');
  await Promise.all([ensureIntelligenceSchema(db),ensureIntelligenceSchema(db)]);
  const rows=sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'intelligence_%'").all().map(x=>x.name);
  for (const name of ['intelligence_events','intelligence_reports','intelligence_ai_threads','intelligence_ai_messages','intelligence_ai_usage']) assert.ok(rows.includes(name));
  assert.equal(sql.prepare('SELECT label FROM protected_bookings').get().label,'keep');
  sql.close();
});

test('superadmin status checks storage and key presence without exposing secrets',async()=>{
  const {sql,db}=fakeD1();
  const env={HOTELS_DB:db,GEMINI_API_KEY:'key-DO-NOT-LEAK'};
  const url=new URL('https://example.com/api/admin/hotels/intelligence/status');
  const admin=await intelligenceAdmin(new Request(url),env,url,{role:'admin'});
  assert.equal(admin.status,403);
  const superadmin=await intelligenceAdmin(new Request(url),env,url,{role:'superadmin'});
  assert.equal(superadmin.status,200);
  const body=await superadmin.json();
  assert.equal(body.databaseReady,true);
  assert.equal(body.geminiKeyConfigured,true);
  assert.equal(body.totalEvents,0);
  assert.equal(JSON.stringify(body).includes('DO-NOT-LEAK'),false);
  sql.close();
});

test('first event batch works with absent tables and is idempotent',async()=>{
  const {sql,db}=fakeD1();
  const eventId=randomUUID();
  const body={visitorId:randomUUID(),sessionId:randomUUID(),platform:'ios',appVersion:'1.0',events:[{id:eventId,name:'app_open',screen:'home',occurredAt:new Date().toISOString()}]};
  const req=()=>new Request('https://example.com/api/catalog/hotels/intelligence/events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await intelligenceIngest(req(),{HOTELS_DB:db})).status,202);
  assert.equal((await intelligenceIngest(req(),{HOTELS_DB:db})).status,202);
  assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM intelligence_events').get().count,1);
  sql.close();
});
