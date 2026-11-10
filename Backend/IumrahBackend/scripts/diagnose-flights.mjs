// Read-only unless --probe-ignav is explicitly supplied.
// No credentials are printed or embedded in repository artifacts.
const base=(process.env.FLIGHT_HUB_URL || 'https://iumrah-backend.helloiumrah.workers.dev/api/flight-hub').replace(/\/+$/,'');
if (!base.startsWith('https://')) throw Error('Set an HTTPS FLIGHT_HUB_URL for this Worker');
const admin=process.env.FLIGHT_HUB_ADMIN_TOKEN || process.env.ADMIN_TOKEN || '';
async function call(path,{method='GET',body,secure=false}={}){
 const url=base+'/'+path.replace(/^\/+/, '');
 const response=await fetch(url,{method,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...(secure?{Authorization:'Bearer '+admin}:{})},
  ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 let parsed;
 try{parsed=await response.json();}catch{throw Error(`${path} returned HTTP ${response.status}, invalid JSON`);}
 return {status:response.status,data:parsed};
}
const publicResult=await call('v1/public/status');
if(publicResult.status!==200||!publicResult.data?.ok){
 console.error('Public Flight Hub unavailable:',publicResult.status,publicResult.data?.error||'UNKNOWN');
 process.exitCode=2;
}else{
 const d=publicResult.data;
 console.log(`Flight Hub at ${base} (server time ${d.generated_at})`);
 console.log(`Flights=${d.counts.flights} offers=${d.counts.offers} fresh priced=${d.counts.priced_flights}`);
 for(const s of d.sources){
  console.log(`${s.name.padEnd(16)} configured=${String(s.configured).padEnd(5)} last=${s.last_run?.status||'-'} `+
   `checked=${s.last_run?.checked_at||'-'} issue=${s.issue||'-'}`);
 }
}
if(admin){
 const diag=await call('v1/admin/flight-diagnostics',{secure:true});
 if(diag.status!==200){console.error(`Admin diagnostics failed HTTP ${diag.status}: ${diag.data.error||'UNKNOWN'}`);process.exitCode=2;}
 else{
  console.log('\nKeys available in Worker (booleans only):',JSON.stringify(diag.data.source_keys_present));
  for(const r of diag.data.monitor_runs.slice(0,12))console.log(`RUN ${r.provider} ${r.checked_at} ${r.status} ${r.message||''}`);
  for(const r of diag.data.searches.slice(0,8))console.log(`SEARCH ${r.source} ${r.search_key} ${r.status} ${r.items_count}`);
  console.log('APNs outbox:',JSON.stringify(diag.data.push_outbox));
 }
}else console.log('\nAdmin diagnostics skipped: set FLIGHT_HUB_ADMIN_TOKEN locally for authenticated details.');
if(process.argv.includes('--probe-ignav')){
 if(!admin)throw Error('--probe-ignav requires FLIGHT_HUB_ADMIN_TOKEN');
 const idx=process.argv.indexOf('--probe-ignav');
 const [origin,destination,departure_date]=process.argv.slice(idx+1,idx+4).map(s=>String(s||'').toUpperCase());
 if(!/^[A-Z]{3}$/.test(origin)||!/^[A-Z]{3}$/.test(destination)||!/\d{4}-\d\d-\d\d/.test(departure_date))
  throw Error('Usage: --probe-ignav TAS JED YYYY-MM-DD');
 console.log('\nSubmitting one Ignav fare query (may consume provider quota)...');
 const result=await call('v1/admin/ignav/search',{method:'POST',secure:true,body:{origin,destination,departure_date}});
 console.log('Ignav probe:',result.status,JSON.stringify(result.data));
 if(result.status!==200||!result.data.ok)process.exitCode=2;
}
