// Kelvin adapter for the existing Telegram Care. No new client store or model access.
const stamp=()=>new Date().toISOString();
const cutoff=()=>new Date(Date.now()-120000).toISOString();
const changes=r=>Number(r?.meta?.changes||0);
export async function ensureKelvinCare(db){await db.batch([
 db.prepare(`CREATE TABLE IF NOT EXISTS telegram_care_kelvin_control(slot INTEGER PRIMARY KEY CHECK(slot=1),owner TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,watermark INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)`),
 db.prepare(`CREATE TABLE IF NOT EXISTS telegram_care_kelvin_notices(message_id INTEGER PRIMARY KEY,owner TEXT NOT NULL,state TEXT NOT NULL,claimed_at TEXT NOT NULL,finished_at TEXT)`),
 db.prepare(`CREATE INDEX IF NOT EXISTS telegram_care_kelvin_notice_owner ON telegram_care_kelvin_notices(owner,state)`),
 db.prepare(`CREATE TABLE IF NOT EXISTS telegram_care_kelvin_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,owner TEXT NOT NULL,action TEXT NOT NULL,thread TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,status TEXT NOT NULL)`)
]);}
export async function careControl(db){await ensureKelvinCare(db);return db.prepare('SELECT * FROM telegram_care_kelvin_control WHERE slot=1').first();}
// Text is never executable. Strict recognition and fixed, localized approved copy only.
const normalized=t=>String(t||'').normalize('NFKC').toLowerCase().replace(/[‘’ʻʼ`]/g,"'").trim();
const patterns={
 contact:/\b(?:operator|manager|xodim|menejer)\b|оператор|менеджер|сотрудник|ходим|менежер/u,
 price:/сколько\s+(?:стоит|будет)|стоимост|цен[ауые]|нарх|қанча|канча|\b(?:narx\w*|qancha|necha pul|price|cost|how much)\b/u,
 flights:/рейс|авиабилет|самол[её]т|вылет|парвоз|авиачипта|\b(?:aviachipta\w*|reys\w*|parvoz\w*|flight\w*)\b/u,
 hotels:/отел|гостиниц|меҳмонхона|мехмонхона|\b(?:hotel\w*|mehmonxona\w*)\b/u,
 transfer:/трансфер|аэропорт|аэропортда|\b(?:transfer|airport|aeroport\w*)\b/u,
 guide:/гид|зи[яа]рат|зи[ёе]рат|\b(?:gid|ziyorat\w*|guide)\b/u,
 booking:/бронирован|забронировать|брон қилиш|\b(?:bron|booking|buyurtma)\b/u,
 service:/индивидуальн|пакет|хизмат|\b(?:individual|paket\w*|xizmat\w*|service\w*)\b/u,
 ritual:/таваф|тавоф|ихрам|эхром|эҳром|\b(?:tawaf|tavof|ehrom|ihram)\b/u
};
const handoffPatterns=/игнорируй|инструкци|системн(?:ый|ые)|промпт|скидк|оплат|возврат|подтверди|отмен[аи]|жалоб|гарант|\b(?:ignore|prompt|system|discount|refund|payment|confirm|cancel|guarantee|chegirma|to'lov|bekor|kafolat)\b|тўлов|чегирма|бекор|кафолат/u;
const slots={
 city:/ташкент|самарканд|ферган|наманган|бухар|андижан|ургенч|карши|термез|тошкент|самарқанд|фарғона|бухоро|андижон|урганч|қарши|термиз|\b(?:toshkent|tashkent|samarqand|samarkand|farg'ona|fergana|namangan|buxoro|bukhara|andijon|andijan|urganch|urgench|qarshi|termez|tas|skd|feg|nma|bhk|azn|ugc|ksq|tmj)(?:dan|ga|da)?\b/u,
 dates:/декабр|январ|феврал|март|апрел|ма[йяе]|июн|июл|август|сентябр|октябр|ноябр|январь|февраль|сентябрь|\b(?:dekabr|yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sentabr|sentyabr|oktabr|oktyabr|noyabr|december|january|february|march|april|june|july|august|september|october|november)(?:da|dan|ga)?\b|\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b|\b20\d{2}-\d{2}-\d{2}\b/u,
 people:/\b\d{1,2}\s*(?:odam|kishi|nafar|people|travelers)\b|(?:^|[^\d])\d{1,2}\s*(?:чел|взросл|турист|паломник|киши|нафар|одам)|(?:на|нас)\s+(?:двоих|троих|четверых|пятерых|шестерых|\d{1,2})(?!\d)|\b(?:ikki|uch|to'rt|besh|olti)\s+(?:odam|kishi|nafar)\b|(?:икки|уч|тўрт|беш|олти)\s+(?:киши|нафар|одам)/u
};
const slotCopy={ru:['город вылета','даты или месяц','количество путешественников'],uz:['jo‘nash shahri','sana yoki oy','sayohatchilar soni'],uz_cyrl:['жўнаш шаҳри','сана ёки ой','саёҳатчилар сони'],en:['departure city','dates or month','number of travelers']};
const askCopy={ru:'Уточните, пожалуйста: ',uz:'Iltimos, aniqlashtiring: ',uz_cyrl:'Илтимос, аниқлаштиринг: ',en:'Please specify: '};
const quoteEscalate={ru:'Спасибо! Передаю запрос сотруднику iumrah Care для проверки актуальной стоимости.',uz:'Rahmat! Aniq narxni tekshirish uchun so‘rovingizni iumrah Care xodimiga yuboraman.',uz_cyrl:'Раҳмат! Аниқ нархни текшириш учун сўровингизни iumrah Care ходимига юбораман.',en:'Thank you! I will pass your request to iumrah Care staff to check the current price.'};
export function kelvinReply(text,locale,previous,copy,{privateInput=false,forceHuman=false,history=[]}={}){
 const t=normalized(text),c=copy(locale),l=slotCopy[locale]?locale:'ru';
 if(privateInput)return {label:'private',answer:c.private,human:true};
 if(forceHuman||handoffPatterns.test(t)||patterns.contact.test(t))return {label:'contact',answer:c.handoff,human:true};
 if(/^(?:ассаламу алейкум|ассалому алайкум|салам|привет|здравствуйте|hello|hi|salom|assalomu alaykum|салом)[!.\s]*$/u.test(t))return {label:'greeting',answer:c.greeting,human:false};
 if(/^(?:спасибо|thanks|thank you|rahmat|раҳмат|рахмат)[!.\s]*$/u.test(t))return {label:'thanks',answer:c.thanks,human:false};
 const topics=Object.keys(patterns).filter(k=>k!=='contact'&&patterns[k].test(t));
 const price=topics.includes('price'),detail=Object.values(slots).some(x=>x.test(t));
 if(price||(previous==='price'&&detail&&topics.every(x=>['flights','service'].includes(x)))){
  // A new explicit price question starts a new quote context. Only recent same-thread user messages are considered for follow-ups.
  const prior=price?[]:history.slice(-8).map(normalized);
  const lastPrice=prior.findLastIndex(x=>patterns.price.test(x));
  const combined=(lastPrice<0?[]:prior.slice(lastPrice)).concat(t).join(' ');
  const missing=Object.values(slots).map((x,i)=>x.test(combined)?null:slotCopy[l][i]).filter(Boolean);
  if(!missing.length)return {label:'contact',answer:quoteEscalate[l],human:true};
  return {label:'price',answer:(price?c.price+' ':'')+askCopy[l]+missing.join(', ')+'.',human:false};
 }
 if(topics.length===1&&t.length<=500)return {label:topics[0],answer:c[topics[0]],human:false};
 return {label:'unknown',answer:c.handoff,human:true};
}
// Serialize outbound writes using existing messages; never retry unknown Telegram delivery.
export async function expireCareSends(db,id){
 await db.prepare(`UPDATE telegram_care_threads SET mode='human' WHERE user_id=? AND EXISTS(SELECT 1 FROM telegram_care_messages WHERE user_id=? AND delivery='sending' AND created_at<?)`).bind(id,id,cutoff()).run();
 await db.prepare(`UPDATE telegram_care_messages SET delivery='uncertain' WHERE user_id=? AND delivery='sending' AND created_at<?`).bind(id,cutoff()).run();
}
export async function reserveAuto(db,id,external,answer){
 await expireCareSends(db,id);
 return changes(await db.prepare(`INSERT OR IGNORE INTO telegram_care_messages(user_id,role,body,external_id,created_at,delivery)
 SELECT ?,'auto',?,?,?,'sending' WHERE EXISTS(SELECT 1 FROM telegram_care_threads WHERE user_id=? AND mode='auto') AND NOT EXISTS(SELECT 1 FROM telegram_care_messages WHERE user_id=? AND delivery='sending')`).bind(id,answer,external,stamp(),id,id).run())===1;
}
export async function setCareMode(db,id,mode){
 await expireCareSends(db,id);
 return changes(await db.prepare(`UPDATE telegram_care_threads SET mode=?,updated_at=? WHERE user_id=? AND NOT EXISTS(SELECT 1 FROM telegram_care_messages WHERE user_id=? AND delivery='sending')`).bind(mode,stamp(),id,id).run())===1;
}
export async function reserveStaff(db,id,external,text){
 return changes(await db.prepare(`INSERT OR IGNORE INTO telegram_care_messages(user_id,role,body,external_id,created_at,delivery)
 SELECT ?,'staff',?,?,?,'sending' WHERE EXISTS(SELECT 1 FROM telegram_care_threads WHERE user_id=? AND mode='human') AND NOT EXISTS(SELECT 1 FROM telegram_care_messages WHERE user_id=? AND delivery='sending')`).bind(id,text,external,stamp(),id,id).run())===1;
}
const goodID=id=>typeof id==='string'&&/^\d{1,16}$/.test(id);
const result=(body,status=200)=>[status,body];
async function audit(db,owner,action,thread,status){await db.prepare('INSERT INTO telegram_care_kelvin_audit(owner,action,thread,created_at,status) VALUES(?,?,?,?,?)').bind(owner,action,thread||'',stamp(),status).run();}
// Claim from canonical Care messages; no replay of pre-enable history. Claims are at-most-once.
export async function kelvinCareAction(db,owner,b,admin){
 const cfg=await careControl(db),action=b?.action;
 if(action==='status')return result({enabled:cfg?.owner===owner&&cfg?.enabled===1,occupied:!!cfg&&cfg.owner!==owner,uncertain:cfg?.owner===owner?Number((await db.prepare("SELECT COUNT(*) n FROM telegram_care_kelvin_notices WHERE owner=? AND state IN ('uncertain','sending')").bind(owner).first())?.n||0):0});
 if(action==='enable'){
  if(cfg&&cfg.owner!==owner)return result({error:'CARE_OWNER_CONFLICT'},409);
  if(cfg?.enabled===1)return result({enabled:true});
  await audit(db,owner,action,'','requested');
  await db.prepare(`INSERT INTO telegram_care_kelvin_control(slot,owner,enabled,watermark,updated_at) VALUES(1,?,1,(SELECT COALESCE(MAX(id),0) FROM telegram_care_messages),?) ON CONFLICT(slot) DO UPDATE SET enabled=1,watermark=excluded.watermark,updated_at=excluded.updated_at WHERE owner=excluded.owner AND enabled=0`).bind(owner,stamp()).run();
  const current=await careControl(db);return current?.owner===owner&&current.enabled===1?result({enabled:true}):result({error:'CARE_OWNER_CONFLICT'},409);
 }
 if(!cfg||cfg.owner!==owner)return result({error:'CARE_NOT_ENABLED'},403);
 if(action==='disable'){await audit(db,owner,action,'','requested');await db.prepare('UPDATE telegram_care_kelvin_control SET enabled=0,updated_at=? WHERE slot=1 AND owner=?').bind(stamp(),owner).run();return result({enabled:false});}
 if(!cfg.enabled)return result({error:'CARE_NOT_ENABLED'},403);
 if(action==='claim'){
  await db.prepare("UPDATE telegram_care_kelvin_notices SET state='uncertain',finished_at=? WHERE owner=? AND state='sending' AND claimed_at<?").bind(stamp(),owner,cutoff()).run();
  // No model receives these rows. Customer messages have already been screened by existing Care.
  const candidate=await db.prepare(`SELECT m.id,m.user_id,m.body,m.created_at,t.mode,t.topic,r.body AS answer,r.delivery FROM telegram_care_messages m JOIN telegram_care_threads t ON t.user_id=m.user_id LEFT JOIN telegram_care_messages r ON r.user_id=m.user_id AND r.external_id='reply:'||m.external_id WHERE m.role='user' AND m.id>? AND NOT EXISTS(SELECT 1 FROM telegram_care_kelvin_notices n WHERE n.message_id=m.id) AND (r.delivery IN ('sent','uncertain') OR (r.id IS NULL AND t.mode='human') OR (r.id IS NULL AND m.created_at<?) OR (r.delivery IN ('pending','sending') AND r.created_at<?)) ORDER BY m.id LIMIT 1`).bind(cfg.watermark,cutoff(),cutoff()).first();
  if(!candidate)return result({notice:null});
  if(candidate.delivery==='sending'){await expireCareSends(db,candidate.user_id);candidate.delivery='uncertain';candidate.mode='human';}
  const courtesy=candidate.delivery==='sent'&&candidate.mode==='auto'&&/^(?:ассаламу алейкум|ассалому алайкум|салам|привет|здравствуйте|hello|hi|salom|assalomu alaykum|салом|спасибо|thanks|thank you|rahmat|раҳмат|рахмат)[!.\s]*$/u.test(normalized(candidate.body));
 const claim=await db.prepare(`INSERT OR IGNORE INTO telegram_care_kelvin_notices(message_id,owner,state,claimed_at) SELECT ?,?,'sending',? WHERE EXISTS(SELECT 1 FROM telegram_care_kelvin_control WHERE slot=1 AND owner=? AND enabled=1 AND watermark<?)`).bind(candidate.id,owner,stamp(),owner,candidate.id).run();
  if(!changes(claim))return result({notice:null});
  if(courtesy){await db.prepare("UPDATE telegram_care_kelvin_notices SET state='skipped',finished_at=? WHERE message_id=? AND owner=? AND state='sending'").bind(stamp(),candidate.id,owner).run();return result({notice:null});}
  return result({notice:{id:candidate.id,thread:candidate.user_id,question:clip(candidate.body),answer:clip(candidate.answer||''),delivery:candidate.delivery==='sent'?'sent':candidate.delivery==='uncertain'?'uncertain':'unconfirmed',mode:candidate.mode,topic:candidate.topic}});
 }
 if(action==='ack'){
  if(!Number.isSafeInteger(b.id)||b.id<1||!['sent','uncertain'].includes(b.state))return result({error:'INVALID_NOTICE'},400);
  const r=await db.prepare("UPDATE telegram_care_kelvin_notices SET state=?,finished_at=? WHERE message_id=? AND owner=? AND state='sending'").bind(b.state,stamp(),b.id,owner).run();return changes(r)?result({}):result({error:'NOTICE_NOT_CLAIMED'},409);
 }
 if(action==='pending'){
  const r=await db.prepare(`SELECT t.user_id AS thread,t.mode,t.topic, (SELECT body FROM telegram_care_messages WHERE user_id=t.user_id ORDER BY id DESC LIMIT 1) AS preview FROM telegram_care_threads t WHERE t.mode='human' ORDER BY updated_at DESC LIMIT 20`).all();return result({threads:(r.results||[]).map(x=>({...x,preview:clip(x.preview||'')}))});
 }
 if(!goodID(b?.thread))return result({error:'INVALID_THREAD'},400);
 if(action==='show'){const r=await admin([b.thread]);if(!r.ok)return result({error:'CARE_ACTION_FAILED'},r.status);const v=await r.json();return result({mode:v.mode,messages:v.messages.slice(-12).map(x=>({role:x.role,body:clip(x.body),delivery:x.delivery}))});}
 if(action==='take'||action==='resume'){await audit(db,owner,action,b.thread,'requested');const r=await admin([b.thread,'mode'],{mode:action==='take'?'human':'auto'});return r.ok?result({mode:action==='take'?'human':'auto'}):result({error:r.status===409?'CARE_SEND_IN_PROGRESS':'CARE_ACTION_FAILED'},r.status);}
 if(action==='reply'){
  if(typeof b.text!=='string'||!b.text.trim()||b.text.length>1000||typeof b.requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(b.requestId))return result({error:'INVALID_MESSAGE'},400);
  await audit(db,owner,action,b.thread,'requested');
  const r=await admin([b.thread,'reply'],{body:b.text,clientMessageID:b.requestId});return r.ok?result({sent:true}):result({error:r.status===409?'CARE_SEND_IN_PROGRESS_OR_UNCERTAIN':'CARE_ACTION_FAILED'},r.status);
 }
 return result({error:'INVALID_ACTION'},400);
}
// Defensive secondary screen before copying content to the private Telegram. No links or contact identifiers.
export function clip(v){return String(v||'').replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:sk-ant-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]+|\b[0-9a-f]{48,}\b|\d{6,}:[A-Za-z0-9_-]+|(?:\+?\d[\s().-]?){6,}|\b[A-Z]{2}\d{6,}\b/gi,'[скрыто]').slice(0,700);}
