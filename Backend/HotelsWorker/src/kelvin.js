import { kelvinSpeech } from './kelvin-voice.js';
// Owner-only shared Kelvin conversation; Mac pulls work over HTTPS. No LLM in Worker.
const base='/api/admin/hotels/kelvin';
const internal='/api/internal/kelvin';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const fail=(error,status)=>json({ok:false,error},status);
const now=()=>Date.now();
const hex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
const hash=async x=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x))));
const secret=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
const rows=async(stmt)=>(await stmt.all()).results||[];
const schema=[`CREATE TABLE IF NOT EXISTS kelvin_links (owner TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, last_seen INTEGER NOT NULL DEFAULT 0)`,
`CREATE TABLE IF NOT EXISTS kelvin_turns (seq INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, request_id TEXT NOT NULL, source TEXT NOT NULL, prompt TEXT NOT NULL, voice INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'queued', answer TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, UNIQUE(owner,request_id))`,
`CREATE INDEX IF NOT EXISTS kelvin_turns_queue ON kelvin_turns(owner,status,seq)`,
`CREATE TABLE IF NOT EXISTS kelvin_memory (owner TEXT NOT NULL, id TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(owner,id))`];
async function setup(db){await db.batch(schema.map(s=>db.prepare(s)));}
async function body(req){const raw=await req.text(); if(raw.length>60000) return null; try{return JSON.parse(raw)}catch{return null}}
const view=r=>({id:r.request_id,source:r.source,prompt:r.prompt,answer:r.answer,status:r.status,createdAt:r.created_at,updatedAt:r.updated_at});
async function history(db,owner){return (await rows(db.prepare('SELECT * FROM kelvin_turns WHERE owner=? ORDER BY seq DESC LIMIT 60').bind(owner))).reverse().map(view);}
async function enqueue(db,owner,input,source){
 const id=input?.id,prompt=input?.prompt;
 if(typeof prompt==='string'&&looksSecret(prompt))return fail('DO_NOT_SEND_SECRETS',400);
 if(typeof id!=='string'||! /^[A-Za-z0-9_-]{8,100}$/.test(id)||typeof prompt!=='string'||!prompt.trim()||prompt.length>12000)return fail('INVALID_REQUEST',400);
 const existing=await db.prepare('SELECT * FROM kelvin_turns WHERE owner=? AND request_id=?').bind(owner,id).first();
 if(existing) return existing.prompt===prompt.trim()&&existing.source===source ? json({ok:true,turn:view(existing)}) : fail('REQUEST_ID_CONFLICT',409);
 const t=now();
 await db.prepare(`INSERT OR IGNORE INTO kelvin_turns(owner,request_id,source,prompt,voice,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM kelvin_turns WHERE owner=? AND status IN ('queued','running'))<30`).bind(owner,id,source,prompt.trim(),input.voice===true?1:0,t,t,owner).run();
 const r=await db.prepare('SELECT * FROM kelvin_turns WHERE owner=? AND request_id=?').bind(owner,id).first();
 if(!r)return fail('QUEUE_FULL',429);
 return r.prompt===prompt.trim()&&r.source===source?json({ok:true,turn:view(r)}):fail('REQUEST_ID_CONFLICT',409);
}
// Fixed aggregate queries, no SQL supplied by model and no passport/contact/chat bodies.
export async function snapshot(env,prompt=""){
 const t=new Date(), since=new Date(t.getTime()-7*86400000).toISOString(), day=t.toISOString().slice(0,10);
 const specs=[
 ['bookingsByStatus',env.BOOKINGS_DB,'SELECT status,COUNT(*) AS count FROM bookings GROUP BY status',[]],
 ['newBookings7d',env.BOOKINGS_DB,'SELECT status,COUNT(*) AS count FROM bookings WHERE created_at>=? GROUP BY status',[since]],
 ['upcomingTrips',env.BOOKINGS_DB,'SELECT status,COUNT(*) AS count FROM bookings WHERE start_date>=? GROUP BY status',[day]],
 ['supportThreads',env.HOTELS_DB,'SELECT COUNT(*) AS total,COALESCE(SUM(unread_for_staff),0) AS unread FROM business_chat_threads',[]],
 ['supportMessages7d',env.HOTELS_DB,'SELECT sender_type,COUNT(*) AS count FROM business_chat_messages WHERE created_at>=? GROUP BY sender_type',[since]],
 ['legacyCoreChat7d',env.BOOKINGS_DB,'SELECT sender_type,COUNT(*) AS count FROM chat_messages WHERE created_at>=? GROUP BY sender_type',[since]],
 ['telegramCareThreads',env.BOOKINGS_DB,'SELECT mode,topic,COUNT(*) AS count FROM telegram_care_threads GROUP BY mode,topic LIMIT 50',[]],
 ['telegramCareMessages7d',env.BOOKINGS_DB,'SELECT role,delivery,COUNT(*) AS count FROM telegram_care_messages WHERE created_at>=? GROUP BY role,delivery',[since]],
 ['careRequests',env.HOTELS_DB,'SELECT source,status,COUNT(*) AS count FROM iumrah_care_package_requests GROUP BY source,status LIMIT 50',[]],
 ['telegramSubscriptions',env.BOOKINGS_DB,'SELECT COUNT(*) AS linked FROM booking_telegram_subscriptions WHERE disabled_at IS NULL',[]],
 ['hotels',env.HOTELS_DB,'SELECT city,status,COUNT(*) AS count FROM hotels GROUP BY city,status LIMIT 50',[]],
 ['futureFlights',env.FLIGHTS_DB,'SELECT origin,destination,COUNT(*) AS count FROM flights WHERE departure_date>=? GROUP BY origin,destination LIMIT 100',[day]],
 ['appEvents7d',env.HOTELS_DB,'SELECT platform,event_name,COUNT(*) AS count FROM intelligence_events WHERE occurred_at>=? GROUP BY platform,event_name LIMIT 100',[since]]];
 const bookingID=String(prompt).match(/\bIUM-\d{4}-[A-Z2-9]{7}\b/i)?.[0]?.toUpperCase();
 if(bookingID)specs.push(['requestedBooking',env.BOOKINGS_DB,'SELECT id,status,created_at,updated_at,start_date,end_date,origin_code,outbound_destination,return_origin,traveler_count,rooms,total_cents,flight_name,makkah_hotel,madinah_hotel FROM bookings WHERE id=? LIMIT 1',[bookingID]]);
 const data=Object.fromEntries(await Promise.all(specs.map(async([k,db,sql,args])=>{try{if(!db)throw Error();return [k,{available:true,rows:await rows(db.prepare(sql).bind(...args))}]}catch{return [k,{available:false}]}})));
 return {asOf:t.toISOString(),periodStart:since,coverage:'Aggregates and explicitly requested booking summary only; legacy/core and business chat metrics may overlap. Catalog counts are not live availability. No Instagram metrics.',data};
}
export async function kelvinAdmin(request,env,user,session){
 if(String(user?.role).toLowerCase()!=='superadmin'||!session)return fail('KELVIN_OWNER_SESSION_REQUIRED',403);
 const db=env.HOTELS_DB,owner=String(user.login||'').trim().toLowerCase(); if(!db||!owner)return fail('KELVIN_UNAVAILABLE',503);
 const path=new URL(request.url).pathname.slice(base.length);
 if(path==='/speech') return kelvinSpeech(request,env,owner);
 await setup(db);
 if(path==='/pair'&&request.method==='POST'){
  const token=secret(); await db.prepare('INSERT INTO kelvin_links(owner,token_hash,last_seen) VALUES(?,?,0) ON CONFLICT(owner) DO UPDATE SET token_hash=excluded.token_hash,last_seen=0').bind(owner,await hash(token)).run();
  // Fence any old worker even if it was still processing at rotation.
  await db.prepare("UPDATE kelvin_turns SET status='queued',lease=NULL,lease_until=0,attempts=0,updated_at=? WHERE owner=? AND status='running'").bind(now(),owner).run();
  return json({ok:true,token});
 }
 if(path==='/revoke'&&request.method==='POST'){await db.prepare('DELETE FROM kelvin_links WHERE owner=?').bind(owner).run();return json({ok:true});}
 if(path==='/history'&&request.method==='GET'){
  const link=await db.prepare('SELECT last_seen FROM kelvin_links WHERE owner=?').bind(owner).first();
  return json({ok:true,paired:!!link,online:!!link&&now()-link.last_seen<45000,turns:await history(db,owner)});
 }
 if(path==='/message'&&request.method==='POST')return enqueue(db,owner,await body(request),'app');
 if(path==='/memory'&&request.method==='GET')return json({ok:true,notes:await rows(db.prepare('SELECT id,content FROM kelvin_memory WHERE owner=? ORDER BY created_at DESC LIMIT 50').bind(owner))});
 if(path==='/remember'&&request.method==='POST')return remember(db,owner,await body(request));
 if(path==='/forget'&&request.method==='POST')return forget(db,owner,await body(request));
 return fail('NOT_FOUND',404);
}
export async function kelvinInternal(request,env){
 const token=(request.headers.get('authorization')||'').match(/^Bearer ([a-f0-9]{64})$/)?.[1];
 if(!token)return fail('UNAUTHORIZED',401);
 const db=env.HOTELS_DB;if(!db)return fail('KELVIN_UNAVAILABLE',503);
 await setup(db);
 const tokenHash=await hash(token),link=await db.prepare('SELECT owner FROM kelvin_links WHERE token_hash=?').bind(tokenHash).first();
 if(!link)return fail('UNAUTHORIZED',401);
 const owner=link.owner,path=new URL(request.url).pathname.slice(internal.length),t=now();
 if(request.method!=='POST')return fail('METHOD_NOT_ALLOWED',405);
 if(path==='/message'){const b=await body(request);return enqueue(db,owner,b,b?.source==='briefing'?'briefing':'telegram');}
 if(path==='/heartbeat'){await db.prepare('UPDATE kelvin_links SET last_seen=? WHERE token_hash=?').bind(t,tokenHash).run();return json({ok:true});}
 if(path==='/claim'){
  await db.prepare('UPDATE kelvin_links SET last_seen=? WHERE token_hash=?').bind(t,tokenHash).run();
  await db.prepare("UPDATE kelvin_turns SET status='failed',answer='Прервано после повторных попыток. Отправьте новый запрос.',lease=NULL,updated_at=? WHERE owner=? AND status='running' AND lease_until<=? AND attempts>=3").bind(t,owner,t).run();
  const lease=secret();
  const job=await db.prepare(`UPDATE kelvin_turns SET status='running',lease=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE seq=(SELECT seq FROM kelvin_turns WHERE owner=? AND (status='queued' OR (status='running' AND lease_until<=?)) AND attempts<3 ORDER BY seq LIMIT 1) AND NOT EXISTS(SELECT 1 FROM kelvin_turns WHERE owner=? AND status='running' AND lease_until>?) AND EXISTS(SELECT 1 FROM kelvin_links WHERE owner=? AND token_hash=?) RETURNING *`).bind(lease,t+900000,t,owner,t,owner,t,owner,tokenHash).first();
  if(!job)return json({ok:true,job:null});
  const context=(await rows(db.prepare("SELECT * FROM kelvin_turns WHERE owner=? AND seq<? AND status='done' ORDER BY seq DESC LIMIT 40").bind(owner,job.seq))).reverse().map(view);
  const memory=await rows(db.prepare('SELECT id,content FROM kelvin_memory WHERE owner=? ORDER BY created_at DESC LIMIT 50').bind(owner));
  return json({ok:true,job:{...view(job),lease,voice:!!job.voice},history:context,memory,snapshot:await snapshot(env,job.prompt)});
 }
 if(path==='/finish'){
  const b=await body(request);if(!b||typeof b.id!=='string'||typeof b.lease!=='string'||typeof b.answer!=='string'||!b.answer.trim()||b.answer.length>30000||!['done','failed'].includes(b.status))return fail('INVALID_REQUEST',400);
  const r=await db.prepare("UPDATE kelvin_turns SET status=?,answer=?,updated_at=?,lease=NULL WHERE owner=? AND request_id=? AND lease=? AND status='running' AND lease_until>? AND EXISTS(SELECT 1 FROM kelvin_links WHERE owner=? AND token_hash=?) RETURNING request_id").bind(b.status,b.answer,t,owner,b.id,b.lease,t,owner,tokenHash).first();
  return r?json({ok:true}):fail('LEASE_LOST',409);
 }
 if(path==='/remember')return remember(db,owner,await body(request));
 if(path==='/memory')return json({ok:true,notes:await rows(db.prepare('SELECT id,content FROM kelvin_memory WHERE owner=? ORDER BY created_at DESC LIMIT 50').bind(owner))});
 if(path==='/forget')return forget(db,owner,await body(request));
 return fail('NOT_FOUND',404);
}

const looksSecret=text=>/\b\d{6,}:[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]+|github_pat_[A-Za-z0-9_]+|\b[a-f0-9]{64}\b/i.test(text);
async function remember(db,owner,b){
 if(typeof b?.content!=='string'||!b.content.trim()||b.content.length>4000||looksSecret(b.content)||typeof b.id!=='string'||! /^[A-Za-z0-9_-]{8,100}$/.test(b.id))return fail('INVALID_MEMORY',400);
 await db.prepare('INSERT OR IGNORE INTO kelvin_memory(owner,id,content,created_at) VALUES(?,?,?,?)').bind(owner,b.id,b.content.trim(),now()).run();return json({ok:true});
}
async function forget(db,owner,b){if(typeof b?.id!=='string')return fail('INVALID_MEMORY',400);await db.prepare('DELETE FROM kelvin_memory WHERE owner=? AND id=?').bind(owner,b.id).run();return json({ok:true});}
