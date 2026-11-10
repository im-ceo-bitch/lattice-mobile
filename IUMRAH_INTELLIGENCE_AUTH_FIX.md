# iumrah Intelligence: Unified Backend / Business session authorization fix

This is a server-only patch. It does not modify GitHub workflow files, create databases, or add secrets.

## Problem addressed

The Business app establishes its staff login and protected-device session on `iumrah.app`. The unified Worker is deployed with its own `HOTELS_DB` binding. The earlier Intelligence routes validated the staff cookie against `iumrah.app` but attempted to resolve the protected-device token against the unified Worker's local D1. On deployments where these session stores differ, all Intelligence screens could fail before any analytics query ran.

## Changes

- All `/api/admin/hotels/intelligence` requests still require the first-party staff cookie and staff role (existing `requireStaff`).
- Their protected Business device-session token is now validated by the **same first-party authority** that issued it, using `GET https://iumrah.app/api/admin/hotels/security/sessions`.
- The authority must return `ok: true` and a valid `currentSessionID`. Any expired/revoked token fails closed with 401; network or unsupported authority returns 503.
- No authentication fallback to a cookie alone, no access to another origin, no raw secrets in logs.
- Analytics storage still uses `iumrah-backend` / `HOTELS_DB`.

## Deployment

1. Unpack this ZIP into the root of the iumrah Business repo through the existing ZIP updater.
2. Manually run the **existing** `Deploy iumrah backend` workflow, unchanged.
3. Refresh `Business > Intelligence` in the currently installed app. **No new TestFlight build required** for this server-only patch.
4. If an error persists, inspect `iumrah-backend` observability events for `INTELLIGENCE_UNHANDLED`, `INTELLIGENCE_SCHEMA_FAILED`, or `AUTH_PROXY_FAILED`. Do not publish cookies, tokens, or Gemini keys in logs/screenshots.

The patch is tested locally only: real production behavior requires the deployment and successful existing-device authorization at iumrah.app.
