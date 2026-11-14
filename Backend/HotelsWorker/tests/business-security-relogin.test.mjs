import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { HOTEL_PRICE_TTL_MS, HOTEL_PRICE_RETRY_MS } from '../src/hotel-price.js';

const source = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace('export default {', 'const workerDefault = {')
  .replace(/export class /g, 'class ')
  .replace(/^export (?=async function )/gm, '')
  .replace(/^export \{[^}]+\};\s*$/gm, '');

function bindingFor(db) {
  const wrap = sql => {
    let values = [];
    return {
      bind(...params) { values = params; return this; },
      async first() { return db.prepare(sql).get(...values) || null; },
      async all() { return { results: db.prepare(sql).all(...values) }; },
      async run() { const result = db.prepare(sql).run(...values); return { ...result, meta: { changes: Number(result.changes || 0) } }; }
    };
  };
  return {
    prepare: wrap,
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const statement of statements) out.push(await statement.run());
        db.exec('COMMIT');
        return out;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  const dir = new URL('../migrations/', import.meta.url);
  for (const name of fs.readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(new URL(name, dir), 'utf8'));
  }
  const fn = new Function(
    'WorkflowEntrypoint','HOTEL_PRICE_TTL_MS','HOTEL_PRICE_RETRY_MS',
    `${source}\nreturn { registerBusinessSession, revokeBusinessSession, businessSessionForRequest, listBusinessSecurityEvents };`
  );
  const api = fn(class {}, HOTEL_PRICE_TTL_MS, HOTEL_PRICE_RETRY_MS);
  return { db, env: { HOTELS_DB: bindingFor(db) }, api };
}

const user = { login: 'owner', role: 'superadmin' };
const primaryPayload = {
  installationID: 'primary-installation-0001',
  installationSecret: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  deviceName: 'iPhone 11', deviceModel: 'iPhone 11', hardwareIdentifier: 'iPhone12,1',
  platform: 'ios', osName: 'iOS', osVersion: '27.0.1', appVersion: '0.1.0', appBuild: '11',
  locale: 'ru_UZ', timeZone: 'Asia/Tashkent'
};
const macPayload = {
  installationID: 'mac-installation-0000001',
  installationSecret: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  deviceName: 'MacBook Pro', deviceModel: 'MacBook Pro', hardwareIdentifier: 'MacBookPro18,3',
  platform: 'macos', osName: 'macOS', osVersion: '15.8.0', appVersion: '0.1.0', appBuild: '11',
  locale: 'ru_UZ', timeZone: 'Asia/Tashkent'
};

function registrationRequest(payload, reauthenticated = false) {
  const headers = { 'content-type': 'application/json' };
  if (reauthenticated) headers['x-iumrah-business-reauthenticated'] = '1';
  return new Request('https://iumrah.app/api/admin/hotels/security/sessions/register', {
    method: 'POST', headers, body: JSON.stringify(payload)
  });
}

function authenticatedRequest(token, path = '/api/admin/hotels/security/sessions') {
  return new Request(`https://iumrah.app${path}`, { headers: { 'x-iumrah-business-session': token } });
}

test('primary termination revokes only the session; the same device can log in again after password reauthentication', async () => {
  const f = fixture();

  const primaryResponse = await f.api.registerBusinessSession(registrationRequest(primaryPayload, true), f.env, user);
  assert.equal(primaryResponse.status, 201);
  const primary = await primaryResponse.json();
  assert.equal(primary.currentSession.isPrimary, true);

  const macResponse = await f.api.registerBusinessSession(registrationRequest(macPayload, true), f.env, user);
  assert.equal(macResponse.status, 201);
  const mac = await macResponse.json();
  assert.equal(mac.currentSession.deviceModel, 'MacBook Pro');
  assert.equal(mac.currentSession.platform, 'macos');

  const currentPrimary = await f.api.businessSessionForRequest(authenticatedRequest(primary.sessionToken), f.env, user);
  const revoked = await f.api.revokeBusinessSession(f.env, user, currentPrimary, mac.currentSession.id);
  assert.equal(revoked.status, 200);

  const macDevice = f.db.prepare('SELECT revoked_at FROM business_security_devices WHERE id=?').get(mac.currentSession.deviceID);
  assert.equal(macDevice.revoked_at, null, 'ending a session must not permanently block the device');

  // Simulate a device already blocked by the previous production policy.
  f.db.prepare('UPDATE business_security_devices SET revoked_at=?, revoked_by_device_id=? WHERE id=?')
    .run('2026-10-04T06:00:00.000Z', primary.currentSession.deviceID, mac.currentSession.deviceID);

  const passiveRestore = await f.api.registerBusinessSession(registrationRequest(macPayload, false), f.env, user);
  assert.equal(passiveRestore.status, 401);
  assert.equal((await passiveRestore.json()).error, 'SESSION_REAUTH_REQUIRED');

  const forged = await f.api.registerBusinessSession(registrationRequest(macPayload, true), f.env, user);
  assert.equal(forged.status, 401, 'a client header alone cannot reactivate');
  const beforeRevocation = await f.api.registerBusinessSession(registrationRequest(macPayload, true), f.env, {...user, authenticatedAt: Date.now()-60_000});
  assert.equal(beforeRevocation.status, 401, 'a cookie issued before revocation cannot reactivate');
  await new Promise(resolve => setTimeout(resolve, 5));
  const reloginResponse = await f.api.registerBusinessSession(registrationRequest(macPayload, true), f.env, {...user, authenticatedAt: Date.now()});
  assert.equal(reloginResponse.status, 201);
  const relogin = await reloginResponse.json();
  assert.notEqual(relogin.currentSession.id, mac.currentSession.id);
  assert.equal(relogin.currentSession.deviceModel, 'MacBook Pro');
  assert.equal(f.db.prepare('SELECT revoked_at FROM business_security_devices WHERE id=?').get(mac.currentSession.deviceID).revoked_at, null);

  const currentMac = await f.api.businessSessionForRequest(authenticatedRequest(relogin.sessionToken), f.env, user);
  const eventsResponse = await f.api.listBusinessSecurityEvents(f.env, new URL('https://iumrah.app/api/admin/hotels/security/events?limit=8'), user, currentMac);
  const events = await eventsResponse.json();
  assert.ok(events.events.length >= 3);
  assert.equal(events.events[0].deviceModel, 'MacBook Pro');
  assert.equal(events.events[0].isCurrent, true);
});

test('client contains native Mac Catalyst identification and Telegram-style new-login banner hooks', () => {
  const descriptor = fs.readFileSync(new URL('../../../Sources/Core/BusinessSessionSecurity.swift', import.meta.url), 'utf8');
  const sessionsView = fs.readFileSync(new URL('../../../Sources/Views/BusinessSessionsView.swift', import.meta.url), 'utf8');
  const overview = fs.readFileSync(new URL('../../../Sources/Views/OverviewView.swift', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../../../Sources/Networking/APIClient.swift', import.meta.url), 'utf8');

  assert.match(descriptor, /targetEnvironment\(macCatalyst\)/);
  assert.match(descriptor, /let platform = "macos"/);
  assert.match(descriptor, /let osName = "macOS"/);
  assert.match(descriptor, /friendlyModelName/);
  assert.match(sessionsView, /laptopcomputer/);
  assert.match(overview, /Text\("Новый вход"\)/);
  assert.match(overview, /businessSecurityEvents/);
  assert.match(api, /X-Iumrah-Business-Reauthenticated/);
});
