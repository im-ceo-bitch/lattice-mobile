# iumrah — One Worker handoff (Business, flight monitoring, Intelligence)

**Source:** `lattice-mobile-main 2.zip`, 10 November 2026. This patch does not migrate customer records or deploy to Cloudflare.

## What is actually wired

- Cloudflare Worker name: `iumrah-backend`; source `Backend/IumrahBackend`, which dispatches to existing `HotelsWorker` and `FlightHubWorker` modules.
- Business flight catalog: `https://iumrah-backend.helloiumrah.workers.dev/v1/public/*`.
- Business analytics: same Worker at `/api/admin/hotels/intelligence*`. Its requests carry the existing staff cookie (from the platform domain) and Business session header **only** for this exact allowlisted path. Do not forward cookies to arbitrary URLs.
- Mobile telemetry ingestion contract: `POST /api/catalog/hotels/intelligence/events` on the same Worker. The Business repository **does not include the kepler-ios source**; migrating the client tracker still needs an update to that repository.
- Flight price monitors: existing GitHub scheduled job queries `iumrah-backend` through `FLIGHT_HUB_URL` (derived by `find-worker-url.mjs`). No second Worker required.
- `AppConfig.apiBaseURL` remains `https://iumrah.app` for the existing login, checkout and bookings paths. Those handlers are not implemented in `IumrahBackend`. Blindly replacing the platform base URL would break sessions and bookings.

## Why analytics may still be unavailable

The current `intelligence.js` reads `intelligence_events` and `intelligence_reports` from **HOTELS_DB**. The consolidation did not migrate these analytics tables to `iumrah-core`. The new Worker needs that database bound and migration `Backend/HotelsWorker/migrations/0044_business_intelligence.sql` applied to the right D1 (the current deploy workflow already attempts this). Any historical analytics in another account must be migrated explicitly to retain continuity.

The new **GET `/__iumrah/readiness`** endpoint probes relevant D1 tables without returning personal data or SQL errors:

- `flights`, `flightOffers`: flight schema present
- `analyticsEvents`, `analyticsReports`: Intelligence schema present
- `businessSessions`: staff-session schema present
- `bookingsBinding`: the configured Core D1 binding exists (**not** evidence of booking-record migration)

`GET /__iumrah/health` only reports the presence of bindings. Use `/__iumrah/readiness` to check table readiness. A 503 means at least one component isn't ready; no client should treat it as a completed migration.

## Release sequence

1. Upload `iumrah-business-update.zip` at the **root** of the Business repo; the existing `.github/workflows/apply-zip.yml` applies it. The ZIP does not modify `.github/workflows/`.
2. Run the **existing** `Deploy iumrah backend` workflow. Do not re-enable `IUMRAH_ENABLE_ROUTE_CUTOVER` yet; keep production auth and bookings paths intact.
3. Check `/__iumrah/health`, `/__iumrah/readiness`, `/v1/public/status`, and the Business **Авиабилеты → Мониторинг** screen. Readiness may be partially false until the real D1 tables/data are migrated.
4. Check the **Аналитика** screen signed in as a superadmin: overview, sessions, and reports. A 401 means the staff cookie or session is not available to the Worker; a 503/500 can indicate unready upstream auth or D1 migrations. Do not generate reports until the event ingestion pipeline is validated.
5. Test a harmless client telemetry event via the client application only after verifying its network destination and user consent/analytics settings. Do not send any personal identifiers in event properties.
6. Verify actual bot runs and price history separately. Passing unit tests does **not** prove live fares have been collected.
7. Once authentication, bookings, admin operations, client telemetry and data migration have been verified, plan the platform API cutover and retire the old Worker. **Not done by this patch**.

## Security

- GitHub Actions service keys use `::add-mask::` before being exported to `$GITHUB_ENV`; none are stored in the app or ZIP.
- Staff session cookies are forwarded only from the platform to the explicitly configured HTTPS backend and only for `/api/admin/hotels/intelligence*`.
- No confidential credentials or customer records are included in the ZIP.
- Do not upload downloaded diagnostics containing secrets to a public repository.
