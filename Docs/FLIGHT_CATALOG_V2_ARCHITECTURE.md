# iumrah Flight Catalog V2 — implementation contract

## Scope and invariants
- One Cloudflare Worker `iumrah-backend`; one existing FLIGHTS_DB binding.
- Preserve existing `flights`, `flight_offers`, `price_history` and every persisted ID.
- No hotel changes. No replacement of current GitHub workflow. No public mutation endpoints.
- An itinerary is an ordered list of 1+ physical flight segments. A fare is an offer for an itinerary, not intrinsic to the flight.
- Business and client iOS use the same public itinerary read-model; Business additionally has authenticated price history and operator notifications.

## Source policy
- Ignav: primary discovery and initial fare when it returns the required itinerary segments, passenger scope, and price observation date.
- Centrum (C6), Uzbekistan Airways (HY), Flynas (XY): twice-daily official-site price observations; update only exact itinerary/flight, fare brand, cabin, passenger count and currency match. No invented availability, time or baggage.
- AeroDataBox: optional enrichment for missing/contradictory schedules and operational information, not price or baggage. Not a prerequisite for every Ignav record.
- Aviasales Data API: **discovery cache only**, explicitly labeled as historical/indicative and never promoted to a booking quote without verification. Cache expiration and date/route mismatch must be checked; no missing segment synthesis.
- Offer price history is append-only; previous price and newly confirmed price generate one idempotent notification event, with rate limiting and APNs delivery after commit.

## Existing flights and migration
- One-segment itineraries are seeded idempotently from current `flights` rows, for active dates only. `flight_key`, `flights.id`, existing offers and price history stay untouched.
- `detail_status=needs_confirmation` if schedule times missing; never display made-up arrival time/duration.
- Distinct connecting itinerary is added only when ordered validated segments exist. If only Aviasales cached origin/destination/date/indicative price exist, store in `flight_discovery_cache`, not in `flight_itineraries`.
- Price from a bot must not overwrite a different provider's offer; prefer ranking a fresh verified offer but keep all source-specific observations.
- Before rollout, verify counts, FK integrity, idempotence, active vs expired counts, and public API backward compatibility.

## Flight search card
- Airline logo/name, date and flight codes; departure/arrival *local time per airport*, IATA codes, duration, 0/1/2 stops, transfer airport and connection duration when known.
- Price per passenger, currency, passenger composition, fare freshness and source, baggage included/not specified.
- Price is hidden when no verified/eligible offer; show `Цена уточняется` rather than `0` or an expired amount.
- Entire card opens itinerary details; fully rounded text-only CTA. Avoid decorative badges.

## Itinerary details page
1. Hero: origin ⇢ destination, local date(s), route type and verified price/placeholder.
2. Segment timeline: every airline, operating carrier, flight number, full airport name and code, departure/arrival local dates and times, terminal only if supplied; exact layover place and duration; self-transfer risk if indicated.
3. Fare comparison: passenger price vs family total, baggage per fare, cabin, change/refund rules, meals, seat availability only if actually supported.
4. Price trust: provider name, last confirmed time, link to booking / revalidation, no fabricated discounts.
5. Business-only: source comparison, chronological price history, operator changes, pending verification, push alert subscriptions and audit log.
6. Sticky bottom area: verified total price + text-only `Выбрать рейс`; use `Проверить стоимость` when stale, disable booking if data is incomplete.

## Notifications
- Trigger only after a committed, verified price change for the same offer. One event fingerprint: offer ID + observation timestamp + old/new amount + currency.
- For Business: in-app event inbox + APNs push; opening goes to itinerary detail at History tab. The payload must not contain secrets or passenger PII.
- Retain an audit trail of failed deliveries; allow quiet hours and threshold/summary settings.

## Rollout sequence
1. Schema-only additive migration on FLIGHTS_DB after backup, verify existing 62 active records count against live DB, no rename/delete.
2. Implement versioned `GET /v1/public/itineraries` and `GET /v1/public/itineraries/:id`, keeping existing `/v1/public/flights` unchanged.
3. Connect Ignav import and only confirmed official-site bot observations; add source-ranking logic.
4. Connect Aviasales discovery cache / route gap cards with links or revalidation, not fake direct fare details.
5. Build client SwiftUI list/detail using exact DTO from backend, then Business detail/history and notifications.
6. Canary verify with 3 providers and data quality report; switch after confirmation.

This SQL is a reviewed *candidate migration*, not evidence it was applied to your live D1. The existing deployment workflow must explicitly invoke migrations on FLIGHTS_DB for it to run.
