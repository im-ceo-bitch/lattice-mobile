# iumrah Rewards / Friends V1 — server-backed

Base: kepler-ios-main 5 + Smart V3 + build fix + package price display + Account visual V1; Business lattice-mobile-main 2 + Smart V2 Orbit.

Apply Business ZIP and run Deploy iumrah backend first. Existing deploy automatically applies additive schema from bootstrap-v21.json. Confirm core cutover readiness and D1 parity; no new Worker or database. Install updated Business and customer app before using payment credit. Run both TestFlight workflows. No web deployment.

Policy: USD 100 once for a new invited account, after source and operational booking statuses confirm payment AND approved receipt. Pending only after booking exists. Verified email/SMS registration or activation and newly created Apple/Google account with consent. Stable opaque invite link; manual code fallback after App Store install. Existing ledger, existing $100/$200 per-booking limits, verified identity, payment pending, before receipt submission. No cash-out. Refund unpaid cancelled booking credits once; paid refund/spent rewards need staff review. No extra automatic tier discounts, new coupon issuance or admin campaign settings in this release.

Tests: 122 core + 39 flights + 111 package + 20 migration = 292, all passed locally; Swift parser 333 customer + 77 Business. No Xcode or live deployment/OTP/payment tests. Confirm iOS universal link association on actual device (existing provisioning team IDs and associated-domain capability).
