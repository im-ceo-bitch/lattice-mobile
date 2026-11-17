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

test('Business persistence uses the exact Worker staff cookie and logout clears it',()=>{
 const persistence=read('Sources/Core/BusinessStaffAuthPersistence.swift');
 const api=read('Sources/Networking/APIClient.swift');
 assert.match(persistence,/cookie\.name == staffCookieName && cookie\.isSecure/);
 assert.match(persistence,/normalizedHost\(cookie\.domain\) == AppConfig\.apiBaseURL\.host\?\.lowercased\(\)/);
 assert.match(persistence,/HTTPCookieStorage\.shared\.cookies\(for: AppConfig\.apiBaseURL\)/);
 assert.match(persistence,/try save\(passwordLoginAt: read\(\)\?\.passwordLoginAt \?\? Date\(\)\)/);
 assert.match(api,/BusinessStaffAuthPersistence\.clearStaffCookies\(\)/);
 assert.match(api,/let sentToken = request\.value\(forHTTPHeaderField: "X-Iumrah-Business-Session"\)/);
 assert.match(api,/object: sentToken/);
 assert.match(read('Sources/App/AuthStore.swift'),/token == BusinessSessionVault\.sessionToken/);
});

test('login errors are distinct and push only registers after a device session exists',()=>{
 const api=read('Sources/Networking/APIClient.swift');
 assert.match(api,/serverError == "INVALID_CREDENTIALS"/);
 assert.match(api,/case "AUTH_SERVICE_UNAVAILABLE", "CORE_CUTOVER_PENDING"/);
 assert.match(read('Sources/Core/BusinessNotifications.swift'),/guard BusinessSessionVault\.sessionToken != nil/);
 const login=read('Sources/Views/LoginView.swift');
 assert.match(login,/\.focused\(\$focusedField, equals: \.password\)/);
 assert.match(login,/\.defaultScrollAnchor\(\.top\)/);
});

test('V33 Business acknowledges the received cursor and listens to chat and operational push events',()=>{
 const chat=read('Sources/Views/ChatsView.swift'), api=read('Sources/Networking/APIClient.swift'), notifications=read('Sources/Core/BusinessNotifications.swift');
 assert.match(chat,/markBusinessChatRead\(bookingID: conversationID, through: cursor, scope: scope\)/);
 assert.match(chat,/acknowledgedCursor = cursor/);
 assert.match(api,/URLQueryItem\(name: "through", value: through\)/);
 assert.match(api,/URLQueryItem\(name: "scope", value: scope\)/);
 assert.match(chat,/retryText == text \? \(retryMessageID/);
 assert.match(notifications,/case "chat_message", "chat_image":/);
 assert.match(notifications,/case "payment_receipt", "booking_created", "booking_status_changed", "booking_updated":/);
 assert.match(chat,/\.iumrahBusinessChatChanged/);
 assert.match(read('Sources/Views/BusinessTabView.swift'),/\.iumrahBusinessChatOpen/);
});
test('V3 preserves cancelled bookings and refreshes cannot overwrite unsaved operations',()=>{
 const list=read('Sources/Views/BookingsView.swift'), detail=read('Sources/Views/BookingDetailView.swift'), archive=read('Sources/Views/ClientArchiveView.swift');
 assert.match(list,/loadGeneration == generation/);
 assert.doesNotMatch(list,/deleteBooking\(id:/);
 assert.match(detail,/cancellationReason/);
 assert.match(detail,/guard !hasUnsavedOperations else \{ return \}\s+detail = value/);
 assert.match(detail,/loadGeneration == generation, !saving, !restartingPriceLock/);
 assert.match(archive,/loadGeneration == generation/);
});
