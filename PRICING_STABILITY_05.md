# Pricing stability 05 / cumulative
Includes prior cumulative patches. Deploy the Business backend first, then build iOS.
- Shared quote request coalescing and stale-response protection on iOS; removed short quote deadline.
- Public retail totals validated in cents; absent breakdown shown as server-version issue, no invented prices or booking without a breakdown.
- Calendar preview cannot invalidate a valid financial quote; health exposes pricingContract=trip-summary-v2.
- Manual/Smart/common summary expose failures and retry; backend returns explicit missing-breakdown error.
- Backend check passed: 202 core, 40 flight hub, 126 package engine, 20 migration tests. Added mock MED arrival/JED return, three adults, two rooms each city. iOS executable arithmetic + source-contract checks passed; Swift parse passed. No Xcode build, real supplier calls, production deployment or device verification performed. Exact production failure remains unverified.
