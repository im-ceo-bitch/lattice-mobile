// Resolve the newly deployed Worker URL from the NEW account, without manual URL secrets.
import fs from 'node:fs';
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!/^[a-f0-9]{32}$/i.test(account ?? '') || !token) throw new Error('CLOUDFLARE_CREDENTIALS_MISSING');
const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/subdomain`, {
  headers:{Authorization:`Bearer ${token}`}
});
if (!response.ok) throw new Error(`WORKERS_SUBDOMAIN_REQUEST_FAILED_${response.status}`);
const payload = await response.json();
const subdomain = payload?.result?.subdomain;
if (!payload?.success || typeof subdomain !== 'string' || !/^[a-z0-9-]{1,63}$/.test(subdomain)) {
 throw new Error('WORKERS_DEV_SUBDOMAIN_NOT_CONFIGURED: enable workers.dev subdomain in new Cloudflare account');
}
const url=`https://iumrah-backend.${subdomain}.workers.dev`;
if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV,`FLIGHT_HUB_URL=${url}\n`);
console.log(`iumrah backend public endpoint: ${url}`);
