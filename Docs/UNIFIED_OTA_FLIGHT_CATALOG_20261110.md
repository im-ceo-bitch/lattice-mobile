# iumrah — Unified OTA Flight Catalog (cumulative overlay, 2026-11-10)

## Safe installation

Upload `iumrah-business-update.zip` to the **root** of the current `lattice-mobile` repository and let its existing `.github/workflows/apply-zip.yml` extract the overlay. The ZIP contains only changed and added paths, is **not** a replacement repository, and does **not** touch `.github/workflows/deploy-iumrah-backend.yml` or other workflows. The next normal existing unified-backend deploy runs a fail-closed additive FLIGHTS_DB migration step before publishing the Worker. It must be reviewed/backed up before applying to production; no remote D1 writes or Worker deployment are performed while generating this ZIP.

The migration step checks the rendered D1 binding is named `FLIGHTS_DB` and points to `iumrah-flights`, then applies files `0001`, `0002`, `0003`, `0004`, `0005`, `0006` in order. `0003` repairs the monitoring dispatch table. `0005` adds bundle offers and histories, cached source metadata, bot-check audits, a deduplicating APNs outbox lease table, and source search accounting. New schema tables use `IF NOT EXISTS`; `0006` idempotently replaces only the automatic direct-route trigger so intermediate connecting segments cannot generate bogus standalone Uzbekistan–Saudi results; historical flight identifiers, existing offers, booking numbers, user records, and analytic tables remain untouched. Existing V2 backfill inserts missing rows only. No expired flight or price history is cascaded away during scheduled maintenance.

## Server API (on the existing iumrah-backend)

The existing prefix `/api/flight-hub` is supported. Authentication relies **only** on existing tokens; never pass an ingestion token to the iOS client.

- `POST /api/flight-hub/v1/ingest/ignav/response` — `Authorization: Bearer $IGNAV_INGEST_TOKEN`; accepts an unmodified Ignav one-way response. Uses `outbound.segments`; requires `price.status=verified` and source `observed_at`. Direct flights reuse the existing physical-flight identity and write initial and changed prices to source-tagged D1 history. A multi-segment journey becomes a complete itinerary with a separately-priced whole-itinerary bundle; its price is not incorrectly attached to its first physical segment.
- `POST /api/flight-hub/v1/ingest/aviasales-cache` — `Authorization: Bearer $ADMIN_TOKEN`; accepts the Aviasales Data API `data` results. The price is marked `cached_not_confirmed`, never inserted into confirmed offers, and incomplete transfers remain separate, non-bookable discovery hints. Exact direct-flight matches are linked and hidden as duplicates.
- `POST /api/flight-hub/v1/admin/ignav/search` — authenticated live one-way search, maximum eight routes per call, dedupe/cooldown/daily limit. **Requires a genuine Ignav provider API key** available as `IGNAV_API_KEY` in the already-existing Worker; no key or new secret is automatically provisioned.
- `POST /api/flight-hub/v1/admin/aviasales/sync` — authenticated direct Data API cache lookup. Requires an `AVIASALES_DATA_TOKEN` in the existing Worker, or use the authenticated ingestion endpoint from the already-existing upstream integration.
- `GET /api/flight-hub/v1/public/itineraries?origin=TAS&destination=JED&date=YYYY-MM-DD` — old `itineraries` shape kept; new `catalog` array combines segment-complete itineraries and separate Aviasales hints; `discoveries` returned explicitly.
- `GET /api/flight-hub/v1/public/discoveries?...` — only non-expired, non-linked cached hints; their `offers` list is always empty.
- `GET /api/flight-hub/v1/public/price-history?flight_key=...` — observed confirmed prices, actual changes, checks and outbox status for the Business graph.
- `POST /api/flight-hub/v1/admin/price-events/deliver` — authenticated replay of queued price-change notifications via **existing** `sendStaffPush`/Business APNs device registry. Delivery attempts persist in D1; transient failures remain retryable. `flight_price_changed` payload includes the exact flight key.

No new dependency was introduced on the legacy `/api/package/flights/data` route.

## Price bots

The **existing** GitHub Actions scheduler invokes `python -m monitor.cli --provider ... --limit 20` at 08:00 and 20:00 Asia/Tashkent. `--limit` now controls page size, not the entire run; each bot requests remaining flights in fair pagination, with a maximum of 140 flight checks/30 minutes per invocation. Checks require an exact matching published flight number, route and date. CAPTCHA, 404/selector failures and no-fare results are recorded as attempts without writing zero prices or inventing flights. Per-flight failure diagnostics, monitor runs and price history are stored separately. Browser selectors still require verification against real airline websites; local tests do **not** prove live booking-site access or price freshness.

## Ignav route sweep

A standalone operator script supports budget-controlled rotation without adding Actions or Workers:

```bash
cd Backend/FlightHubWorker
node scripts/mass-search-ignav.mjs --max-searches 60 --days 30
```

That is a **dry run**. To actually spend provider quota and submit results, run the same command with `--push` and operator-provided environment variables `IGNAV_API_KEY`, `FLIGHT_HUB_IGNAV_TOKEN`, and `FLIGHT_HUB_URL=https://iumrah-backend.helloiumrah.workers.dev/api/flight-hub`. The script will issue real API requests and store accepted responses. It stops on upstream rate/quota blocks. **The sweep is not automatically scheduled** by this ZIP; scheduling it and providing the genuine provider API key are production follow-up prerequisites, not completed claims.

## Push navigation and Business

The existing iumrah Business app push delegate processes `flight_price_changed` and opens `FlightHubMonitorView` → `FlightHubPriceHistoryView`, including when the app was launched from the notification. The view uses Charts, reports changes, source timestamps and bot-check attempts. Different currencies are plotted separately to avoid misleading comparisons. Source prices are observed market prices, not proof of ticket availability at checkout.

## Verification and deployment gates

Run from the repo root:

```bash
cd Backend/IumrahBackend && npm run check
cd ../AirlineMonitors && python -m unittest discover -s tests -v
```

`npm run check` includes the pre-existing unified Worker test suite and new Flight Hub SQLite/D1-compatible integration tests. Swift source syntax was checked with `swiftc -frontend -parse`. An actual iOS archive, signed APNs device delivery, browser scraping of official live airline prices, cloud-migrated D1 schema, and an end-to-end production booking/search response have **NOT** been verified in this sandbox. The deployment job must be observed in GitHub Actions, followed by verification of D1 tables, `/v1/public/status`, actual new Ignav rows, bot logs, APNs subscription and Business deep-link.

`businessSessions: false` from `/__iumrah/readiness` is deliberately outside this aviation patch.
