# iumrah Business — Navigation cleanup, Flight Hub reliability, safe migration verification

**Stage:** source-level patch, 2026-11-09; based on the user-provided `lattice-mobile-main.zip` (2026-11-08). ZIP name must start with `iumrah-business-` to be picked up by the existing `apply-zip.yml`.

## 1. Retired hotel-management UI

- Removed the legacy Hotels tab from compact iPhone navigation and the macOS keyboard menu.
- Removed `Primary Hotels` from the compact drawer and large-screen administration navigation.
- Preserved the **underlying hotel models**, original booking/itinerary data, booking assignment, saved hotel IDs, and existing `APIClient.hotels()` compatibility route. This prevents a UI cleanup from breaking already-booked trips.
- Replaced an obsolete UI instruction telling operators to add hotels in a nonexistent Hotels tab.
- Did **not** remove HotelsWorker, migrate its tables, change live API routes, or replace the hotel provider. The existing backend endpoint still needs to be routed to the user's independent hotel API; **a new provider URL/contract was not provided**. Do not claim this integration is finished.

## 2. Flight Hub safety and transparency

- Expired flight identities are skipped in the legacy-curated flight import, using `Asia/Tashkent` calendar dates. Old prices are **not** copied as live fare data.
- Price `fresh` checks reject expired offers, invalid/future observation timestamps and unverified historical imports.
- Public status counts only flights/offers associated with departures that have not passed (Tashkent date).
- Business UI identifies passenger counts, checked baggage and cabin baggage *only where the source has supplied them*. Seats-left is shown only for a fresh offer with confirmed numeric data. The UI never invents values. Price provenance and age are displayed.
- Existing Ignav, AeroDataBox and airline monitor adapters are preserved; automated tests cover their source-normalization contract. **Live scraping, scheduled execution and provider access are not yet established by a passing test in the new Cloudflare account.**

## 3. Database migration integrity gate

- Added `Backend/CloudflareMigration/verify_cutover.py` for private offline comparison of filtered old D1 SQL snapshots and imported new D1 SQL snapshots. Checks every expected table, column, row contents, foreign keys and absence of core hotel catalog tables. Output is counts/reasons only; no personal information or identifiers are printed.
- Reuses existing `Backend/CloudflareMigration/prepare.py`, policy and deploy pipeline. Adds **no new GitHub Actions workflow** and changes no Cloudflare deployment configuration.
- The audit archive in chat contains **schemas and row counts only**, not actual user/booking records. It cannot be used by itself to restore customers. No real data was copied or production cutover performed.
- Cutover requires the actual private D1 SQL exports, a safe one-time import with reconciliation, R2 document retention/bridge, Worker secrets, authentication smoke tests, final write freeze or differential sync, and confirmation that `/api/...` routes remain compatible. Do **not** switch production just from this patch.

## Application release and tests

Upload `iumrah-business-next-priority-20261109.zip` into the **root** of the Business repository on `main`. Existing `.github/workflows/apply-zip.yml` will apply files; this patch does **not** modify or add a workflow. After patch application, use the existing `ios-root-testflight.yml` to build the next TestFlight version. This package contains no signing files or credentials.

Local QA run in a Linux workspace:

```sh
swiftc -frontend -parse Sources/Views/BusinessTabView.swift Sources/Views/BusinessSidebar.swift Sources/Views/UmrahBuilderView.swift Sources/Views/FlightHubMonitorView.swift
python3 -m unittest discover -s Tests/Architecture -p 'test_*.py'
python3 -m unittest discover -s Backend/CloudflareMigration/tests -p 'test_*.py'
python3 -m unittest discover -s Backend/CoreMigration/tests -p 'test_*.py'
PYTHONPATH=Backend/AirlineMonitors python3 -m unittest discover -s Backend/AirlineMonitors/tests -p 'test_*.py'
node --test Backend/FlightHubWorker/tests/*.test.mjs Backend/CloudflareD1Deploy/tests/*.test.mjs
```

**Limitations:** Swift syntax parse is not a full Xcode build. No live Cloudflare migrations, current account access, TestFlight upload or provider API responses were exercised locally.
