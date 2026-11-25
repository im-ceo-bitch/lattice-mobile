# iumrah Business — Umrah Studio 4.0

Cumulative overlay on the provided `lattice-mobile-main 2.zip` and Workspace 3.0. Apply only this ZIP via the existing apply-zip workflow; no workflow, backend, signing, entitlement, or pricing model changes in the Studio 4.0 delta.

## Studio changes
- Shared draft and existing submission pipeline; Mac Catalyst defaults to client presentation, phone/tablet to manager mode; either mode available on all supported devices. The existing brand navigation header is retained.
- Available-pane responsive layout: fixed-in-workspace scrolling live summary at >=800 pt; separate stage rail at >=1100 pt; otherwise horizontal stage navigation and bottom estimate. Left rail is independent of the app sidebar.
- Editorial stage headers, category cards, optional preferred date filters, direct-flight filter, existing provider flight cards; inline Nuitee hotel gallery with dynamic star-filter copy, real catalog images when available and fallback icon; check-in/out and room controls before the gallery.
- Existing vehicle assets in large cards, route, separate guide, ziyarat, visa/other-service sections; conditional descriptions and service scope caveats. Final review shows actual selected flight and hotel cards, package details and canonical price calculation. Customer mode does not submit directly or display contact form; manager mode is required for submission. Existing offer link sharing remains available after creation.
- Local comparison snapshot A vs current B for a completed estimate; no PII or server persistence, not a reservation. Clear when changing draft. Existing protected saved drafts stay separate.
- No fake Nuitee prices or distances. The 100–200 m note is qualified general editorial copy, not measured hotel data. USD-only rate transfer; multiple room prices remain manually verified. No new image rights/assets for city, guide or ziyarat photography were supplied; hero uses native artwork; real hotel images and existing car assets are used. Guide coverage is not guaranteed 24/7 physical presence. eSIM remains within other services rather than a new standalone checkout component. Existing public offer renderer and backend pricing rules unchanged.

## Validation
- Swift parser across Sources passed on Linux; production draft behavioral, configurator and partial-price tests passed. Static wiring checks passed. No Apple SDK, Xcode, actual Catalyst/iPhone UI rendering, live API, or TestFlight performed. Before release: test resizing 700/800/1100 pt, direct flight filter, preferred date search, changing dates after a rate, sandbox and non-USD tariffs, compare, complete package, manager-mode contact form and final confirmation/share. Test actual hotel provider availability and retained prior Workspace 3.0 functionality.
