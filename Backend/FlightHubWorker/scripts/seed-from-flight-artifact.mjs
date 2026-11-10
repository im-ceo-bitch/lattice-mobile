// Seed public flight identities exported from the kepler-ios OLD Cloudflare audit.
// Never uploads historic fares, hotel data, or client data. No old account keys required.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { normaliseFlight, eligibleFlightDay } from '../src/core.js';
import { deriveServiceCredentials } from './ci-secret-derivation.mjs';

export const artifactFileURL = new URL('./data/flight-identities.json', import.meta.url);
const airlines = new Set(['C6','HY','XY']);
const uzbekAirports = new Set(['TAS','FEG','NMA','AZN','SKD','BHK','KSQ','TMJ','UGC']);
const saudiAirports = new Set(['JED','MED','TIF']);
const fields = new Set(['airline_code','flight_number','origin','destination','departure_date','departure_at','arrival_at']);

export function prepareFlightIdentities(artifact, now = new Date()) {
  if (!artifact || artifact.version !== 1 || artifact.scope !== 'public_flight_identities_only' || !Array.isArray(artifact.records))
    throw Error('INVALID_FLIGHT_ARTIFACT');
  if (artifact.records.length > 2000) throw Error('ARTIFACT_TOO_LARGE');
  const accepted = [], seen = new Set();
  const stats = { export_count: artifact.records.length, future_eligible: 0, expired_or_departed: 0, duplicates: 0, invalid: 0 };
  for (const raw of artifact.records) {
    // Reject unexpected fields rather than accidentally importing personal or price data.
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k=> !fields.has(k))) {
      stats.invalid++; continue;
    }
    try {
      const item = normaliseFlight(raw, 'legacy_import');
      if (!airlines.has(item.airline_code) ||
          !((uzbekAirports.has(item.origin) && saudiAirports.has(item.destination)) ||
            (saudiAirports.has(item.origin) && uzbekAirports.has(item.destination)))) {
        stats.invalid++; continue;
      }
      if (!eligibleFlightDay(item.departure_date, now) ||
          (item.departure_at && Date.parse(item.departure_at) <= now.getTime())) {
        stats.expired_or_departed++; continue;
      }
      if (seen.has(item.key)) { stats.duplicates++; continue; }
      seen.add(item.key);
      accepted.push({
        airline_code: item.airline_code, flight_number: item.flight_number,
        origin: item.origin, destination: item.destination, departure_date: item.departure_date,
        departure_at: item.departure_at, arrival_at: item.arrival_at
      });
      stats.future_eligible++;
    } catch { stats.invalid++; }
  }
  if (stats.invalid) throw Error('FLIGHT_ARTIFACT_CONTAINS_INVALID_RECORDS_' + stats.invalid);
  return { records: accepted, stats };
}

export async function seedLocalFlightArtifactIfAvailable({ path = artifactFileURL, now = new Date(), push = process.argv.includes('--push'), request = fetch } = {}) {
  if (!existsSync(path)) return false;
  const text = await readFile(path, 'utf8');
  if (text.length > 2_000_000) throw Error('ARTIFACT_FILE_TOO_LARGE');
  const {records, stats} = prepareFlightIdentities(JSON.parse(text), now);
  console.log(JSON.stringify({source: 'kepler_ios_export_2026_11_10', ...stats, old_prices_imported: false},null,2));
  if (!records.length) throw Error('NO_FUTURE_VALID_FLIGHTS_IN_ARTIFACT');
  if (!push) { console.log('Dry-run: no new D1 writes.'); return true; }

  const hub = String(process.env.FLIGHT_HUB_URL || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+$/.test(hub)) throw Error('FLIGHT_HUB_URL_MISSING_OR_INVALID');
  const account = process.env.NEW_CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.NEW_CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
  const { admin } = deriveServiceCredentials(account, token);
  if (!admin) throw Error('FLIGHT_HUB_ADMIN_AUTH_MISSING');
  let imported=0, rejected=0, unmatched=0;
  for (let i=0; i<records.length; i+=100) {
    const reply = await request(hub + '/v1/ingest/legacy_import', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: records.slice(i, i + 100), status: 'ok' }),
      redirect: 'error', signal: AbortSignal.timeout(25000)
    });
    if (!reply.ok) throw Error('FLIGHT_HUB_IMPORT_HTTP_' + reply.status);
    const json = await reply.json();
    imported += Number(json.accepted ?? 0);
    rejected += Number(json.rejected ?? 0);
    unmatched += Number(json.unmatched ?? 0);
  }
  console.log(JSON.stringify({seeded_or_matched: imported, rejected, unmatched, historic_prices_imported: false}, null, 2));
  if (imported !== records.length || rejected || unmatched) throw Error('FLIGHT_ARTIFACT_IMPORT_INCOMPLETE');
  return true;
}
