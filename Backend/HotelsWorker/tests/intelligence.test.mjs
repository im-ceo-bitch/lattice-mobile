import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { intelligenceIngest, intelligenceAdmin, intelligenceOverview, runIntelligenceReport, validateIntelligenceBatch } from '../src/intelligence.js';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

function batch() {
  return { visitorId: randomUUID(), sessionId: randomUUID(), platform: 'ios', appVersion: '1.0', events: [
    { id: randomUUID(), name: 'screen_view', screen: 'flight_results', elementId: 'search_button' }
  ] };
}

test('accepts only bounded pseudonymous UUID events', () => {
  const received = validateIntelligenceBatch(batch());
  assert.equal(received.events[0].eventName, 'screen_view');
  assert.equal(received.platform, 'ios');
  assert.equal(validateIntelligenceBatch({ ...batch(), visitorId: 'real_person_name' }), null);
  assert.equal(validateIntelligenceBatch({ ...batch(), events: [{ id: randomUUID(), name: 'passport_uploaded' }] }), null);
  assert.equal(validateIntelligenceBatch({ ...batch(), events: [{ id: randomUUID(), name: 'tap', screen: 'secret@mail.com' }] }), null);
  assert.equal(validateIntelligenceBatch({ ...batch(), platform: 'web' })?.platform, 'web');
  assert.equal(validateIntelligenceBatch({ ...batch(), events: Array(31).fill({ id: randomUUID(), name: 'tap' }) }), null);
});

test('ingestion writes ONLY whitelisted columns, never arbitrary client properties', async () => {
  const captured = [];
  const env = { HOTELS_DB: {
    prepare(sql) {
      if (sql.includes('sqlite_master')) {
        const names = ['intelligence_events','intelligence_reports','intelligence_ai_threads','intelligence_ai_messages','intelligence_ai_usage'];
        return { async all() { return { results: names.map(name => ({name})) }; } };
      }
      return { bind(...args) { captured.push({ sql, args }); return { sql, args }; } };
    },
    async batch(statements) { assert.equal(statements.length, 1); return []; }
  } };
  const payload = batch();
  payload.email = 'private@example.com';
  payload.events[0].secret = 'passport';
  const request = new Request('https://iumrah.app/api/catalog/hotels/intelligence/events', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
  });
  const response = await intelligenceIngest(request, env);
  assert.equal(response.status, 202);
  assert.equal((await response.json()).accepted, 1);
  assert.equal(captured.length, 1);
  assert.ok(!captured[0].args.includes('private@example.com'));
  assert.ok(!captured[0].args.includes('passport'));
});

test('anonymous event ingestion rejects malformed data', async () => {
  const response = await intelligenceIngest(new Request('https://iumrah.app/api/catalog/hotels/intelligence/events', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...batch(), platform: 'bad' })
  }), { HOTELS_DB: {} });
  assert.equal(response.status, 400);
});

test('admin intelligence access is superadmin only', async () => {
  const url = new URL('https://iumrah.app/api/admin/hotels/intelligence');
  const response = await intelligenceAdmin(new Request(url), {}, url, { role: 'admin' });
  assert.equal(response.status, 403);
});


function sqliteD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(new URL('../migrations/0044_business_intelligence.sql', import.meta.url), 'utf8'));
  const prepare = sql => {
    const statement = sqlite.prepare(sql);
    const wrapped = params => ({
      async first() { return statement.get(...params) ?? null; },
      async all() { return { results: statement.all(...params) }; },
      async run() { const info = statement.run(...params); return { meta: { changes: Number(info.changes) } }; },
      bind(...bound) { return wrapped(bound); }
    });
    return wrapped([]);
  };
  return { sqlite, env: { HOTELS_DB: {
    prepare,
    async batch(stmts) { return Promise.all(stmts.map(stmt => stmt.run())); }
  } } };
}

test('D1 migration, ingest, funnel, screen durations and 90-day retention integrate correctly', async () => {
  const { sqlite, env } = sqliteD1();
  const visitor = randomUUID();
  const payload = { ...batch(), visitorId: visitor, events: [
    { id: randomUUID(), name: 'app_open', screen: 'home' },
    { id: randomUUID(), name: 'screen_view', screen: 'flights' },
    { id: randomUUID(), name: 'screen_exit', screen: 'flights', durationMs: 12500 },
    { id: randomUUID(), name: 'search_started', screen: 'flights' }
  ] };
  const request = () => new Request('https://iumrah.app/api/catalog/hotels/intelligence/events', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
  });
  assert.equal((await intelligenceIngest(request(), env)).status, 202);
  assert.equal((await intelligenceIngest(request(), env)).status, 202); // retries are idempotent
  const overview = await intelligenceOverview(env, 7);
  assert.equal(overview.events, 4);
  assert.equal(overview.visitors, 1);
  assert.equal(overview.funnel.find(s => s.event === 'app_open').visitors, 1);
  assert.equal(overview.screens[0].averageSeconds, 13);
  sqlite.close();
});

test('scheduled analysis never calls Gemini on insufficient data and is once per day', async () => {
  const { sqlite, env } = sqliteD1();
  const first = await runIntelligenceReport(env);
  assert.equal(first.status, 'no_data');
  const duplicate = await runIntelligenceReport(env);
  assert.equal(duplicate.skipped, 'already_running_or_done');
  sqlite.close();
});

test('Gemini report gets aggregate-only payload, persists advice and never receives raw visitor IDs', async () => {
  const { sqlite, env } = sqliteD1();
  env.GEMINI_API_KEY = 'test-gemini-key-not-real';
  const visitors = [randomUUID(), randomUUID(), randomUUID()];
  for (const visitor of visitors) {
    const payload = { ...batch(), visitorId: visitor, events: Array.from({ length: 4 }, () => ({
      id: randomUUID(), name: 'app_open', screen: 'home'
    })) };
    const request = new Request('https://iumrah.app/api/catalog/hotels/intelligence/events', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
    });
    assert.equal((await intelligenceIngest(request, env)).status, 202);
  }
  const originalFetch = globalThis.fetch;
  let requested = false;
  try {
    globalThis.fetch = async (url, options) => {
      requested = true;
      assert.match(url, /generativelanguage.googleapis.com\/v1beta\/models\/gemini-3.8-flash:generateContent/);
      assert.equal(options.headers['x-goog-api-key'], env.GEMINI_API_KEY);
      const body = JSON.stringify(JSON.parse(options.body));
      for (const id of visitors) assert.ok(!body.includes(id));
      assert.ok(!body.includes('sessionId'));
      assert.match(body, /"responseMimeType":"application\/json"/);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        summary: 'Сессии есть, но данных по выбору отеля пока нет.',
        recommendations: [{ area: 'UX', priority: 'medium', finding: 'Не измерен выбор отеля',
          recommendation: 'Добавить hotel_selected', metric: 'Число hotel_selected / уникальные посетители' }]
      }) }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const result = await runIntelligenceReport(env, { manual: true });
    assert.equal(result.status, 'ready');
    assert.equal(result.report.recommendations[0].area, 'UX');
    assert.equal(requested, true);
    assert.equal(sqlite.prepare("SELECT status FROM intelligence_reports").get().status, 'ready');
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});
