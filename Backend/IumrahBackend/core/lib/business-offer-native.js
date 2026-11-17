import { requestEnv, NextResponse, backendFetch } from '../runtime.js';
import { hashBookingToken } from './booking-store.js';
import { dbReady, lookup, readOffer, convert } from './business-offers.js';
import { offerPage } from './business-offer-page.js';
const origin='https://iumrah-backend.helloiumrah.workers.dev';
const headers={'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'};
const json=(v,status=200)=>NextResponse.json(v,{status,headers});
const secret=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
export async function readNativeOffer(request,{params}){
 const {token}=await params;
 const read=await readOffer(new Request(request.url,{method:'POST',body:JSON.stringify({token,track:!new URL(request.url).searchParams.has('preview')})}));
 if(!read.ok)return read;
 const db=await dbReady(),r=await lookup(db,token);if(!r||r.state==='revoked')return json({error:'NOT_FOUND'},404);
 const p=JSON.parse(r.snapshot_json),i=p.input,t=i.travelers;
 // Only display fields; never send supplier pricing, personal information or editor draft.
 return json({packageID:r.id,revision:r.revision,expiresAt:r.expires_at,status:r.state==='converted'?'accepted':r.expires_at<=new Date().toISOString()?'expired':'available',lang:r.lang,package:{totalUsd:p.totalUsd,perPilgrimUsd:p.perPilgrimUsd,input:{from:i.from,originCode:i.originCode||p.route.originCode,arrivalAirportCode:i.arrivalAirportCode||p.route.outboundDestination,startDate:i.startDate,endDate:i.endDate,includeMadinah:i.includeMadinah,travelers:{adults:t.adults,children:t.children,infants:t.infants,rooms:t.rooms}},hotelNames:p.hotelNames,flight:p.flight,includedServices:p.includedServices}});
}
export async function acceptNativeOffer(request,{params}){
 const {token}=await params,raw=await request.json().catch(()=>null),env=requestEnv();
 if(!secret(raw?.requestSecret)||!secret(raw?.verificationToken)||!['sms','email'].includes(raw?.channel))return json({error:'VERIFIED_CONTACT_REQUIRED'},400);
 const db=await dbReady();if(!db||!env.HOTELS_DB)return json({error:'UNAVAILABLE'},503);
 const row=await lookup(db,token);if(!row||row.state==='revoked')return json({error:'NOT_FOUND'},404);
 const firstName=String(raw.firstName||'').trim().slice(0,120),lastName=String(raw.lastName||'').trim().slice(0,120);
 if(firstName.length<2||lastName.length<2)return json({error:'INVALID_NAME'},400);
 const native={channel:raw.channel,requestHash:await hashBookingToken('native-offer:'+row.id+':'+raw.requestSecret),proofHash:await hashBookingToken(raw.verificationToken),accessToken:await hashBookingToken('native-booking:'+row.id+':'+raw.requestSecret)};
 let response;
 if(row.state==='converted')response=await convert(db,row,{},'',false,raw.revision,'client','native-offer',native);
 else{
  if(raw.revision!==row.revision)return json({error:'OFFER_CHANGED'},409);
  if(row.expires_at<=new Date().toISOString())return json({error:'OFFER_EXPIRED'},409);
  const channel=raw.channel==='sms'?'phone':'email';
  const proof=await env.HOTELS_DB.prepare(`SELECT ${channel} AS contact,proof_expires_at,consumed_at,booking_id FROM iumrah_guest_booking_${channel}_challenges WHERE verification_token_hash=? LIMIT 1`).bind(native.proofHash).first();
  if(!proof||!Number.isFinite(Date.parse(proof.proof_expires_at))||Date.parse(proof.proof_expires_at)<=Date.now()||proof.consumed_at)return json({error:'PROOF_EXPIRED_OR_INVALID'},400);
  response=await convert(db,row,{firstName,lastName,phone:channel==='phone'?proof.contact:''},channel==='email'?proof.contact:'',false,raw.revision,'client','native-offer',native);
 }
 if(response.ok){const result=await response.clone().json();try{await backendFetch(`${origin}/api/package/booking/${result.booking.id}/verified-${raw.channel==='sms'?'phone':'email'}`,{method:'POST',headers:{'content-type':'application/json','x-booking-token':native.accessToken},body:JSON.stringify({verificationToken:raw.verificationToken,locale:row.lang})});}catch{}}
 return response;
}
export function nativeOfferPage(request){return offerPage(request);}
