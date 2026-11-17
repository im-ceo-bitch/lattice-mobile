# Hotel pagination V3
Cumulative over Backend V2. Deploy via existing Deploy iumrah backend workflow.
- Replaces the capped catalog with supplier offset pagination, merging aliases and deduplicating IDs. New cache namespace avoids serving old capped snapshots as fresh. Old cache remains fallback.
- Filter before slicing; return total and nextOffset to the current iOS client. Legacy requests without paging parameters retain full-catalog response. Price cache isolated by hotel ID set; no oversized rate batches.
- Tests: 123 package-engine, 181 unified backend, 40 FlightHub, 20 migration (other suites run before final test-only addition). V11 iOS gate 18/18 separately. Provider credentials/live deploy and real booking not tested. Supplier inventory may genuinely contain fewer properties.
