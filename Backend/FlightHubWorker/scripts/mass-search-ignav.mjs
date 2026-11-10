// Manual, budget-capped 30-day Ignav route sweep. Uses existing Flight Hub ingestion
// token and operator-held provider key, without adding any Worker or GitHub Secrets.
// Dry run by default; --push incurs REAL Ignav requests.
import {tashkentDay} from '../src/core.js';
const UZ=['TAS','FEG','NMA','AZN','SKD','BHK','KSQ','TMJ','UGC'];
const KSA=['JED','MED','TIF'];
const argv=process.argv.slice(2);
const option=(key,defaultValue)=>{const p=argv.indexOf(key);return p===-1?defaultValue:argv[p+1];};
const max=Math.max(1,Math.min(100,Number(option('--max-searches','60'))||60));
const days=Math.max(1,Math.min(30,Number(option('--days','30'))||30));
const origins=String(option('--uz-airports',UZ.join(','))).split(',').map(x=>x.trim().toUpperCase()).filter(x=>UZ.includes(x));
const destination=String(option('--sa-airports',KSA.join(','))).split(',').map(x=>x.trim().toUpperCase()).filter(x=>KSA.includes(x));
if(!origins.length||!destination.length)throw Error('NO_SUPPORTED_AIRPORTS');
const candidate=[];
for(let d=0;d<=days;d++){
 const day=new Date(tashkentDay()+'T00:00:00Z');day.setUTCDate(day.getUTCDate()+d);
 for(const uz of origins)for(const sa of destination){
  candidate.push({origin:uz,destination:sa,departure_date:day.toISOString().slice(0,10)});
  candidate.push({origin:sa,destination:uz,departure_date:day.toISOString().slice(0,10)});
 }
}
// Stride covers many origins/dates every run, rather than retrying first 60 pairs.
// A complete deterministic sweep over the 30-day horizon without rechecking
// nearly identical sets on consecutive calendar days. 29 is coprime with
// 1674 default route/day combinations; fall back to a coprime stride otherwise.
const gcd=(a,b)=>b?gcd(b,a%b):a;
let stride=29;
while(gcd(stride,candidate.length)!==1)stride+=2;
const dayIndex=Math.floor(Date.now()/86400000);
const start=(dayIndex*max)%candidate.length;
const selected=Array.from({length:Math.min(max,candidate.length)},(_,i)=>candidate[((start+i)*stride)%candidate.length]);
console.log(JSON.stringify({searches_total:candidate.length,selected:selected.length,
    mode:argv.includes('--push')?'LIVE':'DRY_RUN',routes:selected},null,2));
if(!argv.includes('--push'))process.exit(0);
const apiKey=process.env.IGNAV_API_KEY;
const ingestToken=process.env.FLIGHT_HUB_IGNAV_TOKEN;
const hub=String(process.env.FLIGHT_HUB_URL||'').replace(/\/$/,'');
if(!apiKey||!ingestToken||!hub.startsWith('https://'))throw Error('Set IGNAV_API_KEY, FLIGHT_HUB_IGNAV_TOKEN and HTTPS FLIGHT_HUB_URL');
let imported=0,failed=0,skipped=0;
for(const search of selected){
 const upstream=await fetch('https://ignav.com/api/fares/one-way',{
  method:'POST',headers:{'X-Api-Key':apiKey,'Content-Type':'application/json'},
  body:JSON.stringify({...search,adults:1,cabin_class:'economy'})});
 if(upstream.status===429||upstream.status===402){console.error('Ignav quota or throttle reached; stopped without retry loop');break;}
 if(!upstream.ok){failed++;console.error('Ignav HTTP',upstream.status,search);continue;}
 const source=await upstream.json();
 const pushed=await fetch(hub+'/v1/ingest/ignav/response',{method:'POST',
  headers:{'Authorization':'Bearer '+ingestToken,'Content-Type':'application/json'},body:JSON.stringify(source)});
 if(!pushed.ok){failed++;console.error('Flight Hub rejected source payload',pushed.status);continue;}
 const response=await pushed.json();imported+=response.imported||0;skipped+=response.skipped||0;
 // A low, stable request rate; never brute force Ignav.
 await new Promise(resolve=>setTimeout(resolve,1500));
}
console.log(JSON.stringify({imported,skipped,failed},null,2));
if(failed)process.exitCode=1;
