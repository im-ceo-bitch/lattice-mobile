# Booking & Notifications 14 — cumulative

Includes previous cumulative patch.
- Compact Booking ID card and notification channels.
- Booking-created receipt and exact authorized booking/chat routes.
- Reuse existing OTP notification outbox; SMS includes booking number, nights, support telephone; universal link opens exact booking.
- Permanent deletion of unpaid, unconfirmed requests only; both databases, minimal anti-resurrection marker.
- Account deletion for trip-free identities without financial or security obligations.
- Backend tests: 203 core, 40 FlightHub, 140 Package Engine, 20 migrations. Swift syntax only, no Xcode device validation.
- Previous static test_seamless_booking script asserts an outdated literal Smart constructor; 12/12 actual policy checks pass.
- Production APNs, SMS, domain Universal Links and D1 deployment not tested. Existing HotelsWorker standalone failures were not retested.
