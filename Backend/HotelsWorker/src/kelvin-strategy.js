// Fixed, read-only analytics on existing iumrah tables. No customer rows, arbitrary SQL,
// model calls, writes, or attribution of money to payments. UTC half-open rolling windows.
const DAY=86400000;
const origins=['TAS','FEG','NMA','AZN','SKD','BHK','KSQ','TMJ','UGC','NCU'];
const tiers=['economy','standard','comfort','luxury'];
const active="'BOOKING_CONFIRMED','READY_TO_TRAVEL','IN_TRIP','COMPLETED'";
const allow=(col,values)=>`CASE WHEN ${col} IN (${values.map(v=>"'"+v+"'").join(',')}) THEN ${col} ELSE 'other' END`;
const number=v=>Number.isSafeInteger(v)&&v>=0;
const countFields=['total','active','cancelled','pending','family','familyKnown','unread','submitted','checkout','both','visitors','errors','crashes','due'];
function cleanCounts(row){const out={};for(const key of countFields)if(key in row){if(!number(row[key]))throw Error('invalid aggregate');out[key]=row[key];}return out;}
export async function strategySnapshot(env, at=new Date()){
 const end=at.toISOString(),start=new Date(+at-7*DAY).toISOString(),previousStart=new Date(+at-14*DAY).toISOString();
 const range=[start,previousStart,end];
 const specs=[
 ['bookingCohort',env.BOOKINGS_DB,`SELECT CASE WHEN created_at>=? THEN 'current' ELSE 'previous' END AS period, COUNT(*) AS total,
 SUM(CASE WHEN status IN (${active}) THEN 1 ELSE 0 END) AS active,
 SUM(CASE WHEN status='CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
 SUM(CASE WHEN status IN ('AVAILABILITY_CHECK','PAYMENT_PENDING') THEN 1 ELSE 0 END) AS pending
 FROM bookings WHERE created_at>=? AND created_at<? GROUP BY period`,range,'BOOKINGS_DB.bookings','Created booking cohorts; statuses as of snapshot; not payments or conversion.'],
 ['bookingOrigins',env.BOOKINGS_DB,`SELECT CASE WHEN created_at>=? THEN 'current' ELSE 'previous' END AS period,${allow('origin_code',origins)} AS dimension,COUNT(*) AS total FROM bookings WHERE created_at>=? AND created_at<? GROUP BY period,dimension`,range,'BOOKINGS_DB.bookings','Origin of created booking records, not searches.'],
 ['bookingTiers',env.BOOKINGS_DB,`SELECT CASE WHEN created_at>=? THEN 'current' ELSE 'previous' END AS period,${allow('plan_id',tiers)} AS dimension,COUNT(*) AS total FROM bookings WHERE created_at>=? AND created_at<? GROUP BY period,dimension`,range,'BOOKINGS_DB.bookings','Selected plan on created booking records.'],
 ['careCohort',env.HOTELS_DB,`SELECT CASE WHEN created_at>=? THEN 'current' ELSE 'previous' END AS period,COUNT(*) AS total,
 SUM(CASE WHEN adults>=1 AND children>=0 AND infants>=0 THEN 1 ELSE 0 END) AS familyKnown,
 SUM(CASE WHEN adults>=1 AND children>=0 AND infants>=0 AND adults+children+infants>=3 THEN 1 ELSE 0 END) AS family
 FROM iumrah_care_package_requests WHERE created_at>=? AND created_at<? GROUP BY period`,range,'HOTELS_DB.iumrah_care_package_requests','Party of 3+ proxy, not verified family relationship; request records, not unique clients.'],
 ['careMonths',env.HOTELS_DB,`SELECT CASE WHEN created_at>=? THEN 'current' ELSE 'previous' END AS period,
 CASE WHEN timing_mode='exact_dates' THEN substr(exact_start_date,1,7) WHEN timing_mode='flexible_month' THEN preferred_month ELSE 'other' END AS dimension,COUNT(*) AS total,
 SUM(CASE WHEN adults>=1 AND children>=0 AND infants>=0 AND adults+children+infants>=3 THEN 1 ELSE 0 END) AS family
 FROM iumrah_care_package_requests WHERE created_at>=? AND created_at<? GROUP BY period,dimension`,range,'HOTELS_DB.iumrah_care_package_requests','Requested departure month, not booked travel.'],
 ['careHotelClasses',env.HOTELS_DB,`SELECT CASE WHEN created_at>=? THEN 'current' ELSE 'previous' END AS period,CASE WHEN hotel_class IN (3,4,5) THEN CAST(hotel_class AS TEXT) ELSE 'other' END AS dimension,COUNT(*) AS total FROM iumrah_care_package_requests WHERE created_at>=? AND created_at<? GROUP BY period,dimension`,range,'HOTELS_DB.iumrah_care_package_requests','Requested hotel stars; not package tier.'],
 ['appSessions',env.HOTELS_DB,`WITH sessions AS (SELECT CASE WHEN occurred_at>=? THEN 'current' ELSE 'previous' END AS period,platform,visitor_id,session_id,
 MAX(CASE WHEN event_name='checkout_started' THEN 1 ELSE 0 END) AS checkout,
 MAX(CASE WHEN event_name='booking_submitted' THEN 1 ELSE 0 END) AS submitted,
 MAX(CASE WHEN event_name='error' THEN 1 ELSE 0 END) AS errors,MAX(CASE WHEN event_name='crash' THEN 1 ELSE 0 END) AS crashes
 FROM intelligence_external_events WHERE occurred_at>=? AND occurred_at<? GROUP BY period,platform,visitor_id,session_id)
 SELECT period,COUNT(*) AS total,SUM(checkout) AS checkout,SUM(submitted) AS submitted,SUM(checkout*submitted) AS both,SUM(errors) AS errors,SUM(crashes) AS crashes FROM sessions GROUP BY period`,range,'HOTELS_DB.intelligence_external_events','Distinct platform/visitor/session tuples per window; both events in same window, not ordered funnel or paid bookings; internal devices excluded.'],
 ['careDue',env.HOTELS_DB,`SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN response_due_at<? THEN 1 ELSE 0 END),0) AS due FROM iumrah_care_package_requests WHERE status='CARE_REQUEST'`,[end],'HOTELS_DB.iumrah_care_package_requests','Current CARE_REQUEST records past response_due_at; may have been contacted elsewhere.'],
 ];
 const metrics=Object.fromEntries(await Promise.all(specs.map(async ([id,db,sql,args,source,definition])=>{
  const meta={source,definition};try{
   if(!db)throw Error();const rows=(await db.prepare(sql).bind(...args).all()).results;if(!Array.isArray(rows))throw Error();
   const dimensioned=['bookingOrigins','bookingTiers','careMonths','careHotelClasses'].includes(id);
   const clean=rows.map(r=>{const c=cleanCounts(r);if(!('total'in c))throw Error();if(id==='careDue')return c;if(!['current','previous'].includes(r.period))throw Error();c.period=r.period;if(dimensioned){let d=r.dimension;if(id==='careMonths')d=typeof d==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(d)?d:'other';else if(![...origins,...tiers,'3','4','5','other'].includes(d))d='other';c.dimension=d;}return c;});
   // All dimensions are allowlisted; unknown month values are folded into one bucket.
   const grouped=new Map();for(const r of clean){const key=(r.period||'point')+'|'+(r.dimension||'');if(!grouped.has(key)){grouped.set(key,r);continue;}const o=grouped.get(key);for(const f of countFields)if(f in r){o[f]=(o[f]||0)+r[f];if(!number(o[f]))throw Error();}}
   return [id,{...meta,available:true,rows:[...grouped.values()]}];
  }catch{return [id,{...meta,available:false}];}
 })));
 return {version:1,asOf:end,windows:{current:{start,end},previous:{start:previousStart,end:start}},metrics,limitations:['No verified receipts, margin, marketing attribution or cancellation reasons in this contract.','Care, bookings and app analytics are separate populations; do not sum or divide across them.','Snapshot is current read; late/backfilled events may change historical aggregates.']};
}
