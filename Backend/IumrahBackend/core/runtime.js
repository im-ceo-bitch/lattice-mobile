import { AsyncLocalStorage } from 'node:async_hooks';
const storage = new AsyncLocalStorage();
export const ORIGIN = 'https://iumrah-backend.helloiumrah.workers.dev';
export function runCore(env,ctx,dispatch,fn) { return storage.run({env,ctx,dispatch},fn); }
export function getCloudflareContext() {
  const state=storage.getStore(); if(!state) throw Error('CORE_CONTEXT_REQUIRED');
  return {env:{...state.env,DB:state.env.BOOKINGS_DB,PASSPORTS:state.env.PASSPORTS},ctx:state.ctx};
}
export function requestEnv(){ return {...getCloudflareContext().env,NODE_ENV:'production'}; }
export function backendFetch(input,init) {
  const url=new URL(input instanceof Request?input.url:input,ORIGIN);
  const state=storage.getStore();
  if(url.origin===ORIGIN && state?.dispatch){
    const request=new Request(input instanceof Request?input:url,init); return state.dispatch(request);
  }
  return fetch(input,init);
}
export class NextResponse extends Response {
  cookies={set:(name,value,options={})=>{
    if(!/^[a-zA-Z0-9_-]+$/.test(name))throw Error('INVALID_COOKIE');
    let cookie=`${name}=${encodeURIComponent(value)}`;
    if(options.path)cookie+=`; Path=${options.path}`;
    if(options.maxAge!==undefined)cookie+=`; Max-Age=${Math.floor(options.maxAge)}`;
    if(options.httpOnly)cookie+='; HttpOnly';
    if(options.secure)cookie+='; Secure';
    if(options.sameSite)cookie+=`; SameSite=${options.sameSite}`;
    this.headers.append('set-cookie',cookie);
  }};
  static json(value,init={}){const headers=new Headers(init.headers);headers.set('content-type','application/json; charset=utf-8');return new NextResponse(JSON.stringify(value),{...init,headers});}
}
export class NextRequest extends Request {
  get nextUrl(){return new URL(this.url);}
  get cookies(){return {get:(name)=>{for(const pair of (this.headers.get('cookie')||'').split(';')){const i=pair.indexOf('=');if(i>=0&&pair.slice(0,i).trim()===name){try{return {value:decodeURIComponent(pair.slice(i+1).trim())}}catch{return undefined}}}return undefined;}};}
}
