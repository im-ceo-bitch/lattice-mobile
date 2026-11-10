# Flight Hub security fix (10 November 2026)

The production deploy log disclosed the automatically derived bot/admin bearer tokens because GitHub did not know they were secrets. This update rotates derived credentials from derivation domain `v1` to `v2`, and masks the new values in the GitHub Actions runner **before** exporting them via `$GITHUB_ENV`.

Apply the same cumulative ZIP via the existing installer, then rerun the existing `Provision new Cloudflare Flight Hub` with `action=deploy` to replace the two Worker secrets. The old disclosed credentials become invalid after successful secret installation. Scheduled monitor jobs derive the new v2 token automatically. Do **not** publish or re-upload the old Actions log artifact; remove it from any public locations.

Deployment does not seed flight identities. Run `seed` only after the old Cloudflare read credentials are configured; then run `monitor` and inspect each airline diagnostic outcome.
