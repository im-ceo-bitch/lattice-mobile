# Booking Experience 3.0 — Stage 2B (2026-11-17)

Cumulative root-overlay patch over Stage 2A, including Sales Offers, Business UI Final and Foundation 1A/1B. No GitHub workflow changes, no new schema, no destructive migration. Deploy Business backend first, then build Business and Client. Never apply older overlapping ZIPs afterwards. This is an overlay, not a full standalone repository.

## Changes
- Common IumrahBookingConfirmationView: clear OTP CTA, identity/contact fields locked after a booking is saved to avoid switching recipients on retry, successful completion opens the status/checkout panel. Existing IumrahBookingCreatedContent with dome, sound and haptics remains unchanged. Existing accepted offers and booking/status/document/payment/delay push taps route to the status panel. Four shared confirmation call sites verified by source inspection, not actual device UI testing.
- Client: payment balance before instructions and receipt history, truthful pending/partial/rejected/verified copy in checkout, status and legacy card. Transfer details/submit button hidden while pending verification or fully paid. Rejected receipts permit resubmission; partial payment shows remainder; no extra payment when verified. Payment review readiness no longer inferred from any approved receipt. Preserve account-optional guest scope and stage 2A documents/offline features.
- Server: derive payment review timing from oldest currently submitted receipt. After last pending receipt is rejected or partially approved, clear obsolete receipt-review timer, preserving paid amount and allowing price hold restart. On full verified settlement stop review timer. Read repair for stale legacy timer values without crediting old unverified payments. No new DB columns.
- Business: separate 30-minute client expectation vs 6-hour operational deadline, warning at 25 minutes, manual localized APNs delay notice after 30 minutes. Staff-only endpoint; audit attempt/result; 30-minute cooldown; actual APNs acceptance count returned (not proof the user received it). No automatic background notification, SMS or email delay notice in this patch. Existing primary initial/status SMS/email retained.

## Validation
- Unified Backend 149/149; includes two new tests for payment timer progression and availability delay eligibility/rate limit/audit/no-device behavior. Package Engine 118/118, TypeScript passed. HotelsWorker legacy suite 152/186, same 34 failing names as Stage 2A.
- Swift changed files parse successfully; no macOS Xcode typecheck/build, real iPhone, APNs or deployed D1 verification. All four original confirmation call sites retained. No production deployment performed.

## Pending (not dropped)
- Foundation 1C: verified guest recovery on another device, full service-level readiness, reconciliation of historic payment data, notification delivery retry/outbox. No new account requirement introduced.
- Stage 2: actual device UX QA on every configurator and audio, remaining passport review/validation, actual delivery tests and web parity with current web repo. Manual delay push does not replace automatic reliable notification handling. No current web repo supplied.
- Stage 3 Business Operations: real per-service checklist, actionable queues, manager assignments, cancellation/refund and operations history. Stage 4: trip companion, execution states, closeout/archive/reviews/certificates. Do not mark these complete.
