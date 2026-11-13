import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNuiteePackageHotels, packageTierForStars } from '../.runtime-dist/nuitee-hotels.js';
import { calculatePackageQuote } from '../.runtime-dist/pricing.js';
import { generatePackageQuote } from '../.runtime-dist/package-search.js';
import { unsealPricingSnapshot } from '../.runtime-dist/quote-audit.js';
const checkin=new Date(Date.now()+10*86400000).toISOString().slice(0,10);
const checkout=new Date(Date.now()+17*86400000).toISOString().slice(0,10);
function fixture({stars=4,sandbox=false}={}) {
 const cache=new Map();
 const put=(key,data)=>cache.set(key,{payload:JSON.stringify(data),updated_at:Date.now(),expires_at:Date.now()+600000});
 put('catalog:v1:makkah',[{id:'lp123',name:'Hotel',stars,city:'Makkah'}]);
 put(`rates:v2:lp123:${checkin}:${checkout}:2::UZ:USD`,[{offerId:'offer',roomId:'room',price:200,currency:'USD'}]);
 const env={cache,put,NUITEE_API_KEY:sandbox?'sand_fixture':'live_fixture',PACKAGE_QUOTE_SEAL_KEY:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',TRAVELPAYOUTS_API_TOKEN:'test',HOTELS_DB:{prepare(sql){let args=[];return{
 bind(...v){args=v;return this;},async first(){return cache.get(args[0])??null;},async run(){if(sql.includes('INSERT INTO'))cache.set(args[0],{payload:args[1],updated_at:args[2],expires_at:args[3]});return{success:true};}
 };}}};
 return env;
}
const room=(overrides={})=>({id:'makkah:0',city:'makkah',hotelId:'lp123',offerId:'offer',roomId:'room',checkin,checkout,adults:2,children:[],...overrides});
const party={adults:2,children:0,infants:0,rooms:1};
const prebook=(overrides={})=>({data:{hotelId:'lp123',prebookId:'prebook',currency:'USD',price:245,...overrides}});
async function mockFetch(callback,work){const old=globalThis.fetch;globalThis.fetch=callback;try{return await work();}finally{globalThis.fetch=old;}}
test('hotel categories: 1–2 Economy, 3–4 Standard, 5 Luxury; no unknown category',()=>{
 assert.deepEqual([1,2,3,4,5].map(packageTierForStars),['economy','economy','standard','standard','luxury']);
 for(const x of [0,6,NaN])assert.throws(()=>packageTierForStars(x),/HOTEL_STARS_REQUIRED/);
});
test('prebook validates exact server-bound offer; ignores caller price and tier',async()=>{
 await mockFetch(async(url,init)=>{
  assert.equal(url,'https://book.liteapi.travel/v3.0/rates/prebook');
  assert.deepEqual(JSON.parse(init.body),{offerId:'offer',usePaymentSdk:false});
  return Response.json(prebook());
 },async()=>{
  const result=await resolveNuiteePackageHotels(fixture(),[room({price:1,stars:1,prebookId:'forged'})],party,false);
  assert.equal(result.tier,'standard');assert.equal(result.makkah.amountUsd*7,245);
  assert.equal(result.rooms[0].prebookId,'prebook');assert.equal(result.bookingAllowed,true);
 });
});
test('sandbox tariffs permit internal booking with server price and explicit source, never supplier reservation',async()=>{
 await mockFetch(async()=>{throw Error('Sandbox must not prebook a real supplier room');},async()=>{
  const result=await resolveNuiteePackageHotels(fixture({sandbox:true}),[room({price:1,tariffSource:'production',supplierReservationConfirmed:true})],party,false);
  assert.equal(result.bookingAllowed,true);
  assert.equal(result.makkah.amountUsd*7,200);
  assert.equal(result.rooms[0].tariffSource,'sandbox');
  assert.equal(result.rooms[0].supplierReservationConfirmed,false);
  assert.equal(result.rooms[0].prebookId,undefined);
 });
});
test('expired/mismatched room identity is rejected before supplier call',async()=>{
 await mockFetch(async()=>{throw Error('unexpected supplier call');},async()=>{
  await assert.rejects(resolveNuiteePackageHotels(fixture(),[room({offerId:'forged'})],party,false),/NUITEE_SELECTED_RATE_EXPIRED/);
  await assert.rejects(resolveNuiteePackageHotels(fixture(),[room({adults:1})],party,false),/NUITEE_OCCUPANCY_MISMATCH/);
  await assert.rejects(resolveNuiteePackageHotels(fixture(),[room(),room()],{...party,rooms:2},false),/NUITEE_ROOM_SELECTION_INCOMPLETE/);
 });
});
test('changed cancellation terms, currency and supplier hotel cannot be silently accepted',async()=>{
 for(const values of [{cancellationChanged:true},{boardChanged:true},{currency:'EUR'},{hotelId:'lp999'},{price:0}]){
  await mockFetch(async()=>Response.json(prebook(values)),()=>assert.rejects(resolveNuiteePackageHotels(fixture(),[room()],party,false),/NUITEE_RATE_TERMS_CHANGED|NUITEE_RATE_RECHECK_FAILED/));
 }
});
test('multiple rooms use exact summed totals, one live recheck per repeated offer',async()=>{
 let calls=0;
 await mockFetch(async()=>{calls++;return Response.json(prebook());},async()=>{
  const result=await resolveNuiteePackageHotels(fixture(),[room(),room({id:'makkah:1'})],{...party,adults:4,rooms:2},false);
  assert.equal(result.makkah.amountUsd*7*2,490);assert.equal(calls,1);
 });
});
test('server quote seals Nuitee identities, uses existing package engine, and derives tier from catalogue',async()=>{
 const env=fixture({stars:3});
 await mockFetch(async(url)=>{
  if(String(url).includes('/rates/prebook'))return Response.json(prebook());
  const u=new URL(url);const reverse=u.searchParams.get('origin')==='JED';
  return Response.json({success:true,currency:'usd',data:[{origin:reverse?'JED':'TAS',destination:reverse?'TAS':'JED',airline:'HY',flight_number:reverse?'336':'335',departure_at:`${reverse?checkout:checkin}T12:00:00${reverse?'+03:00':'+05:00'}`,duration:360,price:300}]});
 },async()=>{
  const provider=`aviasales:pair:TAS:JED:${checkin}:${checkout}:HY:335:HY:336:JED:TAS`;
  const response=await generatePackageQuote(new Request('https://fixture/api/package/quote',{method:'POST',body:JSON.stringify({tier:'luxury',tripType:'roundTrip',includeMadinah:false,travelers:party,hotels:{makkah:{hotelId:'lp123',roomId:'room',nights:7}},flight:{providerItineraryId:provider,cabinClass:'economy',legs:[{origin:'TAS',destination:'JED',departureDate:checkin},{origin:'JED',destination:'TAS',departureDate:checkout}]},nuiteeRooms:[room()]})}),env);
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
  assert.equal(body.quote.resolvedTier,'standard');assert.equal(body.quote.bookingAllowed,true);assert.match(body.quote.quoteId,/^server-/);
  const snapshot=await unsealPricingSnapshot(body.quote.quoteProof,env);
  assert.equal(snapshot.nuiteeRooms[0].prebookId,'prebook');assert.equal(snapshot.context.tier,'standard');
  assert.equal(snapshot.components.find(x=>x.code==='hotel_makkah')?.supplierCostUsd ?? snapshot.components.find(x=>/makkah/i.test(x.code))?.supplierCostUsd,245);
  assert.equal(body.quote.stayPlan.makkahCheckIn,checkin);assert.equal(body.quote.stayPlan.makkahCheckOut,checkout);
 });
});

test('Aviasales accepts legacy, extended and open-jaw identities without changing return airports', async () => {
 const { resolveAviasalesSelection } = await import('../.runtime-dist/package-search.js');
 for (const suffix of ['', ':JED:TAS', ':MED:TAS']) {
  const routes=[];
  await mockFetch(async(raw)=>{
   const url=new URL(raw);const origin=url.searchParams.get('origin'),destination=url.searchParams.get('destination');
   routes.push(`${origin}-${destination}`);
   const reverse=origin!=='TAS';
   return Response.json({success:true,currency:'usd',data:[{origin,destination,airline:'HY',flight_number:reverse?'336':'335',departure_at:`${reverse?checkout:checkin}T12:00:00+03:00`,duration:360,price:reverse?320:300}]});
  },async()=>{
   const result=await resolveAviasalesSelection(`aviasales:pair:TAS:JED:${checkin}:${checkout}:HY:335:HY:336${suffix}`,{TRAVELPAYOUTS_API_TOKEN:'test'});
   const airport=suffix.startsWith(':MED')?'MED':'JED';
   assert.deepEqual(routes,['TAS-JED',`${airport}-TAS`]);
   assert.equal(result.inbound.origin,airport);
   assert.equal(result.perTravelerUsd,620);
  });
 }
});
test('Aviasales rejects malformed identities before sending supplier requests',async()=>{
 const { resolveAviasalesSelection } = await import('../.runtime-dist/package-search.js');
 await mockFetch(async()=>{throw Error('Unexpected supplier request');},async()=>{
  for(const value of [`aviasales:pair:TAS:JED:${checkin}:${checkout}:HY:335:HY:336:MED`, `aviasales:pair:TAS:JED:${checkin}:${checkout}:HY:335:HY:336:MED:SKD`]) {
   await assert.rejects(resolveAviasalesSelection(value,{TRAVELPAYOUTS_API_TOKEN:'test'}),/AVIASALES_IDENTITY_INVALID/);
  }
 });
});


test('hotel meals use server stars and board inclusion; existing engine units apply only to optional meals',async()=>{
 await mockFetch(async()=>Response.json(prebook()),async()=>{
  for(const stars of [1,2,3,4,5]) {
   const env=fixture({stars});
   const result=await resolveNuiteePackageHotels(env,[room({meals:{breakfast:true,lunch:true,dinner:true},includedMeals:{breakfast:true,lunch:true,dinner:true}})],party,false);
   const cost=(meal)=>result.mealComponents.find(x=>x.code.endsWith('_'+meal)).supplierCostUsd;
   const unit=stars===5?50:15;
   assert.equal(cost('breakfast'),stars>=4?0:unit*7*2);
   assert.equal(cost('lunch'),unit*7*2);assert.equal(cost('dinner'),unit*7*2);
  }
  const env=fixture({stars:2});
  env.put(`rates:v2:lp123:${checkin}:${checkout}:2::UZ:USD`,[{offerId:'offer',roomId:'room',price:200,currency:'USD',mealPlan:'Full board'}]);
  const result=await resolveNuiteePackageHotels(env,[room({meals:{breakfast:true,lunch:true,dinner:true}})],party,false);
  assert.equal(result.mealComponents.length,3);
  assert.equal(result.mealComponents.reduce((s,x)=>s+x.supplierCostUsd,0),0);
 });
});
test('Madinah excludes lunch; different city stars price their own meals',async()=>{
 const mid=new Date(Date.parse(checkin)+3*86400000).toISOString().slice(0,10);
 const env=fixture({stars:4,sandbox:true});
 env.put('catalog:v1:madinah',[{id:'lp456',name:'Hotel Medina',stars:5,city:'Madinah'}]);
 env.put(`rates:v2:lp123:${checkin}:${mid}:2::UZ:USD`,[{offerId:'offer',roomId:'room',price:200,currency:'USD',mealPlan:'Room only'}]);
 env.put(`rates:v2:lp456:${mid}:${checkout}:2::UZ:USD`,[{offerId:'med',roomId:'room',price:400,currency:'USD',mealPlan:'Room only'}]);
 const rooms=[room({checkout:mid,meals:{breakfast:false,lunch:true,dinner:false}}),room({id:'madinah:0',city:'madinah',hotelId:'lp456',offerId:'med',checkin:mid,meals:{breakfast:false,lunch:true,dinner:true}})];
 const result=await resolveNuiteePackageHotels(env,rooms,party,true);
 assert.equal(result.rooms[1].meals.lunch,false);
 assert.equal(result.rooms[1].meals.breakfast,true);
 assert.equal(result.mealComponents.reduce((sum,x)=>sum+x.supplierCostUsd,0),15*3*2+50*4*2);
});
test('Economy and Standard retain included ziyarat rows at zero; Comfort/Luxury retain engine costs',()=>{
 const hotel={hotelId:'lp123',roomId:'room',amountUsd:100,unit:'perRoomNight',nights:3,pricingMode:'test'};
 const fare={candidateId:'flight',amount:600,currency:'USD',fareScope:'totalParty',providerId:'test',observedAt:new Date().toISOString(),travelDate:checkin,normalizedGroupUsd:600};
 for(const tier of ['economy','standard','comfort','luxury']) {
  const q=calculatePackageQuote({tier,tripType:'roundTrip',includeMadinah:true,travelers:party,meals:{makkahLunch:false,makkahDinner:false,madinahDinner:false},hotelMealComponents:[],transferVehicle:'carnival',includeHaramainTrain:false,haramainFareClass:'economy',haramainTicketCount:0,journeyFare:fare,makkahHotel:hotel,madinahHotel:{...hotel,hotelId:'lp456'}});
  const lines=q.snapshot.components.filter(x=>x.code.startsWith('ziyarat_'));
  assert.equal(lines.length,2);
  assert.equal(lines.reduce((sum,x)=>sum+x.supplierCostUsd,0),['economy','standard'].includes(tier)?0:200);
  assert.equal(q.snapshot.totals.supplierCostUsd,q.snapshot.components.reduce((sum,x)=>sum+x.supplierCostUsd,0));
 }
});
test('known hotel and room amenities are localized without changing identifiers',async()=>{
 const {localizeKnownAmenities}=await import('../.runtime-dist/hotel-localization.js');
 const hotel={id:'lp123',amenities:['Free Wi-Fi','Bar','Room service'],rooms:[{id:'r',amenities:['Air conditioning']}]};
 const ru=localizeKnownAmenities(hotel,'ru');
 assert.deepEqual(ru.amenities,['Бесплатный Wi-Fi','Бар','Обслуживание номеров']);
 assert.equal(ru.rooms[0].amenities[0],'Кондиционер');assert.equal(ru.rooms[0].id,'r');
 assert.equal(localizeKnownAmenities(hotel,'uz').amenities[2],'Xonaga xizmat ko‘rsatish');
 assert.equal(localizeKnownAmenities(hotel,'uz-cyrl').amenities[1],'Бар');
});

test('sandbox package quote seals the real selections and commits or queues a Business cost report under the booking ID',async()=>{
 const {commitPackageQuoteReport}=await import('../.runtime-dist/booking-gateway.js');
 const env=fixture({stars:4,sandbox:true});
 const provider=`aviasales:pair:TAS:JED:${checkin}:${checkout}:HY:335:HY:336`;
 let body;
 await mockFetch(async(raw)=>{
  assert.ok(!String(raw).includes('/rates/prebook'));
  const u=new URL(raw),reverse=u.searchParams.get('origin')==='JED';
  return Response.json({success:true,currency:'usd',data:[{airline:'HY',flight_number:reverse?'336':'335',departure_at:`${reverse?checkout:checkin}T12:00:00+03:00`,duration:360,price:300}]});
 },async()=>{
  const response=await generatePackageQuote(new Request('https://fixture/api/package/quote',{method:'POST',body:JSON.stringify({tier:'standard',tripType:'roundTrip',includeMadinah:false,travelers:party,hotels:{makkah:{hotelId:'lp123',roomId:'room',nights:7}},flight:{providerItineraryId:provider,legs:[{origin:'TAS',destination:'JED',departureDate:checkin},{origin:'JED',destination:'TAS',departureDate:checkout}]},nuiteeRooms:[room({meals:{breakfast:true,lunch:false,dinner:true}})]})}),env);
  body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
 });
 const snapshot=await unsealPricingSnapshot(body.quote.quoteProof,env);
 assert.equal(snapshot.supplierMode,'sandbox');assert.equal(snapshot.supplierReservationConfirmed,false);
 assert.equal(snapshot.components.find(x=>x.code==='makkah_hotel').supplierCostUsd,200);
 assert.equal(snapshot.components.find(x=>x.code==='ziyarat_makkah').supplierCostUsd,0);
 assert.equal(snapshot.nuiteeRooms[0].meals.dinner,true);
 assert.equal(snapshot.components.find(x=>x.code.endsWith('_dinner')).supplierCostUsd,210);
 const bookingID='IUM-2026-ABCDEFG',token='a-test-booking-token-long-enough';
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
 const booking={totalUsd:body.quote.totalPackagePrice,perPilgrimUsd:body.quote.pricePerPerson,planId:'standard',input:{travelers:party},selection:{makkahHotelId:'lp123'},stay:{makkahNights:7,madinahNights:0},generatorTrace:{quoteId:body.quote.quoteId}};
 for(const tripExists of [true,false]) {
  const writes=[];
  const db={prepare(sql){let args;return {bind(...a){args=a;return this;},async first(){
   if(sql.includes('FROM bookings'))return args[0]===bookingID && args[1]===hash?{id:bookingID,payload_json:JSON.stringify(booking)}:null;
   if(sql.includes('FROM pilgrim_trips'))return tripExists?{id:'business-trip',pricing_snapshot_json:null}:null;
   return null;
  },async run(){writes.push({sql,args});return {meta:{changes:1}};}};}};
  const response=await commitPackageQuoteReport(new Request('https://fixture/commit',{method:'POST',headers:{'x-booking-token':token},body:JSON.stringify({quoteProof:body.quote.quoteProof})}),bookingID,{...env,BOOKINGS_DB:db,HOTELS_DB:db});
  assert.equal(response.status,tripExists?200:202,JSON.stringify(await response.clone().json()));
  const stored=writes.find(x=>tripExists?x.sql.startsWith('UPDATE pilgrim_trips'):x.sql.startsWith('INSERT INTO pending_package_pricing_reports'));
  assert.ok(stored);
  const report=JSON.parse(stored.args[tripExists?0:3]);
  assert.equal(report.quoteId,snapshot.quoteId);assert.equal(report.totals.publicTotalUsd,body.quote.totalPackagePrice);
  assert.equal(report.supplierMode,'sandbox');assert.equal(report.nuiteeRooms[0].meals.dinner,true);
  const rejected=await commitPackageQuoteReport(new Request('https://fixture/commit',{method:'POST',headers:{'x-booking-token':'wrong-token-long-enough-to-check'},body:JSON.stringify({quoteProof:body.quote.quoteProof})}),bookingID,{...env,BOOKINGS_DB:db,HOTELS_DB:db});
  assert.equal(rejected.status,404);
 }
});

test('room-only and explicit breakfast exclusions are never treated as supplier-included breakfast',async()=>{
 const {supplierMealInclusions}=await import('../.runtime-dist/pricing.js');
 for(const board of ['Room only','Breakfast not included','Without breakfast','No breakfast']) {
  assert.deepEqual(supplierMealInclusions(board),{breakfast:false,lunch:false,dinner:false});
 }
 assert.equal(supplierMealInclusions('BB').breakfast,true);
});

test('mixed one-way suppliers resolve both directions, preserve open-jaw and sum server fares', async()=>{
 const {resolveMixedSelection}=await import('../.runtime-dist/package-search.js');
 const curatedLeg={origin:'TAS',destination:'JED',departure_at:'2027-01-03T10:00:00Z',arrival_at:'2027-01-03T16:00:00Z'};
 const row={id:'direct',currency:'USD',per_traveler_fare:200,observed_at:'2026-11-12T00:00:00Z',itinerary_json:JSON.stringify({legs:[curatedLeg]})};
 const env={TRAVELPAYOUTS_API_TOKEN:'test',HOTELS_DB:{prepare(){return{bind(){return this;},async first(){return row;}};}}};
 const api='aviasales:ow:MED:TAS:2027-01-10:-:HY:338:-:-';
 await mockFetch(async()=>Response.json({success:true,data:[{price:300,airline:'HY',flight_number:'338',departure_at:'2027-01-10T10:00:00Z',duration:360}]}),async()=>{
  const value=await resolveMixedSelection('mixed:curated:direct~'+api,2,env);
  assert.equal(value.fare.normalizedGroupUsd,1000);assert.equal(value.schedule.inbound.origin,'MED');
  row.itinerary_json=JSON.stringify({legs:[curatedLeg,{origin:'MED',destination:'TAS',departure_at:'2027-01-10T10:00:00Z',arrival_at:'2027-01-10T16:00:00Z'}]});
  await assert.rejects(resolveMixedSelection('mixed:curated:direct~'+api,2,env),/ONE_WAY/);
  await assert.rejects(resolveMixedSelection('mixed:curated:direct+other~'+api,2,env),/IDENTITY/);
 });
});
test('mixed API outbound and published inbound work without carrier matching',async()=>{
 const {resolveMixedSelection}=await import('../.runtime-dist/package-search.js');
 const row={currency:'USD',per_traveler_fare:180,observed_at:'2026-11-12',itinerary_json:JSON.stringify({legs:[{origin:'MED',destination:'TAS',departure_at:'2027-01-10T10:00:00Z',arrival_at:'2027-01-10T16:00:00Z'}]})};
 const env={TRAVELPAYOUTS_API_TOKEN:'test',HOTELS_DB:{prepare(){return{bind(){return this;},async first(){return row;}};}}};
 await mockFetch(async()=>Response.json({success:true,data:[{price:250,airline:'XY',flight_number:'634',departure_at:'2027-01-03T10:00:00Z',duration:360}]}),async()=>{
  const result=await resolveMixedSelection('mixed:aviasales:ow:TAS:JED:2027-01-03:-:XY:634:-:-~curated:return',2,env);
  assert.equal(result.fare.normalizedGroupUsd,860);
  assert.equal(result.schedule.outbound.destination,'JED');assert.equal(result.schedule.inbound.origin,'MED');
 });
});

test('mixed supplier quote seals authoritative fare and rejects altered routes',async()=>{
 const env=fixture({sandbox:true});
 const originalPrepare=env.HOTELS_DB.prepare;
 env.HOTELS_DB.prepare=(sql)=>sql.includes('curated_flight_offers')?{bind(){return this;},async first(){return {currency:'USD',per_traveler_fare:200,observed_at:new Date().toISOString(),itinerary_json:JSON.stringify({legs:[{origin:'TAS',destination:'JED',departure_at:checkin+'T09:00:00Z',arrival_at:checkin+'T15:00:00Z'}]})};}}:originalPrepare(sql);
 const body={tier:'standard',tripType:'roundTrip',includeMadinah:false,travelers:party,hotels:{makkah:{hotelId:'lp123',roomId:'room',nights:7}},flight:{providerItineraryId:`mixed:curated:direct~aviasales:ow:JED:TAS:${checkout}:-:HY:338:-:-`,legs:[{origin:'TAS',destination:'JED',departureDate:checkin},{origin:'JED',destination:'TAS',departureDate:checkout}]},nuiteeRooms:[room()]};
 await mockFetch(async()=>Response.json({success:true,data:[{price:300,airline:'HY',flight_number:'338',departure_at:checkout+'T15:00:00Z',duration:360}]}),async()=>{
  const send=()=>generatePackageQuote(new Request('https://fixture/api/package/quote',{method:'POST',body:JSON.stringify(body)}),env);
  const response=await send();const payload=await response.json();assert.equal(response.status,200,JSON.stringify(payload));
  const sealed=await unsealPricingSnapshot(payload.quote.quoteProof,env);
  assert.equal(sealed.components.find(x=>x.code==='flight_roundtrip').supplierCostUsd,1000);
  body.flight.legs[1].origin='MED';
  const rejected=await send();assert.notEqual(rejected.status,200);assert.match(JSON.stringify(await rejected.json()),/MIXED_ROUTE_MISMATCH/);
 });
});
