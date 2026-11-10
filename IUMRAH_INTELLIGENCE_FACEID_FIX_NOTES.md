# iumrah Business — Intelligence / Gemini / Face ID hotfix (10 Nov 2026)

Patch only. Uses existing `Deploy iumrah backend` manual GitHub Actions workflow unchanged.

## Server
- `INTELLIGENCE_*` schema is checked once per Worker isolate and repaired idempotently if the dedicated tables were missed by D1 migration. Existing business tables, bookings, devices and credentials are never dropped or rewritten.
- Authenticated `GET /api/admin/hotels/intelligence/status` (superadmin only) reports presence of HOTELS_DB schema and `GEMINI_API_KEY`, never the secret or private session data.
- Unhandled analytics errors are distinguished from hotel errors with `INTELLIGENCE_BACKEND_FAILURE` and a log correlation ID.
- Gemini chat now exposes a safe provider HTTP status code such as `GEMINI_HTTP_400`, `GEMINI_HTTP_403`, or `GEMINI_HTTP_429`, instead of hiding the cause behind `GEMINI_UNAVAILABLE`.

## iOS Business
- Scene `.inactive` (which occurs during Face ID sheets) no longer starts the background autolock timer; only real `.background` does.
- One automatic biometric prompt per lock cycle; manual Face ID and PIN fallback remain available.
- Successful unlock clears saved background timestamps to prevent relocking immediately.
- Intelligence screen displays partial data even if one endpoint fails, with readable errors and a server diagnostics line.

## Installation
1. Upload `iumrah-business-update.zip` to the **repository root** and commit; wait for **Apply iumrah Business ZIP update**.
2. Manually run the **existing** **Deploy iumrah backend** action (no YAML edits).
3. Build and install iumrah Business through existing TestFlight action (backend deploy alone cannot update Face ID on the device).
4. Open **Intelligence**, check that D1 and key presence are visible; try a short Gemini chat prompt.
5. For any remaining failure, read Cloudflare Worker Observability events for `INTELLIGENCE_UNHANDLED` and/or `INTELLIGENCE_CHAT_FAILED`; note only the safe error code and correlation ID. Never send API keys.

Cloudflare key presence does **not** prove that Google has accepted the key or that the Gemini free quota is available.
If iOS itself has **Require Face ID** enabled for the entire app, a system-level Face ID request may appear in addition to the local Business PIN lock. The patch cannot disable that independent iOS feature.
