// A saved client quote is a distinct source in the existing offers table.
// No booking, payment, PII, booking grant or supplier purchase is created.
import { requestEnv, NextResponse } from '../runtime.js';
import { dbReady, find } from './business-offers.js';
import { hashBookingToken } from './booking-store.js';
import { parsePayload } from '../app/api/bookings/route.js';
const json=(v,status=200)=>NextResponse.json(v,{status,headers:{'cache-control':'no-store','referrer-policy':'no-referrer'}});
const secret=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const validID=s=>typeof s==='string'&&/^PKG-[A-F0-9-]{36}$/.test(s);
const ownerHash=s=>hashBookingToken('client-saved-package:v1:'+s);
async function schema(db){await db.prepare(`CREATE TABLE IF NOT EXISTS client_saved_package_versions(package_id TEXT NOT NULL,revision INTEGER NOT NULL,snapshot_json TEXT NOT NULL,report_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(package_id,revision),FOREIGN KEY(package_id) REFERENCES business_offers(id))`).run();}
async function body(request){if(Number(request.headers.get('content-length')||0)>160000||!request.body)return null;const reader=request.body.getReader();let size=0,parts=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>160000){await reader.cancel();return null;}parts.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}return JSON.parse(new TextDecoder().decode(bytes));}catch{return null;}}
function publicRow(row){const b=JSON.parse(row.snapshot_json);return {packageID:row.id,revision:row.revision,status:row.state==='converted'?'converted':row.expires_at<=new Date().toISOString()?'expired':'saved',shareURL:`https://iumrah-backend.helloiumrah.workers.dev/offer/saved/${row.token}/${row.revision}`,expiresAt:row.expires_at,createdAt:row.created_at,updatedAt:row.updated_at,package:b};}
async function validate(raw){
 const booking=parsePayload(raw?.booking);if(!booking||!booking.selectionDetails?.flight||!booking.selectionDetails?.makkahHotel)return null;
 if(raw.booking?.travelerDetails!=null||raw.booking?.pilgrimProfile!=null)return null;
 const verify=requestEnv().IUMRAH_VERIFY_SAVED_PACKAGE_QUOTE;if(typeof verify!=='function')throw new Error('UNAVAILABLE');
 const {verified,report}=await verify(booking,raw.quoteProof);const t=booking.input.travelers;
 const i=booking.input;
 // Public snapshot is explicitly whitelisted. No opaque proof or confidential trace.
 const input={from:i.from,originCode:i.originCode||booking.route.originCode,arrivalAirportCode:i.arrivalAirportCode||booking.route.outboundDestination,startDate:i.startDate,endDate:i.endDate,flexibleDays:i.flexibleDays,hotelPreference:i.hotelPreference,includeMadinah:i.includeMadinah,travelers:{adults:t.adults,children:t.children,infants:t.infants,rooms:t.rooms}};
 const trace=booking.generatorTrace||{};const bookingScope={makkahRoom:trace.makkahHotel?.roomId??null,madinahRoom:trace.madinahHotel?.roomId??null,rooms:(trace.nuiteeRooms||[]).map(r=>({id:r.id,hotelId:r.hotelId,roomId:r.roomId,adults:r.adults,children:r.children,checkin:r.checkin,checkout:r.checkout})).sort((a,b)=>String(a.id).localeCompare(String(b.id)))};
 const snapshot={bookingScope,planId:booking.planId,totalUsd:verified.totalUsd,perPilgrimUsd:verified.perPilgrimUsd,input,route:booking.route,stay:booking.stay,selection:booking.selection,selectionDetails:booking.selectionDetails,customization:booking.customization,includedServices:booking.includedServices,hotelNames:booking.hotelNames,flight:booking.flight,tripSummary:report.client};
 const at=new Date().toISOString(),departure=Date.parse(booking.selectionDetails.flight.outboundDepartureTime||i.startDate);
 if(!Number.isFinite(departure)||departure<=Date.now())return null;
 return {snapshot,report,at,expiresAt:new Date(Math.min(Date.now()+86400000,departure)).toISOString(),count:t.adults+t.children+t.infants,lang:['ru','uz','uz-cyrl','en','tr'].includes(raw.lang)?raw.lang:'ru'};
}
const fail=e=>json({error:typeof e?.message==='string'&&/^(BOOKING_QUOTE_[A-Z_]+|QUOTE_EXPIRED|QUOTE_PROOF_REQUIRED|INVALID_QUOTE_PROOF|SANDBOX_QUOTE_NOT_BOOKABLE)$/.test(e.message)?e.message:'PACKAGE_SAVE_UNAVAILABLE'},e?.message==='UNAVAILABLE'?503:409);
async function ownerRow(db,id,token){if(!validID(id)||!secret(token))return null;return db.prepare("SELECT * FROM business_offers WHERE id=? AND request_hash=? AND source='client' AND state IN ('active','converted')").bind(id,await ownerHash(token)).first();}
export async function saveClientPackage(request){
 const token=request.headers.get('x-package-owner');if(!secret(token))return json({error:'OWNER_TOKEN_REQUIRED'},400);
 const db=await dbReady();if(!db)return json({error:'UNAVAILABLE'},503);await schema(db);const hash=await ownerHash(token);
 const existing=await db.prepare("SELECT * FROM business_offers WHERE request_hash=? AND source='client'").bind(hash).first();if(existing)return json(publicRow(existing));
 let v;try{v=await validate(await body(request));}catch(e){return fail(e);}if(!v)return json({error:'INVALID_PACKAGE'},400);
 const id='PKG-'+crypto.randomUUID().toUpperCase(),shareToken=await hashBookingToken(crypto.randomUUID()+crypto.randomUUID()),snapshot=JSON.stringify(v.snapshot),cost=JSON.stringify({tripSummaryReport:v.report});
 try{await db.batch([
 db.prepare('INSERT INTO business_offers (id,request_hash,token,token_hash,staff_login,source,snapshot_json,cost_json,draft_json,lang,total_cents,travelers,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,hash,shareToken,await hashBookingToken(shareToken),'client','client',snapshot,cost,'',v.lang,Math.round(v.snapshot.totalUsd*100),v.count,v.at,v.at,v.expiresAt),
 db.prepare('INSERT INTO client_saved_package_versions(package_id,revision,snapshot_json,report_json,created_at) VALUES (?,1,?,?,?)').bind(id,snapshot,cost,v.at),
 db.prepare("INSERT INTO business_offer_events(offer_id,kind,created_at) VALUES (?,'client_saved',?)").bind(id,v.at)
 ]);}catch(e){const prior=await db.prepare("SELECT * FROM business_offers WHERE request_hash=? AND source='client'").bind(hash).first();if(prior)return json(publicRow(prior));throw e;}
 return json(publicRow(await find(db,id)),201);
}
export async function readClientPackage(request,{params}){const db=await dbReady();if(!db)return json({error:'UNAVAILABLE'},503);const row=await ownerRow(db,(await params).id,request.headers.get('x-package-owner'));return row?json(publicRow(row)):json({error:'NOT_FOUND'},404);}
export async function reviseClientPackage(request,{params}){
 const db=await dbReady();if(!db)return json({error:'UNAVAILABLE'},503);await schema(db);const row=await ownerRow(db,(await params).id,request.headers.get('x-package-owner'));if(!row)return json({error:'NOT_FOUND'},404);if(row.state!=='active')return json({error:'PACKAGE_CLOSED'},409);
 const raw=await body(request);if(raw?.revision!==row.revision)return json({error:'PACKAGE_CHANGED'},409);let v;try{v=await validate(raw);}catch(e){return fail(e);}if(!v)return json({error:'INVALID_PACKAGE'},400);
 const snapshot=JSON.stringify(v.snapshot),cost=JSON.stringify({tripSummaryReport:v.report});if(snapshot===row.snapshot_json&&cost===row.cost_json)return json(publicRow(row));
 const results=await db.batch([
 db.prepare("INSERT INTO client_saved_package_versions(package_id,revision,snapshot_json,report_json,created_at) SELECT id,revision+1,?,?,? FROM business_offers WHERE id=? AND revision=? AND source='client' AND state='active'").bind(snapshot,cost,v.at,row.id,row.revision),
 db.prepare("INSERT INTO business_offer_events(offer_id,kind,created_at) SELECT id,'client_updated',? FROM business_offers WHERE id=? AND revision=? AND source='client' AND state='active'").bind(v.at,row.id,row.revision),
 db.prepare("UPDATE business_offers SET snapshot_json=?,cost_json=?,lang=?,total_cents=?,travelers=?,expires_at=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=? AND source='client' AND state='active'").bind(snapshot,cost,v.lang,Math.round(v.snapshot.totalUsd*100),v.count,v.expiresAt,v.at,row.id,row.revision)
 ]);if(results[2].meta?.changes!==1)return json({error:'PACKAGE_CHANGED'},409);return json(publicRow(await find(db,row.id)));
}
