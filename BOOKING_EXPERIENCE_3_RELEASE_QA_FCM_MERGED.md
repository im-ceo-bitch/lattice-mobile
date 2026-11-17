# Booking Experience 3.0 Release QA + Android FCM

This cumulative update merges all 98 Release QA paths with the complete nine-file Android FCM patch. Do not install older patches afterward. No workflow, D1 migration, iOS or Android app code changes relative to the Release QA patch. The existing additive D1 migration still needs to run via the existing deploy workflow.

- Restores case-sensitive FCM token registration and the health `pushProviders` result.
- Preserves APNs for client iOS and Business; adds FCM routing for Android, including booking-created receipts, Care and Signal.
- Keeps the Release QA outbox and adds FCM transport with bounded retries, current recipient validation and stale status suppression; scheduler supports FCM-only deployments.
- Preserves Booking Experience server transition and payment/document gates. Mixed integration tests now use a valid booking stage, required document slot, and service confirmation.
- Runtime configuration: existing `FCM_SERVICE_ACCOUNT_JSON` must be a Worker runtime secret. Health is shape-only, not proof of delivery. No credential values are included.

QA: `npm run check` exit 0 (171 unified, 40 FlightHub, 119 Package Engine, 20 Core Migration = 350). Standalone HotelsWorker: 152/186 pass; exact same 34 pre-existing failed test names as Release QA. No live deployment or device delivery tested. Provider acceptance is not device receipt. Initial booking receipts, Care and Signal remain best effort; ambiguous delivery failures may duplicate messages.
