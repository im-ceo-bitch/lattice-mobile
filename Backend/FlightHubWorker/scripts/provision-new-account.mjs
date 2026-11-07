// Explicit, idempotent provisioning. Requires only the NEW Cloudflare account.
// Creates / finds independent D1 Flight Hub; never touches hotel databases.
import fs from 'node:fs';
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!/^[a-f\d]{32}$/i.test(account||'') || !token) throw new Error('NEW_CLOUDFLARE_ACCOUNT_OR_TOKEN_MISSING');
const name = 'iumrah-flights';
const root = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database`;
const headers = {Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
async function api(url,init={}) {
 const resp=await fetch(url,{...init,headers});
 if (!resp.ok) throw new Error(`CLOUDFLARE_HTTP_${resp.status}`);
 const data=await resp.json();
 if (!data.success) throw new Error(`CLOUDFLARE_D1_API_FAILED_${JSON.stringify(data.errors||[]).slice(0,180)}`);
 return data;
}
let existing=[];
for (let page=1;page<=10;page++) {
 const res=await api(`${root}?page=${page}&per_page=100`);
 existing.push(...(res.result||[]));
 if ((res.result||[]).length<100) break;
}
async function ensureDB(name) {
 let db=existing.find(x=>x.name===name);
 if (!db) {
  const created=await api(root,{method:'POST',body:JSON.stringify({name,primary_location_hint:'apac'})});
  db=created.result;
  console.log(`Created new D1 ${name}`);
 } else console.log(`Reusing new-account D1 ${name}`);
 return db;
}
const db=await ensureDB(name);
// Deliberately empty until private operations/booking migrations pass audit.
const core=await ensureDB('iumrah-core');
const coreID=core?.uuid||core?.id;
if (!/^[a-f\d-]{36}$/i.test(coreID||'')) throw new Error('CORE_DATABASE_UUID_NOT_FOUND');
const databaseID=db?.uuid||db?.id;
if (!/^[a-f\d-]{36}$/i.test(databaseID||'')) throw new Error('DATABASE_UUID_NOT_FOUND');
// Runtime config is generated, never committed. No tokens or secrets in this file.
const template=fs.readFileSync(new URL('../wrangler.toml.example',import.meta.url),'utf8');
if (!template.includes('REPLACE_WITH_NEW_D1_ID')) throw new Error('CONFIG_PLACEHOLDER_MISSING');
fs.writeFileSync(new URL('../wrangler.generated.toml',import.meta.url),template.replace('REPLACE_WITH_NEW_D1_ID',databaseID),{mode:0o600});
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,`database_id=${databaseID}\ncore_database_id=${coreID}\n`);
console.log('Generated wrangler.generated.toml for NEW account (D1 identifier not a credential).');
