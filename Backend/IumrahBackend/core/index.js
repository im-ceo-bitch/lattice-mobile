import {routes} from './routes.js';
import {NextRequest,NextResponse,runCore} from './runtime.js';
export function resolveCoreRoute(path){return routes.find(r=>r.pattern.test(path));}
export default {
 async fetch(request,env,ctx,dispatch){
  const match=resolveCoreRoute(new URL(request.url).pathname);
  if(!match)return NextResponse.json({error:'NOT_FOUND'},{status:404});
  const handler=match.handlers[request.method];
  if(typeof handler!=='function')return NextResponse.json({error:'METHOD_NOT_ALLOWED'},{status:405});
  let params;try{params=Object.fromEntries(match.keys.map((k,i)=>[k,decodeURIComponent(match.pattern.exec(new URL(request.url).pathname)[i+1])]));}catch{return NextResponse.json({error:'INVALID_PATH'},{status:400});}
  return runCore(env,ctx,dispatch,async()=>{
    try {return await handler(new NextRequest(request),{params:Promise.resolve(params)});}
    catch(e){console.error('CORE_ROUTE_ERROR',request.method,new URL(request.url).pathname.split('/').slice(0,3).join('/'),e?.name);return NextResponse.json({error:'CORE_REQUEST_FAILED'},{status:500,headers:{'cache-control':'no-store'}});}
  });
 }
};
