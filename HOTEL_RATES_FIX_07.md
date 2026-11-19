# Hotel rates and collage regression fix 07

Cumulative overlay 01–07. Previous SHA manifests are historical; verify this manifest for the current overlay. Deploy Business Worker before building iOS.

- Restore the existing distinct-photo loader and catalogue collage, including bounded detail enrichment when previews are incomplete.
- Do not discard real supplier offers because room photo mapping is missing. Retain the original offer ID and original room mapping value, including empty mapping; server offer validation remains intact.
- Price searches set a 30-second supplier search window without adding a short client abort. Partial minimum rate searches fall back once to the full room-rate endpoint for missing IDs in paged requests. Do not cache empty room searches as successful results; explicitly distinguish confirmed unavailability.
- Detail retry bypasses cached offers; one retry for ambiguous empty result. Preserve the existing price formula and catalogue layout.
- Checks: backend 202, Flight Hub 40, Package Engine 130, migration 20; targeted Swift model/cache/photo and integration checks passed. No Xcode device build or live supplier requests verified.
