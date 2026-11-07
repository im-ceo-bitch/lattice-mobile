# iumrah Client integration — prepared, NOT yet installed

This standalone Swift file is **not** wired into the consumer's booking/search/quote screens: the current client repository was not attached. Never misrepresent it as a production migration.

Once the CURRENT `kepler-ios-main` repo is provided:
1. Audit the original `PackageEngine` URL, authorization/session token and flight search endpoints.
2. Add `IumrahFlightHubClient` to sources; supply the new public workers.dev HTTPS URL from the new account.
3. Route flight discovery to the new Hub; keep full server quote and availability revalidation in the Package Engine.
4. Only change account, checkout, quote and booking API URLs after verified migration of the Core D1 and deployment of a compatible new Core Worker.
5. Preserve the independently configured hotel API, existing auth and booking reference numbers.
6. Build iOS/TestFlight and test: outbound / return flights, package total, customer login, new booking, payment instructions and booked trip.

Flight Hub is **not** a booking or checkout API and must not replace the Package Engine.
