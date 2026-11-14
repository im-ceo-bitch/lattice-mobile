import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePackageQuote} from '../.runtime-dist/pricing.js';
import {sealPricingSnapshot} from '../.runtime-dist/quote-audit.js';
import {verifyBookingQuote} from '../.runtime-dist/booking-gateway.js';
const env={PACKAGE_QUOTE_SEAL_KEY:Buffer.alloc(32,19).toString('base64url')};
const departure='2027-02-01',arrival='2027-02-08';
async function fixture(){
 const hotel={hotelId:'h1',roomId:'r1',amountUsd:100,unit:'perRoomNight',nights:7,pricingMode:'fixture'};
 const fare={candidateId:'f1',amount:300,currency:'USD',fareScope:'totalParty',providerId:'test',observedAt:new Date().toISOString(),travelDate:departure,normalizedGroupUsd:300};
 const travelers={adults:1,children:0,infants:0,rooms:1};
 const quote=calculatePackageQuote({tier:'standard',tripType:'roundTrip',includeMadinah:false,travelers,meals:{makkahLunch:false,makkahDinner:false,madinahDinner:false},transferVehicle:'carnival',includeHaramainTrain:false,haramainFareClass:'economy',haramainTicketCount:0,journeyFare:fare,makkahHotel:hotel,madinahHotel:null});
 const outbound={origin:'TAS',destination:'JED',departureAt:departure+'T09:00:00+05:00',arrivalAt:departure+'T12:00:00+03:00'};
 const inbound={origin:'JED',destination:'TAS',departureAt:arrival+'T12:00:00+03:00',arrivalAt:arrival+'T19:00:00+05:00'};
 quote.snapshot.bookingContract={legs:[{origin:'TAS',destination:'JED',departureDate:departure},{origin:'JED',destination:'TAS',departureDate:arrival}],schedule:{outbound,inbound},makkahRoomId:'r1',madinahRoomId:null};
 const booking={planId:'standard',totalUsd:quote.totalPackagePrice,perPilgrimUsd:quote.pricePerPerson,input:{travelers,includeMadinah:false},route:{originCode:'TAS',outboundDestination:'JED',returnOrigin:'JED'},stay:{makkahNights:7,madinahNights:0},selection:{flightId:'f1',makkahHotelId:'h1',madinahHotelId:null},generatorTrace:{quoteId:quote.quoteId,outbound:{...outbound,departureAt:new Date(outbound.departureAt).toISOString()},inbound,makkahHotel:{roomId:'r1'}}};
 return {quote,booking,proof:await sealPricingSnapshot(quote.snapshot,env)};
}
test('verified quote returns only public values, accepts equivalent local/UTC flight times',async()=>{const {booking,proof,quote}=await fixture();const result=await verifyBookingQuote(booking,proof,env);assert.deepEqual(result,{quoteId:quote.quoteId,totalUsd:quote.totalPackagePrice,perPilgrimUsd:quote.pricePerPerson});assert.ok(!JSON.stringify(result).includes('supplierCost'));});
test('missing, forged, wrong-key and old contract proofs cannot create bookings',async()=>{const {booking,proof,quote}=await fixture();await assert.rejects(verifyBookingQuote(booking,undefined,env),/QUOTE_PROOF_REQUIRED/);await assert.rejects(verifyBookingQuote(booking,proof.slice(0,-10)+'AAAAAAAAAA',env),/INVALID_QUOTE_PROOF/);await assert.rejects(verifyBookingQuote(booking,proof,{PACKAGE_QUOTE_SEAL_KEY:Buffer.alloc(32,20).toString('base64url')}),/INVALID_QUOTE_PROOF/);delete quote.snapshot.bookingContract;await assert.rejects(verifyBookingQuote(booking,await sealPricingSnapshot(quote.snapshot,env),env),/BOOKING_QUOTE_REFRESH_REQUIRED/);});
test('tampering with selling price, group, hotel, room, or flight cannot pass verification',async()=>{const {booking,proof}=await fixture();for(const mutate of [b=>b.totalUsd=1,b=>b.input.travelers.adults=2,b=>b.selection.makkahHotelId='other',b=>b.generatorTrace.makkahHotel.roomId='other',b=>b.generatorTrace.outbound.departureAt='2027-02-02T10:00:00Z',b=>b.route.originCode='FEG',b=>b.generatorTrace.quoteId='server-forged']){const b=structuredClone(booking);mutate(b);await assert.rejects(verifyBookingQuote(b,proof,env),/BOOKING_QUOTE_/);}});

test('real core booking endpoint rejects tampered price before DB writes and accepts a valid sealed quote',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const {default:core}=await import('../../core/index.js');
 const {createBackendRouter}=await import('../../src/router.js');
 const sql=new DatabaseSync(':memory:');
 const db={prepare(query){let values=[];const api={bind(...args){values=args;return api},async run(){return {meta:sql.prepare(query).run(...values)}},async first(){return sql.prepare(query).get(...values)||null},async all(){return {results:sql.prepare(query).all(...values)}}};return api},async batch(stmts){sql.exec('BEGIN');try{const out=[];for(const stmt of stmts)out.push(await stmt.run());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
 try {
 const {booking,proof}=await fixture();
 Object.assign(booking.input,{from:'Tashkent',originCode:'TAS',startDate:departure,endDate:arrival,flexibleDays:0,hotelPreference:'3'});
 Object.assign(booking,{customization:{},hotelNames:{makkah:'Fixture Hotel'},flight:'Fixture flight'});
 const dummy={fetch:()=>new Response('unexpected')};
 const router=createBackendRouter({hotels:dummy,flights:dummy,packages:dummy,core,verifyBookingQuote});
 const bindings={...env,HOTELS_DB:{},BOOKINGS_DB:db,PASSPORTS:{},FLIGHTS_DB:{},HOTELS_MEDIA:{},IUMRAH_CORE_PARITY_ATTESTATION:'v21:'+'a'.repeat(64),IUMRAH_CORE_CUTOVER_READY:'1',IUMRAH_SUPERADMIN_PASSWORD:'fixture',IUMRAH_SESSION_SECRET:'fixture'};
 const send=(b,p)=>router.fetch(new Request('https://iumrah-backend.helloiumrah.workers.dev/api/bookings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lang:'ru',booking:b,quoteProof:p})}),bindings,{});
 assert.equal((await send({...booking,totalUsd:1},proof)).status,409);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='bookings'").get().n,0);
 assert.equal((await send(booking,undefined)).status,409);
 const response=await send(booking,proof);assert.equal(response.status,202,await response.clone().text());
 const result=await response.json();assert.equal(result.identityReady,false);assert.equal(result.booking.totalUsd,booking.totalUsd);assert.ok(result.accessToken);assert.equal('quoteProof' in result.booking,false);assert.doesNotMatch(JSON.stringify(result),/supplierCostUsd|markupRate|estimatedProfitUsd/);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM bookings').get().n,1);
 assert.doesNotMatch(sql.prepare('SELECT payload_json FROM bookings').get().payload_json,/quoteProof|supplierCostUsd|markupRate/);
 } finally{sql.close()}
});
