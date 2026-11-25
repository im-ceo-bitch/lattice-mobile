# iumrah Business — Manager Workspace 3

Cumulative patch against lattice-mobile-main 2.zip (2fc09ed552f4fe724c0018812b171fe0adc9d3d3). Includes earlier manager UX fixes. No workflow changes, no DB migration, no deployment required for new UI using existing API contracts.

## Manager journey and changes
- Compact tabs: Overview → Trips → Create → Chats → Account. Account contains old drawer destinations and catalogs; desktop retains workspace sidebar. Flight notification route redirects into the Account flight catalog.
- Trips: first-class requests, offers, bookings. Request and offer details push instead of stacking sheets. Request contacts and desired dates populate isolated draft; actual dates still require verified flights. Explicit action to mark request READY after creating an offer; share offer using the existing share mechanism. No automatic messages. Requests with children/infants require separate handling because the existing manual submission contract serializes all travelers as adults.
- Studio: component dashboard, direct navigation to sections, final validation, local protected saved draft snapshots, resume, delete confirmation, duplicate completed general offer with cleared contact/price fields. Existing pricing and server idempotency retained. No inventory reservation is implied.
- Hotels: new Nuitee catalog using `/api/package/nuitee/hotels` (server pagination, filters, catalog-only), room tariffs using `/api/package/nuitee/rates`, coverage screen existing admin endpoint. No old admin hotel catalog calls in new builder. Old source files and operations assignment logic remain for historical trips and legacy IDs, not exposed in daily catalog. Sandbox tariffs cannot be copied; one-room price only. Multi-room price must be confirmed manually. Local favorites apply to loaded pages; not shared between devices. Unknown stars shown explicitly in catalog; existing manual payload still has historical default star handling. No automatic supplier booking. Existing backend pricing contract not changed.
- Inbox: app and Telegram threads interleaved by date with pins first, source filters, swipe/archive, restore, context menu. Archive and pin are per-account, local only. New message/update reappears. Telegram polling uses existing endpoints; human/auto controls retained. No permanent deletion or server synchronization, no Telegram unread count contract.
- Keyboard: prior booking input numeric keyboards, focus dismissal, interactive scroll, explicit Done. Added builder, offer acceptance and Telegram keyboard dismissal.

## Checks run
- `swiftc -frontend -parse $(find Sources -name '*.swift')` — passed all Swift syntax.
- `python Tests/run_umrah_draft_tests.py` — passed production draft behavioral, pricing and preview checks.
- `node --test Backend/IumrahBackend/tests/business-configurator-v2.test.mjs Backend/IumrahBackend/tests/concierge.test.mjs Backend/IumrahBackend/tests/telegram-care.test.mjs` — 12 passed.
- No Apple SDK / Xcode simulator available: SwiftUI type checking, iPhone/iPad/Catalyst build, signing and live network/visual UI verification remain required. The client iOS repository was not supplied in this turn, so no exact visual parity claim. This is a substantial partial implementation, not a finished production release.

## Acceptance checklist on TestFlight
1. Five tabs; verify account destinations, notification routes, and iPad/Mac sidebars.
2. Create → edit arbitrary component → back to dashboard → save/start new → resume; confirm incomplete package cannot publish. Confirm old draft loads.
3. Requests → detail → calculate; verify exact dates shown, contacts copied, and no booking or message created automatically. Create offer → share → explicitly mark READY. Confirm a child request is not silently represented as all adults.
4. Hotels → switch city/search/filter/pagination; open one-room rate; select room/meal/price; change dates/occupancy and verify price reset. Test provider failure, sandbox, and multi-room manual price.
5. Chats → both channels → pin, archive, restore; check new message restores archived item; check operator mode and message sending. Local archive does not delete history.
6. Booking → Finance → payment details; verify numeric keyboard, Done, swipe, save, and preservation of editing during background refresh.
7. Test historical booking/assignment, public share, offer revision, and pricing without changes to server workflows.
