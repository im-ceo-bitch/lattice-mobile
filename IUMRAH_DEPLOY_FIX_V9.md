# V9 — deploy repair (13 Nov 2026)

Based on both supplied logs and the supplied Business repository with the V8 overlay.

- `logs_117447035855`: deploy failed before publishing at `SELECT id,status FROM hotels LIMIT 0`; `HOTELS_DB` had no hotels table, `BOOKINGS_DB` had no bookings table; R2 was not connected. The existing `npm run deploy` now bootstraps the final schema on the discovered existing D1 databases before deployment. No historical reset/data-cleanup SQL is run against production. The schema was generated in disposable SQLite and includes no legacy rows. Missing incompatible columns stop deployment with a specific error. No databases or R2 buckets are created.
- `check-deployed.mjs` now checks the unified core and Package Engine module identity, package database SQL health, and the flight schema/catalog. It does not assert that private data has migrated.
- One monitor-run timestamp tie breaker fixes nondeterministic flight monitor status reporting.
- All workflows preserved. Dashboard variables preserved; no new secrets in ZIP. `core-bindings.json` is not overwritten, and is optional until a verified private bucket has been selected.

## Install order

1. Upload this ZIP to `lattice-mobile` and let the existing ZIP installer finish. Run the existing `Deploy iumrah backend` workflow once. Do not run the old Package Engine workflow.
2. Check `/__iumrah/health`, `/api/package/health`, `/v1/public/status`, and `/__iumrah/cutover` on `https://iumrah-backend.helloiumrah.workers.dev`.
3. Only then apply the Web V9 ZIP. Its deploy command verifies the backend before uploading and verifies both domains after upload.

## Data safety — not a data import

The log explicitly reports a different existing Web bookings D1 (`iumrah-web-db`) from the backend `BOOKINGS_DB` (`iumrah-core`). Creating tables does NOT transfer records. The existing V8 migration tool `Backend/CoreMigration/prepare_cutover.py` is retained. Export the real legacy D1 and target D1 privately, freeze old writes, plan/merge and verify row parity, preserve passport R2 objects and original signing/session secrets, then activate the existing core cutover flag. Do not enable it merely because a schema check passes. See `IUMRAH_UNIFIED_CORE_V8.md` for the procedure. No old Workers, databases or files are deleted by V9. Without the real production data/credentials this release cannot confirm account or booking continuity. Public catalog read routes do not require the private cutover flag, but may still report an unavailable/empty catalog if the real inventory has not been imported.

## Validation

`npm run check`: 41 unified backend + 39 Flight Hub + 86 Package Engine runtime tests = 166 passed; package TypeScript check passed. Schema bootstrap tested on SQLite with the partial existing intelligence schema, a repeat run and preserved hotel row, missing booking tables, and incompatible schema rejection. Cloudflare publish and remote data checks must run in the existing workflow. The live repository may contain files not present in the supplied archive; this is a cumulative V8 overlay, not a replacement of the repository.
