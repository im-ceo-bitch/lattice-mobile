# iumrah Booking Experience 3.0 — Foundation 1A (2026-11-17)

This is an incremental test release, not the entire Foundation stage. Apply both ZIPs to their matching repositories. The files are rooted at the repository root, and GitHub workflows are unchanged. The authoritative server is the unified backend from the Business repository.

## Implemented
- Business iOS can create a shareable proposal without creating a booking. Server assigns a Package ID and an opaque share token. Offer expires in seven days or by the start date (whichever comes earlier). One offer can be redeemed once. Server validates the verified contact proof and recalculates the selling price; atomic database batch prevents duplicate bookings; internal costs are retained in the existing manual booking manager view.
- Universal Link and custom scheme route to native offer preview and existing guest confirmation. Browser fallback is hosted by the Worker at `/offer/<token>` with OTP confirmation and an App Store link. Existing `iumrah.app`, `iumrah.uz` and `iumrah.us` web site routes are NOT deployed by this ZIP. Web Business source was not supplied.
- First booking-created notification via APNs where available, with local fallback. The existing verified-email attachment sends the initial email. New DevSMS status messages are sent only to verified Uzbekistan phone numbers; provider acceptance/rejection/unknown is recorded. No automatic retries of ambiguous sends.
- Client checkout now lists all travel documents of the same type.

## Before production
1. Deploy unified backend from the Business repository using the existing workflow. Existing core cutover safety gate remains enforced; do not bypass it. New tables are additive and created on first use.
2. Build both iOS apps; test Universal Links on an installed TestFlight build and in Telegram. Actual Apple AASA association depends on signed entitlement and domain/Apple CDN. Worker AASA includes `/offer/*` and `/flights/package/*`; publish equivalent AASA and routes on all production domains in the web repository.
3. DevSMS requires approved transactional SMS templates. In the provider dashboard approve exact Russian message variants (number variable), or the provider may reject them. Verify key permissions and balance. Message format: `iumrah. №{number}. {status text}`. Status texts are in `booking-sms.ts`. Email requires Resend and verified email; APNs requires correct server keys, entitlement, token and notification permission.
4. Test guest offer acceptance, duplicate requests, two devices, actual provider delivery, web fallback and iOS navigation. No actual iOS SDK/Xcode or live provider credentials were available in this environment.

## Still outstanding (not part of 1A)
Full guest checkout authorization without any account, passport number and expiry per traveler, secure web booking recovery and full web UI parity, web Business offer builder, independent document states and server readiness checklist, explicit payment approval/rejection, full operations center, cancellation/refunds, remaining audit items and production E2E. Do not use this incremental release as proof that the entire Foundation or four-stage release is complete.

## Checks
139 unified backend tests passed, including the new offer acceptance and browser script test; 118 package-module runtime tests passed; TypeScript type checking and changed Swift source syntax parsing passed. Actual SwiftUI compilation, signing, deployment and live end-to-end delivery were not tested.
