// Booking Experience 3.0: stable slot IDs and monetary arithmetic (USD cents).
export function documentRequirements(snapshot = {}, count = 1) {
  const services = new Set(Array.isArray(snapshot.includedServices) ? snapshot.includedServices : []);
  const requirements = [];
  const add = (key, kind, label, travelerPosition = null) => requirements.push({key, kind, label, travelerPosition});
  // The legacy package schema always has a round-trip route. Flight services are
  // explicit on new packages; legacy packages with a route also need both legs.
  const travelers = Math.max(1, Math.min(60, Number.isInteger(count) ? count : 1));
  if (services.has('flight') || snapshot.route?.originCode || snapshot.flight) {
    for (let i = 1; i <= travelers; i++) {
      add(`ticket:outbound:${i}`,'ticket',`Авиабилет туда · Паломник ${i}`,i);
      add(`ticket:inbound:${i}`,'ticket',`Авиабилет обратно · Паломник ${i}`,i);
    }
  }
  if (services.has('makkahHotel') || snapshot.hotelNames?.makkah) add('voucher:makkah','voucher','Ваучер Мекки');
  if (services.has('madinahHotel') || (snapshot.hotelNames?.madinah && snapshot.input?.includeMadinah !== false)) add('voucher:madinah','voucher','Ваучер Медины');
  for (let i = 1; i <= travelers; i++) {
    if (services.has('visa') || !services.size) add(`visa:${i}`,'visa',`Виза · ${i}`,i);
    if (services.has('insurance')) add(`insurance:${i}`,'insurance',`Страховка · ${i}`,i);
  }
  return requirements;
}
export function readinessFor(requirements, documents) {
  const published = new Set(documents.filter(d=>d.publication_status==='published').flatMap(d=>{
    const slots = Array.isArray(d.slots) ? d.slots : [];
    return slots.filter(key=>requirements.some(r=>r.key===key&&r.kind===d.document_kind));
  }));
  return requirements.map(r=>({...r, ready:published.has(r.key)}));
}
export function validatedAmount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 250000) return null;
  const amount = Math.round(value*100);
  return Math.abs(value*100-amount)<0.00001 ? amount : null;
}
export function paymentSatisfied(due, paid) {
  return Number.isSafeInteger(due) && due >= 0 && Number.isSafeInteger(paid) && paid >= due;
}

// Stable component definitions derived from the purchased package, not from uploaded files.
export function serviceRequirements(snapshot={}) {
 const selected=new Set(Array.isArray(snapshot.includedServices)?snapshot.includedServices:[]);
 const legacy=selected.size===0, input=snapshot.input||{}, hotels=snapshot.hotelNames||{}, route=snapshot.route||{}, selection=snapshot.selection||{}, details=snapshot.selectionDetails||{}, stay=snapshot.stay||{};
 const result=[];
 const add=(key,label,scope)=>result.push({key,label,scope:JSON.stringify(scope)});
 if(selected.has('flight')||(legacy&&(route.originCode||snapshot.flight))) {
  add('flight:outbound','Перелёт туда',[route.originCode,route.outboundDestination,input.startDate,selection.flightId,details.flight?.outboundDate,details.flight?.outboundDepartureTime]);
  add('flight:inbound','Перелёт обратно',[route.returnOrigin,route.originCode,input.endDate,selection.flightId,details.flight?.returnDate,details.flight?.returnDepartureTime]);
 }
 if(selected.has('makkahHotel')||(legacy&&hotels.makkah))add('hotel:makkah','Отель в Мекке',[hotels.makkah,selection.makkahHotelId,details.makkahHotel?.roomId,stay.makkahCheckIn,stay.makkahCheckOut]);
 if(selected.has('madinahHotel')||(legacy&&hotels.madinah&&input.includeMadinah!==false))add('hotel:madinah','Отель в Медине',[hotels.madinah,selection.madinahHotelId,details.madinahHotel?.roomId,stay.madinahCheckIn,stay.madinahCheckOut]);
 for(const [key,label] of [['visa','Визы'],['insurance','Страховка'],['transfer','Трансферы'],['accompaniment','Персональный гид'],['meals','Питание'],['ziyaratMakkah','Зияраты Мекки'],['ziyaratMadinah','Зияраты Медины'],['care','Поддержка'],['haramainTrain','Поезд Haramain'],['esim','eSIM']]){
  if(selected.has(key)||(legacy&&key==='visa'))add(key,label,[input.startDate,input.endDate,input.travelers||null,key==='transfer'?input.transferVehicle:null]);
 }
 return result;
}
export function operationalProgress(requirements,rows){
 const map=new Map(rows.map(x=>[x.service_key,x]));
 return requirements.map(({scope,...r})=>{const row=map.get(r.key), valid=row?.scope===scope;return {...r,availability:valid?row.availability:'pending',execution:valid?row.execution:'planned',reference:valid?row.reference:'',note:valid?row.note:'',updatedAt:valid?row.updated_at:null,updatedBy:valid?row.updated_by:null};});
}
export function queueFor(status,{createdAt,startDate,endDate,paymentDue=null,documentsDue=null,submitted=0,cancellationRequested=false,manager=null},now=new Date()){
 const tasks=[]; const add=(key,priority,dueAt=null)=>tasks.push({key,priority,dueAt});
 if(['completed','cancelled'].includes(status))return tasks;
 if(cancellationRequested)add('cancellation',0);
 if(status==='availability_check'){const start=Date.parse(createdAt);const due=Number.isFinite(start)?new Date(start+30*60000).toISOString():null;add('availability',due&&Date.parse(due)<=now.getTime()?0:1,due);}
 if(status==='payment_pending')add(submitted>0?'receipt':'payment',submitted>0?0:3,paymentDue);
 if(status==='booking_confirmed'){const due=documentsDue||startDate||null;add('documents',due&&Date.parse(due)<=now.getTime()?0:2,due);}
 if(status==='ready_to_travel')add('departure',startDate&&startDate<=now.toISOString().slice(0,10)?0:3,startDate||null);
 if(status==='in_trip')add('trip',endDate&&endDate<=now.toISOString().slice(0,10)?0:2,endDate||null);
 if(!manager)add('unassigned',3);
 return tasks;
}

// Preliminary whole-trip estimate. No payment or cancellation is performed.
export function refundEstimate(report,ctx){
 const items=report.components.map(c=>{
  const amountCents=Math.round(c.amountUsd*100);let refundCents=null,reason='supplier_review';
  if(c.cancellationPolicy==='visa_submission'&&ctx.visaSlots.length){
   const slots=ctx.visaSlots;
   if(slots.some(s=>['refused','needs_correction'].includes(s.state)))reason='visa_manual_review';
   else {const base=Math.floor(amountCents/slots.length),extra=amountCents%slots.length;refundCents=slots.reduce((sum,s,i)=>sum+(!s.ready&&!s.submitted&&!['submitted','published'].includes(s.state)?base+(i<extra?1:0):0),0);reason='visa_submission';}
  }else if(c.cancellationPolicy==='full_before_service'&&ctx.beforeTrip){refundCents=amountCents;reason='before_service';}
  else if(c.cancellationPolicy==='transfer_24h'&&Number.isFinite(ctx.pickupAt)&&ctx.now<ctx.pickupAt&&!ctx.transferStarted){refundCents=amountCents-(ctx.now<=ctx.pickupAt-86400000?0:Math.min(10000,amountCents));reason='transfer_24h';}
  return {code:c.code,label:c.label,amountCents,refundCents,reason};
 });
 const knownCents=items.reduce((s,c)=>s+(c.refundCents??0),0),supportCents=Math.min(Math.round(knownCents*.09),Math.round(report.supportAmountUsd*100));
 const remainingCents=Math.max(0,ctx.paidCents-ctx.refundedCents);
 const estimateCents=ctx.paymentVerified&&!ctx.cancelled&&ctx.refundedCents===0?Math.min(remainingCents,knownCents+supportCents):null;
 return {items,knownCents,supportCents,estimateCents,paidCents:ctx.paidCents,refundedCents:ctx.refundedCents,manualReview:true,paymentFeeRefundCents:null};
}
