import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root = new URL('../../../', import.meta.url);
const read = relative => readFileSync(new URL(relative,root),'utf8');

test('Business uses only the unified public backend URL for flight and Intelligence reads',()=>{
  const endpoints=JSON.parse(read('Resources/EndpointConfig.json'));
  assert.equal(endpoints.backend_api_url,'https://iumrah-backend.helloiumrah.workers.dev');
  assert.equal(endpoints.platform_api_url,'https://iumrah-backend.helloiumrah.workers.dev');
  assert.equal(endpoints.flight_hub_url,undefined);
  const config=read('Sources/Core/AppConfig.swift');
  assert.match(config,/static let unifiedBackendURL/);
  assert.match(config,/static let flightHubBaseURL: URL = unifiedBackendURL/);
  const analytics=read('Sources/Networking/APIClient+Intelligence.swift');
  assert.match(analytics,/AppConfig\.unifiedBackendURL/);
  assert.doesNotMatch(analytics,/AppConfig\.apiBaseURL\.appending/);
});

test('staff authorization forwarding remains confined to trusted unified admin routes',()=>{
  const api=read('Sources/Networking/APIClient.swift');
  assert.match(api,/AppConfig\.routedAPIURL\(originalURL\)/);
  assert.match(api,/url\.host\?\.lowercased\(\) == AppConfig\.unifiedBackendURL\.host/);
  assert.match(api,/AppConfig\.isUnifiedModulePath\(url.path\) && url.path.hasPrefix\("\/api\/admin\/"\)/);
  assert.match(api,/HTTPCookieStorage\.shared\.cookies\(for: AppConfig\.apiBaseURL\)/);
  assert.match(api,/request\.setValue\(token, forHTTPHeaderField: "X-Iumrah-Business-Session"\)/);
  assert.match(api,/AppConfig\.apiBaseURL\.appending\(path: "\/api\/auth\/staff\/login"\)/);
  assert.match(api,/source.host == target.host/);
  for (const name of ['APIClient+SecurityKYC.swift','APIClient+IgnavUsage.swift','APIClient+Intelligence.swift']) {
    const extension=read('Sources/Networking/'+name);
    assert.match(extension,/await perform\(/);
    assert.doesNotMatch(extension,/URLSession\(configuration:/);
  }
});
