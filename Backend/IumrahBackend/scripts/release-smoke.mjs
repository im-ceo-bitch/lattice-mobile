// Production read checks plus login/logout of an explicitly dedicated test account.
// Do not run with a real customer's credentials. No request/response data is logged.
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const origin='https://iumrah-backend.helloiumrah.workers.dev';
function assert(ok,label){if(!ok)throw Error(label);}
export async function releaseSmoke(env=process.env,fetcher=fetch,publicOnly=false){
 const done=[];let token='',cookie='';
 async function call(p,{method='GET',body,headers={},status=200,label=p,raw=false}={}){
  const res=await fetcher(origin+p,{method,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(45000)});
  assert((Array.isArray(status)?status:[status]).includes(res.status),`${label}:HTTP_${res.status}`);
  return raw?res:res.json().catch(()=>{throw Error(`${label}:INVALID_JSON`);});
 }
 const mark=name=>done.push(name);
 const health=await call('/__iumrah/health');assert(health.service==='iumrah-backend'&&health.modules?.core&&health.modules?.packages,'BACKEND_HEALTH');mark('unified backend');
 const date=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date()).replaceAll('/','-');
 for(const city of ['makkah','madinah']){
  const prayer=await call(`/api/services/prayer?city=${city}&date=${date}`);assert(['Fajr','Dhuhr','Asr','Maghrib','Isha'].every(k=>typeof prayer.data?.timings?.[k]==='string'),'PRAYER_DATA');
  const weather=await call(`/api/services/weather?city=${city}`);assert(weather.properties?.timeseries?.length>0,'WEATHER_DATA');
 }
 mark('prayer and weather');const fx=await call('/api/services/fx');assert(fx.some?.(x=>x.Ccy==='USD'&&Number(String(x.Rate).replace(/ /g,'').replace(',','.'))>0),'FX_DATA');mark('exchange rates');
 for(const lang of ['ru','uz','en']){const translations=await call(`/api/services/advisor/translations?lang=${lang}`);assert(Array.isArray(translations)&&translations.length>100,'ADVISOR_TEXT');}
 const audio=await call('/api/services/advisor/audio?lang=ru');assert(Array.isArray(audio)&&audio.length>0&&audio[0].url.startsWith('/api/services/advisor/audio/ru/'),'ADVISOR_AUDIO_LIST');
 const recording=await call(audio[0].url,{raw:true,label:'ADVISOR_AUDIO'});const bytes=new Uint8Array(await recording.arrayBuffer());assert(bytes.length>1000&&bytes[0]!==60&&bytes[0]!==123,'ADVISOR_AUDIO_CONTENT');mark('Advisor text and audio');
 const flights=await call('/v1/public/flights?limit=1');assert(Array.isArray(flights.flights)&&flights.flights.length>0,'FLIGHTS_EMPTY');mark('flight catalogue');
 if(publicOnly)return {done,publicOnly:true,releaseReady:false};
 const cutover=await call('/__iumrah/cutover');assert(cutover.coreCutoverEnabled&&cutover.schemaReady&&(cutover.migrationAttested||cutover.cleanLaunchAttested)&&cutover.providerConfigurationReady,'CORE_NOT_READY');mark('cutover and provider configuration');
 for(const k of ['SMOKE_TEST_IDENTIFIER','SMOKE_TEST_PASSWORD','SMOKE_EXPECTED_IUMRAH_ID','SMOKE_BOOKING_ID','SMOKE_BOOKING_TOKEN','SMOKE_STAFF_LOGIN','SMOKE_STAFF_PASSWORD'])assert(typeof env[k]==='string'&&env[k].length>0,'MISSING_'+k);
 assert(env.SMOKE_DEDICATED_TEST_ACCOUNT==='1','DEDICATED_TEST_ACCOUNT_REQUIRED');
 const bookingPath='/api/bookings/'+encodeURIComponent(env.SMOKE_BOOKING_ID);
 const accountBase='/api/catalog/hotels/client/account';const packageBase='/api/package/client/account';
 try{
  await call(accountBase+'/session',{status:401});await call(bookingPath,{status:404,headers:{'x-booking-token':'x'.repeat(32)},label:'BOOKING_UNAUTHORIZED'});mark('unauthenticated access denied');
  const device={installationID:randomUUID(),secret:randomBytes(32).toString('base64url'),name:'Release smoke test',model:'CI',platform:'iOS',locale:'ru'};
  const login=await call(packageBase+'/login',{method:'POST',body:{identifier:env.SMOKE_TEST_IDENTIFIER,password:env.SMOKE_TEST_PASSWORD,device} ,label:'PASSWORD_LOGIN'});
  token=login.session?.token||'';assert(token&&login.account?.iumrahID===env.SMOKE_EXPECTED_IUMRAH_ID,'LOGIN_ID_MISMATCH');const headers={Authorization:`Bearer ${token}`,'x-iumrah-device-id':device.installationID,'x-iumrah-device-secret':device.secret};
  const session=await call(accountBase+'/session',{headers});assert(session.account?.iumrahID===env.SMOKE_EXPECTED_IUMRAH_ID,'SESSION_ID_MISMATCH');mark('account/password/session');
  for(const [p,label] of [[packageBase+'/security','sessions'],[packageBase+'/public-card','iumrah ID'],[packageBase+'/friends','Gift Cards'],['/api/catalog/hotels/client/trips','trip history']]){const data=await call(p,{headers,label});assert(data&&data.ok!==false,label);mark(label);}
  const wallet=await call(packageBase+'/wallet-pass',{headers,raw:true,label:'APPLE_WALLET'});assert((wallet.headers.get('content-type')||'').includes('application/vnd.apple.pkpass'),'WALLET_CONTENT_TYPE');const pass=new Uint8Array(await wallet.arrayBuffer());assert(pass[0]===0x50&&pass[1]===0x4b,'WALLET_INVALID_ZIP');mark('Apple Wallet');
  const booking=await call(bookingPath,{headers:{'x-booking-token':env.SMOKE_BOOKING_TOKEN},label:'EXISTING_BOOKING'});assert(booking.booking?.id===env.SMOKE_BOOKING_ID,'BOOKING_ID_MISMATCH');mark('existing test booking');
  const telegram=await call('/api/package/booking/'+encodeURIComponent(env.SMOKE_BOOKING_ID)+'/telegram-status',{headers:{'x-booking-token':env.SMOKE_BOOKING_TOKEN},label:'TELEGRAM_STATUS'});assert(telegram.ok===true&&typeof telegram.linked==='boolean','TELEGRAM_STATUS_DATA');mark('Telegram booking status');
  const staff=await call('/api/auth/staff/login',{method:'POST',body:{login:env.SMOKE_STAFF_LOGIN,password:env.SMOKE_STAFF_PASSWORD},raw:true,label:'STAFF_LOGIN'});cookie=(staff.headers.get('set-cookie')||'').split(';')[0];assert(cookie,'STAFF_COOKIE');
  const staffSession=await call('/api/auth/staff/session',{headers:{cookie}});assert(staffSession.authenticated===true,'STAFF_SESSION');
  const list=await call('/api/admin/bookings',{headers:{cookie}});assert(Array.isArray(list.bookings),'BUSINESS_BOOKINGS');mark('Business authentication and bookings');
 }finally{
  if(token)await call(accountBase+'/logout',{method:'POST',body:{},headers:{Authorization:`Bearer ${token}`},label:'TEST_LOGOUT'});
  if(cookie)await call('/api/auth/staff/logout',{method:'POST',body:{},headers:{cookie},label:'STAFF_LOGOUT'});
 }
 return {done,publicOnly:false,releaseReady:false,note:'Automated checks passed; OTP, Apple/Google sign-in, create/commit booking, provider deliveries, R2 access and TestFlight remain separate release gates.'};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){try{const r=await releaseSmoke(process.env,fetch,process.argv.includes('--public-only'));console.log(JSON.stringify(r,null,2));}catch(e){console.error('RELEASE_SMOKE_BLOCKED:',/^[A-Za-z0-9_ /:-]+$/.test(e.message)?e.message:'NETWORK_OR_PROVIDER_ERROR');process.exitCode=1;}}
