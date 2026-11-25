# Business Manager UX — 2026-11-25

Patch based on lattice-mobile-main commit 2fc09ed552f4fe724c0018812b171fe0adc9d3d3. No workflow or backend changes.

- Rename Concierge entry points; push request details within existing NavigationStack rather than presenting a second sheet. Builder still opens as a sheet.
- Booking detail: interactive keyboard dismissal, Done keyboard toolbar, dismissal on workspace changes, numeric keyboard for card numbers, focus handling for payment fields. Protect unsaved payment values from payment refresh where possible.
- Booking chats: native swipe actions on compact List, context menu on compact and desktop, account-scoped local archive with confirmation and restore; changed last-message timestamp returns archived conversation to active list. No deletion of messages, bookings, or remote records. Telegram Care inbox is unchanged.

Validation: Swift frontend syntax parse of all five edited files passed; no Apple SDK/Xcode build or device test available.

Device QA: verify booking keyboard Done/drag, numeric entry, save and refresh; requests list > detail > back > builder; archive and restore, app restart, account switching and new incoming message; iPad two-pane. Check unread counters, dark mode and accessibility.

Remaining: full manager workflow and configurator redesign; server-side chat lifecycle and synchronization; CARE request-to-offer linking/automation; client button wiring verification.
