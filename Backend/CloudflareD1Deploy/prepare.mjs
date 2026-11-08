/**
 * Prepare D1 destinations in the NEW account without touching old production.
 * This script intentionally does NOT export/copy data or alter Workers routes.
 * The pre-existing iumrah-flights database is our safety fingerprint for the
 * new account. Refuse all writes when it is missing.
 */
const apiBase = 'https://api.cloudflare.com/client/v4';

export async function prepareD1({ accountId, token, fetcher = fetch }) {
  if (!/^[a-f0-9]{32}$/i.test(accountId || '')) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID must be the 32-character ID of the NEW Cloudflare account.');
  }
  if (!token || token.length < 20) {
    throw new Error('CLOUDFLARE_API_TOKEN is absent or too short.');
  }
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const request = async (path, init = {}) => {
    const response = await fetcher(`${apiBase}/accounts/${accountId}${path}`, { ...init, headers });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = null; }
    if (!response.ok || body?.success === false || !body) {
      const details = Array.isArray(body?.errors) ? body.errors.map(e => `${e.code || ''}: ${e.message || ''}`).join('; ') : '';
      throw new Error(`Cloudflare D1 request rejected (HTTP ${response.status})${details ? ` — ${details}` : ''}`);
    }
    return body;
  };

  const databases = [];
  for (let page = 1; page <= 20; page += 1) {
    const payload = await request(`/d1/database?per_page=100&page=${page}`);
    if (!Array.isArray(payload.result)) throw new Error('Cloudflare returned an unexpected D1 listing.');
    databases.push(...payload.result);
    const totalPages = Number(payload.result_info?.total_pages || 0);
    if (totalPages ? page >= totalPages : payload.result.length < 100) break;
    if (page === 20) throw new Error('D1 inventory truncated: more than 20 listing pages.');
  }
  const byName = name => databases.find(item => item.name === name);
  const flights = byName('iumrah-flights');
  if (!flights) {
    throw new Error('Safety stop: iumrah-flights was not found. Verify the NEW Cloudflare account ID and create that D1 first. No database was changed.');
  }
  const flightsId = flights.uuid || flights.id;
  if (!flightsId) throw new Error('iumrah-flights exists but has no database ID.');

  let core = byName('iumrah-core');
  let created = false;
  if (!core) {
    const result = await request('/d1/database', {
      method: 'POST',
      body: JSON.stringify({ name: 'iumrah-core' }),
    });
    core = result.result;
    created = true;
  }
  const coreId = core?.uuid || core?.id;
  if (!coreId) throw new Error('iumrah-core has no database ID after preparation.');
  return { flightDatabase: 'iumrah-flights', coreDatabase: 'iumrah-core', createdCore: created };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const summary = await prepareD1({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_API_TOKEN,
    });
    console.log(`Verified existing ${summary.flightDatabase} and ${summary.createdCore ? 'created' : 'verified'} ${summary.coreDatabase}.`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFileSync } = await import('node:fs');
      const lines = [
        '### Cloudflare D1 preparation',
        '- `iumrah-flights`: existing; flight schema applied in next step',
        `- \`iumrah-core\`: ${summary.createdCore ? 'created empty' : 'existing, unchanged'}`,
        '- R2: disabled; production Workers and routes: unchanged',
        '- Customer records: **not copied by this preparation job**',
        '',
      ];
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));

    }
  } catch (error) {
    console.error(`D1 preparation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
