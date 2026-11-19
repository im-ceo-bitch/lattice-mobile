# Hotel price recovery 08 — cumulative 01–08

- The screenshot wording matches the stage 06 catalog; stage 07 alone is not sufficient to resolve every omitted property. The new client automatically checks omitted IDs via the same single-property room-rate endpoint as the hotel detail screen, with up to three concurrent checks per page and one retry for an ambiguous empty response. Stops on rate-limit responses. Positive prices stay in place, and retry targets only unresolved rows.
- Server does not treat partial batch cache as complete or batch-wide unavailability as property-specific proof. Reuses positive detail rates for identical dates/adult occupancy (no children). Does not invent unavailable prices.
- Preserve existing photo collage layout; fetch missing metadata before expensive image fingerprint validation. Do not change Trip Summary or financial formulas.
- Checks: 202 Core, 40 Flight Hub, 133 Package Engine, 20 migration tests. Swift catalog model smoke test with mocked service, hotel cache/photo/paging scripts, Swift syntax parsing. No device build, live Nuitee calls or production deployment verified. Existing list-price occupancy contract is adult-based; this patch does not redesign child-specific list pricing.
- Install Business/backend before iOS. Previous manifests are historical; verify the stage 08 manifest for the current cumulative overlay.
