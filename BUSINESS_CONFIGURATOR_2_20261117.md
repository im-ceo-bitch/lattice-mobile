# Business Configurator 2.0 — cumulative release

Base: Telegram Concierge V1 cumulative (Booking Experience 3.0, Release QA, FCM and APNs preserved). No workflow changes or new database migration.

## Manager flow
1. Parameters: 1–6 pilgrims, existing tariff categories, city, optional Medina.
2. Flights: outbound → return → explicit full journey fare. Compact cards, fare and selection inside, blue feedback, collapsible labelled filters, selected itinerary and manual/verified input retained. Return restricted to outbound origin and after arrival; changing itinerary invalidates stale fare and affected accommodation prices. A round-trip offer is counted once; distinct explicit one-way offers may be summed, otherwise manually confirm total. Catalog prices are indicative, not live inventory guarantees.
3. Accommodation: Makkah then Medina (if included), separately; choose hotel, room, dates, rooms, meals, total. Saudi calendar checks full coverage. Exact matching fresh cached hotel quote remains a reference; room and meals require manager verification. Prices clear when dates, room, room count, meals, or traveler count changes.
4. Services: direct vehicle selection, pickup, transfers, visits, visa/guide/other amounts. Existing backend inclusion semantics preserved.
5. Price: rounded line costs + commission − optional absolute group discount. Server computes canonical amount; no discount field exposed in public offer/booking snapshot. Older clients and drafts default to no discount.
6. Final review: editable component rows, orbit moment, distinct offer vs booking, client language/contact, existing idempotent API and receipt/share flow. Review before publishing is a manager summary; existing client-facing preview link is available after creation.

Draft step/substep/finish mode stored with protected draft; old drafts decode. Closing saves. Invalid step shows reason and disables primary action. No unrelated client updates required.

## QA
- Unified Backend 180/180, FlightHub 40/40, Package Engine 119/119, CoreMigration 20/20 (`npm run check`).
- Production Swift draft logic executable tests passed (round-trip fares, discount, draft compatibility, original dates/capacity tests).
- Architecture source contracts 16/16; updated obsolete source assertions to current navigation/status UI, not simulator tests.
- Swift syntax parse for changed Swift files passed; full Xcode typechecking/build and real iPhone UI testing unavailable locally.
- Previous Concierge cumulative patch files retained; no workflows included.

## Acceptance on device
Create a new proposal with two pilgrims, choose outbound and return (including an actual round-trip offer and an independent one-way pair), verify date filters, enter total fare, complete Makkah and Medina rooms and dates, choose a vehicle and costs, apply group discount, return from final review to edit a component, close/reopen draft, publish offer and open client share link. Then create a direct booking, verify receipt and idempotent retry. Confirm changed travel dates and guests invalidate affected costs. Test on smaller iPhone and inspect keyboard/safe area. Deploy backend before using new discount field.
