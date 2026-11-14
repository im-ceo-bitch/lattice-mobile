# iumrah Business V32 — Auth & Session Stability

Source: lattice-mobile-main 3.zip, snapshot 87675024a088610821ca3495dda59a11d67f5674.

## Installation
1. Upload this ZIP to the root of the lattice-mobile Business repository. Wait for Apply ZIP.
2. Run the existing Deploy iumrah backend (manual). No new secrets, D1/R2 changes or workflow edits are needed.
3. Run the existing Business TestFlight build. Install on iPhone; sign in with the current Cloudflare superadmin credentials. Old 12-hour cookies are not extended; a fresh sign-in may be needed.
4. Confirm that the same session restores after force quit and relaunch; test local PIN/Face ID, logout and relogin. Check push registration and an actual notification.

## Changes
- Staff signed cookie expires after 7 days, not a rolling extension; signed authentication timestamp included in the existing session API.
- Cookie persisted only for the exact current HTTPS Worker host, and removed on logout. Keychain errors no longer silently report success.
- Revoked device reactivation requires a signed recent password authentication timestamp later than revocation, not a caller header alone. Temporary auth service failures remain 503.
- Login errors distinct; stale request failures carry the token actually sent and cannot invalidate a different active device token.
- Login layout keeps safe-area background separate, uses top alignment on compact screens, focuses password on Next and supports keyboard dismissal.
- Push registration requires a session, records failures and retries on foreground; existing security login banner restored.
- Existing PIN/Face ID mechanism, chat, booking and pilgrim identifiers, D1 schema, R2 and workflows are not redesigned. Shared staff cookie lifetime also applies to staff web routes; separate device credential still has its existing 180-day inactivity policy. This is not a complete security review of every staff API.

## QA
- Unified Backend 111/111; Flight Hub 39/39; Package Engine runtime 100/100; Python CoreMigration 20/20. Total 270/270; TypeScript typecheck PASS.
- Expanded HotelsWorker suite: original 150/185 (35 failed), patched 152/185 (33 failed). Exact failing test names compared, no new failing tests. Two staff-security tests now pass. Remaining tests include outdated source-based fixture exports and assertions around hotel pricing, hotel sync and booking status. These are not proven production failures; require a separate audit.
- All 72 Swift source files parsed on Linux; Xcode/iOS/macOS SDK, actual Keychain, UI safe area, Face ID, APNs and production Cloudflare not verified here.
- No changes to workflows, credentials, migrations or user records.
