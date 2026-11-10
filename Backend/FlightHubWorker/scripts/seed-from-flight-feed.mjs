// One-time safe import via existing iumrah Business public read-only Flight Sync.
// Reuses the same Flight Hub admin key as the current provision workflow.
// Does not import old prices or touch old D1. Does not print the feed URL.
import { extractPublicFeedIdentities, normalisePublicFeedURL } from '../src/flight-feed.js';
import { deriveServiceCredentials } from './ci-secret-derivation.mjs';
import { seedLocalFlightArtifactIfAvailable } from './seed-from-flight-artifact.mjs';

if (await seedLocalFlightArtifactIfAvailable()) {
  console.log('Used local kepler-ios flight artifact; no old account or feed credentials necessary.');
} else {

const raw = process.env.FLIGHT_SYNC_FEED_URL;
if (!raw) throw Error('FLIGHT_SYNC_FEED_URL_MISSING_IN_GITHUB_SECRETS');
const feedURL = normalisePublicFeedURL(raw);
const response = await fetch(feedURL, { headers: {Accept:'application/json'}, redirect:'error', signal:AbortSignal.timeout(25000) });
if (!response.ok) throw Error('FLIGHT_SYNC_FEED_HTTP_' + response.status);
const length = Number(response.headers.get('content-length') || 0);
if (length > 10_000_000) throw Error('FLIGHT_SYNC_FEED_TOO_LARGE');
const text = await response.text();
if (text.length > 10_000_000) throw Error('FLIGHT_SYNC_FEED_TOO_LARGE');
let data;
try { data = JSON.parse(text); } catch { throw Error('FLIGHT_SYNC_FEED_NOT_JSON_USE_DOT_JSON_URL'); }
const { records, stats } = extractPublicFeedIdentities(data);
console.log(JSON.stringify({source:'business_read_only_feed', ...stats, old_prices_imported:false},null,2));
if (!process.argv.includes('--push')) { console.log('Dry-run: no D1 writes.'); process.exit(0); }
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const hub = String(process.env.FLIGHT_HUB_URL || '').trim().replace(/\/+$/,'');
if (!hub || !hub.startsWith('https://')) throw Error('FLIGHT_HUB_URL_MISSING');
const { admin } = deriveServiceCredentials(account,token);
let accepted = 0, unmatched = 0, rejected = 0;
for (let i = 0; i < records.length; i += 100) {
  const r = await fetch(hub + '/v1/ingest/legacy_import', {
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+admin},
    body:JSON.stringify({records: records.slice(i,i+100),status:'ok'}),
    redirect:'error', signal:AbortSignal.timeout(25000)
  });
  if (!r.ok) throw Error('FLIGHT_HUB_IMPORT_HTTP_' + r.status);
  const answer = await r.json();
  accepted += Number(answer.accepted || 0);
  unmatched += Number(answer.unmatched || 0);
  rejected += Number(answer.rejected || 0);
}
console.log(JSON.stringify({created_or_matched:accepted, unmatched, rejected, imported_without_old_prices:true},null,2));
if (rejected || unmatched) process.exitCode = 1;

}
