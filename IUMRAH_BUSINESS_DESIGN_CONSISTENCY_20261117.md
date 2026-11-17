# iumrah Business — Design Consistency · Cumulative (Blocks 1 + 2)

Base: `lattice-mobile-main 6.zip`, commit `668cd1cd961ecf7bfbb2947f169a804a75fdb14e` (as recorded in the Block 1 manifest). This single overlay includes all source and test changes from Block 1, plus Block 2. Apply it instead of the standalone Block 1 ZIP; there is no need to apply Block 1 separately. Do not apply older cumulative releases afterward.

## Block 1
- Black native navigation surface, white toolbar controls and logos. System-owned sheets/pickers keep native styling.
- Configurator 2.0: six circular 44-point stages; existing source separation, draft validation, price/commission/discount, offers and bookings retained. Sticky price panel distinguishes partial costs from validated totals.
- Security Blue palette and Orbit V5; monochrome primary controls.

## Block 2
- `BusinessWorldMapHeader`: native SwiftUI Canvas with offline land-point geometry derived from the locally available Natural Earth public-domain 1:110m dataset. A subdued moving blue/white wave, paused when app inactive or Reduce Motion enabled. Pinned below the native Overview header, not on all secondary screens. Client repository source tree could not be fetched; this is an independent visual approximation, not a verified pixel-perfect port of the client map.
- Booking Experience 3.0: preserves four workspaces and all existing operations. Adds read-only six-stage progress based on actual server state, date/count summary, adaptive workspace controls, visible current-stage timer, and collapsible advanced controls with unsaved-edit indicator. Retains every queue filter and existing confirmation/permission workflow; expands secondary queues on demand. Document controls use 44-point areas. No changes to public statuses or backend rules.
- Concierge: access from Overview and Offers; counts from fetched requests (API default latest 100); search and filters; request details with existing optional server fields; explicit status actions and confirmation for closure/cancellation. Existing API and status values preserved. A separate request-specific protected configurator draft can be prepared with traveler count, room count, supported origin, hotel category and scope; dates, fares, hotels and prices must be verified by the operator. It does not automatically create a booking, change the request's status, or create a server-side request-to-offer association. Groups beyond the configurator's six-person/six-room limits are not silently truncated. Contact info is copied only on explicit action, not automatically transferred to the offer.

## Verification
- 24/24 architecture source-contract tests passed (includes Block 1 and Block 2).
- Existing executable Swift draft, Configurator 2 and price preview checks passed.
- Swift frontend parsing: all 88 Swift files under Sources passed. This is syntax verification, not full SwiftUI type checking or Xcode compilation.
- Overlay verified against original archive; no Backend, workflow, resources, project or bot changes. Networking change is limited to optional Concierge response fields already returned by existing server SELECT; no endpoint/schema changes.
- Xcode/TestFlight, runtime API integration and device visual verification still required. Test iPhone 11/13 mini, dark appearance, large Dynamic Type, iPad and Catalyst.

## Installation
Upload only the cumulative ZIP to the repo root and let the existing Apply iumrah Business ZIP update workflow apply it. Then start the existing iOS TestFlight workflow. No new backend deployment is required by this UI overlay. If the backend included in your base version is not yet deployed, deploy that separately.
