# iumrah Business — UI Final (2026-11-17)

Cumulative overlay of Sales & Offers on lattice-mobile-main 5.zip. The server code is byte-for-byte identical to the previous Sales & Offers ZIP. No workflows included or changed.

## UI changes
- Shared Foundation geometry adapted from client `IumrahFoundation.swift` / `DESIGN_FOUNDATION_20261105.md`: 44pt targets, 56pt CTA, rounded semantic typography, neutral surfaces. Existing Security Blue palette and orbit geometry preserved. Inline navigation bars now share the black treatment, including secondary sheets.
- Dashboard: a single create CTA, actionable availability/payment/all queues and chat entry, honest placeholder values before data loads; diagnostics grouped separately.
- Configurator: accessible five-step rail, backward navigation, compact assembly, fixed cost and full-width context-dependent CTA. Mutually exclusive Offer/Booking forms; offer creation does not ask for contact info. Offer editing uses offer mode. Existing validation and server endpoints preserved. Clear selected flight treatment and filtered empty state.
- Sales: single add entry from the bookings toolbar, offer context preselected, separate primary share action and secondary conversion/edit actions, truthful manual sent marker and metrics placeholders.
- Booking details: readable IDs and price on narrow displays; allowed next status can be staged, then explicitly saved. No automatic status transition.
- Chat: search by name/ID/booking/message preview, server-derived unread conversation badge, quick reply drafts (never automatically sent), white header foreground. Existing photo/send/read logic preserved. Account exit clears badge.

## Verification
- All 85 Swift source files passed Swift frontend syntax parsing (Linux, no SwiftUI SDK).
- 16 architecture/source contracts passed; both compiled adaptive layout checks passed.
- Draft behavioral checks passed.
- 139 backend tests passed with the previous Sales & Offers backend unchanged.
- Archive integrity and overlay hashes checked. No Xcode typecheck, simulator screenshots, TestFlight build or live delivery verification. The exact animated client world-map header is not ported; no fake map included. Full pixel parity is not established. Business UI remains Russian as before; offer language selector remains four-language.

## Install
Upload this cumulative ZIP to repository root; existing apply workflow processes it. If Sales & Offers backend already deployed, only build TestFlight; otherwise deploy backend first. No workflow replacement, bots, secrets or new databases for this UI pass.
