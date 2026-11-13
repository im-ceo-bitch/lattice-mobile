import catalog from './advisor-catalog.js';
import {liveAdvisor,validAudio} from './advisor-provider.js';
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const json=(body,status=200,ttl=0)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':ttl?`public, max-age=${ttl}`:'no-store','x-content-type-options':'nosniff','access-control-allow-origin':'*'}});
const error=(code,status)=>json({ok:false,error:code},status);
const cities={makkah:[21.4225,39.8262],madinah:[24.4672,39.6111]};
function audioPath(lang,key){return `/api/services/advisor/audio/${encodeURIComponent(lang)}/${encodeURIComponent(key)}`;}
function validDate(value){if(!/^\d{2}-\d{2}-\d{4}$/.test(value))return false;const [d,m,y]=value.split('-').map(Number);const t=new Date(Date.UTC(y,m-1,d));return t.getUTCFullYear()===y&&t.getUTCMonth()===m-1&&t.getUTCDate()===d&&y>=2020&&y<=2100;}
async function upstream(url,fetcher,kind,ttl){
 try {
  const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(12000),headers:{'User-Agent':'iumrah-backend/1.0 (https://iumrah.app; support@iumrah.app)',Accept:kind==='audio'?'audio/*':'application/json'},cf:{cacheEverything:true,cacheTtlByStatus:{'200-299':ttl,'300-599':0}}});
  if(!response.ok)return error('UPSTREAM_UNAVAILABLE',502);
  if(kind==='audio'){
   const ct=(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
   if(!['audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','application/octet-stream'].includes(ct))return error('INVALID_UPSTREAM_AUDIO',502);
   const length=Number(response.headers.get('content-length')||0);if(length>25*1024*1024)return error('AUDIO_TOO_LARGE',502);
   // Stream the published recording; never forward provider cookies or redirects.
   return new Response(response.body,{headers:{'content-type':ct,'cache-control':`public, max-age=${ttl}`,'x-content-type-options':'nosniff','access-control-allow-origin':'*'}});
  }
  const data=await response.json();
  const valid=kind==='prayer'?data?.code===200&&typeof data?.data?.timings?.Fajr==='string':kind==='weather'?Array.isArray(data?.properties?.timeseries)&&data.properties.timeseries.length>0:Array.isArray(data)&&data.some(row=>row?.Ccy==='USD'&&Number(String(row.Rate).replace(/ /g,'').replace(',','.'))>0);
  return valid?json(data,200,ttl):error('INVALID_UPSTREAM_DATA',502);
 }catch{return error('UPSTREAM_UNAVAILABLE',502);}
}
export async function publicServices(request,fetcher=fetch,env){
 if(request.method!=='GET')return error('METHOD_NOT_ALLOWED',405);
 const url=new URL(request.url),p=url.pathname;
 if(p==='/api/services/health')return json({ok:true,service:'iumrah-public-services',release:'v21-rc',advisorLanguages:Object.keys(catalog.translations).length,audioLanguages:Object.keys(catalog.audio).length});
 if(p==='/api/services/fx')return upstream('https://cbu.uz/en/arkhiv-kursov-valyut/json/',fetcher,'fx',3600);
 if(p==='/api/services/prayer'||p==='/api/services/weather'){
  const city=url.searchParams.get('city');if(!own(cities,city))return error('INVALID_CITY',400);
  const [lat,lon]=cities[city];
  if(p.endsWith('/weather'))return upstream(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`,fetcher,'weather',900);
  const date=url.searchParams.get('date')||'';if(!validDate(date))return error('INVALID_DATE',400);
  return upstream(`https://api.aladhan.com/v1/timings/${date}?latitude=${lat}&longitude=${lon}&method=4&school=0`,fetcher,'prayer',21600);
 }
 if(p==='/api/services/advisor/translations'||p==='/api/services/advisor/audio'){
  const lang=url.searchParams.get('lang')||'';if(!/^[a-z]{2}$/.test(lang))return error('INVALID_LANGUAGE',400);
  const translations=p.endsWith('/translations'),map=translations?catalog.translations:catalog.audio;
  const merged={...(own(map,lang)?map[lang]:{}),...(env?await liveAdvisor(lang,translations?'translations':'audio',catalog,fetcher,env):{})};
  return json(Object.entries(merged).map(([key,value])=>translations?{key,value}:{key,url:audioPath(lang,key)}),200,300);
 }
 const match=p.match(/^\/api\/services\/advisor\/audio\/([a-z]{2})\/([a-z0-9_]+)$/);
 if(match){const [,lang,key]=match;
  if(!Object.values(catalog.audio).some(entries=>own(entries,key)))return error('AUDIO_NOT_FOUND',404);
  const fallback=own(catalog.audio,lang)&&own(catalog.audio[lang],key)?catalog.audio[lang][key]:null;
  const live=env?await liveAdvisor(lang,'audio',catalog,fetcher,env):{};
  const source=validAudio(own(live,key)?live[key]:fallback);if(!source)return error('AUDIO_NOT_FOUND',404);
  return upstream(source,fetcher,'audio',86400);
 }
 return error('NOT_FOUND',404);
}
