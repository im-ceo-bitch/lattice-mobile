# Booking Experience 3.0 — Foundation 1B (2026-11-17)

Cumulative patch over the merged 1A, including Sales Offers and UI Final. Apply files over the repository root, not as a replacement repository. Do not reapply older patches afterward. Deploy Business backend first, then build both iOS apps. Existing GitHub Actions unchanged; the existing deploy applies additive 0044 SQL (repeatable). Do not delete existing data. If the incompatible original 1A was deployed, inspect business_offers schema before deploying.

## Implemented
- Guest access using existing verified booking token, without mandatory account creation on the device holding the token; optional account access retained.
- Per-traveler information and passport form; names may be saved first. Payment and document APIs use booking-scoped authorization.
- Staff explicit payment receipt decision; approved amount in USD equivalent, rejection reason, partial payments, duplicate protection. New confirmation checks full verified amount and traveler readiness. Historical confirmed payments are identified without inventing amounts.
- Independent document publication, assignment by traveler and flight direction or hotel, group PDF may cover several slots, revoke/republish, upload during trip. Existing documents remain visible unless revoked; manager must assign historical files to slots before a new readiness transition. Server verifies required document slots before ready/in_trip. Legacy admin status route uses same operational API.
- Additive receipt review, document publication and operational audit tables. No destructive migration.

## Validation
- Unified backend tests 144/144 (4 new SQLite integration and contract tests, including repeat migration, receipt decision, guest token, multi-traveler docs).
- Package Engine 118/118 and TypeScript check passed.
- HotelsWorker separate legacy suite: 152/186 passed; 34 failures also reproduced on merged 1A baseline. Not a clean suite; investigate separately.
- Changed Swift files parse successfully, not a full Xcode build. No actual D1 deployment, device test, provider notification verification.

## Still pending (Foundation continuation / later phases)
- Guest recovery on a different device by verified phone/email; full website UI requires current web repo. Same-device proof is not cross-device recovery.
- Legacy pending bookings with preexisting approved receipts without itemized amount need staff reconciliation; historical completed/confirmed amounts are not inferred. Payments currently record USD equivalent; native settlement currencies and refunds remain later scope.
- Full service readiness (guide, transfer, optional insurance in the package engine), availability checklist, all operations audit/delivery retry, replacement/preview UX, offline documents and actual trip execution are later work. Revoking a required file after ready blocks a subsequent in_trip transition but does not automatically roll back a ready status.
- Full notification delivery, old booking migration data and Xcode build to be verified on actual environment.
