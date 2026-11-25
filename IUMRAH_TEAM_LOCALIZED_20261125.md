# iumrah — Team directory and localized biographies

Cumulative on final dashboard/direct flights patch. Apply Business/backend first, then iOS. Existing deployment workflow runs apply-package-schema.mjs, which adds the new fields idempotently; do not manually rerun raw ALTER migration. No changes to signing or workflow.

Business → Employees → select member → Edit. Three editable localized descriptions (RU, UZ Latin, UZ Cyrillic), original bio preserved; missing translations fall back to original. Founder draft button only fills empty localized fields. Set Davlat as Head guide and Available for requests; second guide remove Head guide and set Temporarily unavailable. Configure other public roles and visibility. Production profiles have not been altered.

Public directory lists guide, founder and other active published staff; contacts redacted on public API; assigned guide contacts returned only if booking is paid and confirmed. Existing Care contact channels remain; dedicated paid manager/founder contact access is not included. Public roles do not grant system permissions.

Verification: 215 unified backend tests pass, edited Swift sources parse. No Xcode SDK / device or production D1 verification.
