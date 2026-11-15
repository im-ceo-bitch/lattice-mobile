# iumrah Smart Configurator backend v1

Base: lattice-mobile-main 2.zip. Canonical Worker `Backend/IumrahBackend`. Adds POST `/api/package/smart/plan` using existing published-flight catalogue and cached monthly Aviasales Data candidates. No separate pricing, hotel, booking, or D1 engine. Current package quote and OTP confirmation remain authoritative. The route respects the existing core cutover gate before accessing the package engine. No secrets or migrations needed specifically for Smart. Do not use an old client-side backend snapshot to deploy over this version.

Search limit: up to 300 existing published rows; ranked first eight verified direct candidates, then Aviasales Data API cached monthly one-way rows (up to three pages per route/month, direct first, connections only if no direct pair). It is not exhaustive inventory; no fallback outside selected departure month. Actual prices and booking availability remain subject to existing provider quote/PREBOOK. Existing Nuitee 4-star Standard tariff is unchanged.

`npm run check` passed 122 core, 39 aviation, 105 package, 20 Python migration tests (286 total). New package runtime tests include exact/±4-day ranking, independently published open-jaw pairs, wrong route/month, and Data-only fallback. No real booking/deploy performed. Verify current production cutover status before deployment and smoke test before shipping iOS.

Smart does not call Ignav. Existing quote validation rejects Aviasales + Nuitee children/infants, so those parties require published inventory.
