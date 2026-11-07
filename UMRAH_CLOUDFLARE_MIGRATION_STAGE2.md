> IMPORTANT (2026-11-07): For current installation, use the **simplified workflows** `provision-flight-hub-simple.yml` and `flight-hub-daily-simple.yml`. The original stage-2 4-secret workflow is superseded. Only `NEW_CLOUDFLARE_ACCOUNT_ID` and `NEW_CLOUDFLARE_API_TOKEN` need manual configuration to create the initial Flight Hub. The bot/admin service credentials are deterministically derived inside GitHub Actions and provisioned to Worker secrets; NEVER put the Cloudflare token in any mobile app.

# iumrah Business + Flight Hub — stage 2 (new Cloudflare account)

## What this ZIP really does
- Adds `Resources/EndpointConfig.json` (Business) and makes **all existing Business endpoints** use it through `AppConfig`; does not hardcode account/DB identifiers into iOS.
- Adds an explicit second endpoint for the NEW Flight Hub, independent from the existing operational URL.
- Includes complete Flight Hub schema, Worker, three monitor adapters, import utilities and the new account provisioning helper. `GET /v1/public/flights` supports `date=YYYY-MM-DD`, returns freshness metadata, and allows the listed iumrah domains via CORS.
- Adds offline operator-data migration audit/extraction tool that **excludes hotels** and refuses unknown tables/foreign-key dependencies. NO private data or secrets are in the ZIP.
- Adds standalone Swift consumer integration DTO/client for the NEXT step; it is **not integrated into the consumer repo** because that repository is not attached here.

## Important status
- No new Cloudflare account credentials were supplied, so no D1/Worker has been created by this assistant, no data has been moved, and no live clients have been switched remotely.
- `iumrah-flights`: provisioning workflow can create D1, run migration and deploy Flight Hub.
- `iumrah-core`: provisioning workflow creates **an empty D1 only**. Source operations are currently coupled to HotelsWorker; this is NOT a functioning Core API or finished booking migration.
- Until the full replacement API and storage migration have passed end-to-end tests, Business `platform_api_url` remains `https://iumrah.app`. **Do not point it to the empty core database.**
- Your existing hotel API remains untouched, and no HOTEL data is imported.
- The Browser bots are adapters awaiting live-site testing and site access permissions; empty D1 does not automatically produce fares.

## Step 1 — upload ZIP to Business GitHub repo

Upload `iumrah-business-update.zip` at repository root. The existing `.github/workflows/apply-zip.yml` applies root files but **skips any `.github/workflows/` files**.

Then manually add the separately supplied `provision-flight-hub-simple.yml` at `.github/workflows/provision-flight-hub.yml` through GitHub UI.

## Step 2 — configure ONLY NEW Cloudflare account in GitHub → Settings → Secrets and variables → Actions

| Name | Purpose |
|---|---|
| `NEW_CLOUDFLARE_ACCOUNT_ID` | 32-character Account ID, NEW Cloudflare account |
| `NEW_CLOUDFLARE_API_TOKEN` | API token restricted to NEW account; D1 Edit and Workers Scripts Edit |
| `FLIGHT_HUB_IGNAV_TOKEN` | Separate Ignav ingest token, optional initially |
| `FLIGHT_HUB_AERODATABOX_TOKEN` | Separate AeroDataBox ingest token, optional initially |
| `AERODATABOX_RAPIDAPI_KEY` | API provider key, optional until verification enabled |

Never send API tokens, passwords or production data dumps in ChatGPT or commit them to GitHub. Generate the internal tokens locally with `openssl rand -hex 32`.

## Step 3 — provision the new databases and Flight Hub (no old account touched)

GitHub → Actions → **Provision new Cloudflare Flight Hub (manual)** → Run workflow.

Workflow performs:
1. Find/create `iumrah-flights` and `iumrah-core` in NEW account (no destruction).
2. Apply `0001_flight_hub.sql` ONLY to `iumrah-flights`.
3. Deploy `iumrah-flight-hub` to its new workers.dev address.
4. Set ingestion/admin tokens in Worker secrets.
5. Print IDs and URL information in Actions logs; do **not** treat empty `iumrah-core` as an active API.

Check with `https://<real-worker>.workers.dev/health` and `/v1/public/status`. `/health` with `database_connected:true` only confirms binding, not working bots.

## Step 4 — connect Business to flight database

Modify `Resources/EndpointConfig.json` via another ZIP or GitHub commit:

```json
{
  "platform_api_url": "https://iumrah.app",
  "flight_hub_url": "https://YOUR-REAL-WORKER.YOUR-REAL-SUBDOMAIN.workers.dev"
}
```

Rebuild Business/TestFlight. Flight Hub monitoring then accesses the NEW account while non-flight operations still use the previous (working) API.

To run the bots, separately add the stage-1 `flight-hub-daily.yml` under `.github/workflows/`; add `FLIGHT_HUB_URL` (public workers.dev URL) and `FLIGHT_HUB_BOT_TOKEN` to Secrets. **First** import canonical flight identities from existing published feed through `import-curated.mjs` using `FLIGHT_HUB_ADMIN_TOKEN` or ingest fresh Ignav results; bots only update existing master flights and don't fabricate them.

## Step 5 — non-hotel legacy data migration (preparation only)

Existing operations span at least `HOTELS_DB` and a separate `BOOKINGS_DB`; they must be audited separately.
Do the export PRIVATE on a trusted machine while authorized to old account, never in public CI or the repository:

```bash
# In a trusted shell configured to OLD account (not new):
npx wrangler d1 export OLD_OPERATIONS_DB --remote --output=./private-old-operations.sql
npx wrangler d1 export OLD_BOOKINGS_DB --remote --output=./private-old-bookings.sql

python3 Backend/CoreMigration/split_core_dump.py ./private-old-operations.sql --plan-only
python3 Backend/CoreMigration/split_core_dump.py ./private-old-bookings.sql --plan-only
```

If no unknown tables or cross-database FKs, produce private SQL with `--output=./private-operations-core.sql`. A cross-reference from bookings/itinerary to `hotels` is a BLOCKER and needs explicit schema adaptation (e.g., persist external hotel API IDs), not a forced import.

The tool validates row counts, IDs and foreign keys locally. This is NOT sufficient for final migration: inventory and migrate R2 media/chat attachments, signatures and other non-D1 dependencies; verify auth keys, session compatibility, SMS/push secrets, booking sequence, quote pricing and all critical endpoints. Migrate data with a write-freeze/delta-sync plan, compare table counts/hashes, perform test bookings, and keep a rollback path. `iumrah-core` has intentionally no production schema or API until that work is done.

## Step 6 — client app

The current client repo is NOT in the present attachment. `Integration/Client/FlightHubClient.swift` is a reusable read-only adapter, not an installed or tested part of that app. To switch the actual client, provide the latest `kepler-ios-main.zip`, then update its flight search and PackageEngine callers. Android and website need separate verification too.

### Test results (local only)

- Node FlightHub tests and CORS tests, Python offline migration tests, Swift parse, YAML/JSON parsing.
- Not tested: live Cloudflare D1 or Wrangler deploy, actual airline availability/prices, Xcode archive, existing client app and production data migration.
