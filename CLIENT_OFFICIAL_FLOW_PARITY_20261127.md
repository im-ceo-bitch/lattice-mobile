# Client Official Flow parity — Business V4

Base: lattice-mobile-main 4.zip; UI reference: kepler-ios-main 10.zip with the cumulative client All Configurators Stability V3 applied. This package includes the previous Business V3 server changes. Do not apply older patches after it.

The existing isolated IumrahClientConfigurator static library remains the integration boundary. No consumer root app, account, wallet, sign-in, onboarding, or customer checkout was imported. No changes to the staff navigation shell, GitHub workflows, signing, bundle IDs, D1 schema, or authentication.

- Exact shared client source is used for the journey header, flight search chrome, both hotel selection stages, transfer, guide catalogue and new guide step, JourneyStore, rate/room repricing policy and remote engine adapter. Home's search hero and both flight carousels already used the client implementations; non-visual account personalization is intentionally excluded in the staff copy.
- Trip Summary retains the original component layout and adds the client price breakdown, chart, support and total cards, comparison carousel and compact bottom bar. Its staff-specific action scrolls to the existing Business price editor. The displayed public quote is not a confidential supplier cost. The staff editor retains independent price overrides, commission, discounts and verification; draft/offer/booking submission stays in Business. Overrides reset when the source snapshot changes so a new package is not silently submitted using an old estimate.
- Business snapshot construction now requires a reconciled current server quote, complete local rooms, sufficient transport capacity and accepted room alternatives. The guide remains a preference, not a confirmed reservation.
- Existing staff API constraints remain: Haramain, more than six travelers/rooms, and incompatible room groups cannot be submitted through the existing manual staff contract. Consumer support threads, account-specific recent activity and customer OTP checkout remain isolated. Business uses its own language setting and host navigation.

## Verification performed
- 25 source/asset comparisons against the current client reference, including normalized UI comparisons excluding consumer personalization and byte-level aliased image comparisons.
- 14 executable pricing policy checks + 11 static Official Flow checks; 37 executable shared pricing model checks; six staff draft/model test groups.
- PackageEngine TypeScript compile and 146 runtime tests passed.
- Swift syntax parsing for all isolated module Swift sources passed. No Apple SDK/Xcode in the environment, so type checking/linking, TestFlight, live APIs and actual screenshot/pixel diff are not verified.

The parity manifest records SHA-256 fingerprints for all 121 module source/resource files (85 byte-identical client files, 30 adapted shared paths, six module-only files). This is a source parity audit, not a claimed screenshot similarity percentage.

## Install
Upload only this cumulative Business V4 ZIP to lattice-mobile. Deploy the backend (V3 server changes are included) and build the Business app. On the client repo use the existing client V3 ZIP if it has not already been applied. Compare on the same iPhone model, locale, Dynamic Type, appearance, dates, traveler composition and server catalogue. Check each flight, hotel, transfer and guide screen, summary and 2→4→5→6→2 repricing, then staff cost editing and draft/offer creation.
