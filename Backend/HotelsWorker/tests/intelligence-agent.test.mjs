import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { intelligenceChat } from '../src/intelligence-agent.js';
import { intelligenceAdmin, validateIntelligenceBatch } from '../src/intelligence.js';

function envDatabase(){
  const db = new DatabaseSync(':memory:');
  for(const filename of ['0044_business_intelligence.sql','0045_intelligence_ai_agent.sql']){
    db.exec(readFileSync(new URL(`../migrations/${filename}`,import.meta.url),'utf8'));
  }
  function prepare(sql){
    const st=db.prepare(sql);
    const make = a=>({bind(...args){return make(args)},async first(){return st.get(...a)??null},
      async all(){return {results:st.all(...a)}},async run(){const r=st.run(...a);return {meta:{changes:Number(r.changes)}}}});
    return make([]);
  }
  return {db,env:{HOTELS_DB:{prepare,async batch(a){return Promise.all(a.map(s=>s.run()))}},GEMINI_API_KEY:'test-key'}};
}

test('web app event validates without accepting arbitrary PII',()=>{
  const event={visitorId:randomUUID(),sessionId:randomUUID(),platform:'web',appVersion:'web-1',events:[{id:randomUUID(),name:'screen_view',screen:'hotels'}]};
  assert.equal(validateIntelligenceBatch(event).platform,'web');
  assert.equal(validateIntelligenceBatch({...event,events:[{id:randomUUID(),name:'screen_view',screen:'passport@example.com'}]}),null);
});

test('chat requires superadmin, never reveals analytics through admin role',async()=>{
  const {db,env}=envDatabase();
  const url=new URL('https://example.org/api/admin/hotels/intelligence/chat');
  const response=await intelligenceAdmin(new Request(url),env,url,{role:'admin'});
  assert.equal(response.status,403);
  db.close();
});

test('Gemini chat is backed by aggregated D1 metrics and retains its history',async()=>{
  const {db,env}=envDatabase();
  // Raw UUID is strictly internal to D1. Never send it to Gemini.
  const privateID=randomUUID();
  db.prepare(`INSERT INTO intelligence_events(event_id,visitor_id,session_id,event_name,screen,element_id,platform,app_version,occurred_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),privateID,randomUUID(),'app_open','home','','ios','1.0',new Date().toISOString(),new Date().toISOString());
  const old=globalThis.fetch;
  try {
    let calls=0;
    globalThis.fetch=async (url,opts)=>{
      ++calls;
      assert.match(url,/gemini-3\.8-flash:generateContent/);
      const body=opts.body;
      assert.ok(!body.includes(privateID));
      assert.ok(!body.includes('passport'));
      assert.ok(body.includes('get_platform_breakdown'));
      if(calls===1)return new Response(JSON.stringify({candidates:[{content:{role:'model',parts:[{functionCall:{name:'get_screen_metrics',args:{days:7}}}]}}]}),{status:200});
      return new Response(JSON.stringify({candidates:[{content:{role:'model',parts:[{text:'Факт: 1 посетитель. Гипотеза: мало данных. Проверка: накопить данные.'}]}}]}),{status:200});
    };
    const url=new URL('https://example.org/api/admin/hotels/intelligence/chat');
    const r=await intelligenceChat(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:'Почему мало броней?',days:7})}),env,url);
    assert.equal(r.status,200);
    const data=await r.json();
    assert.equal(data.model,'gemini-3.8-flash');
    assert.equal(calls,2);
    const history=await intelligenceChat(new Request(url+'?threadId='+data.threadId),env,new URL(url+'?threadId='+data.threadId));
    assert.equal((await history.json()).messages.length,2);
  } finally {globalThis.fetch=old;db.close();}
});

test('chat free-tier cap prevents costly calls',async()=>{
  const {db,env}=envDatabase();
  db.prepare('INSERT INTO intelligence_ai_usage(day,requests) VALUES(?,?)').run(new Date().toISOString().slice(0,10),25);
  const url=new URL('https://example.org/api/admin/hotels/intelligence/chat');
  const r=await intelligenceChat(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:'Сколько посетителей?'})}),env,url);
  assert.equal(r.status,429);
  assert.equal((await r.json()).error,'DAILY_AI_LIMIT');
  db.close();
});
