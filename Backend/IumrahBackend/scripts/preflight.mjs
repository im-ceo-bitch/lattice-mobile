// One-click staging preflight: resources must exist in the chosen account.
// Schema issues are warnings, not identity mismatches; never silently route
// production traffic to a partially migrated database.
import {buildConfig} from './render-config.mjs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

async function check(env = process.env, fetcher = fetch) {
  const accountID = String(env.CLOUDFLARE_ACCOUNT_ID || '');
  const token = String(env.CLOUDFLARE_API_TOKEN || '');
  if (!/^[a-f\d]{32}$/i.test(accountID) || !token) throw Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required');
  const cfg = buildConfig(env);
  const origin = `https://api.cloudflare.com/client/v4/accounts/${accountID}`;
  const headers = {Authorization:`Bearer ${token}`};
  async function get(url) {
    const res=await fetcher(url,{headers});
    if (!res.ok) throw Error(`Cloudflare API HTTP ${res.status}: verify resource ownership and token permissions`);
    const data=await res.json();
    if (!data.success) throw Error(`Cloudflare API error HTTP ${res.status}`);
    return data.result;
  }
  const results=[];
  for (const db of cfg.d1_databases) {
    const info=await get(`${origin}/d1/database/${encodeURIComponent(db.database_id)}`);
    if (String(info?.name||'')!==db.database_name) throw Error(`${db.binding} is not named ${db.database_name} in this Cloudflare account`);
    results.push(`${db.binding}: confirmed D1 ${info.name}`);
    const required=db.binding==='HOTELS_DB'?['hotels']:(db.binding==='BOOKINGS_DB'?['bookings']:['flights','flight_offers']);
    try {
      const schema=await fetcher(`${origin}/d1/database/${encodeURIComponent(db.database_id)}/query`,{
        method:'POST',headers:{...headers,'Content-Type':'application/json'},
        body:JSON.stringify({sql:"SELECT name FROM sqlite_master WHERE type='table'"})
      });
      if (!schema.ok) throw Error(`HTTP ${schema.status}`);
      const schemaJSON=await schema.json();
      if (!schemaJSON.success) throw Error('schema query failed');
      const found=new Set((schemaJSON.result?.[0]?.results||[]).map(row=>String(row.name||'')));
      const missing=required.filter(name=>!found.has(name));
      if (missing.length) results.push(`WARNING ${db.binding}: missing legacy tables ${missing.join(', ')}; related APIs may fail until data/schema are migrated`);
      else results.push(`${db.binding}: expected legacy tables present`);
    } catch(error) {
      results.push(`WARNING ${db.binding}: cannot inspect schema (${error.message}); API compatibility not verified`);
    }
  }
  for (const {binding,bucket_name:bucket} of cfg.r2_buckets) {
    const info=await get(`${origin}/r2/buckets/${encodeURIComponent(bucket)}`);
    if (!info || String(info.name||'')!==bucket) throw Error(`${binding} bucket ${bucket} is absent in this account`);
    results.push(`${binding}: found existing ${bucket}`);
  }
  for(const binding of ['HOTELS_MEDIA','PASSPORTS']) if(!cfg.r2_buckets.some(x=>x.binding===binding)) results.push(`WARNING ${binding}: R2 is not connected; related media endpoints will be unavailable`);
  if (cfg.routes.length) throw Error('ONE_CLICK_DEPLOY_MUST_NOT_CHANGE_PRODUCTION_ROUTES');
  const allowedCrons = ['*/5 * * * *'];
  if (cfg.triggers.crons.some(cron => !allowedCrons.includes(cron))) throw Error('UNEXPECTED_CRON');
  return results;
}
export {check};
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    for (const result of await check()) console.log(result);
    console.log('PREFLIGHT COMPLETE: no production HTTP routes changed; configured cron schedules allowed.');
  } catch (error) { console.error('PREFLIGHT_BLOCKED:', error.message); process.exitCode=1; }
}
