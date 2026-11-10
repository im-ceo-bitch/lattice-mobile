// Called only from GitHub Actions. Mask derived credentials before export to GITHUB_ENV.
// v2 domain separation rotates tokens previously disclosed in workflow logs.
import fs from 'node:fs';
import { deriveServiceCredentials } from './ci-secret-derivation.mjs';
const output = process.env.GITHUB_ENV;
if (!output) throw new Error('GITHUB_ENV missing (GitHub Actions only)');
const { bot, admin } = deriveServiceCredentials(process.env.CLOUDFLARE_ACCOUNT_ID, process.env.CLOUDFLARE_API_TOKEN);
// GitHub parses add-mask commands, so all subsequent environment dumps/logs redact secrets.
// Never write these derived values to ordinary logs or uploaded artifacts.
process.stdout.write(`::add-mask::${bot}\n`);
process.stdout.write(`::add-mask::${admin}\n`);
fs.appendFileSync(output, `FLIGHT_HUB_BOT_TOKEN=${bot}\nFLIGHT_HUB_ADMIN_TOKEN=${admin}\n`, { encoding: 'utf8', mode: 0o600 });
console.log('Flight Hub service credentials rotated and masked.');
