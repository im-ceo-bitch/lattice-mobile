# iumrah Signal: Android push (FCM HTTP v1)

Base: lattice-mobile-main 3.zip, Booking Experience foundation 1A merged. No workflow, D1 schema, iOS code or app signing changes.

## Deploy

1. Verify `FCM_SERVICE_ACCOUNT_JSON` is a **runtime Secret** on the Worker named `iumrah-backend`, not a Pages/Build-only variable or legacy `iumrah-flight-hub` secret. Paste the complete Google service account JSON; never commit or log it. The service account must have `cloudmessaging.messages.create` permission (Firebase Cloud Messaging API Admin role suffices), and the Firebase Cloud Messaging API must be enabled in the project matching the production Android configuration. The renderer already preserves dashboard variables (`keep_vars: true`).
2. Apply the ZIP at repository root through the existing Apply iumrah Business ZIP update workflow; verify all patched files were committed. Run the existing **Deploy iumrah backend** workflow manually. No new GitHub secrets needed for the backend.
3. Open `https://iumrah-backend.helloiumrah.workers.dev/__iumrah/health` after deployment. `pushProviders.fcm: true` confirms the runtime secret is present and looks like a service-account credential. This is a format/configuration check, NOT proof of OAuth access or device delivery. `pushProviders.apns` is the existing iOS credential-presence check. If FCM is false, check Worker runtime Settings → Variables and Secrets, correct project and JSON type/contents; do not expose the key.
4. Build the Android **production** AAB with the four existing `IUMRAH_FIREBASE_*` GitHub Secrets. Install via Google Play internal testing and launch, grant notification permission, confirm network and Google Play services. This patch preserves the existing production-only `com.iumrah.app` registration contract; debug `com.iumrah.beta` is NOT covered.
5. On one Android and one iOS device, verify booking creation (while awaiting availability), a committed booking status update (payment confirmation included), uploaded travel document, a staff Care message, and an iumrah Signal system notice. Check foreground/background, locked screen, notification tap and authorization after account switch. A forced-stop Android app or blocked notifications cannot be assumed to receive pushes. Confirm actual receipt; FCM API acceptance alone is not device delivery.

## Design

- Existing production APNs hex tokens are normalized as before. Case-sensitive FCM tokens are preserved; token shape routes them to the corresponding transport. No schema migration. Existing authenticated live-session and guest booking targeting rules still apply. New Android initial booking receipt is attempted at registration if the current booking still awaits availability, deduplicated per booking/token using the existing receipt table. Existing Apple initial delivery behavior is retained.
- FCM uses a signed RSA OAuth assertion and the official HTTP v1 endpoint with an expiring in-memory access token. Notification and string data are sent together for native system notifications and app navigation. Channel `iumrah_trip_updates` and icon match the Android source. Only `UNREGISTERED` disables a token; temporary failures do not re-enable or revoke it. APNs and FCM failures are isolated. No private key, OAuth bearer or raw FCM error body is written to logs or D1.
- Existing status change event in Business operations sends both transports; payment confirmation is a booking status transition. Existing document, Care chat, security and system notification hooks use the same dispatcher. The legacy direct Core admin status path is not changed. No Firebase database, auth, or hosting is used. The existing direct push delivery is best effort (no durable FCM retry queue added). Existing bulk Signal delivery limits are unchanged.

## Verification

Tests use generated fixture keys, SQLite-backed D1 adapters and mocked Google/Apple HTTP responses. They do not perform production network requests or prove device delivery. Run `node --test tests/*.test.mjs` from `Backend/IumrahBackend`. The standalone HotelsWorker suite has pre-existing failures; compare against the supplied base before attributing them to this patch.
