# iumrah — unified backend migration, stage 1 (2026-11-12)

Source: lattice-mobile-main 4.zip and kepler-ios-main 10.zip. This is a code-only overlay. No workflow modifications, no new Worker, no new D1 database, no destructive SQL. Existing D1/R2 resources are reused. This is NOT the completed Core cutover.

## What is installed
- The single `iumrah-backend` Worker imports HotelsWorker, FlightHubWorker and the Package Engine module (`Backend/IumrahBackend/package-engine`). Package routes are compatibility URL paths, not separate deployments.
- Public flight search, calendar, detail, recommendations, curation, hotel rates/primary-hotel routes are now handled locally by that module. The AeroDataBox request broker is shared by client detail, Business verification and Flight Hub refresh. Secrets stay on the server.
- Business routes its catalog, flight verification, curation and intelligence through the same backend, using a common API transport. Staff login and Core-dependent operations remain on their current origin pending verification. Client iOS overlay follows the same staged policy.
- Booking, identity, quote and commit routes copied from Package Engine are intentionally blocked on the new Worker until Core and data parity are verified. Existing legacy routes remain untouched. The existing two scheduled triggers stay unchanged; do not activate the package cron while the original scheduler is still active.

## Deploy order
1. Upload `iumrah-business-update.zip` in the Business repository. Keep the current `Deploy iumrah backend` workflow unchanged. Do not use the iOS `Deploy iumrah Package Engine` workflow for this update.
2. Verify the existing Worker contains the configured provider secrets: `AERODATABOX_RAPIDAPI_KEY`, `AERODATABOX_RAPIDAPI_KEY_BACKUP`, `IGNAV_API_KEY`, `TRAVELPAYOUTS_API_TOKEN`, and `NUITEE_API_KEY` if using Nuitee. Secret values must never be put in ZIPs, logs, or Swift code. Existing workflow syncs primary AeroDataBox only if configured in the Business repo. Both AeroDataBox credentials must belong to provider-authorized subscriptions for the intended use; do not use multiple free accounts to bypass restrictions. Default local guard: 5 calls/day per configured key; all three consumers share it.
3. Run `Deploy iumrah backend`. Check `https://iumrah-backend.helloiumrah.workers.dev/__iumrah/health` and `/__iumrah/cutover`. The latter is read-only and reports schema presence, not data parity. Verify actual catalog, provider configuration and a known flight detail before building either app. `GET /api/package/health` checks package tables and provider configuration (can initialize additive room-category schema).
4. Apply the matching iOS ZIP; only then build TestFlight for the staged client changes. Business builds also only after successful backend checks. No database deletion or cutover should be attempted here.

## Blocking the final migration
- `/api/bookings`, `/api/auth/staff/*`, `/api/admin/bookings`, `/api/storefront/packages`, `/api/airports`: source handlers are absent from both archives. The original deployment README explicitly states this. Need the current `iumrah-web` repo and any separate Core Worker if applicable.
- The current generated config binds THREE existing D1 resources: `iumrah-hotels`, `iumrah-core`, `iumrah-flights`. `iumrah-backend` is the Worker, not a D1 database. Existing migration policy places several operational tables into Core while the old hotel/package code expects them under HOTELS_DB; remote schema, table placement, row parity, references and R2 must be verified before moving writes. Do not merge or rename databases blindly.
- Existing auth and booking services call the old platform origin. Preserve session cookies, account IDs, booking tokens, quote signing key and provider bindings when migrating. Keep legacy packages and core handlers for rollback until final cutover. The ZIP extractors only overwrite/add files; they cannot delete old modules or workflows. No legacy source or live Worker was deleted in this stage.
- Android and Web have not been edited because their current sources were not supplied.

## Local verification
- Unified router and configuration: 31/31; Flight Hub: 39/39; migrated Package Engine runtime: 86/86; TypeScript typecheck passed.
- Swift AppConfig routing smoke tests compiled and ran for iOS and Business; changed Swift source syntax parsed. Full Xcode build, Wrangler cloud bundle/deploy, live secrets, and remote D1 data not verified here. Offline npm installation unavailable for Wrangler; no remote operations performed.
