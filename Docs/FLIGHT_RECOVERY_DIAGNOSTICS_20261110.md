# iumrah aviation — production recovery after the blank price history screenshot (2026-11-10)

## Observed symptoms (not proof of production state)

The Business screenshot shows 62 flight identities (22 C6 / 14 HY / 26 XY), zero verified fresh fares, no reported runs for any of the three airline bots, and no per-flight historical observations. This does **not** mean all flights have price=0. It means **no confirmed observation has been recorded or returned to Business**. Flight price history appears only after a successful ingestion. No UI-only patch can manufacture an upstream fare.

## Static repo findings and fixes

1. The existing GitHub Actions `deploy-iumrah-backend.yml` schedules three Python monitors at `03:00` and `15:00 UTC` (08:00 and 20:00 Tashkent); runs depend on the **default-branch schedule**, repo Actions settings, Cloudflare account/API token, and working Playwright websites. Any failure before the API ingestion endpoint previously left `last_run = null` with no diagnostic in Business.
2. `IGNAV_API_KEY` is the **upstream provider key** required for live `POST https://ignav.com/api/fares/one-way`. `IGNAV_INGEST_TOKEN` is an unrelated credential for the iumrah backend endpoint; the previous status mistakenly checked only that token to report “Ignav configured”. The existing workflow syncs ingestion credentials, but not the provider API key. It **must be configured in the existing `iumrah-backend` Worker**; never embed it in iOS, this ZIP, or code. The separate Aviasales live search requires `AVIASALES_DATA_TOKEN`; without it, the authenticated Aviasales-cache ingestion path remains available.
3. Existing Worker Ignav Cron fires at `01:15 UTC` (06:15 Tashkent). The schedule is not a request to execute immediately after deploying. An authenticated manual probe can trigger one live search once the provider key exists.
4. This update records bot `started` and final/fatal reports through **the existing** `POST /v1/ingest/{provider}`; the existing GitHub artifact uploader will include `fatal.json` when the Python process fails after launch. It also records Ignav/Aviasales live search statuses and differentiates missing-key, never-reported, timed-out and failed operations in Business. No workflows were modified.

## Verify after installing the cumulative ZIP

1. Check GitHub Actions → `Deploy iumrah backend` → last manual Deploy run **succeeded** (migration and Worker publish). Then inspect the `Update existing airline prices` jobs triggered by the schedule at 08:00/20:00 Asia/Tashkent. If no workflow run exists, inspect Actions enablement and whether the workflow resides in the default branch. If a job fails before `Monitor fares in unified backend`, the Worker will not receive a bot report; **GitHub logs**, not D1, are authoritative for those failures.
2. Open **Cloudflare → Workers & Pages → iumrah-backend → Settings → Variables and Secrets**. Verify existence (do **not** share values): `IGNAV_API_KEY` for provider search, `BOT_INGEST_TOKEN` for monitored price ingestion, `ADMIN_TOKEN` for operator diagnostics. Configure `IGNAV_API_KEY` as a secret there if you already have a genuine Ignav API key; this is an objectively required external provider credential, not a new Worker or GitHub Actions workflow. For live Aviasales fetching, similarly configure `AVIASALES_DATA_TOKEN` if the account has it. Keep existing secrets intact.
3. Check public status at `https://iumrah-backend.helloiumrah.workers.dev/api/flight-hub/v1/public/status`. `sources[].issue`, `search_configured`, `ingest_configured`, `last_run`, and `last_search` now distinguish missing keys from absent reports. A configured flag is **not** proof that a provider call succeeded.
4. For detailed operator data, request `GET /api/flight-hub/v1/admin/flight-diagnostics` with your **existing** `ADMIN_TOKEN` in the `Authorization: Bearer ...` header. The response reports key presence as booleans, last search statuses, bot reports/check attempts and APNs outbox. Never place the token in a screenshot, query string, issue, or app source.
5. To execute **bot verification immediately**, without modifying the existing workflow, run `python -m monitor.cli --provider centrum --limit 20` from `Backend/AirlineMonitors` on a machine with Playwright Chromium installed and environment variables `FLIGHT_HUB_URL` and `FLIGHT_HUB_BOT_TOKEN` set securely. The same command accepts `uzbekistan` and `flynas`. Running the GitHub workflow via its manual `workflow_dispatch` only deploys the Worker; `flight-monitors` is explicitly restricted to scheduled events. Browser scraping still depends on the actual official site UI and may return `site_changed`, `blocked` or `no_verified_fares` without recording prices.
6. Optional terminal command (from a secure local shell with valid environment variables):

   ```bash
   cd Backend/IumrahBackend
   node scripts/diagnose-flights.mjs
   # When IGNAV_API_KEY is already set in the Worker, the admin token is present locally,
   # and you explicitly want to consume one fare-search request:
   node scripts/diagnose-flights.mjs --probe-ignav TAS JED 2026-11-12
   ```

7. Success criterion is **not** just HTTP 200. It is at least one source-confirmed `flight_offers` price with a genuine `checked_at` and `price_history` row, plus the matching flight in `GET /v1/public/flights`. Two distinct observations with changed amounts are required for a 2-point price-change graph. For bot runs, observe `flight_monitor_attempts`, `monitor_runs`, and successful exact price records; a 200 result with zero fares is not success. For APNs, verify actual delivery in the Business app and `flight_push_delivery`, not just an outbox event.

## Database-read checks (existing FLIGHTS_DB; no writes)

Using the existing generated config from `Backend/IumrahBackend`, these read-only SQL queries can be used via Wrangler D1 execute:

```sql
SELECT provider,status,checked_at,accepted,rejected,message FROM monitor_runs ORDER BY checked_at DESC LIMIT 25;
SELECT provider,COUNT(*) AS offers,MAX(checked_at) AS last_checked FROM flight_offers GROUP BY provider;
SELECT provider,COUNT(*) AS observations FROM price_history GROUP BY provider;
SELECT source,status,searched_at,items_count,message FROM flight_source_search_runs ORDER BY searched_at DESC LIMIT 20;
SELECT provider,outcome,COUNT(*) AS checks FROM flight_monitor_attempts GROUP BY provider,outcome;
```

**No remote D1, Cloudflare secret, scheduled GitHub Action, airline website, or real APNs delivery has been accessed by the local tests.** Any remaining provider/browser failure must be diagnosed from those external logs; tests use fixtures and a local SQLite-compatible D1 adapter.
