# iumrah Unified Catalog 11 — cumulative update

Apply this archive over the original repository, not over an assumed deployed version. Includes prior cumulative stage 10 and all current changed files. Old hash manifests are superseded by UNIFIED_CATALOG_11.sha256. No supplier booking or automatic purchases are added.

- New v3 catalogue snapshot: all returned supplier pages and supported city spellings, ID deduplication, reject repeated/incomplete pagination, retain stale snapshot if refresh fails. Safety limit 50 pages per spelling, fails explicitly rather than claiming full sync.
- Staff catalog coverage screen and authenticated GET/POST diagnostics. Counts reflect IDs actually observed; no live credentials tested.
- Rotating default-date price warm-up in bounded batches of 40, exact-date/occupancy demand pricing remains separate. D1 batch reads/writes.
- Main backend check passed: core 202, flight 40, package engine 140, migrations 20. Legacy standalone HotelsWorker failure set from previous audit remains outside this change; not revalidated here.
