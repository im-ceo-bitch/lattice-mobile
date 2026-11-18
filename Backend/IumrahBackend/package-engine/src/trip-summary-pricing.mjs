// Trip Summary 2.0: deterministic retail projection of a trusted server price.
// Integer cents throughout. Never use client-provided costs or totals.
const cents = x => Math.round(x * 100);
const usd = x => x / 100;
const rate = (n, pct) => Math.round(n * pct / 100);
const codes = { flight:'flight_roundtrip', makkah:'makkah_hotel', madinah:'madinah_hotel', transfer:'transfers', ziyarat:'ziyarat', visa:'visa', guide:'accompaniment', other:'other' };
const labels = { flight:'Авиабилеты', makkah:'Отель в Мекке', madinah:'Отель в Медине', transfer:'Индивидуальный трансфер', ziyarat:'Зияраты', visa:'Визы', guide:'Персональный гид', other:'Другие услуги' };

function cancellationPolicy(code) {
  if(code.startsWith('flight_')||code==='makkah_hotel'||code==='madinah_hotel')return 'supplier_tariff';
  if(code==='visa')return 'visa_submission';
  if(code==='transfers'||code==='vip_transfer_upgrade')return 'transfer_24h';
  if(code==='accompaniment'||code.startsWith('ziyarat'))return 'full_before_service';
  return 'service_terms';
}

export function tripSummaryReport({components, totalUsd, travelers, referencePaymentUsd, referenceRoundingUsd=0, addOns={}}) {
  if (!Array.isArray(components) || !Number.isSafeInteger(travelers) || travelers<1 || !Number.isFinite(totalUsd) || totalUsd<=0 || totalUsd>250000) return null;
  if (components.some(x=>!x || typeof x.code!=='string' || typeof x.label!=='string' || !Number.isFinite(x.supplierCostUsd) || x.supplierCostUsd<0 || x.supplierCostUsd>250000)) return null;
  const lines=components.filter(x=>x.code!=='care').map(x=>({code:x.code,label:x.label,cost:cents(x.supplierCostUsd),retail:cents(x.supplierCostUsd)}));
  if (new Set(lines.map(x=>x.code)).size!==lines.length) return null;
  const total=cents(totalUsd), payment=rate(total,2);
  // Preserve the legacy rounding convention and the agreed component allocation.
  // The actual fee is always 2% of the final payable total, not an estimate.
  const refPayment=Number.isFinite(referencePaymentUsd)?cents(referencePaymentUsd):payment;
  const refRounding=Number.isFinite(referenceRoundingUsd)?cents(referenceRoundingUsd):0;
  const target=Math.round((total-refPayment-refRounding)*100/109);
  for(const line of lines) {
    if(Object.hasOwn(addOns,line.code)) {
      if(!Number.isFinite(addOns[line.code])||addOns[line.code]<0) return null;
      line.retail=cents(addOns[line.code]);
    } else if(line.code==='vip_transfer_upgrade'||line.code==='haramain_train_addon') return null;
  }
  const transfer=lines.find(x=>x.code==='transfers');
  const guide=lines.find(x=>x.code==='accompaniment');
  const sum=()=>lines.reduce((s,x)=>s+x.retail,0);
  // An underfunded discounted quote cannot truthfully be repackaged at 9% + 2%
  // while leaving supplier-priced services intact. Return no breakdown rather than invent one.
  if(target<sum()) return null;
  for(const line of lines.filter(x=>x.code==='ziyarat_makkah'||x.code==='ziyarat_madinah')) {
    const desired=Math.max(line.retail,10000), delta=desired-line.retail;
    if(delta<=target-sum()) line.retail=desired;
  }
  if(guide) {
    // Prefer round $100 increments, and keep the variable remainder in transfers.
    const desired=Math.ceil(guide.cost/10000)*10000+10000;
    if(desired-guide.retail<=target-sum()) guide.retail=desired;
  }
  if(sum()<target) {
    const recipient=transfer||guide;
    if(!recipient) return null;
    recipient.retail+=target-sum();
  }
  const subtotal=sum(), support=rate(subtotal,9), rounding=total-subtotal-support-payment;
  const supplier=lines.reduce((s,x)=>s+x.cost,0), margin=total-supplier-payment;
  const client={version:'trip-summary-v2',currency:'USD',components:lines.map(x=>({code:x.code,label:x.label,amountUsd:usd(x.retail),cancellationPolicy:cancellationPolicy(x.code)})),servicesSubtotalUsd:usd(subtotal),supportRate:0.09,supportAmountUsd:usd(support),paymentRate:0.02,paymentAmountUsd:usd(payment),roundingUsd:usd(rounding),totalUsd:usd(total),perPilgrimUsd:usd(Math.round(total/travelers))};
  const internal={components:lines.map(x=>({code:x.code,label:x.label,supplierCostUsd:usd(x.cost),retailUsd:usd(x.retail),marginUsd:usd(x.retail-x.cost)})),supplierCostUsd:usd(supplier),componentMarginUsd:usd(subtotal-supplier),supportAmountUsd:usd(support),paymentAmountUsd:usd(payment),roundingUsd:usd(rounding),estimatedMarginUsd:usd(margin)};
  return {client,internal};
}

export function tripSummaryForSnapshot(snapshot,addOns) {
  if(!snapshot?.totals||!snapshot.context?.travelers) return null;
  const t=snapshot.context.travelers;
  return tripSummaryReport({components:snapshot.components,totalUsd:snapshot.totals.publicTotalUsd,travelers:t.adults+t.children+t.infants,referencePaymentUsd:snapshot.totals.paymentFeeAmountUsd,referenceRoundingUsd:snapshot.totals.roundingDifferenceUsd,addOns:addOns||snapshot.tripSummaryAddOns||{}});
}

export function tripSummaryForManual(cost,totalUsd,travelers) {
  if(!cost) return null;
  const components=Object.keys(codes).filter(k=>k!=='madinah'||cost[k]>0).map(k=>({code:codes[k],label:labels[k],supplierCostUsd:cost[k]}));
  return tripSummaryReport({components,totalUsd,travelers});
}

// Adults-only escalation; occupancy, child rules and room inventory are separate checks.
export function adultRoomPolicy(adults,rooms) {
  if(!Number.isSafeInteger(adults)||adults<1||!Number.isSafeInteger(rooms)||rooms<1) throw new Error('INVALID_OCCUPANCY');
  const minimumRooms=Math.ceil(adults/5);
  return {minimumRooms,requiresAdultException:rooms<minimumRooms};
}

// Quote-time policies only. A booking refund must use the immutable accepted rules
// and verified provider/payment/fulfillment state; no money is moved here.
export function transferCancellationPreview(amountUsd, startsAt, cancelledAt) {
  if(!Number.isFinite(amountUsd)||amountUsd<0||!/(?:Z|[+-]\d\d:\d\d)$/.test(startsAt)||!/(?:Z|[+-]\d\d:\d\d)$/.test(cancelledAt)) throw new Error('INVALID_TRANSFER_REFUND');
  const start=Date.parse(startsAt),cancel=Date.parse(cancelledAt);
  if(!Number.isFinite(start)||!Number.isFinite(cancel)) throw new Error('INVALID_TRANSFER_REFUND');
  const deadline=new Date(start-86400000).toISOString();
  if(cancel>=start) return {deadline,manualReview:true,refundUsd:null,penaltyUsd:null};
  const amount=cents(amountUsd),penalty=cancel<=start-86400000?0:Math.min(10000,amount);
  return {deadline,manualReview:false,refundUsd:usd(amount-penalty),penaltyUsd:usd(penalty)};
}
export function visaCancellationPreview(amountUsd, state) {
  if(!Number.isFinite(amountUsd)||amountUsd<0) throw new Error('INVALID_VISA_REFUND');
  if(['not_started','preparing'].includes(state)) return {refundUsd:usd(cents(amountUsd)),manualReview:false};
  if(['submitted','issued'].includes(state)) return {refundUsd:0,manualReview:false};
  return {refundUsd:null,manualReview:true};
}
