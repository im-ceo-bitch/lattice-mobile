# iumrah backend — Seamless Booking notifications V1

Base: lattice-mobile-main 7.zip (01170a2992ddd0c0d0d54064609f0e6722d328b2). Compatible with iOS Notifications & Hotel Pagination V6. Existing workflows, secrets, Worker name and database bindings are unchanged.

## Deployment

1. Upload the update ZIP into the root of lattice-mobile on main; the existing Apply iumrah Business ZIP update workflow extracts it. Do not unpack or replace the repository manually.
2. After the apply workflow succeeds, run the existing **Deploy iumrah backend** workflow. Its schema bootstrap adds the new delivery tables; no existing rows are deleted.
3. Verify a new booking with a verified phone, then a new booking with a verified email, using an iOS V6 device with push permission. Check creation and a later status update. Test Care in both directions.

## Contract

- The booking endpoint validates notificationIntent against an actual, unexpired contact verification proof, consumes it for exactly one booking, and saves the contact and creation-delivery outbox with the booking. Exact verified retries use a deterministic request identity. Legacy clients without notificationIntent retain the previous contract.
- On commit, the Worker schedules notification dispatch without making provider availability a prerequisite for the success response. The existing scheduled handler retries pending creation/SMS jobs. Contact and push jobs are independently tracked. Provider acceptance is not a delivery/read receipt.
- SMS uses a stable UUID Idempotency-Key and immutable body per booking/status/recipient. The provider may reject unapproved SMS text. Legacy ambiguous SMS rows are not blindly replayed. SMS currently supports +998 numbers and Russian status text.
- Email includes the persisted package information (dates, flights, hotels, room names, totals and recorded included services); details remain subject to availability confirmation. Links point to the existing booking access page, not a public passport/document URL.
- Initial APNs delivery uses the existing push queue. A registered device, permission, and valid APNs credentials are necessary. Late device registration can replay a recent pending creation notification. Other devices and old clients use existing registration paths.
- The new booking-session route validates booking ownership and the already-consumed contact proof before issuing a profile session. Verified identity is reused where safely possible. Existing credentials and protected bookings are not overwritten. An unmatched verified contact does not silently transfer an existing booking to another account. The earlier guest chat and account security boundaries are retained.
- This patch does not implement WhatsApp Cloud API or new Telegram linking. It does not change Business iOS UI; provider delivery status/read receipts are not implemented here.

## Provider prerequisites

The existing deployed Worker must have valid RESEND_API_KEY and configured sender, DEVSMS_API_TOKEN and approved SMS templates, APNS_KEY_ID/APNS_PRIVATE_KEY/APPLE_TEAM_ID and correct app topic/environment, plus IUMRAH_SESSION_SECRET (minimum 32 characters). Never put these values in the repository. The existing workflow and secret management are not changed. Review exact SMS copy in booking-sms.ts against approved provider templates before live use. No real SMS/email/APNs were sent by automated tests.

## Verification

`npm run check` in Backend/IumrahBackend: 181/181 unified backend tests, 40/40 FlightHub tests, 119/119 Package Engine tests, 20/20 migration tests, TypeScript check passed. The new integration test uses a SQLite D1 adapter and mocked providers to exercise contact proof validation, booking creation SMS and APNs, idempotent retry, profile session and identity reuse, and email package details. Live deployment, provider credentials, templates and device receipt must still be verified.
