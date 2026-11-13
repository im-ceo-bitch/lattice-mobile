// Existing public, RLS-restricted anon key moved from iOS. Not a service-role key.
// The operator can rotate it using UMRAH_ADVISOR_SUPABASE_ANON_KEY without an app build.
const publicAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvYXFyc2FwbnB5dXRzeGZsc3J1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQzNjE2OTcsImV4cCI6MjA3OTkzNzY5N30.iycnHay3nX__40VTKzvkyX3NKbSo8wWqBhKGKGl2yIo';
const origin='https://coaqrsapnpyutsxflsru.supabase.co';
const languages=new Set(['ar','bn','en','fr','id','kk','ms','ru','tr','uz']);
export function validAudio(value){try{const u=new URL(value);return u.origin===origin&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname.startsWith('/storage/v1/object/public/')&&/\.mp3$/i.test(u.pathname)?u.href:null;}catch{return null;}}
export async function liveAdvisor(lang,kind,catalog,fetcher,env){
 if(!languages.has(lang))return {};
 const translations=kind==='translations';const tables=translations?['translations2','translations']:['audio_urls','audio'];
 const allowed=new Set(Object.values(translations?catalog.translations:catalog.audio).flatMap(m=>Object.keys(m)));
 const key=env.UMRAH_ADVISOR_SUPABASE_ANON_KEY||publicAnonKey;
 for(const table of tables){try{
   const url=new URL(`${origin}/rest/v1/${table}`);url.searchParams.set('select',translations?'key,value':'key,url');url.searchParams.set('lang',`eq.${lang}`);
   const res=await fetcher(url.href,{redirect:'error',signal:AbortSignal.timeout(3000),headers:{apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json'},cf:{cacheEverything:true,cacheTtlByStatus:{'200-299':300,'300-599':0}}});
   if(!res.ok)continue;const rows=await res.json();if(!Array.isArray(rows))continue;
   const result=Object.create(null);for(const row of rows){if(!allowed.has(row?.key))continue;const value=translations?row.value:validAudio(row.url);if(typeof value==='string'&&value.length>0&&value.length<=50000)result[row.key]=value;}
   if(Object.keys(result).length)return result;
 }catch{}}
 return {};
}
