import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);

test('unified deployment never references absent Flight Hub SQL files', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.scripts.deploy, 'node scripts/apply-flights-migrations.mjs && wrangler deploy --config wrangler.generated.jsonc');
  const migration = fs.readFileSync(new URL('scripts/apply-flights-migrations.mjs',root),'utf8');
  assert.match(migration,/0003_monitor_task_checks\.sql/);
  assert.match(migration,/0004_itinerary_catalog\.sql/);
  assert.match(migration,/0005_catalog_sources\.sql/);
  assert.match(migration,/0006_catalog_route_guard\.sql/);
  assert.match(migration,/--remote/);
  assert.equal(pkg.scripts['dry-run'], 'wrangler deploy --dry-run --config wrangler.generated.jsonc');
});

test('Flight Hub CI credentials are masked before reaching subsequent job environments', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iumrah-ci-mask-'));
  try {
    const envFile = path.join(tempDir, 'github-env.txt');
    const script = fileURLToPath(new URL('../FlightHubWorker/scripts/write-ci-service-keys.mjs', root));
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_ENV: envFile,
        CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
        CLOUDFLARE_API_TOKEN: 'ci-regression-token-that-is-not-real',
        FLIGHT_HUB_BOT_TOKEN: '',
        FLIGHT_HUB_ADMIN_TOKEN: '',
        BOT_INGEST_TOKEN: '',
        ADMIN_TOKEN: ''
      }
    });
    assert.equal(result.status, 0, result.stderr);
    const credentials = Object.fromEntries(fs.readFileSync(envFile, 'utf8').trim().split('\n').map(s => {
      const separator = s.indexOf('=');
      return [s.slice(0, separator), s.slice(separator + 1)];
    }));
    assert.equal(credentials.FLIGHT_HUB_BOT_TOKEN, credentials.BOT_INGEST_TOKEN);
    assert.equal(credentials.FLIGHT_HUB_ADMIN_TOKEN, credentials.ADMIN_TOKEN);
    assert.notEqual(credentials.FLIGHT_HUB_BOT_TOKEN, credentials.FLIGHT_HUB_ADMIN_TOKEN);
    const lines = result.stdout.split('\n');
    for (const value of [credentials.FLIGHT_HUB_BOT_TOKEN, credentials.FLIGHT_HUB_ADMIN_TOKEN]) {
      assert.ok(lines.includes(`::add-mask::${value}`), 'missing GitHub Actions masking directive');
    }
    assert.ok(result.stdout.indexOf('::add-mask::') < result.stdout.indexOf('Service authorization'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
