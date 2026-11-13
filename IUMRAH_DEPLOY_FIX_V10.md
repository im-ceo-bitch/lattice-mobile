# Unified Backend V10 — deployment regression repair (2026-11-13)

Based on `lattice-mobile-main 4.zip` + the cumulative Business V9 overlay + GitHub Actions log `117452750875`.

GitHub stopped at `npm run check`: 42 passed, 2 failed out of 44. `Backend/IumrahBackend/tests/package-compatibility.test.mjs` existed in the live repository but was absent from the original archive and V9 overlay. The older fixture expected the singular internal router label `package` rather than the actual current `packages` module, and a session route returned 404 instead of authenticating.

V10 explicitly replaces that file at its original path with real module integration tests. The test compiles the actual Package Engine, imports the actual HotelsWorker and Core, uses the actual router and V9 schema in disposable SQLite, and verifies the health endpoint, unknown route 404, missing/wrong/expired/revoked credentials 401, real pre-existing account identity, revocation of the current token only, migration safety and row preservation. No test skips, no fake health response, no disabling the migration gate. The Package Engine now implements GET `/api/package/client/account/session` and POST `/api/package/client/account/logout` using the existing hashed-token session table in HOTELS_DB; the legacy catalog paths still work. No new account or token is minted by a session read. Core's readiness gate is preserved.

The V9 schema-bootstrap test also now calls the actual deployment entry point against a local Cloudflare-shaped API transport with the discovered D1 IDs. The incomplete hotel database and empty bookings database are initialized and a repeat run preserves records. All V9 files remain included.

## Install

1. Upload ONLY `iumrah-business-unified-deploy-v10.zip` to the root of `lattice-mobile` and confirm the automatic ZIP apply commit has finished.
2. Run the existing `Deploy iumrah backend` workflow. Do not rerun the previous failed job against its old commit.
3. If it succeeds, the already-installed Web V9 can be deployed using its existing workflow. No new Web or iOS ZIP is needed for this specific log.

No workflow, DNS, R2 binding, Cron, live data, or secrets have been changed in this repair. No destructive migration has been added. Do not delete old databases, set `IUMRAH_CORE_CUTOVER_READY=1` or assume existing records are imported simply because deploy passes. Real data/R2 and signing-secret parity still need verification.

## Local verification

Exact `npm run check` command from the workflow: 47 Unified Backend + 39 Flight Hub + 86 Package Engine tests = 172 passed. TypeScript check passed. Node v22.16.0. Local D1 tests use disposable SQLite, not Cloudflare. No remote deployment or production migration executed. The original failing test's source was not supplied; its replacement is based on the log and actual current module behavior. Other unprovided live-repo changes cannot be verified.
