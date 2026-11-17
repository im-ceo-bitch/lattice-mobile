# Booking Experience 3.0 — Stage 2A: Booking & Document Center (2026-11-17)

Cumulative patch over Foundation 1B merged, including Sales Offers and Business UI Final. Apply files at repository root (not a whole-repository replacement). Existing GitHub Actions unchanged. The existing Deploy iumrah backend workflow applies the additive, repeatable 0044 SQL before deployment. Deploy Business backend before building Business and Client iOS. Do not overwrite with earlier patches.

## Implemented in 2A
- Client: prominent next-action entry in actual BookingsHomeView, stage-specific status card and instructions in four main languages, guest-capable traveler editor connected (rather than the old passport-only route), separate photo and form counters; full name/passport/contact input, partial save. No account profile writes for guest traveler.
- Client: grouped flight/hotel/visa/insurance documents with actual requirement counts and each assigned position, all published files shown independently; optional categories hidden when absent; payment amounts and remaining balance, no rejected receipt presented as paid.
- Client: explicit single/all published-file offline downloads; iOS complete file protection, private Application Support, backup exclusion, hashed booking scope, local index, revocation pruning on successful checkout, cleanup on access rejection and account logout/local booking deletion. Offline copies can be stale until sync; files explicitly exported by the user cannot be remotely revoked. Offline cold-start behavior and data protection require device QA.
- Client: document/payment review push reception forces checkout refresh for locally known bookings; tapping that push opens the status panel (other booking links retain package behavior). Polling fallback remains. No claim of actual APNs delivery.
- Business: grouped Document Center, per-position readiness, upload from a specific requirement, multi-position common PDF, file preview before publish, preview for existing files, reference editing on replacement, explicit revocation history and re-publication. Independent requirement states pending/preparing/needs_correction; published state is derived exclusively from files. Only staff can change operational state; no freeform private notes exposed.
- Server: atomic document replacement retains previous file in staff history, validates kind/booking/scope, preserves all old assigned positions, rejects stale concurrent replacements, removes newly uploaded R2 object if D1 publication cannot complete; no new destructive migration. Staff audit events for replacement and requirement state.

## Validation
- Unified backend 147/147 (three new tests for replacement, slot progress, race with revocation). Package Engine 118/118 and TypeScript passed.
- HotelsWorker legacy suite 152/186 passed; same 34 failing test names as Foundation 1B. Not a clean suite; investigate separately.
- Changed Swift files pass parser only, not Xcode typechecking or on-device tests. Actual D1, R2, APNs/SMS/email and Universal Links not verified in production.

## Pending, not dropped
- Foundation 1C: verified guest recovery on another device; complete non-document service readiness (guide/transfer etc.), legacy pending payment reconciliation, delivery retry/notifications and financial exceptions. Do not treat Foundation as complete.
- Stage 2 remaining: full visual end-to-end QA for all configurators and confirmation sound/animation; remaining payment/availability UI polish and explicit delay notification, passport validation/review workflows; complete web parity on iumrah.uz requires current web repository; localization of provider notifications and verification of real APNs delivery. The common confirmation flow and existing offer/notification functions are preserved, not rewritten.
- Stages 3 and 4: operations center, independent service execution, real itinerary completion, cancellation/refunds, trip companion, review/archive/certificates and financial closeout. Business screens continue the existing layout; complete workspace redesign is Stage 3.
