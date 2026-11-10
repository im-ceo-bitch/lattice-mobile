// Secure source execution. Does not depend on website /api/package/flights/data.
// LIVE Ignav searches require an already-provisioned IGNAV_API_KEY; ingestion via existing token works without it.
import {importIgnavResponse,importAviasalesCache,validUmrahRoute} from './source-sync.js';
import {eligibleFlightDay,tashkentDay} from './core.js';
const uid=()=>crypto.randomUUID();
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
const validPair=r=>r&&typeof r==='object'&&validUmrahRoute(String(r.origin||'').toUpperCase(),String(r.destination||'').toUpperCase())&&eligibleFlightDay(r.departure_date);
export async function importIgnavPayload(request,env,importDirect){
 const payload=await request.json().catch(()=>null);
 if(!payload||JSON.stringify(payload).length>700000)return json({ok:false,error:'INVALID_SOURCE_PAYLOAD'},400);
 try{
  const out=await importIgnavResponse(env.FLIGHTS_DB,payload,{},importDirect);
  return json({ok:out.rejected===0,source:'ignav',...out},out.rejected?207:200);
 }catch(error){return json({ok:false,error:String(error.message).slice(0,120)},400);}
}
export async function importAviasalesPayload(request,env){
 const payload=await request.json().catch(()=>null);
 if(!payload||JSON.stringify(payload).length>700000)return json({ok:false,error:'INVALID_SOURCE_PAYLOAD'},400);
 try{return json({ok:true,source:'aviasales_data',...await importAviasalesCache(env.FLIGHTS_DB,payload)});}
 catch(error){return json({ok:false,error:String(error.message).slice(0,120)},400);}
}
async function reserveSearch(db,source,key,now,minimumHours=6){
 const last=await db.prepare('SELECT searched_at FROM flight_source_search_runs WHERE source=? AND search_key=?').bind(source,key).first();
 if(last&&Date.parse(last.searched_at)>Date.now()-minimumHours*3600000)return false;
 const r=await db.prepare(`INSERT INTO flight_source_search_runs(source,search_key,searched_at,status) VALUES(?,?,?,'started')
  ON CONFLICT(source,search_key) DO UPDATE SET searched_at=excluded.searched_at,status='started'
  WHERE julianday(flight_source_search_runs.searched_at)<julianday(excluded.searched_at)-?/24`).bind(source,key,now,minimumHours).run();
 return Number(r?.meta?.changes??1)>0;
}
async function logSearch(db,source,key,status,count,message=''){
 await db.prepare('UPDATE flight_source_search_runs SET status=?,items_count=?,message=? WHERE source=? AND search_key=?').bind(status,count,message.slice(0,150),source,key).run();
}
export async function searchIgnav(request,env,importDirect,{fetcher=fetch}={}){
 if(!env.IGNAV_API_KEY)return json({ok:false,error:'IGNAV_API_KEY_NOT_CONFIGURED',detail:'Existing ingestion endpoint remains available; no new secret was automatically created.'},503);
 const body=await request.json().catch(()=>null);
 const searches=Array.isArray(body?.searches)?body.searches:(validPair(body)?[body]:[]);
 if(!searches.length||searches.length>8||searches.some(x=>!validPair(x)))return json({ok:false,error:'INVALID_SEARCHES_MAX_8'},400);
 const db=env.FLIGHTS_DB,day=tashkentDay();
 const budget=Math.min(100,Math.max(1,Number(env.IGNAV_DAILY_SEARCH_LIMIT||60)));
 const results=[];
 for(const search of searches){
  const origin=search.origin.toUpperCase(),destination=search.destination.toUpperCase();
  const key=`${origin}|${destination}|${search.departure_date}`;
  const total=await db.prepare(`SELECT COUNT(*) AS n FROM flight_source_search_attempt_log WHERE source='ignav' AND attempted_at>=?`).bind(new Date(Date.parse(day+'T00:00:00Z')-5*3600000).toISOString()).first();
  if(Number(total?.n||0)>=budget){results.push({key,status:'budget_exhausted'});break;}
  const reserved=await reserveSearch(db,'ignav',key,new Date().toISOString());
  if(!reserved){results.push({key,status:'recently_searched'});continue;}
  // This records every attempt even when upstream errors. No silent quota reuse.
  await db.prepare('INSERT INTO flight_source_search_attempt_log(id,source,search_key,attempted_at) VALUES(?,?,?,?)')
   .bind(uid(),'ignav',key,new Date().toISOString()).run();
  try{
   const upstream=await fetcher('https://ignav.com/api/fares/one-way',{method:'POST',headers:{'X-Api-Key':env.IGNAV_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({origin,destination,departure_date:search.departure_date,adults:1,cabin_class:'economy'})});
   if(upstream.status===402 || upstream.status===429){
    await logSearch(db,'ignav',key,'throttled',0,'IGNAV_HTTP_'+upstream.status);
    results.push({key,status:'throttled',http_status:upstream.status});break; // Respect upstream quota; never retry the remaining batch.
   }
   if(!upstream.ok)throw Error(`IGNAV_HTTP_${upstream.status}`);
   const payload=await upstream.json();
   const out=await importIgnavResponse(db,payload,{origin,destination,departure_date:search.departure_date},importDirect);
   await logSearch(db,'ignav',key,'ok',out.imported);
   results.push({key,status:'ok',...out});
  }catch(error){await logSearch(db,'ignav',key,'failed',0,String(error.message));results.push({key,status:'failed',error:String(error.message).slice(0,100)});}
 }
 // Source search monitoring is distinct from imported prices. Record even zero results,
 // rate-limit blocks and failed requests, so Business never silently says 'never ran'.
 const failed=results.filter(x=>x.status==='failed'||x.status==='throttled').length;
 const imported=results.reduce((n,x)=>n+Number(x.imported||0),0);
 const rejected=results.reduce((n,x)=>n+Number(x.rejected||0),0);
 const state=failed?'partial':results.every(x=>['recently_searched','budget_exhausted'].includes(x.status))?'no_tasks':imported===0?'no_verified_fares':'ok';
 await db.prepare(`INSERT INTO monitor_runs(id,provider,checked_at,status,accepted,unmatched,rejected,message)
  VALUES(?,?,?,?,?,?,?,?)`).bind(uid(),'ignav',new Date().toISOString(),state,imported,0,rejected,
    `queries=${results.length}; imported=${imported}; failed=${failed}; skipped=${results.reduce((n,x)=>n+Number(x.skipped||0),0)}`).run();
 return json({ok:failed===0,source:'ignav',results});
}
export async function searchAviasales(request,env,{fetcher=fetch}={}){
 if(!env.AVIASALES_DATA_TOKEN)return json({ok:false,error:'AVIASALES_DATA_TOKEN_NOT_CONFIGURED',detail:'Use authenticated cache ingestion from the existing Aviasales integration.'},503);
 const query=await request.json().catch(()=>null);
 if(!validPair(query))return json({ok:false,error:'INVALID_SEARCH'},400);
 const db=env.FLIGHTS_DB,key=`${query.origin.toUpperCase()}|${query.destination.toUpperCase()}|${query.departure_date}`;
 if(!await reserveSearch(db,'aviasales_data',key,new Date().toISOString(),4))return json({ok:true,status:'recently_searched',source:'aviasales_data'});
 try{
  const u=new URL('https://api.travelpayouts.com/aviasales/v3/prices_for_dates');
  for(const [k,v] of Object.entries({origin:query.origin.toUpperCase(),destination:query.destination.toUpperCase(),departure_at:query.departure_date,one_way:'true',direct:'false',currency:'usd',limit:'30'}))u.searchParams.set(k,v);
  const response=await fetcher(u.toString(),{headers:{'X-Access-Token':env.AVIASALES_DATA_TOKEN,'Accept':'application/json'}});
  if(!response.ok)throw Error('AVIASALES_HTTP_'+response.status);
  const payload=await response.json();
  const out=await importAviasalesCache(db,payload);
  await logSearch(db,'aviasales_data',key,'ok',out.stored);
  await db.prepare(`INSERT INTO monitor_runs(id,provider,checked_at,status,accepted,unmatched,rejected,message)
    VALUES(?,?,?,?,?,?,?,?)`).bind(uid(),'aviasales_data',new Date().toISOString(),'ok',out.stored,0,0,
    `cache_hints=${out.stored}; linked=${out.linked}`).run();
  return json({ok:true,source:'aviasales_data',...out});
 }catch(error){
  await logSearch(db,'aviasales_data',key,'failed',0,String(error.message));
  await db.prepare(`INSERT INTO monitor_runs(id,provider,checked_at,status,accepted,unmatched,rejected,message)
    VALUES(?,?,?,?,?,?,?,?)`).bind(uid(),'aviasales_data',new Date().toISOString(),'failed',0,0,1,'SOURCE_UNAVAILABLE').run();
  return json({ok:false,error:'SOURCE_UNAVAILABLE'},502);
 }
}

// Runs in the EXISTING single Worker cron at 01:15 UTC. The provider key is never
// exposed to iOS or the browsers; when absent, nothing is fetched or billed.
// This intentionally uses the same authenticated-write path as the manual search:
// no new Worker, queue, GitHub Action or secret is created.
export async function scheduledIgnavSweep(env,importDirect,{fetcher=fetch}={}) {
 if(!env?.FLIGHTS_DB || !env.IGNAV_API_KEY)return {status:'not_configured',attempted:0};
 const db=env.FLIGHTS_DB;
 const day=tashkentDay();
 const dailyLimit=Math.max(1,Math.min(100,Number(env.IGNAV_DAILY_SEARCH_LIMIT||60)));
 const budgetRow=await db.prepare(`SELECT COUNT(*) AS n FROM flight_source_search_attempt_log
   WHERE source='ignav' AND attempted_at>=?`).bind(new Date(Date.parse(`${day}T00:00:00Z`)-5*3600000).toISOString()).first();
 const remaining=Math.max(0,dailyLimit-Number(budgetRow?.n||0));
 if(!remaining)return {status:'daily_budget_exhausted',attempted:0};
 const uz=['TAS','FEG','NMA','AZN','SKD','BHK','KSQ','TMJ','UGC'];
 const sa=['JED','MED','TIF'];
 const existing=await db.prepare("SELECT search_key,searched_at FROM flight_source_search_runs WHERE source='ignav'").all();
 const age=new Map((existing.results||[]).map(x=>[x.search_key,Date.parse(x.searched_at)||0]));
 const candidates=[];
 for(let offset=0;offset<=30;offset++){
  const d=new Date(`${day}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+offset);
  const when=d.toISOString().slice(0,10);
  for(const u of uz)for(const k of sa){
   for(const [origin,destination] of [[u,k],[k,u]]){
    const search_key=`${origin}|${destination}|${when}`;
    candidates.push({origin,destination,departure_date:when,offset,search_key,last:age.get(search_key)||0});
   }
  }
 }
 // Prioritize a portion of the near-term departures without starving the
 // remainder of the 30-day window. Repeated cron runs advance by last search.
 const sort=(a,b)=>a.last-b.last||a.offset-b.offset||a.search_key.localeCompare(b.search_key);
 const near=candidates.filter(x=>x.offset<=7).sort(sort);
 const far=candidates.filter(x=>x.offset>7).sort(sort);
 const cap=Math.min(remaining,60);
 const selected=[...near.slice(0,Math.min(20,cap)),...far.slice(0,Math.max(0,cap-20))];
 if(selected.length<cap){
  const selectedKeys=new Set(selected.map(x=>x.search_key));
  selected.push(...[...near,...far].filter(x=>!selectedKeys.has(x.search_key)).slice(0,cap-selected.length));
 }
 let attempted=0,imported=0,skipped=0,failed=0,throttled=false;
 for(let i=0;i<selected.length;i+=6){
  const searches=selected.slice(i,i+6).map(x=>({origin:x.origin,destination:x.destination,departure_date:x.departure_date}));
  const request=new Request('https://internal/v1/admin/ignav/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({searches})});
  const response=await searchIgnav(request,env,importDirect,{fetcher});
  const result=await response.json();
  for(const r of result.results||[]){
   if(['ok','failed','throttled'].includes(r.status))attempted++;
   imported+=Number(r.imported||0);skipped+=Number(r.skipped||0);
   if(r.status==='failed')failed++;
   if(r.status==='throttled')throttled=true;
  }
  if(throttled || (result.results||[]).some(r=>r.status==='budget_exhausted'))break;
 }
 return {status:throttled?'throttled':failed?'partial':'ok',attempted,imported,skipped,failed};
}
