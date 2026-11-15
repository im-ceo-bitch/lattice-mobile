import { publicCuratedFlightRecommendations } from './curated-flights';
import { publicAviasalesData } from './aviasales-data';
import type { Env } from './env';

// Smart is a selection policy, not another pricing engine. No fares, hotel rules
// or booking mutations are implemented here. The existing quote/resolve APIs
// still verify every chosen component.
type Leg = { origin: string; destination: string; departure_at: string; arrival_at: string; stops: number };
type Row = { id: string; outbound: Leg; inbound: Leg | null; nonstop: boolean; offerType: string; journeyRole: string };
export type SmartQuery = { origin: string; month: string; durationDays: number; both: boolean; firstCity: 'JED' | 'MED'; source?: 'published' | 'data' };
type Pair = { completeID?: string; outboundID?: string; returnID?: string; departureDay: string; returnDay: string; durationDays: number; deviation: number };
const dayMs = 86400000;
const date = (s: string) => new Date(s + 'T00:00:00Z');
const day = (d: Date) => d.toISOString().slice(0,10);
const add = (s: string, n: number) => day(new Date(date(s).getTime()+n*dayMs));
const days = (a: string,b: string) => Math.round((date(b).getTime()-date(a).getTime())/dayMs)+1;
const json = (v: unknown,status=200) => new Response(JSON.stringify(v), {status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export function smartRoute(q: SmartQuery) { return {out: q.both ? q.firstCity : 'JED', back: q.both && q.firstCity === 'JED' ? 'MED' : 'JED'}; }
export function validSmartQuery(q: SmartQuery, today: string) {
  return q && typeof q.origin==='string' && /^[A-Z]{3}$/.test(q.origin) && !['JED','MED'].includes(q.origin) &&
    typeof q.month==='string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(q.month) && q.month>=today.slice(0,7) &&
    q.month<=add(today,365).slice(0,7) && [3,7,10,14,20,25].includes(q.durationDays) && typeof q.both==='boolean' && ['JED','MED'].includes(q.firstCity);
}
export function rankSmartPublished(rows: Row[], q: SmartQuery, today: string): Pair[] {
  const route=smartRoute(q), result: Pair[]=[];
  const outboundOK=(l:Leg)=>l.origin===q.origin && l.destination===route.out && l.stops===0 && l.departure_at.slice(0,7)===q.month && l.departure_at.slice(0,10)>=today;
  const returnOK=(l:Leg)=>l.origin===route.back && l.destination===q.origin && l.stops===0;
  const addPair=(out:Leg,back:Leg,ids:Pick<Pair,'completeID'|'outboundID'|'returnID'>)=>{
    if (!outboundOK(out)||!returnOK(back)) return;
    const departureDay=out.departure_at.slice(0,10),returnDay=back.departure_at.slice(0,10);
    const durationDays=days(departureDay,returnDay),deviation=Math.abs(durationDays-q.durationDays);
    const nights=days(out.arrival_at.slice(0,10),returnDay)-1;
    if (!Number.isFinite(durationDays)||deviation>4||nights<(q.both?2:1)||Date.parse(back.departure_at)<=Date.parse(out.arrival_at)) return;
    result.push({...ids,departureDay,returnDay,durationDays,deviation});
  };
  const single=rows.filter(r=>r.nonstop && !r.inbound && r.offerType==='one_way');
  const returns=single.filter(r=>r.journeyRole==='return' && returnOK(r.outbound));
  for(const row of rows) {
    if(!row.nonstop||!outboundOK(row.outbound)) continue;
    if(row.inbound && row.journeyRole==='complete') addPair(row.outbound,row.inbound,{completeID:row.id});
    else if(!row.inbound && row.offerType==='one_way' && row.journeyRole==='outbound') {
      for(const back of returns) addPair(row.outbound,back.outbound,{outboundID:row.id,returnID:back.id});
    }
  }
  return result.sort((a,b)=>a.deviation-b.deviation||a.departureDay.localeCompare(b.departureDay)||a.returnDay.localeCompare(b.returnDay)).slice(0,8);
}
// Data API is a recent-search cache, never an Ignav/live flight search.
export type DataOffer = { id:string; origin:string; destination:string; departureAt:string; arrivalAt?:string|null; returnAt?:string|null; airlineCode:string; flightNumber:string; durationMinutes:number; transfers:number; price:number };
export type DataPair = { outbound:DataOffer; inbound:DataOffer; departureDay:string; returnDay:string; deviation:number; stops:number };
const arrival = (o:DataOffer) => Date.parse(o.departureAt)+o.durationMinutes*60000;
export function rankSmartData(outbound:DataOffer[], inbound:DataOffer[],q:SmartQuery,today:string):DataPair[] {
  const route=smartRoute(q), result:DataPair[]=[];
  const eligible=(o:DataOffer,from:string,to:string)=>o.origin===from&&o.destination===to&&!o.returnAt&&!!o.airlineCode&&!!o.flightNumber&&Number.isFinite(o.price)&&o.price>0&&Number.isFinite(o.durationMinutes)&&o.durationMinutes>0&&Number.isInteger(o.transfers)&&o.transfers>=0&&Number.isFinite(Date.parse(o.departureAt));
  const backs=inbound.filter(o=>eligible(o,route.back,q.origin));
  for(const out of outbound) {
    if(!eligible(out,q.origin,route.out)) continue;
    const departureDay=out.departureAt.slice(0,10);
    if(departureDay.slice(0,7)!==q.month||departureDay<today) continue;
    // Use Saudi local day for the overnight-arrival check, rather than UTC.
    const arrivalDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(arrival(out)));
    for(const back of backs) {
      const returnDay=back.departureAt.slice(0,10),deviation=Math.abs(days(departureDay,returnDay)-q.durationDays);
      if(!Number.isFinite(deviation)||deviation>4||days(arrivalDay,returnDay)-1<(q.both?2:1)||Date.parse(back.departureAt)<=arrival(out)) continue;
      result.push({outbound:out,inbound:back,departureDay,returnDay,deviation,stops:out.transfers+back.transfers});
    }
  }
  return result.sort((a,b)=>a.stops-b.stops||a.deviation-b.deviation||(a.outbound.price+a.inbound.price)-(b.outbound.price+b.inbound.price)||a.departureDay.localeCompare(b.departureDay)).slice(0,8);
}
async function dataOffers(request:Request,env:Env,origin:string,destination:string,month:string,direct:boolean):Promise<DataOffer[]> {
  const offers:DataOffer[]=[];
  for(let page=1;page<=3;page++) {
    const url=new URL(request.url); url.search='';
    for(const [key,value] of Object.entries({origin,destination,departure:month,view:direct?'direct':'offers',direct:String(direct),currency:'usd',limit:'100',page:String(page)})) url.searchParams.set(key,value);
    const response=await publicAviasalesData(url,env);
    if(!response.ok) throw new Error('SMART_DATA_UNAVAILABLE');
    const body=await response.json() as {ok:boolean;currency:string;offers:DataOffer[]};
    if(!body.ok||body.currency.toLowerCase()!=='usd') throw new Error('SMART_DATA_UNAVAILABLE');
    offers.push(...body.offers);
    if(body.offers.length<100) break;
  }
  return offers;
}
async function smartDataPairs(request:Request,env:Env,q:SmartQuery,today:string):Promise<DataPair[]> {
  const route=smartRoute(q), next=date(q.month+'-01');next.setUTCMonth(next.getUTCMonth()+1);
  const months=[q.month,day(next).slice(0,7)];
  const load=async(direct:boolean)=>{
    const [out,...back]=await Promise.all([dataOffers(request,env,q.origin,route.out,q.month,direct),...months.map(m=>dataOffers(request,env,route.back,q.origin,m,direct))]);
    return rankSmartData(out,back.flat(),q,today);
  };
  const direct=await load(true);
  if(direct.some(p=>p.stops===0)) return direct.filter(p=>p.stops===0);
  return load(false);
}
export async function smartConfiguratorPlan(request: Request,env: Env): Promise<Response> {
  let q: SmartQuery;
  try {q=await request.json() as SmartQuery;} catch {return json({ok:false,error:'INVALID_JSON'},400);}
  // Saudi/Uzbekistan day boundary: use origin local date for the supported region.
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  if(!validSmartQuery(q,today)) return json({ok:false,error:'INVALID_SMART_REQUEST'},400);
  if(q.source==='data') {
    try { return json({ok:true,published:[],dataPairs:await smartDataPairs(request,env,q,today)}); }
    catch { return json({ok:false,error:'SMART_DATA_UNAVAILABLE'},502); }
  }
  const end=date(q.month+'-01');end.setUTCMonth(end.getUTCMonth()+1);
  const url=new URL(request.url);url.searchParams.set('umrah_origin',q.origin);url.searchParams.set('from',q.month===today.slice(0,7)?today:q.month+'-01');url.searchParams.set('to',add(day(end),q.durationDays+4));
  const res=await publicCuratedFlightRecommendations(url,env.HOTELS_DB);
  if(!res.ok) return res;
  const data=await res.json() as {recommendations:Row[]};
  return json({ok:true, published:rankSmartPublished(data.recommendations,q,today),dataPairs:[]});
}
