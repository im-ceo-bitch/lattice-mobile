# iumrah Configurator Stability 10 — cumulative 01–10

Install this archive only on top of the supplied original repository. Includes stages 01–09. Deploy Business/backend first, then build iOS.

Scope: price discovery and request submission, not supplier reservation. Managers confirm availability and price before payment. Sandbox room selections use exact server-observed tariff snapshots (maximum 24 hours), scoped by property, dates and occupancy. No invented price, no sandbox prebook. Production supplier prebook behavior is unchanged. Unknown property stars remain unknown; commercial Standard fallback is used for calculation. 9% support and 2% payment model unchanged.

Client: complete lazy hotel list; separate metadata and rates; groups of 40 (two concurrent), bounded individual recovery; filters on existing rows; no manual 12-item pagination; retain valid prices and selection; per-card package quote requests removed; public published flight fares displayed when provided; identical quote reused for up to five minutes if complete and eligible. No perpetual seven-day request deadlines. Existing photo collage preserved.

Verification: 202 Core + 40 Flight Hub + 138 Package Engine + 20 migration tests passed; 8 iOS test scripts passed, including actual Swift catalog model with 87 hotels; Swift syntax parse for 47 files. Legacy HotelsWorker suite: 152/186 passed, same 34 failures as version 09. No Xcode build, TestFlight/device UI validation, production provider or deployment verification. Actual rates can be missing when supplier does not return them; no fallback invented price. This is a candidate stabilization patch, not certification of production readiness.
