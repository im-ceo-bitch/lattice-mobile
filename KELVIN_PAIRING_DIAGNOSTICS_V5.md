# Kelvin pairing diagnostics V5 / App Switcher

Basis: lattice-mobile-main 5.zip + Voice 2.1 + Native Motion V4. This is a targeted diagnostic patch, NOT a verified production HTTP 403 repair. The actual Block 07 desktop source and Cloudflare logs were not available. If the current repository has newer changes to router.js or RootView.swift, merge the two small changes rather than replacing newer logic.

## First: diagnose on MacBook (before rotating keys or deploying)
Copy `scripts/kelvin-pairing-diagnose.py` to your Mac and run `python3 kelvin-pairing-diagnose.py`. Expected without a key: HTTP 401, JSON `UNAUTHORIZED`. If the existing current key is still available, run `python3 kelvin-pairing-diagnose.py --with-key`. Enter it only in the hidden Terminal prompt. The only authenticated operation is heartbeat, which updates last_seen; no messages, memory, settings or configuration are changed. No key is saved, echoed, sent to any other URL or followed through a redirect.

* 403 JSON CROSS_ORIGIN_REQUEST: Worker Origin check. Inspect the actual Bridge HTTP request (remove an inappropriate Origin on a native server-to-server request, if present; do not bypass server checks).
* 403 HTML or nonstandard JSON: inspect Cloudflare Security Events/Access and Worker logs by timestamp and CF-Ray; CF-Ray alone is not proof of WAF. Do not globally disable WAF or Access.
* 401 with current key: check exact host, token format, latest key issuance, correct D1 binding and worker deployment; do not print the token/hash or query unrelated accounts.
* 503 CORE_CUTOVER_PENDING: inspect existing cutover readiness, never force enable.
* 503 KELVIN_UNAVAILABLE: inspect D1 binding/schema and Worker logs.
* 200 with key but link-iumrah.sh fails: inspect actual Block 07 URL/method/headers/redirect handling; likely client-side difference, not proof until code comparison.

## Deploy patch
Apply after V2.1 + V4, not to an unknown newer branch without checking the two modified source files. Upload ZIP in lattice-mobile only. Existing apply-zip YAML, signing, secrets, binding names, tables and token validation remain unchanged. Deploy iumrah backend, then iOS Root TestFlight. The Worker adds headers x-kelvin-bridge-revision, x-kelvin-request-id, x-kelvin-stage to internal Kelvin requests and admin pair responses. Worker log event KELVIN_BRIDGE contains only operation, stage, status, correlation ID and revision; no request payload, credentials, owner ID or response text. Successful routine heartbeat/claim requests are not logged by the added code. Use Cloudflare dashboard Worker real-time logs or authorized `npx wrangler tail iumrah-backend` with existing credentials; filter for KELVIN_BRIDGE. Missing marker does not prove WAF: it can mean older code, wrong host or edge rejection. Check actual deployed revision and Cloudflare Access/WAF events separately. No live deployment or remote logs checked in this environment.

## Desktop follow-up
Need current Block 07 archive or exact shared_business.py and macos/link-iumrah.sh (with credentials removed). Need sanitized probe output plus Worker log/edge event for failed request. Do not send config files, tokens or local memory. Do not reinstall or clear memory. If desktop changes are needed, apply a separate patch in Kelvin repository and restart existing LaunchAgent only after checking config compatibility. The patch here does not modify desktop code.

## App Switcher
Removed only the extra `BusinessAppPrivacyShield` overlay on inactive/background scenes from RootView. PIN/Face ID, automatic lock on actual background, hit-testing guard, session invalidation, logout and token protection unchanged. iOS may still show the genuine unlock screen when app is locked. Business data may now be visible in Recents; requested behavior. Actual iOS build/device snapshot not tested.

## Acceptance
1. Existing owner session issues key, unauthorized staff cannot pair. 2. No-key/invalid-key heartbeat rejected. 3. Current key returns 200 and app shows online. 4. App sends a test request, Mac claims/finishes it. 5. Telegram sends a test question in shared legacy chat, both see answer. 6. Shared explicit test note visible from both; remove only that test note afterward. New app threads have separate history; Telegram uses legacy thread and shared notes unless desktop supports thread selection. 7. Verify old notes/config/Telegram are unchanged. 8. Confirm App Switcher preview and normal PIN/Face ID behavior on iPhone.

Local checks: 22 Node tests across existing Kelvin, voice, unified router and added integration tests (SQLite substitute for D1, mocked staff middleware boundary; no real Cloudflare or Telegram). 13 existing architecture checks. 8 simulated diagnostic-script checks. Swift RootView syntax parse. No Xcode/device build, production logs, live API result or actual end-to-end Mac/Telegram verification.
