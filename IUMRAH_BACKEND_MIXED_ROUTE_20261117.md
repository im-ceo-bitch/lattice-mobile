# Mixed route date normalization — 2026-11-17

Base: lattice-mobile-main 8.zip (1ae62a27aa3cfb25906b8f3189f55100ebf65638).

The iOS quote request contains the departure calendar day in the origin airport's timezone. The mixed-supplier quote previously compared it to the raw ISO timestamp prefix. The package engine now resolves the local day from the verified flight timestamp, including UTC midnight crossings, and retains strict exact airport, itinerary, and local-date checks. Aviasales identity lookup continues to use the original provider date; direct Aviasales quote validation compares the verified schedule with the client day. The existing same-home-airport rule remains consistent with the iOS guided return search. No change to fare verification, payment, notifications, databases or deployment workflows.

Tests: npm run check passed (181 backend, 40 FlightHub, 121 package engine, 20 migration). New tests exercise both midnight legs, signed quote contract and rejection of altered date/airport. The actual failing itinerary and live suppliers were not available for replay. Deploy the cumulative ZIP using the existing apply workflow, then manually run Deploy iumrah backend.
