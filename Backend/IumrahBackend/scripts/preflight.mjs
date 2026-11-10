// Read-only preflight. Verifies that every existing D1 database and R2 bucket
// belongs to the exact SAME Cloudflare account before publishing a unified Worker.
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
    if (!res.ok) throw Error(`Cloudflare API returned HTTP ${res.status}; verify permissions and account`);
    const data=await res.json();
    if (!data.success) throw Error(`Cloudflare API reported an error (${res.status})`);
    return data.result;
  }
  const results = [];
  for (const db of cfg.d1_databases) {
    const info = await get(`${origin}/d1/database/${encodeURIComponent(db.database_id)}`);
    if (String(info?.name || '') !== db.database_name) throw Error(`${db.binding} is not named ${db.database_name} in this account; stop to avoid wrong database`);
    const schema = await fetcher(`${origin}/d1/database/${encodeURIComponent(db.database_id)}/query`,{
      method:'POST', headers:{...headers,'Content-Type':'application/json'},
      body:JSON.stringify({sql:"SELECT name FROM sqlite_master WHERE type='table'"})
    });
    if (!schema.ok) throw Error(`Could not inspect ${db.binding} schema: HTTP ${schema.status}`);
    const schemaJSON=await schema.json();
    if (!schemaJSON.success) throw Error(`Could not inspect ${db.binding} schema`);
    const found=new Set((schemaJSON.result?.[0]?.results||[]).map(row=>String(row.name||'')));
    const required=db.binding==='HOTELS_DB'?['hotels']:(db.binding==='BOOKINGS_DB'?['bookings']:['flights','flight_offers']);
    for (const table of required) if (!found.has(table)) throw Error(`${db.binding} is missing expected production table ${table}; stop before deployment`);
    results.push(`${db.binding}: found existing ${info.name} with required tables`);
  }
  const bucket=cfg.r2_buckets[0].bucket_name;
  const info=await get(`${origin}/r2/buckets/${encodeURIComponent(bucket)}`);
  if (!info || String(info.name||'')!==bucket) throw Error(`HOTELS_MEDIA bucket ${bucket} is absent in this account`);
  results.push(`HOTELS_MEDIA: found existing ${bucket}`);
  // Staging has no routes. When routes are opted in, verify zone ownership.
  if (cfg.routes.length) {
    const zoneRes=await fetcher(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(env.CLOUDFLARE_ZONE_ID)}`,{headers});
    if (!zoneRes.ok) throw Error(`ZONE_INACCESSIBLE_HTTP_${zoneRes.status}`);
    const zone=await zoneRes.json();
    if (!zone.success || String(zone.result?.name)!=='iumrah.app') throw Error('ZONE_ID_IS_NOT_IUMRAH_APP');
    results.push('ZONE: iumrah.app accessible');
  }
  return results;
}
export { check };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    for (const result of await check()) console.log(result);
    console.log('PASS: All bindings exist in ONE account. No resources were modified.');
  } catch (error) { console.error('PREFLIGHT_BLOCKED:', error.message); process.exitCode=1; }
}
