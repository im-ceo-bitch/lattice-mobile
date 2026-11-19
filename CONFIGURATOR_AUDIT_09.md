# iumrah Configurator Audit 09

Scope: original kepler-ios and lattice-mobile archives supplied by the owner + cumulative update 08. Audit covers hotel and flight selection in the shared configurator flows. This is a stabilization patch, not a production certification.

## Corrected in 09
- Hotel list prices now include child ages in requests and cache keys; detail rates are reused only for matching dates and occupancy. Identical detail API requests coalesce on backend.
- Catalog pagination is independent of price hydration; multiple pages may appear while earlier prices are loading. Price work remains bounded and queued. Already obtained valid prices are retained.
- Standalone hotel search text survives navigation; positive cached prices are refreshed on reentry when expired. Confirmed unavailability clears outdated positive rates. Hotel offer selection checks dates, adult count and freshness.
- Unknown star ratings are retained in legacy hotel filter as well. No invented category. Photo collage not removed.
- Official hotel lookup no longer makes eight sequential Medina alias queries. Existing server list route recognizes historic city aliases.
- Hotel selection checks the actual stay and occupancy. Smart checks date/adult count of room response and includes child ages in catalog search. The final room no longer automatically navigates out of the hotel step; explicit confirmation remains.
- Legacy flight screens preserve selected tickets on reentry and debounce/cancel stale price previews. Guided flight query identity uses relevant fields only; the chosen pair is validated before modifying the draft. Reconfirming unchanged flights preserves rooms.

## Open release blockers / risks
1. Hotels with unspecified stars appear in filters but existing package tier policy rejects them. Obtain authoritative stars or approve a separate commercial tier in Business. Do not assign fictitious ratings.
2. Multiple rooms: independent single-room offer validation (including repeated offer ID) does not guarantee simultaneous inventory. Verify supplier multi-room contract and final prebooking for full allocation.
3. Long provider deadlines (up to seven days on client); use measured finite request lifecycles, retry and partial-results strategy. Do not represent timeout as unavailable.
4. Guided flights: exact lookup and calendar lookup still form a serial pipeline; errors can be swallowed as empty results. Separate exact offers, calendar availability, error state; batch or scope price previews instead of one full quote per flight. Published schedule is not guaranteed purchasable fare; child fare must be validated by supplier.
5. Hotel filters still may restart hydration and reset pagination; separate purely local visual filters from price query identity, preserve scroll and visible rows. No redesign of filter bar in this patch.
6. Production crash root cause unknown without .ips, Xcode build and device reproduction. Existing HotelsWorker suite has 34 baseline failures (same names in 08 and 09).

## Verification
- Backend npm run check: 398 tests passing (202 Core, 40 Flight Hub, 136 Package Engine, 20 migrations).
- Separate HotelsWorker: 152/186 passing; 34 failing, reproduced in baseline 08. Not a green release gate.
- Linux Swift smoke tests for actual catalog model (partial responses, family price isolation, pagination through 3 pages during hydration), page compatibility, daily cache, hotel stability, Smart editing/review, shared quote contract and mixed booking. Some suites are static rather than end-to-end. Swift parser checked 10 changed application files.
- Full Xcode compile, production API, real hotel inventory, UI scroll and device crash verification not performed.

Release gate: staging backend and iOS build; verify hotel list/detail price and family occupancy for same dates, multi-room inventory, slow/offline network and retry, filter & back navigation preserving selections, local airport times, no false sold-out on provider failures, all three configurator final quote and booking flows, device crash-free test. Fix baseline suite before production sign-off.
