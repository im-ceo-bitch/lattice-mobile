// Firebase HTTP v1 transport for Cloudflare Workers. No Firebase Admin SDK or Node runtime required.
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const encoder = new TextEncoder();
const apnsPattern = /^[0-9a-f]{32,256}$/i;
const fcmPattern = /^[A-Za-z0-9_:-]{32,4096}$/;

// Existing iOS and Android clients share com.iumrah.app. Their token formats
// distinguish transport without changing existing D1 tables or client contracts.
export function normalizeClientPushToken(value) {
  if (typeof value !== 'string') return null;
  const token = value.trim();
  if (apnsPattern.test(token)) return token.toLowerCase();
  return fcmPattern.test(token) ? token : null;
}
export function clientPushProvider(token) {
  if (typeof token !== 'string') return null;
  if (apnsPattern.test(token)) return 'apns';
  return fcmPattern.test(token) ? 'fcm' : null;
}
function credentials(env) {
  try {
    const raw = env.FCM_SERVICE_ACCOUNT_JSON;
    if (typeof raw !== 'string') return null;
    const c = JSON.parse(raw);
    if (c.type !== 'service_account' || typeof c.project_id !== 'string' || !/^[a-z][a-z0-9-]{4,62}$/.test(c.project_id) ||
        typeof c.client_email !== 'string' || !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(c.client_email) ||
        typeof c.private_key !== 'string' || !/^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----\s*$/.test(c.private_key)) return null;
    return c;
  } catch { return null; }
}
export const fcmConfigured = env => !!credentials(env);
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const encode = value => b64url(encoder.encode(JSON.stringify(value)));
const keyBytes = pem => Uint8Array.from(atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'')), c=>c.charCodeAt(0));
let cached = null;
async function oauthToken(env,c,fetcher) {
  const secret = env.FCM_SERVICE_ACCOUNT_JSON;
  const now = Date.now();
  if (cached?.secret === secret && cached.expiresAt > now + 60_000) return cached.token;
  // Cache completed credentials only: Worker I/O promises must not cross requests.
  {
    const iat = Math.floor(Date.now()/1000);
    const header = encode({alg:'RS256',typ:'JWT',...(typeof c.private_key_id==='string'?{kid:c.private_key_id}:{})});
    const claims = encode({iss:c.client_email,scope:SCOPE,aud:TOKEN_URL,iat,exp:iat+3600});
    const input = `${header}.${claims}`;
    const key = await crypto.subtle.importKey('pkcs8',keyBytes(c.private_key),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,encoder.encode(input));
    const assertion = `${input}.${b64url(new Uint8Array(signature))}`;
    const response = await fetcher(TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),redirect:'error',signal:AbortSignal.timeout(10000)});
    const result = await response.json().catch(()=>null);
    if (!response.ok || typeof result?.access_token !== 'string' || !result.access_token || !Number.isFinite(Number(result.expires_in)) || Number(result.expires_in)<=0) throw Error('FCM_OAUTH_FAILED');
    cached = {secret,token:result.access_token,expiresAt:Date.now()+Math.min(Number(result.expires_in),3600)*1000};
    return cached.token;
  }
}
export function fcmMessage(token,title,body,data={}) {
  return {message:{token,notification:{title:String(title),body:String(body)},data:Object.fromEntries(Object.entries(data).filter(([,v])=>v!==null&&v!==undefined).map(([k,v])=>[k,String(v)])),android:{priority:'HIGH',ttl:'3600s',notification:{channel_id:'iumrah_trip_updates',icon:'ic_stat_iumrah_notification',sound:'default'}}}};
}
export async function sendFCM(env,token,title,body,data={},fetcher=fetch) {
  const c=credentials(env);
  if(!c) return {ok:false,disable:false,error:'FCM_NOT_CONFIGURED'};
  if(clientPushProvider(token)!=='fcm') return {ok:false,disable:false,error:'FCM_INVALID_TOKEN'};
  let bearer;
  try {bearer=await oauthToken(env,c,fetcher);} catch {return {ok:false,disable:false,error:'FCM_OAUTH_FAILED'};}
  const send=accessToken=>fetcher(`https://fcm.googleapis.com/v1/projects/${c.project_id}/messages:send`,{method:'POST',headers:{authorization:`Bearer ${accessToken}`,'content-type':'application/json'},body:JSON.stringify(fcmMessage(token,title,body,data)),redirect:'error',signal:AbortSignal.timeout(10000)});
  try {
    let response=await send(bearer);
    if(response.status===401){
      if(cached?.secret===env.FCM_SERVICE_ACCOUNT_JSON&&cached.token===bearer)cached=null;
      try{bearer=await oauthToken(env,c,fetcher);}catch{return {ok:false,disable:false,error:'FCM_OAUTH_FAILED'};}
      response=await send(bearer);
    }
    if(response.ok) return {ok:true,response};
    const result=await response.json().catch(()=>null);
    const code=result?.error?.details?.find?.(x=>x?.['@type']==='type.googleapis.com/google.firebase.fcm.v1.FcmError')?.errorCode;
    const safeCode=typeof code==='string'&&/^[A-Z_]{1,60}$/.test(code)?code:'HTTP_ERROR';
    // INVALID_ARGUMENT may also mean an invalid payload: never revoke on it.
    return {ok:false,response,disable:safeCode==='UNREGISTERED',error:`FCM_${response.status}_${safeCode}`};
  } catch {return {ok:false,disable:false,error:'FCM_NETWORK_FAILED'};}
}

// Fail one transport independently; never send FCM tokens to Apple or vice versa.
export async function deliverClientPushRows(env,rows,title,body,data,persistResult,sendApple,appleReady) {
  const apple=rows.filter(r=>clientPushProvider(r.device_token)==='apns');
  const android=rows.filter(r=>clientPushProvider(r.device_token)==='fcm');
  let sent=0;
  if(apple.length&&appleReady){
    try{const result=await sendApple(apple);sent+=Number(result?.sent||0);}catch{console.warn('CLIENT_APNS_DELIVERY_FAILED');}
  }
  if(android.length&&fcmConfigured(env)){
    // Prime the completed-token cache before bounded parallel sends.
    // Never share an in-flight network promise between Worker requests.
    try { await oauthToken(env,credentials(env),fetch); } catch {
      for (const device of android) {
        try { await persistResult(device,{ok:false,disable:false,error:'FCM_OAUTH_FAILED'}); } catch {}
      }
      return {ok:sent>0,sent,total:rows.length};
    }
    for(let i=0;i<android.length;i+=8){
      const results=await Promise.all(android.slice(i,i+8).map(async device=>{
        const result=await sendFCM(env,device.device_token,title,body,data);
        try{await persistResult(device,result);}catch{console.warn('CLIENT_FCM_RESULT_PERSIST_FAILED');}
        return result.ok?1:0;
      }));
      sent+=results.reduce((a,b)=>a+b,0);
    }
  }
  return {ok:sent>0,sent,total:rows.length,...(!rows.length?{skipped:'NO_DEVICES'}:{})};
}
