// Called by GitHub Actions only; credentials go into GITHUB_ENV and are registered for masking.
import fs from 'node:fs';
import { deriveServiceCredentials } from './ci-secret-derivation.mjs';
const output = process.env.GITHUB_ENV;
if (!output) throw new Error('GITHUB_ENV missing (this script is intended for GitHub Actions)');
const derived = deriveServiceCredentials(process.env.CLOUDFLARE_ACCOUNT_ID,process.env.CLOUDFLARE_API_TOKEN);
const bot = process.env.FLIGHT_HUB_BOT_TOKEN || derived.bot;
const admin = process.env.FLIGHT_HUB_ADMIN_TOKEN || derived.admin;
// Derived credentials are NOT automatically redacted by GitHub Actions. Mask them
// before they are injected into subsequent step environments (which can be logged).
function mask(value) {
  if (!value) return;
  const escaped = String(value).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A');
  process.stdout.write(`::add-mask::${escaped}\n`);
}
for (const value of new Set([derived.bot,derived.admin,bot,admin,process.env.BOT_INGEST_TOKEN,process.env.ADMIN_TOKEN])) mask(value);
fs.appendFileSync(output,`FLIGHT_HUB_BOT_TOKEN=${bot}\nFLIGHT_HUB_ADMIN_TOKEN=${admin}\n${process.env.BOT_INGEST_TOKEN?'':`BOT_INGEST_TOKEN=${bot}\n`}${process.env.ADMIN_TOKEN?'':`ADMIN_TOKEN=${admin}\n`}`,{encoding:'utf8',mode:0o600});
console.log('Service authorization derived for this deployment. No extra GitHub secrets required.');
