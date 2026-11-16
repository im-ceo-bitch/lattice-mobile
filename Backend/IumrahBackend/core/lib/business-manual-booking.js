import { requestEnv, backendFetch, NextResponse } from '../runtime.js';
import { ensureBookingSchema, getBookingDb, hashBookingToken, makeBookingId, normalizeLanguage, cents } from './booking-store.js';
import { readCookie, STAFF_SESSION_COOKIE, verifyStaffSessionToken } from './staff-auth.js';
import { parsePayload } from '../app/api/bookings/route.js';
const headers = {'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const json = (body,status=200)=>NextResponse.json(body,{status,headers});
const origin = 'https://iumrah-backend.helloiumrah.workers.dev';
const validSecret = s => typeof s==='string' && /^[a-f0-9]{64}$/.test(s);
async function schema(db) {
  await ensureBookingSchema(db);
  await db.prepare(`CREATE TABLE IF NOT EXISTS business_manual_bookings (request_hash TEXT PRIMARY KEY, booking_id TEXT NOT NULL UNIQUE, share_hash TEXT NOT NULL UNIQUE, staff_login TEXT NOT NULL, cost_json TEXT NOT NULL, email_status TEXT NOT NULL DEFAULT 'not_requested', created_at TEXT NOT NULL)`).run();
}
export function manualTotals(cost, count) {
  if (!cost || !Number.isInteger(count) || count<1 || count>6) return null;
  const names=['flight','makkah','madinah','transfer','ziyarat','visa','guide','other'];
  if (!names.every(k=>typeof cost[k]==='number' && Number.isFinite(cost[k]) && cost[k]>=0 && cost[k]<=250000)) return null;
  if(cost.flight<=0||cost.makkah<=0||typeof cost.commission!=='number'||!Number.isFinite(cost.commission)||cost.commission<0||cost.commission>100) return null;
  const subtotal=names.reduce((n,k)=>n+cents(cost[k]),0);
  const total=subtotal+Math.round(subtotal*cost.commission/100);
  return total>0&&total<=25000000?{totalUsd:total/100,perPilgrimUsd:Math.round(total/count)/100}:null;
}
function safeDetails(d) {
  const str=(s,n=160)=>typeof s==='string'?s.slice(0,n):'';
  const legs=v=>Array.isArray(v)?v.slice(0,12).filter(l=>l&&typeof l==='object').map(l=>Object.fromEntries(['airline','number','origin','destination','departure','arrival'].map(k=>[k,str(l[k])]))):[];
  const room=r=>r&&typeof r==='object'?{room:str(r.room),rooms:Math.min(6,Math.max(1,Number.isInteger(r.rooms)?r.rooms:1)),meals:str(r.meals)}:null;
  return {outbound:legs(d?.outbound),inbound:legs(d?.inbound),makkah:room(d?.makkah),madinah:room(d?.madinah),vehicle:str(d?.vehicle),pickup:str(d?.pickup)};
}
async function authorize(request) {
  const session=await verifyStaffSessionToken(readCookie(request.headers.get('cookie'),STAFF_SESSION_COOKIE));
  if(!session||!request.headers.get('x-iumrah-business-session')) return null;
  const check=await backendFetch(`${origin}/api/admin/hotels/operations/me`,{headers:{cookie:request.headers.get('cookie')||'', 'x-iumrah-business-session':request.headers.get('x-iumrah-business-session')}});
  return check.ok?session:null;
}
const localized={ru:['Заявка на умру принята','Проверяем наличие. Оплата пока не требуется.','Открыть поездку'],uz:['Umra arizangiz qabul qilindi','Mavjudlik tekshirilmoqda. Hozircha to‘lov talab etilmaydi.','Safarni ochish'],'uz-cyrl':['Умра аризангиз қабул қилинди','Мавжудлик текширилмоқда. Ҳозирча тўлов талаб этилмайди.','Сафарни очиш'],en:['Umrah request received','Availability is being checked. No payment is required yet.','View trip']};
async function sendEmail(env,email,lang,url,id) {
  if(!env.RESEND_API_KEY) return 'not_configured';
  const copy=localized[lang]||localized.ru;
  try {
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,'content-type':'application/json','Idempotency-Key':`iumrah-business-${id}`},signal:AbortSignal.timeout(8000),body:JSON.stringify({from:`iumrah <${env.ACCOUNT_EMAIL_FROM||'security@iumrah.app'}>`,to:[email],subject:copy[0],text:`${copy[0]}\n${copy[1]}\n${url}`,html:`<h1>${copy[0]}</h1><p>${copy[1]}</p><p><a href="${url}">${copy[2]}</a></p>`})});
    return response.ok?'accepted':'failed';
  } catch { return 'failed'; }
}
export async function createManualBooking(request) {
  const staff=await authorize(request); if(!staff)return json({error:'FORBIDDEN'},403);
  if(Number(request.headers.get('content-length')||0)>160000)return json({error:'PAYLOAD_TOO_LARGE'},413);
  const raw=await request.json().catch(()=>null);
  if(!raw||!validSecret(raw.requestSecret))return json({error:'INVALID_REQUEST'},400);
  const db=getBookingDb();if(!db)return json({error:'BOOKING_DB_NOT_CONFIGURED'},503);
  await schema(db);
  const requestHash=await hashBookingToken('request:'+raw.requestSecret);
  const shareToken=await hashBookingToken('share:'+raw.requestSecret);
  const accessToken=await hashBookingToken('booking:'+raw.requestSecret);
  const shareHash=await hashBookingToken(shareToken);
  const shareURL=`${origin}/api/bookings/share#${shareToken}`;
  let previous=await db.prepare('SELECT * FROM business_manual_bookings WHERE request_hash=? AND staff_login=?').bind(requestHash,staff.sub).first();
  let booking;
  if(previous) {
    const row=await db.prepare('SELECT payload_json,status FROM bookings WHERE id=?').bind(previous.booking_id).first();
    if(!row)return json({error:'BOOKING_NOT_FOUND'},404);
    booking={...JSON.parse(row.payload_json),status:row.status};
  } else {
    const input=parsePayload(raw.booking);
    if(!input||input.travelerDetails||!input.pilgrimProfile?.firstName||!input.pilgrimProfile?.lastName||!/^\+[1-9]\d{7,14}$/.test(input.pilgrimProfile.phone))return json({error:'INVALID_BOOKING'},400);
    const count=input.input.travelers.adults+input.input.travelers.children+input.input.travelers.infants;
    const total=manualTotals(raw.cost,count);
    if(!total||!input.selectionDetails?.flight||!input.selectionDetails?.makkahHotel||input.input.includeMadinah!==Boolean(input.selectionDetails.madinahHotel)||(!input.input.includeMadinah&&raw.cost.madinah!==0)||(input.input.includeMadinah&&raw.cost.madinah<=0))return json({error:'INVALID_MANUAL_COST'},400);
    if(input.input.startDate<new Date().toISOString().slice(0,10))return json({error:'TRIP_DATE_IN_PAST'},400);
    const email=typeof raw.email==='string'?raw.email.trim().slice(0,180):'';
    if(raw.sendEmail===true&&!/^\S+@\S+\.\S+$/.test(email))return json({error:'INVALID_EMAIL'},400);
    const id=makeBookingId(input.input.startDate.slice(0,4));const now=new Date().toISOString(), lang=normalizeLanguage(raw.lang), status='AVAILABILITY_CHECK';
    // Public booking contains only selling amounts, never internal costs or commission.
    booking={...input,...total,manualDetails:safeDetails(raw.manualDetails),id,status,createdAt:now,updatedAt:now};
    const statements=[db.prepare(`INSERT INTO bookings (id,access_token_hash,status,created_at,updated_at,lang,plan_id,total_cents,per_pilgrim_cents,traveler_count,rooms,origin_code,outbound_destination,return_origin,start_date,end_date,flight_name,makkah_hotel,madinah_hotel,payload_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,await hashBookingToken(accessToken),status,now,now,lang,input.planId,cents(total.totalUsd),cents(total.perPilgrimUsd),count,input.input.travelers.rooms,input.route.originCode,input.route.outboundDestination,input.route.returnOrigin,input.input.startDate,input.input.endDate,input.flight,input.hotelNames.makkah,input.hotelNames.madinah,JSON.stringify(booking)),db.prepare(`INSERT INTO booking_events (booking_id,status,actor_type,actor_id,note,created_at) VALUES (?,?,'staff',?,?,?)`).bind(id,status,staff.sub,'Manual Business booking; availability not confirmed.',now),db.prepare('INSERT INTO business_manual_bookings (request_hash,booking_id,share_hash,staff_login,cost_json,email_status,created_at) VALUES (?,?,?,?,?,?,?)').bind(requestHash,id,shareHash,staff.sub,JSON.stringify({cost:raw.cost,email,lang}),raw.sendEmail===true?'pending':'not_requested',now)];
    try {await db.batch(statements);} catch(e) {
      // Concurrent retries must return the same existing booking, not duplicate it.
      const existing=await db.prepare('SELECT booking_id FROM business_manual_bookings WHERE request_hash=? AND staff_login=?').bind(requestHash,staff.sub).first();
      if(!existing)throw e;
      const row=await db.prepare('SELECT payload_json,status FROM bookings WHERE id=?').bind(existing.booking_id).first();
      booking={...JSON.parse(row.payload_json),status:row.status};
    }
    previous=await db.prepare('SELECT * FROM business_manual_bookings WHERE request_hash=? AND staff_login=?').bind(requestHash,staff.sub).first();
  }
  const env=requestEnv();let trip=null;
  try { if(typeof env.IUMRAH_MATERIALIZE_BOOKING_IDENTITY==='function')trip=await env.IUMRAH_MATERIALIZE_BOOKING_IDENTITY(booking); } catch { /* Booking is already committed. */ }
  let emailStatus=previous?.email_status||'not_requested';
  const linkStillValid=previous?.share_hash===shareHash;
  if(linkStillValid&&['pending','failed','not_configured'].includes(emailStatus)) {
    const data=JSON.parse(previous.cost_json);
    emailStatus=await sendEmail(env,data.email,data.lang,shareURL,booking.id);
    try {await db.prepare('UPDATE business_manual_bookings SET email_status=? WHERE request_hash=?').bind(emailStatus,requestHash).run();}catch{/* Provider idempotency protects retries. */}
  }
  return json({bookingID:booking.id,bookingNumber:trip?.bookingNumber??null,pilgrimID:trip?.pilgrimID?String(trip.pilgrimID):null,identityReady:Boolean(trip?.bookingNumber&&trip?.pilgrimID),shareURL:linkStillValid?shareURL:"",emailStatus,totalUsd:booking.totalUsd},201);
}
export async function shareRead(request) {
  const body=await request.json().catch(()=>null);if(!validSecret(body?.token))return json({error:'NOT_FOUND'},404);
  const db=getBookingDb();if(!db)return json({error:'UNAVAILABLE'},503);await schema(db);
  const row=await db.prepare('SELECT b.id,b.status,b.lang,b.payload_json FROM business_manual_bookings m JOIN bookings b ON b.id=m.booking_id WHERE m.share_hash=?').bind(await hashBookingToken(body.token)).first();
  if(!row)return json({error:'NOT_FOUND'},404);
  const b=JSON.parse(row.payload_json),d=b.selectionDetails||{};
  const operation=await requestEnv().HOTELS_DB?.prepare?.('SELECT booking_number,status FROM pilgrim_trips WHERE booking_id=?').bind(row.id).first().catch(()=>null);
  const status=operation?.status?String(operation.status).toUpperCase():row.status;
  // Deliberately whitelist. No names, contacts, passport, cost report or access token.
  const flight=d.flight||{};const hotel=h=>h?{name:h.name,checkIn:h.checkIn,checkOut:h.checkOut}:null;
  return json({id:row.id,bookingNumber:operation?.booking_number??null,status,lang:row.lang,totalUsd:b.totalUsd,travelers:b.input?.travelers?.adults,startDate:b.input?.startDate,endDate:b.input?.endDate,flight:{airline:flight.airline,outboundOrigin:flight.outboundOrigin,outboundDestination:flight.outboundDestination,outboundDate:flight.outboundDate,returnOrigin:flight.returnOrigin,returnDestination:flight.returnDestination,returnDate:flight.returnDate},makkah:hotel(d.makkahHotel),madinah:hotel(d.madinahHotel),services:b.includedServices,details:safeDetails(b.manualDetails)});
}
export function sharePage() {
  const nonce=crypto.randomUUID().replaceAll('-','');
  const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>iumrah · Trip</title><style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#f5f5f5;color:#111;font:16px -apple-system,BlinkMacSystemFont,sans-serif}header{background:#000;color:white;padding:24px;text-align:center;font-size:32px;font-weight:800;letter-spacing:-2px}main{max-width:560px;margin:auto;padding:20px}section{background:#fff;border-radius:22px;padding:20px;margin:12px 0;white-space:pre-line}h1{font-size:28px}h2{font-size:18px;margin:0 0 10px}p{line-height:1.5;margin:0}</style><header>iumrah</header><main id="main"><h1>Моя поездка</h1><p id="state">Загрузка…</p></main><script nonce="${nonce}">const token=location.hash.slice(1),main=document.getElementById('main'),state=document.getElementById('state');const add=(title,value)=>{const section=document.createElement('section'),h=document.createElement('h2'),p=document.createElement('p');h.textContent=title;p.textContent=value;section.append(h,p);main.append(section)};fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(b=>{state.textContent='';const status={AVAILABILITY_CHECK:'Проверка наличия',PAYMENT_PENDING:'Ожидание оплаты',BOOKING_CONFIRMED:'Подтверждено',READY_TO_TRAVEL:'Готово к поездке',COMPLETED:'Завершено',IN_TRIP:'В поездке',CANCELLED:'Отменено'};add('Бронирование',(b.bookingNumber?'#'+String(b.bookingNumber).padStart(4,'0'):b.id)+' · '+(status[b.status]||b.status));add('Даты и предварительная стоимость',b.startDate+' — '+b.endDate+'\\n'+b.travelers+' чел. · $'+b.totalUsd);const f=b.flight;add('Авиабилеты',f.airline+'\\n'+f.outboundOrigin+' → '+f.outboundDestination+' · '+f.outboundDate+'\\n'+f.returnOrigin+' → '+f.returnDestination+' · '+f.returnDate);for(const [title,h] of [['Мекка',b.makkah],['Медина',b.madinah]])if(h)add(title,h.name+'\\n'+h.checkIn+' — '+h.checkOut);const d=b.details||{};for(const [t,ls] of [['Туда',d.outbound],['Обратно',d.inbound]])if(ls?.length)add(t,ls.map(l=>l.airline+' '+l.number+' · '+l.origin+' → '+l.destination+' · '+l.departure+' → '+l.arrival).join('\\n'));for(const [t,h] of [['Номер в Мекке',d.makkah],['Номер в Медине',d.madinah]])if(h)add(t,h.room+' · '+h.rooms+' · '+h.meals);if(d.vehicle)add('Трансфер',d.vehicle+' · '+d.pickup);add('Важно','Наличие и окончательная стоимость подтверждаются менеджером.');}).catch(()=>state.textContent='Ссылка недоступна. Обратитесь в iumrah.');</script></html>`;
  return new Response(html,{headers:{...headers,'content-type':'text/html; charset=utf-8','content-security-policy':`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`}});
}

export async function manualBookingInfo(request,{params}) {
  const staff=await authorize(request);if(!staff)return json({error:'FORBIDDEN'},403);
  const {id}=await params;const db=getBookingDb();if(!db)return json({error:'UNAVAILABLE'},503);await schema(db);
  const row=await db.prepare('SELECT m.cost_json,m.email_status FROM business_manual_bookings m JOIN bookings b ON b.id=m.booking_id WHERE m.booking_id=?').bind(id).first();
  if(!row)return json({manual:false});
  const data=JSON.parse(row.cost_json);return json({manual:true,cost:data.cost,emailStatus:row.email_status});
}
export async function rotateManualShare(request,{params}) {
  const staff=await authorize(request);if(!staff)return json({error:'FORBIDDEN'},403);
  const {id}=await params;const db=getBookingDb();if(!db)return json({error:'UNAVAILABLE'},503);await schema(db);
  const token=await hashBookingToken(crypto.randomUUID()+crypto.randomUUID());
  const result=await db.prepare('UPDATE business_manual_bookings SET share_hash=? WHERE booking_id=? AND EXISTS (SELECT 1 FROM bookings WHERE id=?)').bind(await hashBookingToken(token),id,id).run();
  if(Number(result.meta?.changes??0)!==1)return json({error:'MANUAL_BOOKING_NOT_FOUND'},404);
  return json({shareURL:`${origin}/api/bookings/share#${token}`});
}
