# All Configurators Stability V3 — Business
Cumulative against lattice-mobile-main 4.zip, includes prior regression test patch.
- Manual estimate accepts roomCount, defaults compatibly, supports multiple rooms per selected city; estimates remain non-bookable.
- Nuitee occupancy validation checks age groups and exact ages across cities; existing pricing formula unchanged.
- Regression tests include 2→4→5→6→2 adults, multiple rooms, partial estimate, invalid child/infant classification.
- scripts/test-package-module.sh: 146/146 runtime tests pass; TypeScript compilation in script succeeded. Fixture/sandbox tests, not live provider or deployed API.
- Deploy existing Business backend workflow; no D1 migration or workflow change. Client V3 requires current backend for multi-room manual estimate.
