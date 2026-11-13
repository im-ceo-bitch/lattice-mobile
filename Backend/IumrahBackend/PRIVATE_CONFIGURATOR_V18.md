# V18 — private configurator
Deploy only from lattice-mobile with the existing Deploy iumrah backend workflow. No workflow changes.

- The server verifies the authenticated encrypted quote against the booking before writing any booking rows. The client sends its quoteProof in the create envelope. Old quotes need to be recalculated. Clients without a proof cannot create bookings through the new core.
- Keep PACKAGE_QUOTE_SEAL_KEY server-side; do not expose it or supplier pricing reports to a client. This is the existing dedicated key, not a new credential.
- The existing IUMRAH_CORE_CUTOVER_READY gate is intentionally unchanged. Do not turn it on merely because schema checks passed. The existing Backend/CoreMigration/prepare_cutover.py can plan and verify an offline merge against fresh source/destination D1 exports. Confirm D1 row parity, passport R2 objects, existing session secrets, and current client compatibility first. Never commit SQL exports. No real customer data was accessed or moved by this update.
- Deploy the server update while cutover is still closed, then update iOS and Web. Android must be updated and checked separately before activation. A fresh quote and an actual authorized test booking must pass on production before legacy retirement. If cutover is already enabled, schedule the compatible client release first; older versions cannot create bookings without the proof.
- /__iumrah/cutover reports missing configuration and schema presence, not proof of data migration.
- Keep lattice-mobile private. Remove the retired PackageEngine and any UnifiedDeploySnapshot from kepler-ios using the separate client cleanup script. Deleting current tracked files does not erase historical commits or downloaded copies.

Validation: npm run check: 47 core + 39 flights + 90 package-engine tests, including a real core route with synthetic local data. No live Cloudflare or Xcode run.
