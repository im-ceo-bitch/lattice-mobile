import type {Env} from "./env";
const origin="https://iumrah-backend.helloiumrah.workers.dev";
function unavailable(){return Response.json({ok:false,error:"UNIFIED_TELEGRAM_UNAVAILABLE"},{status:503});}
function auth(request:Request){const h=new Headers({"content-type":"application/json"});for(const name of ["authorization","x-booking-token","x-iumrah-device-id","x-iumrah-device-secret"]){const value=request.headers.get(name);if(value)h.set(name,value);}return h;}
export async function createTelegramBookingLink(request:Request,bookingID:string,env:Env):Promise<Response>{
 if(!env.IUMRAH_CORE_FETCH)return unavailable();
 const payload=await request.json().catch(()=>({})) as Record<string,unknown>;
 return env.IUMRAH_CORE_FETCH(origin+"/api/telegram/link",{method:"POST",headers:auth(request),body:JSON.stringify({bookingId:bookingID,language:payload?.language})});
}
export async function getTelegramBookingStatus(request:Request,bookingID:string,env:Env):Promise<Response>{
 if(!env.IUMRAH_CORE_FETCH)return unavailable();
 return env.IUMRAH_CORE_FETCH(origin+"/api/telegram/link?bookingId="+encodeURIComponent(bookingID),{headers:auth(request)});
}
