# iumrah — Unified Flight Catalog, 10 November 2026

This is an **additive ZIP overlay** for the existing `lattice-mobile` repository. The archive is intended to be extracted by the existing `.github/workflows/apply-zip.yml` after committing `iumrah-business-update.zip` to repository root. No GitHub Actions workflow, Cloudflare Worker name, D1 database name, or existing booking ID is modified by this overlay.

## Implemented in code

1. **Flight Catalog V2 + D1:** additive migrations `0003` through `0006`; `flights` preserves physical IDs, `flight_itineraries` represents segment sequences, and offers/history remain separate. Connecting segments are **not** displayed as independent UZ–KSA itineraries. Only flights between known Uzbekistan airports and JED/MED/TIF qualify for the public itinerary search.
2. **Ignav:** authenticated one-way ingestion of the documented `itineraries[].outbound.segments[]` shape. Only explicitly verified positive fares with a source `observed_at` are entered as provider observations, never as checkout guarantees. Exact physical-flight keys and itinerary fingerprints avoid duplicate inventory; original offer observation and later changes are retained. Live search endpoint supports limited batches, a D1-backed attempt budget and anti-repeat windows. The existing Cloudflare Worker `01:15 UTC` cron can perform a budget-capped rolling 30-day sweep **if** the already-deployed Worker has a valid `IGNAV_API_KEY`; without a key, no upstream calls occur. There is also an operator-only mass search CLI (dry-run by default).
3. **Aviasales Data API:** separate authenticated cached discovery ingestion and optional provider sync. Stale/partial route hints are never promoted to flight offers, source currency/price provenance is explicit, no imaginary second segment is produced. Verified first-segment identity can link a cached hint to an unambiguous existing connecting itinerary to avoid display duplication.
4. **Airline monitors:** existing Centrum / Uzbekistan Airways / Flynas Playwright implementation now paginates task batches until inventory or run safety cap is reached. It logs attempted checks and does not write zero fares for CAPTCHA, empty results, changed selectors or site failures. Existing cron continues at 03:00 and 15:00 UTC = 08:00/20:00 Tashkent.
5. **Business price history and push:** D1 price-change outbox, idempotency fingerprint, delivery lease and retry metadata. Reuses `sendStaffPush` and existing `business_push_devices`/APNs infrastructure. iOS Business has a price chart, history list, monitor attempts and deep-link routing by `flightKey` from push. For genuine APNs delivery, real device registration, APNs credentials/entitlement and production push testing are still required.
6. **Deployment:** `Backend/IumrahBackend/package.json` existing `npm run deploy` now applies additive FLIGHTS_DB migrations before the unchanged `wrangler deploy` command. Migration failure aborts deployment (fail-closed). No changes to `.github/workflows/deploy-iumrah-backend.yml`.

## Important operating constraints

- The `/api/package/flights/data` legacy website endpoint is **not** a dependency of the new Flight Hub routes.
- Search/cache API and server ingestion must use a configured access token: `IGNAV_API_KEY` for live Ignav calls, `AVIASALES_DATA_TOKEN` for optional live Aviasales calls, `IGNAV_INGEST_TOKEN` for Ignav payload submissions, and existing `ADMIN_TOKEN` for operator endpoints. These are backend-only. **This ZIP does not create secrets or assume they already exist.**
- **No Cloudflare production writes were performed in local tests.** Check the real D1 schema, sample imported flight IDs, bot diagnostic artifacts, APNs notification delivery and user deep-link on TestFlight after deployment. A local run can pass while official airline sites reject Playwright automation.
- The `businessSessions: false` readiness issue remains outside this flight update.
- Flight prices are supplier observations, not ticket holds, confirmed availability, or completed bookings.

## Endpoints on the one existing backend

- `GET /v1/public/flights`: backward-compatible physical flights and their provider offers.
- `GET /v1/public/itineraries`: complete routes plus separately labeled optional discovery hints in `catalog`.
- `GET /v1/public/itineraries/:id`: ordered segments and whole-itinerary offers.
- `GET /v1/public/discoveries`: Aviasales incomplete cache hints only.
- `GET /v1/public/price-history?flight_key=<urlencoded>`: observations, changes and monitor attempts.
- `POST /v1/ingest/ignav/response`: ingestion using the existing provider ingestion token.
- `POST /v1/ingest/aviasales-cache`: ingestion using existing admin token.
- `POST /v1/admin/ignav/search`: small-batch provider search using existing admin token and provider API key.
- `POST /v1/admin/aviasales/sync`: fetch Aviasales Data API hints using existing admin token and provider token.
- `GET /v1/monitor/tasks?provider=centrum|uzbekistan|flynas&limit=20&since=<run-start>`.
- `POST /v1/admin/price-events/deliver`: retry pending push events through existing sender.

## Verification performed here (local only)

- `cd Backend/IumrahBackend && npm run check` — succeeds, includes FlightHubWorker tests (36/36).
- `cd Backend/IumrahBackend && npm test` — succeeds (27/27).
- `cd Backend/AirlineMonitors && python -m unittest discover -s tests -v` — succeeds (5/5).
- `node Backend/FlightHubWorker/scripts/mass-search-ignav.mjs --max-searches 3 --days 1` — dry-run prints routes without calling Ignav.
- Verify actual deployment with existing GitHub Actions `deploy-iumrah-backend.yml`; do not manually apply the Fly Hub SQL against the HOTELS_DB or BOOKINGS_DB binding.

## Post-deployment acceptance checks

1. Read `GET /v1/public/status` on `https://iumrah-backend.helloiumrah.workers.dev` and verify D1 bindings/tables and published flight count. Note this alone is not proof of current fares.
2. Confirm new Ignav route requests use a real provider key and inspect a sample complete response. Inspect `flight_source_search_attempt_log`, `flight_offers`, `price_history`, `flight_itinerary_bundle_offers` and `flight_discovery_cache` in `iumrah-flights`.
3. Run existing airline monitor workflows and inspect uploaded diagnostic artifacts. Verify match by flight/date/tariff at official sites. Accept **no** price change claims until official site checks are successful.
4. Confirm one real price change creates exactly one `flight_price_change_outbox` event, then verify push delivery, Business notification click and history chart on physical device.
5. Compare all pre-existing physical flight IDs and booking snapshots before/after migration; the migration does not overwrite existing IDs.
