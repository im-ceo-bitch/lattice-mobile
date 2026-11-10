// iumrah AI Analyst — Gemini 3.8 Flash free-tier model; read-only aggregate SQL tools.
// Protected by the superadmin staff cookie + Business device-session middleware in index.js.
const H = {'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const json = (body, code=200)=>new Response(JSON.stringify(body),{status:code,headers:H});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const cut=(s,m)=>String(s||'').slice(0,m);
const modelName=()=> 'gemini-3.8-flash'; // Keep model locked to Free tier until owner explicitly enables billing.
const since=days=>new Date(Date.now()-days*86400000).toISOString();
const DAYS=[7,14,30];
const funnelEvents=['app_open','onboarding_completed','search_started','flight_selected','hotel_selected','checkout_started','booking_completed'];

async function toolData(env,name,days) {
  const db=env.HOTELS_DB;
  const bound=since(days);
  if(name==='get_overview'){
    const x=await db.prepare(`SELECT COUNT(*) AS events,COUNT(DISTINCT visitor_id) AS visitors,
      COUNT(DISTINCT session_id) AS sessions FROM intelligence_events WHERE created_at>=?`).bind(bound).first();
    return {days,visitors:n(x?.visitors),sessions:n(x?.sessions),events:n(x?.events)};
  }
  if(name==='get_funnel'){
    const x=await db.prepare(`SELECT event_name, COUNT(DISTINCT visitor_id) AS visitors FROM intelligence_events
      WHERE created_at>=? AND event_name IN ('app_open','onboarding_completed','search_started','flight_selected','hotel_selected','checkout_started','booking_completed')
      GROUP BY event_name`).bind(bound).all();
    const by=new Map((x.results||[]).map(r=>[r.event_name,n(r.visitors)]));
    return {days,stages:funnelEvents.map(name=>({event:name,visitors:by.get(name)||0})),note:'Unique visitors per stage, not necessarily the same session or a sequential cohort.'};
  }
  if(name==='get_platform_breakdown'){
    const x=await db.prepare(`SELECT platform,COUNT(DISTINCT visitor_id) AS visitors,
      COUNT(DISTINCT session_id) AS sessions,COUNT(*) AS events,
      COUNT(DISTINCT CASE WHEN event_name='booking_completed' THEN visitor_id END) AS bookings
      FROM intelligence_events WHERE created_at>=? GROUP BY platform`).bind(bound).all();
    return {days,platforms:(x.results||[]).map(r=>({platform:r.platform,visitors:n(r.visitors),sessions:n(r.sessions),events:n(r.events),bookings:n(r.bookings)}))};
  }
  if(name==='get_screen_metrics'){
    const x=await db.prepare(`SELECT screen,
      COUNT(DISTINCT CASE WHEN event_name='screen_view' THEN visitor_id END) AS visitors,
      SUM(CASE WHEN event_name='screen_view' THEN 1 ELSE 0 END) AS views,
      AVG(CASE WHEN event_name='screen_exit' THEN duration_ms END) AS avg_ms
      FROM intelligence_events WHERE created_at>=? AND screen<>''
      GROUP BY screen ORDER BY views DESC LIMIT 15`).bind(bound).all();
    return {days,screens:(x.results||[]).map(r=>({screen:r.screen,visitors:n(r.visitors),views:n(r.views),averageSeconds:r.avg_ms===null?null:Math.round(n(r.avg_ms)/1000)}))};
  }
  if(name==='get_daily_trend'){
    const x=await db.prepare(`SELECT substr(created_at,1,10) AS day,platform,
      COUNT(DISTINCT visitor_id) AS visitors,COUNT(*) AS events
      FROM intelligence_events WHERE created_at>=? GROUP BY substr(created_at,1,10),platform
      ORDER BY day`).bind(bound).all();
    return {days,byDayAndPlatform:(x.results||[]).map(r=>({day:r.day,platform:r.platform,visitors:n(r.visitors),events:n(r.events)}))};
  }
  return {error:'UNKNOWN_TOOL'};
}
const METHODS=['get_overview','get_funnel','get_platform_breakdown','get_screen_metrics','get_daily_trend'];
const tools=[{functionDeclarations:METHODS.map(name=>({name,
  description:({get_overview:'Count visitors, sessions, events in a period',get_funnel:'Get booking conversion events grouped by stage',
    get_platform_breakdown:'Compare conversion for iOS Android and Web',get_screen_metrics:'Find high-traffic screens and time on screens',
    get_daily_trend:'Find daily traffic changes split by platforms'})[name],
  parameters:{type:'OBJECT',properties:{days:{type:'INTEGER',description:'Only 7, 14 or 30 days'}},required:['days']}}))}];

async function askGemini(env, question, history, days){
  const key=String(env.GEMINI_API_KEY||'').trim();
  if(!key) throw Error('GEMINI_KEY_MISSING');
  const model=modelName(env);
  const base=await Promise.all(['get_overview','get_platform_breakdown','get_funnel'].map(x=>toolData(env,x,days)));
  const system=[
    'Ты iumrah AI Analyst — ведущий продуктовый аналитик и руководитель growth-маркетинга B2C продукта умры.',
    'Используй только данные сервера, полученные в текущем запросе через инструмент. Не выдумывай продажи, установки, конверсию, причинно-следственные связи и прогнозы.',
    'Обязательно отделяй факт → гипотезу → что исправить → какую метрику измерить. Если нет данных Android/Web, скажи что трекинг на них ещё не подтверждён.',
    'Стадии funnel показывают уникальных посетителей, а НЕ строгую последовательную когортную конверсию. Отсутствие booking_completed нельзя приравнивать к 0 фактических продаж.',
    'При запросе за другой период вызывай необходимые аналитические функции. При сложных вопросах сравни платформы и экраны, используй инструменты.',
    'Никаких изменений кода, покупки рекламы, рассылок или запуска деплоя: только анализ и советы.',
    'Пиши на русском, конкретно, приоритеты Высокий/Средний/Низкий. Не более 400 слов.',
    `Период: последние ${days} дней. Вот базовые проверенные метрики (без персональных идентификаторов):`,
    JSON.stringify({overview:base[0],platforms:base[1],funnel:base[2]})
  ].join('\n');
  const contents=[];
  for(const entry of history.slice(-12)) contents.push({role:entry.role==='assistant'?'model':'user',parts:[{text:cut(entry.content,1800)}]});
  contents.push({role:'user',parts:[{text:question}]});
  for(let round=0;round<4;round++){
    const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
      method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},
      body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents,tools,
        generationConfig:{temperature:0.25,maxOutputTokens:3500}}),
      signal:AbortSignal.timeout(70000)
    });
    if(!response.ok) throw Error(`GEMINI_HTTP_${response.status}`);
    const result=await response.json();
    const candidate=result?.candidates?.[0]?.content;
    if(!candidate?.parts?.length) throw Error('GEMINI_EMPTY_RESPONSE');
    const calls=candidate.parts.filter(p=>p.functionCall).slice(0,5);
    if(!calls.length){
      const answer=cut(candidate.parts.map(p=>p.text||'').join('').trim(),12000);
      if(!answer) throw Error('GEMINI_EMPTY_RESPONSE');
      return {answer,model};
    }
    // Preserve full model parts, including thought signatures required by reasoning models.
    contents.push(candidate);
    const responses=[];
    for(const part of calls){
      const call=part.functionCall;
      const d=DAYS.includes(Number(call.args?.days))?Number(call.args.days):days;
      const data=METHODS.includes(call.name)?await toolData(env,call.name,d):{error:'TOOL_NOT_ALLOWED'};
      responses.push({functionResponse:{name:call.name,response:{result:data},...(call.id?{id:call.id}:{})}});
    }
    contents.push({role:'user',parts:responses});
  }
  throw Error('GEMINI_TOOL_LIMIT');
}

export async function intelligenceChat(request,env,url){
  if(!env.HOTELS_DB) return json({ok:false,error:'DATABASE_UNAVAILABLE'},503);
  const threadId=url.searchParams.get('threadId');
  if(request.method==='GET'){
    if(!UUID.test(threadId||''))return json({ok:true,threadId:null,messages:[]});
    const found=await env.HOTELS_DB.prepare('SELECT id FROM intelligence_ai_threads WHERE id=?').bind(threadId).first();
    if(!found)return json({ok:true,threadId:null,messages:[]});
    const rows=await env.HOTELS_DB.prepare(`SELECT id,role,content,created_at FROM intelligence_ai_messages
      WHERE thread_id=? ORDER BY created_at DESC,id DESC LIMIT 40`).bind(threadId).all();
    return json({ok:true,threadId,messages:(rows.results||[]).reverse().map(x=>({id:x.id,role:x.role,content:x.content,createdAt:x.created_at}))});
  }
  if(request.method!=='POST')return json({ok:false,error:'METHOD_NOT_ALLOWED'},405);
  if(Number(request.headers.get('content-length')||0)>4096)return json({ok:false,error:'PAYLOAD_TOO_LARGE'},413);
  let body;try{body=await request.json();}catch{return json({ok:false,error:'INVALID_JSON'},400);}
  const question=typeof body?.message==='string'?body.message.trim():'';
  if(!question||question.length>1400)return json({ok:false,error:'INVALID_MESSAGE'},400);
  if(body?.threadId && !UUID.test(body.threadId))return json({ok:false,error:'INVALID_THREAD'},400);
  const days=DAYS.includes(body?.days)?body.days:7;
  // Small usage cap protects free quota from accidental repeated requests.
  const today=new Date().toISOString().slice(0,10);
  const usage=await env.HOTELS_DB.prepare('SELECT requests FROM intelligence_ai_usage WHERE day=?').bind(today).first();
  if(n(usage?.requests)>=25)return json({ok:false,error:'DAILY_AI_LIMIT'},429);
  const id=body?.threadId||crypto.randomUUID();
  const existing=await env.HOTELS_DB.prepare('SELECT id,updated_at FROM intelligence_ai_threads WHERE id=?').bind(id).first();
  if(body?.threadId&&!existing)return json({ok:false,error:'THREAD_NOT_FOUND'},404);
  if(existing && Date.now()-Date.parse(existing.updated_at)<2500)return json({ok:false,error:'RATE_LIMITED'},429);
  const rows=existing?await env.HOTELS_DB.prepare(`SELECT role,content FROM intelligence_ai_messages WHERE thread_id=? ORDER BY created_at DESC,id DESC LIMIT 12`).bind(id).all():{results:[]};
  // Charge a request only when the model is actually called; idempotent daily row.
  await env.HOTELS_DB.prepare(`INSERT INTO intelligence_ai_usage(day,requests) VALUES(?,1)
    ON CONFLICT(day) DO UPDATE SET requests=requests+1`).bind(today).run();
  let result;
  try{ result=await askGemini(env,question,(rows.results||[]).reverse(),days); }
  catch(e){
    const err=String(e?.message||'');
    const status=err==='GEMINI_KEY_MISSING'?503:err==='GEMINI_HTTP_429'?429:502;
    const safe=/^GEMINI_HTTP_\d{3}$/.test(err)||
      ['GEMINI_KEY_MISSING','GEMINI_EMPTY_RESPONSE','GEMINI_TOOL_LIMIT'].includes(err)?err:'GEMINI_UNAVAILABLE';
    // Only a safe status code; never print the user prompt, API key or Gemini response.
    console.error('INTELLIGENCE_CHAT_FAILED',safe);
    return json({ok:false,error:safe},status);
  }
  const now=new Date().toISOString();
  if(!existing)await env.HOTELS_DB.prepare('INSERT INTO intelligence_ai_threads(id,title,created_at,updated_at) VALUES(?,?,?,?)')
    .bind(id,cut(question,90),now,now).run();
  await env.HOTELS_DB.batch([
    env.HOTELS_DB.prepare('INSERT INTO intelligence_ai_messages(id,thread_id,role,content,created_at) VALUES(?,?,?,?,?)')
      .bind(crypto.randomUUID(),id,'user',question,now),
    env.HOTELS_DB.prepare('INSERT INTO intelligence_ai_messages(id,thread_id,role,content,created_at) VALUES(?,?,?,?,?)')
      .bind(crypto.randomUUID(),id,'assistant',result.answer,now)
  ]);
  await env.HOTELS_DB.prepare('UPDATE intelligence_ai_threads SET updated_at=? WHERE id=?').bind(now,id).run();
  return json({ok:true,threadId:id,answer:result.answer,model:result.model});
}
