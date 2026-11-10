import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root = new URL('../../../', import.meta.url);
const read = relative => readFileSync(new URL(relative,root),'utf8');

test('Business uses only the unified public backend URL for flight and Intelligence reads',()=>{
  const endpoints=JSON.parse(read('Resources/EndpointConfig.json'));
  assert.equal(endpoints.backend_api_url,'https://iumrah-backend.helloiumrah.workers.dev');
  assert.equal(endpoints.platform_api_url,'https://iumrah.app');
  assert.equal(endpoints.flight_hub_url,undefined);
  const config=read('Sources/Core/AppConfig.swift');
  assert.match(config,/static let unifiedBackendURL/);
  assert.match(config,/static let flightHubBaseURL: URL = unifiedBackendURL/);
  const analytics=read('Sources/Networking/APIClient+Intelligence.swift');
  assert.match(analytics,/AppConfig\.unifiedBackendURL/);
  assert.doesNotMatch(analytics,/AppConfig\.apiBaseURL\.appending/);
});

test('staff authorization forwarding is scoped to trusted analytics only',()=>{
  const api=read('Sources/Networking/APIClient.swift');
  assert.match(api,/url\.host\?\.lowercased\(\) == AppConfig\.unifiedBackendURL\.host/);
  assert.match(api,/url\.path == "\/api\/admin\/hotels\/intelligence"/);
  assert.match(api,/HTTPCookieStorage\.shared\.cookies\(for: AppConfig\.apiBaseURL\)/);
  assert.match(api,/request\.setValue\(token, forHTTPHeaderField: "X-Iumrah-Business-Session"\)/);
  assert.match(api,/AppConfig\.apiBaseURL\.appending\(path: "\/api\/auth\/staff\/login"\)/);
});
