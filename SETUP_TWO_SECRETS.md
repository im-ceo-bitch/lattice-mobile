# iumrah Cloudflare Flight Hub — two-secrets deployment (7 Nov 2026)

This is a **cumulative Business ZIP** recognized by the repository's `.github/workflows/apply-zip.yml` (`iumrah-business-*.zip`). ZIP members have repository-root paths (no nested top-level directory). The ZIP does **not** contain `.github/workflows` files because the unpacker deliberately blocks that directory.

## Step 1 — Token in new Cloudflare account
Choose **Start from scratch (Custom)** rather than Full account/zone access. Scope **only the new account**; grant **D1 Write** and **Workers Admin** (product scope, needed to create a Worker) and, if required, **Account Settings Read**. Leave Client IP address filtering empty for GitHub Actions runners. Use a managed expiration and rotate the token before it expires. Never post the token in chat or commit it to Git.

## Step 2 — GitHub Secrets, only these two manually
- `NEW_CLOUDFLARE_ACCOUNT_ID` — 32-character ID of the NEW account.
- `NEW_CLOUDFLARE_API_TOKEN` — API token created in the NEW account.

The workflow derives **BOT_INGEST_TOKEN** and **ADMIN_TOKEN** through domain-separated HMAC-SHA256 from these CI-only credentials. These credentials are placed into the Cloudflare Worker secrets by Wrangler. No extra manual `FLIGHT_HUB_BOT_TOKEN`, `FLIGHT_HUB_ADMIN_TOKEN` or `FLIGHT_HUB_URL` Secret is needed. The scheduled bots compute the same derived bot token and discover `workers.dev` URL using the Cloudflare API. Rotating the Cloudflare API token requires rerunning provisioning before the next daily monitor.

Security tradeoff: the monitor CI needs access to the Cloudflare deployment token. This simplifies setup, but a separate least-privilege ingestion secret is preferable for long-term production. Keep the token available only to a trusted repository and do not run unreviewed workflows/code.

## Step 3 — ZIP, Workflows and provision
1. Upload `iumrah-business-update.zip` to the ROOT of the **Business** GitHub repo, on `main`. Do not upload it to Releases or a subfolder. Check Actions → **Apply iumrah Business ZIP update**; the run should log `Applying iumrah-business-update.zip` and remove the archive after applying.
2. Manually add `.github/workflows/provision-flight-hub.yml` using the separately supplied `provision-flight-hub-simple.yml` file's contents.
3. Manually add `.github/workflows/flight-hub-daily.yml` using the separately supplied `flight-hub-daily-simple.yml` contents.
4. Set the TWO GitHub Secrets above and run Actions → **Provision new Cloudflare Flight Hub (manual)**.
5. On success, save the public `https://iumrah-flight-hub.<subdomain>.workers.dev` URL from the job log. Test `/health`, `/v1/public/status` and `/v1/public/flights`.

If the new account has no `workers.dev` subdomain, set one up in Cloudflare Workers settings before deploying.

## Important limitations
- This workflow creates a NEW `iumrah-flights` D1 and an **empty** `iumrah-core` D1 and deploys only Flight Hub; it does not migrate old customer/booking/auth data.
- No hotel tables or hotel data are touched. Do not move the Business platform base URL until the new core server and data migration are complete.
- Airline browser adapters still need verified live-page selectors; do not consider flight prices verified until their runs actually extract exact priced matches.
- Client iOS app is not changed by this Business-repo ZIP.
