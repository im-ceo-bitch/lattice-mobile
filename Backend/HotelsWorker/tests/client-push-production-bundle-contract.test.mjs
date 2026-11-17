import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../migrations/0042_client_push_production_bundle.sql', import.meta.url), 'utf8');

function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test('client push registration uses the production com.iumrah.app topic', () => {
  assert.match(source, /const CLIENT_APP_BUNDLE_ID = 'com\.iumrah\.app';/);
  assert.ok(occurrences(source, 'appBundleID!==CLIENT_APP_BUNDLE_ID') >= 1);
  assert.ok(occurrences(source, 'appBundleID !== CLIENT_APP_BUNDLE_ID') >= 1);
  assert.doesNotMatch(source, /appBundleID[^\n]{0,200}com\.iumrah\.beta/);
});

test('client APNs delivery cannot fall back to the business topic', () => {
  assert.match(source, /fallbackTopic = BUSINESS_APP_BUNDLE_ID/);
  assert.match(source, /apple=>sendAPNsToRows\(env,apple,title,body,data,persistResult,CLIENT_APP_BUNDLE_ID\)/);
  assert.match(source, /deliverClientPushRows\(env, rows, title, body, data, persistResult,/);
  assert.match(source, /app_bundle_id=\?/);
});

test('legacy beta tokens are disabled instead of being incorrectly retagged', () => {
  assert.match(migration, /WHERE app_bundle_id = 'com\.iumrah\.beta'/);
  assert.doesNotMatch(migration, /SET\s+app_bundle_id\s*=\s*'com\.iumrah\.app'/i);
});
