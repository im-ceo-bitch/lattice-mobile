// Called by GitHub Actions only; secrets are written to $GITHUB_ENV, never to stdout.
import fs from 'node:fs';
import { deriveServiceCredentials } from './ci-secret-derivation.mjs';
const output = process.env.GITHUB_ENV;
if (!output) throw new Error('GITHUB_ENV missing (this script is intended for GitHub Actions)');
const {bot,admin} = deriveServiceCredentials(process.env.CLOUDFLARE_ACCOUNT_ID,process.env.CLOUDFLARE_API_TOKEN);
fs.appendFileSync(output,`FLIGHT_HUB_BOT_TOKEN=${bot}\nFLIGHT_HUB_ADMIN_TOKEN=${admin}\n`,{encoding:'utf8',mode:0o600});
console.log('Service authorization derived for this deployment. No extra GitHub secrets required.');
