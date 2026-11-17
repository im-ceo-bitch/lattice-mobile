import { requestEnv, NextResponse, ORIGIN } from '../runtime.js';
import { getBookingDb, hashBookingToken, makeBookingId, cents } from './booking-store.js';
import { schema as manualSchema, authorize, manualTotals, safeDetails, sendEmail, publicBooking } from './business-manual-booking.js';
import { parsePayload } from '../app/api/bookings/route.js';
import { offerPage } from './business-offer-page.js';
export { offerPage };
const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const json=(v,status=200)=>NextResponse.json(v,{status,headers});
const secret=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const str=(v,n=180)=>typeof v==='string'?v.trim().slice(0,n):'';
const now=()=>new Date().toISOString();
const link=token=>`${ORIGIN}/api/offers#${token}`;
const lang=v=>['ru','uz','uz-cyrl','en'].includes(v)?v:'ru';
async function body(request){
  if(Number(request.headers.get('content-length')||0)>160000||!request.body)return null;
  const reader=request.body.getReader(),decoder=new TextDecoder();let text='',bytes=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>160000){await reader.cancel();return null;}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();return JSON.parse(text);}catch{return null;}
}
export async function offerSchema(db){
  await manualSchema(db);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS business_offers (id TEXT PRIMARY KEY, request_hash TEXT NOT NULL UNIQUE, token TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL UNIQUE, staff_login TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'offer', last_edit_hash TEXT, state TEXT NOT NULL DEFAULT 'active', revision INTEGER NOT NULL DEFAULT 1, snapshot_json TEXT NOT NULL, cost_json TEXT NOT NULL, draft_json TEXT NOT NULL, lang TEXT NOT NULL, total_cents INTEGER NOT NULL, travelers INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL, sent_at TEXT, first_viewed_at TEXT, views INTEGER NOT NULL DEFAULT 0, booking_id TEXT UNIQUE, converted_at TEXT, email_status TEXT NOT NULL DEFAULT 'not_requested')`),
    db.prepare(`CREATE TABLE IF NOT EXISTS business_offer_native_acceptances (offer_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, proof_hash TEXT NOT NULL UNIQUE, FOREIGN KEY(offer_id) REFERENCES business_offers(id))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_business_offers_created ON business_offers(created_at DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS business_offer_events (id INTEGER PRIMARY KEY AUTOINCREMENT, offer_id TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(offer_id) REFERENCES business_offers(id) ON DELETE CASCADE)`)
  ]);
}
export async function dbReady(){const db=getBookingDb();if(db)await offerSchema(db);return db}
export function validateOffer(raw){
  if(!raw||!raw.booking||raw.booking.travelerDetails!==undefined)return null;
  const b=parsePayload({...raw.booking,pilgrimProfile:undefined,generatorTrace:undefined});
  if(!b||!b.selection||!b.selectionDetails?.flight||!b.selectionDetails?.makkahHotel)return null;
  const t=b.input.travelers,count=t.adults+t.children+t.infants,total=manualTotals(raw.cost,count);
  if(!total||b.input.includeMadinah!==Boolean(b.selectionDetails.madinahHotel)||(!b.input.includeMadinah&&raw.cost.madinah!==0)||(b.input.includeMadinah&&raw.cost.madinah<=0))return null;
  const f=b.selectionDetails.flight, today=now().slice(0,10);
  const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
  if(![b.input.startDate,b.input.endDate,f.outboundDate,f.returnDate].every(date))return null;
  if(b.input.startDate<today||f.outboundDate<today||!/^\d{4}-\d{2}-\d{2}$/.test(f.outboundDate)||!Number.isFinite(Date.parse(f.outboundDepartureTime))||Date.parse(f.outboundDepartureTime)<=Date.now()||f.returnDate!==b.input.endDate||f.outboundOrigin!==b.route.originCode||f.returnDestination!==b.route.originCode||f.outboundDestination!==b.route.outboundDestination||f.returnOrigin!==b.route.returnOrigin)return null;
  const hours=Number(raw.hours);if(![24,48,168].includes(hours))return null;
  // parsePayload preserves raw input, so whitelist it and never persist arbitrary extras.
  const i=b.input;b.input={from:i.from,originCode:i.originCode||b.route.originCode,arrivalAirportCode:i.arrivalAirportCode||b.route.outboundDestination,startDate:i.startDate,endDate:i.endDate,flexibleDays:i.flexibleDays,hotelPreference:i.hotelPreference,includeMadinah:i.includeMadinah,travelers:{adults:t.adults,children:t.children,infants:t.infants,rooms:t.rooms}};
  // Strip quote/evidence amounts; only the actual selling price is client-visible.
  delete b.pilgrimProfile;delete b.travelerDetails;delete b.generatorTrace;
  const cost=Object.fromEntries(['flight','makkah','madinah','transfer','ziyarat','visa','guide','other','commission','discount'].map(k=>[k,k==='discount'?(raw.cost[k]??0):raw.cost[k]]));
  const draft=typeof raw.editorDraft==='string'&&raw.editorDraft.length<=80000?raw.editorDraft:'';
  const expiresAt=new Date(Math.min(Date.now()+hours*3600000,Date.parse(f.outboundDepartureTime))).toISOString();
  return {snapshot:{...b,...total,manualDetails:safeDetails(raw.manualDetails)},cost,draft,lang:lang(raw.lang),count,expiresAt};
}
export function offerState(row,at=now()){return row.state==='converted'?'converted':row.state==='revoked'?'revoked':row.expires_at<=at?'expired':row.first_viewed_at?'viewed':row.sent_at?'sent':'created'}
function staffRow(row){const b=JSON.parse(row.snapshot_json);return {id:row.id,revision:row.revision,status:offerState(row),totalUsd:row.total_cents/100,travelers:row.travelers,startDate:b.input.startDate,endDate:b.input.endDate,makkah:b.hotelNames.makkah,lang:row.lang,createdAt:row.created_at,expiresAt:row.expires_at,views:row.views,sentAt:row.sent_at,firstViewedAt:row.first_viewed_at,bookingID:row.booking_id,convertedAt:row.converted_at,shareURL:link(row.token)};}
async function push(title,message,data){try{await requestEnv().IUMRAH_OFFER_PUSH?.(title,message,data)}catch{console.warn('OFFER_PUSH_FAILED')}}
export async function lookup(db,token){return secret(token)?db.prepare('SELECT * FROM business_offers WHERE token_hash=?').bind(await hashBookingToken(token)).first():null}
export const find=(db,id)=>db.prepare('SELECT * FROM business_offers WHERE id=?').bind(id).first();
export async function listOffers(request){if(!await authorize(request))return json({error:'FORBIDDEN'},403);const db=await dbReady();if(!db)return json({error:'UNAVAILABLE'},503);const result=await db.prepare("SELECT * FROM business_offers WHERE source='offer' ORDER BY created_at DESC LIMIT 250").all();return json({offers:(result.results||[]).map(staffRow)});}
export async function createOffer(request){
  const staff=await authorize(request);if(!staff)return json({error:'FORBIDDEN'},403);const raw=await body(request);if(!secret(raw?.requestSecret))return json({error:'INVALID_REQUEST'},400);const db=await dbReady();if(!db)return json({error:'UNAVAILABLE'},503);
  if(raw.mode==='booking'&&!validContact(raw.booking?.pilgrimProfile,raw.email,raw.sendEmail===true))return json({error:'INVALID_CONTACT'},400);
  const hash=await hashBookingToken('offer:'+staff.sub+':'+raw.requestSecret);let row=await db.prepare('SELECT * FROM business_offers WHERE request_hash=?').bind(hash).first();
  if(!row){const v=validateOffer(raw);if(!v)return json({error:'INVALID_OFFER'},400);const id='PKG-'+crypto.randomUUID().toUpperCase(),token=await hashBookingToken(crypto.randomUUID()+crypto.randomUUID()),at=now();
    try{await db.batch([db.prepare('INSERT INTO business_offers (id,request_hash,token,token_hash,staff_login,source,snapshot_json,cost_json,draft_json,lang,total_cents,travelers,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,hash,token,await hashBookingToken(token),staff.sub,raw.mode==='booking'?'direct':'offer',JSON.stringify(v.snapshot),JSON.stringify(v.cost),v.draft,v.lang,cents(v.snapshot.totalUsd),v.count,at,at,v.expiresAt),db.prepare("INSERT INTO business_offer_events (offer_id,kind,created_at) VALUES (?,'created',?)").bind(id,at)]);}catch(e){row=await db.prepare('SELECT * FROM business_offers WHERE request_hash=?').bind(hash).first();if(!row)throw e;}row=row||await find(db,id);
  }
  if((raw.mode==='booking')!==(row.source==='direct'))return json({error:'INVALID_REQUEST'},409);
  if(raw.mode==='booking')return convert(db,row,raw.booking?.pilgrimProfile,raw.email,raw.sendEmail===true,row.revision,'staff',staff.sub);
  return json(staffRow(row),201);
}
export async function offerDetail(request,{params}){if(!await authorize(request))return json({error:'FORBIDDEN'},403);const db=await dbReady();if(!db)return json({error:'UNAVAILABLE'},503);const row=await find(db,(await params).id);if(!row)return json({error:'NOT_FOUND'},404);const result=await db.prepare('SELECT kind,created_at AS createdAt FROM business_offer_events WHERE offer_id=? ORDER BY id DESC LIMIT 100').bind(row.id).all();return json({...staffRow(row),editorDraft:row.draft_json,events:result.results||[]});}
export async function updateOffer(request,{params}){
  if(!await authorize(request))return json({error:'FORBIDDEN'},403);const db=await dbReady();if(!db)return json({error:'UNAVAILABLE'},503);const id=(await params).id,raw=await body(request),row=await find(db,id);if(!row)return json({error:'NOT_FOUND'},404);const editHash=raw?.action==='edit'&&secret(raw.requestSecret)?await hashBookingToken('edit:'+raw.requestSecret):null;
  if(editHash&&row.last_edit_hash===editHash&&row.revision===raw.revision+1)return json(staffRow(row));
  if(row.state!=='active'||raw?.revision!==row.revision)return json({error:'OFFER_CHANGED'},409);
  const at=now();let stmt,kind;let eventGuard="id=? AND revision=? AND state='active'",eventArgs=[id,row.revision];
  if(raw.action==='sent'){if(row.sent_at)return json(staffRow(row));stmt=db.prepare("UPDATE business_offers SET sent_at=COALESCE(sent_at,?),updated_at=? WHERE id=? AND revision=? AND state='active' AND sent_at IS NULL AND expires_at>?").bind(at,at,id,row.revision,at);kind='sent';eventGuard+=" AND sent_at IS NULL AND expires_at>?";eventArgs.push(at);}
  else if(raw.action==='revoke'){stmt=db.prepare("UPDATE business_offers SET state='revoked',updated_at=?,revision=revision+1 WHERE id=? AND revision=? AND state='active'").bind(at,id,row.revision);kind='revoked';}
  else if(raw.action==='edit'){const v=validateOffer(raw);if(!v||!editHash)return json({error:'INVALID_OFFER'},400);stmt=db.prepare("UPDATE business_offers SET snapshot_json=?,cost_json=?,draft_json=?,lang=?,total_cents=?,travelers=?,expires_at=?,updated_at=?,last_edit_hash=?,revision=revision+1 WHERE id=? AND revision=? AND state='active'").bind(JSON.stringify(v.snapshot),JSON.stringify(v.cost),v.draft,v.lang,cents(v.snapshot.totalUsd),v.count,v.expiresAt,at,editHash,id,row.revision);kind='edited';}
  else return json({error:'INVALID_REQUEST'},400);
  const results=await db.batch([db.prepare(`INSERT INTO business_offer_events (offer_id,kind,created_at) SELECT id,?,? FROM business_offers WHERE ${eventGuard}`).bind(kind,at,...eventArgs),stmt]);if(results[1].meta?.changes!==1)return json({error:'OFFER_CHANGED'},409);return json(staffRow(await find(db,id)));
}
function publicSnapshot(row){const b=JSON.parse(row.snapshot_json),d=b.selectionDetails,f=d.flight;const hotel=h=>h?{name:h.name,stars:h.stars,checkIn:h.checkIn,checkOut:h.checkOut}:null;return {packageID:row.id,revision:row.revision,status:offerState(row),lang:row.lang,expiresAt:row.expires_at,totalUsd:b.totalUsd,perPilgrimUsd:b.perPilgrimUsd,travelers:row.travelers,startDate:b.input.startDate,endDate:b.input.endDate,flight:{airline:f.airline,outboundOrigin:f.outboundOrigin,outboundDestination:f.outboundDestination,outboundDate:f.outboundDate,returnOrigin:f.returnOrigin,returnDestination:f.returnDestination,returnDate:f.returnDate},makkah:hotel(d.makkahHotel),madinah:hotel(d.madinahHotel),services:b.includedServices,details:safeDetails(b.manualDetails)};}
export async function readOffer(request){const raw=await body(request),db=await dbReady();if(!db)return json({error:'UNAVAILABLE'},503);let row=await lookup(db,raw?.token);if(!row||row.state==='revoked')return json({error:'NOT_FOUND'},404);
  if(row.state==='converted'){const b=await db.prepare('SELECT id,status,lang,payload_json FROM bookings WHERE id=?').bind(row.booking_id).first();return b?json({...await publicBooking(b),packageID:row.id,converted:true}):json({error:'NOT_FOUND'},404);}
  if(row.expires_at<=now())return json({...publicSnapshot(row),status:'expired'});
  // Count each explicit open, not email previews (fragment is absent from HTTP requests).
  if(raw.track===true&&row.source==='offer'){const at=now();const first=await db.batch([db.prepare("INSERT INTO business_offer_events (offer_id,kind,created_at) SELECT id,'first_viewed',? FROM business_offers WHERE id=? AND state='active' AND first_viewed_at IS NULL AND expires_at>?").bind(at,row.id,at),db.prepare("UPDATE business_offers SET first_viewed_at=?,views=views+1 WHERE id=? AND state='active' AND first_viewed_at IS NULL AND expires_at>?").bind(at,row.id,at)]);if(first[1].meta?.changes===1){await push('Предложение просмотрено',`Пакет ${row.id.slice(-8)}`,{type:'offer_viewed',offerID:row.id});}else await db.prepare("UPDATE business_offers SET views=views+1 WHERE id=? AND state='active' AND expires_at>?").bind(row.id,at).run();row=await find(db,row.id);if(row.state==='converted')return readOffer(new Request(request.url,{method:'POST',body:JSON.stringify({token:raw.token})}));if(row.state==='revoked')return json({error:'NOT_FOUND'},404);}
  return json(publicSnapshot(row));}
export async function acceptOffer(request){const raw=await body(request),db=await dbReady();if(!db)return json({error:'UNAVAILABLE'},503);const row=await lookup(db,raw?.token);if(!row||row.state==='revoked')return json({error:'NOT_FOUND'},404);return convert(db,row,raw?.contact,raw?.email,Boolean(raw?.email),raw?.revision,'client','offer-link');}
export async function staffAcceptOffer(request,{params}){const staff=await authorize(request);if(!staff)return json({error:'FORBIDDEN'},403);const db=await dbReady();if(!db)return json({error:'UNAVAILABLE'},503);const row=await find(db,(await params).id),raw=await body(request);if(!row)return json({error:'NOT_FOUND'},404);return convert(db,row,raw?.contact,raw?.email,Boolean(raw?.sendEmail),raw?.revision,'staff',staff.sub);}
function validContact(contact,email,send){return Boolean(str(contact?.firstName,120)&&str(contact?.lastName,120)&&/^\+[1-9]\d{7,14}$/.test(str(contact?.phone,60))&&(!send||/^\S+@\S+\.\S+$/.test(str(email))));}
export async function convert(db,row,contact,email,send,revision,actor,actorID,native=null){
  if(row.state==='converted')return native?nativeReceipt(db,row,native,false):receipt(db,row,false,actor==='staff');
  if(row.state!=='active'||row.expires_at<=now())return json({error:'OFFER_EXPIRED'},409);
  if(revision!==row.revision)return json({error:'OFFER_CHANGED'},409);
  const profile={firstName:str(contact?.firstName,120),lastName:str(contact?.lastName,120),phone:str(contact?.phone,60),telegram:'',whatsapp:''};email=str(email);if(/^\S+@\S+\.\S+$/.test(email))profile.email=email;
  if(!profile.firstName||!profile.lastName||((!native||native.channel==='sms')&&!/^\+[1-9]\d{7,14}$/.test(profile.phone))||(send&&!/^\S+@\S+\.\S+$/.test(email)))return json({error:'INVALID_CONTACT'},400);
  const b=JSON.parse(row.snapshot_json),at=now(),id=makeBookingId(b.input.startDate.slice(0,4)),status='AVAILABILITY_CHECK';
  const booking={...b,pilgrimProfile:profile,offerPackageID:row.id,id,status,createdAt:at,updatedAt:at};
  const accessToken=native?native.accessToken:await hashBookingToken(crypto.randomUUID()+crypto.randomUUID()),requestHash=await hashBookingToken('offer-conversion:'+row.id),shareHash=await hashBookingToken(await hashBookingToken('manual-offer-share:'+row.token));
  // Every statement is conditional on the winning row. D1 batch is transactional.
  const guard="id=? AND revision=? AND state='active' AND expires_at>?";
  let results;try{results=await db.batch([
    db.prepare(`UPDATE business_offers SET state='converted',booking_id=?,converted_at=?,updated_at=?,email_status=? WHERE ${guard}`).bind(id,at,at,send?'pending':'not_requested',row.id,revision,at),
    ...(native?[db.prepare(`INSERT INTO business_offer_native_acceptances (offer_id,request_hash,proof_hash) SELECT id,?,? FROM business_offers WHERE id=? AND booking_id=?`).bind(native.requestHash,native.proofHash,row.id,id)]:[]),
    db.prepare(`INSERT INTO bookings (id,access_token_hash,status,created_at,updated_at,lang,plan_id,total_cents,per_pilgrim_cents,traveler_count,rooms,origin_code,outbound_destination,return_origin,start_date,end_date,flight_name,makkah_hotel,madinah_hotel,payload_json) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM business_offers WHERE id=? AND booking_id=?`).bind(id,await hashBookingToken(accessToken),status,at,at,row.lang,b.planId,cents(b.totalUsd),cents(b.perPilgrimUsd),row.travelers,b.input.travelers.rooms,b.route.originCode,b.route.outboundDestination,b.route.returnOrigin,b.input.startDate,b.input.endDate,b.flight,b.hotelNames.makkah,b.hotelNames.madinah,JSON.stringify(booking),row.id,id),
    db.prepare(`INSERT INTO booking_events (booking_id,status,actor_type,actor_id,note,created_at) SELECT ?,?,?,?,?,? FROM business_offers WHERE id=? AND booking_id=?`).bind(id,status,actor,actorID,'Offer converted; availability not confirmed.',at,row.id,id),
    db.prepare(`INSERT INTO business_manual_bookings (request_hash,booking_id,share_hash,staff_login,cost_json,email_status,created_at) SELECT ?,?,?,?,?,?,? FROM business_offers WHERE id=? AND booking_id=?`).bind(requestHash,id,shareHash,row.staff_login,JSON.stringify({cost:JSON.parse(row.cost_json),email,lang:row.lang}),send?'pending':'not_requested',at,row.id,id),
    db.prepare(`INSERT INTO business_offer_events (offer_id,kind,created_at) SELECT id,'converted',? FROM business_offers WHERE id=? AND booking_id=?`).bind(at,row.id,id)
  ]);}catch(e){if(!native)throw e;const winner=await find(db,row.id);if(winner?.state==='converted')return nativeReceipt(db,winner,native,false);return json({error:'OFFER_ALREADY_ACCEPTED_OR_PROOF_USED'},409);}
  const current=await find(db,row.id);if(current.state!=='converted')return json({error:'OFFER_CHANGED'},409);
  return native?nativeReceipt(db,current,native,results[0].meta?.changes===1):receipt(db,current,results[0].meta?.changes===1,actor==='staff');
}
async function receipt(db,row,won,staff){
  const b=await db.prepare('SELECT payload_json,status FROM bookings WHERE id=?').bind(row.booking_id).first();if(!b)return json({error:'NOT_FOUND'},404);
  const booking={...JSON.parse(b.payload_json),status:b.status},env=requestEnv();let trip=null;
  try{if(won||staff)trip=await env.IUMRAH_MATERIALIZE_BOOKING_IDENTITY?.(booking)}catch{console.warn('OFFER_IDENTITY_PENDING')}
  if(won)await push('Новое бронирование',row.source==='direct'?'Менеджер создал бронирование':'Предложение принято',{type:'booking_created',bookingID:booking.id,offerID:row.id});
  let emailStatus=row.email_status;
  if(['pending','failed','not_configured'].includes(emailStatus)&&(won||staff)){const m=await db.prepare('SELECT cost_json FROM business_manual_bookings WHERE booking_id=?').bind(booking.id).first();if(m){const data=JSON.parse(m.cost_json);emailStatus=await sendEmail(env,data.email,data.lang,link(row.token),booking.id);await db.batch([db.prepare('UPDATE business_offers SET email_status=? WHERE id=?').bind(emailStatus,row.id),db.prepare('UPDATE business_manual_bookings SET email_status=? WHERE booking_id=?').bind(emailStatus,booking.id)]).catch(()=>{});}}
  const result={bookingID:booking.id,bookingNumber:trip?.bookingNumber??null,identityReady:Boolean(trip?.bookingNumber&&trip?.pilgrimID),shareURL:link(row.token),emailStatus,totalUsd:booking.totalUsd,packageID:row.id};
  // The bearer link is shareable; pilgrim identifiers stay staff-only.
  if(staff)result.pilgrimID=trip?.pilgrimID?String(trip.pilgrimID):null;
  return json(result,201);
}

async function nativeReceipt(db,row,native,won){
  const claim=await db.prepare('SELECT request_hash,proof_hash FROM business_offer_native_acceptances WHERE offer_id=?').bind(row.id).first();
  if(!claim||claim.request_hash!==native.requestHash||claim.proof_hash!==native.proofHash)return json({error:'OFFER_ALREADY_ACCEPTED'},409);
  const response=await receipt(db,row,won,false);
  if(!response.ok)return response;
  const r=await db.prepare('SELECT payload_json,status FROM bookings WHERE id=?').bind(row.booking_id).first();
  if(!r)return json({error:'NOT_FOUND'},404);
  const booking={...JSON.parse(r.payload_json),status:r.status},env=requestEnv();let trip=null;
  try{trip=await env.IUMRAH_MATERIALIZE_BOOKING_IDENTITY?.(booking)}catch{}
  return json({booking,accessToken:native.accessToken,trip,identityReady:!!trip?.bookingNumber},trip?.bookingNumber?201:202);
}
