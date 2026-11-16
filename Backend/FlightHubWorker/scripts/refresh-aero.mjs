// Explicit operator action. No price is retrieved and at most three schedules are queried.
const base=String(process.env.FLIGHT_HUB_URL||'').replace(/\/+$/,'');
const token=process.env.FLIGHT_HUB_ADMIN_TOKEN||process.env.ADMIN_TOKEN;
if(!/^https:\/\/iumrah-backend\.[a-z0-9-]+\.workers\.dev$/.test(base)||!token)throw Error('UNIFIED_BACKEND_OR_ADMIN_CREDENTIAL_MISSING');
const response=await fetch(base+'/v1/admin/aerodatabox/refresh',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({limit:3}),signal:AbortSignal.timeout(90000)});
const result=await response.json().catch(()=>null);
console.log('AeroDataBox status:',response.status,result?.status||result?.error||'UNKNOWN','checked:',result?.results?.length??0,'matched:',result?.results?.filter(r=>r.match).length??0);
if(!response.ok||result?.ok!==true)process.exitCode=1;
