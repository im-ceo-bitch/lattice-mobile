# iumrah Intelligence · backend + Business v1

## What is implemented

- **Collector:** `POST /api/catalog/hotels/intelligence/events` (same `iumrah-hotels-api` Worker). It accepts up to 30 minimal events per batch (16 KB max), server-received timestamp plus validated event timestamps and optional screen dwell durations, UUIDv4 visitor/session/event IDs, no arbitrary properties. Replay-safe insert by event ID. Native clients should batch requests and send them only according to their analytics consent/disclosure policy.
- **Admin (superadmin only):** `GET /api/admin/hotels/intelligence?days=7|14|30`, `GET .../sessions`, `GET .../sessions/{uuid}`, `GET .../reports`, `POST .../reports/generate`. Existing Business staff cookies **and** the existing business session header are required; no new admin tokens.
- **Storage:** new, independent `intelligence_events` and `intelligence_reports` tables in existing `HOTELS_DB`. Historical booking and hotel data is untouched. Cron deletes event rows over 90 days old and reports over 180 days old.
- **Gemini:** only aggregates for the last 7 days, compared with the prior 7 days. No raw events, visitor IDs, session IDs, passport data, user text, payment data or contact details sent to Google.
- **Automatic analysis:** Cloudflare Cron `0 3 * * *` (03:00 UTC = 08:00 Asia/Tashkent), every day by default. To run every other day set `INTELLIGENCE_REPORT_CADENCE_DAYS` to `2` in the Worker **vars**, then redeploy. Cron runs independently of the Business app being open.
- **Business UI:** hamburger/persistent sidebar → «Аналитика» (superadmin only), tabs «Обзор», «Сессии», «Gemini». No dummy statistics.

## Deployment steps (needed for production)

This repo currently contains a D1-only workflow `deploy-hotels-cloud.yml`. It does **not** deploy `iumrah-hotels-api`. Applying the update ZIP changes the repository but **does not deploy the Worker or apply the new D1 migration**. Existing `/api/catalog/hotels/*` and `/api/admin/hotels/*` routes already belong to this Worker, so no additional route or separate backend is necessary.

1. Apply the ZIP via existing `iumrah-business-*.zip` root ZIP workflow.
2. Run existing backend tests: `cd Backend/HotelsWorker && npm test` (or `node --test tests/intelligence.test.mjs`).
3. Deploy `iumrah-hotels-api` using the currently working Cloudflare HotelsWorker deployment credentials / process: render `wrangler.generated.jsonc` using `node scripts/render-config.mjs` with current Cloudflare environment, `npx wrangler d1 migrations apply HOTELS_DB --remote --config wrangler.generated.jsonc`, and `npx wrangler deploy --config wrangler.generated.jsonc`. **Do not repoint to a different account or D1**. Check that the generated bindings still target the intended production HOTELS_DB and BOOKINGS_DB before deployment.
4. Set **Worker secret** `GEMINI_API_KEY` in the Cloudflare environment serving `iumrah-hotels-api`, for example `npx wrangler secret put GEMINI_API_KEY --config wrangler.generated.jsonc` (do not add key to Swift, GitHub ZIP, app configuration, source or plaintext variables). The model defaults to `gemini-2.5-flash`; optional Worker variable `GEMINI_MODEL` can override it.
5. Build the Business iOS app from the updated repository. API screens will initially be empty until the client iOS repo is instrumented.
6. Verify signed-in superadmin requests to `/api/admin/hotels/intelligence`; verify a test batch to public collection endpoint, then manually invoke «Сформировать отчёт» after test data is sufficient.

## Event payload contract for the iumrah client repository

```json
{
  "visitorId": "cce35af8-6a6f-4559-a912-d372bc58f37e",
  "sessionId": "72b52ba5-2633-49a7-a20b-a4262d4c3891",
  "platform": "ios",
  "appVersion": "1.0.0",
  "events": [
    {"id": "26084394-5e76-4ae5-bc78-05693b16ab49", "name": "screen_view", "screen": "flights", "occurredAt": "2026-11-10T07:20:00.000Z"},
    {"id": "6f999d5a-e74d-40b4-b4d7-05a34c2b7694", "name": "tap", "screen": "flights", "elementId": "search_button", "occurredAt": "2026-11-10T07:20:04.000Z"}
  ]
}
```

Valid event names are in `Backend/HotelsWorker/src/intelligence.js`. Generate visitor UUIDv4 at first launch and persist it locally; generate new session UUIDv4 for each foreground session. Generate event UUIDv4 per event. Include `occurredAt` as UTC ISO 8601 (Z) to preserve event sequence when buffering; include an integer `durationMs` (0–3,600,000) only for `screen_exit` to calculate average screen dwell time. Keep `screen` and `elementId` as fixed developer-defined codes (letters/digits/underscores), never enter raw text, passport numbers, phone numbers, search terms or arbitrary user inputs. Only send after any legally required consent and provide disclosure/opt-out as applicable. The server intentionally does not support recording touch coordinates, keystrokes, screenshots or personally sensitive values.

## Limits / next phase

- iOS and Android SDK instrumentation is **not** in this package; it needs their separate repos. Until then, events will not be generated automatically.
- Store installs and app deletions cannot be attributed reliably to a single visitor from these events. Store-level aggregated downloads/uninstalls require separate integrations.
- Anonymous ingestion cannot cryptographically prove that a request came from a real app installation. Before high-volume public exposure, configure Cloudflare rate limiting and anti-abuse protections for `/api/catalog/hotels/intelligence/events`. Avoid shipping reusable authentication secrets inside apps.
- Retention and any international transmission to Google must be checked against the applicable privacy policy, store disclosures and local regulations before production collection.
- Generated reports are **recommendations**, not autonomous code changes. They never modify the app or execute deployments.
