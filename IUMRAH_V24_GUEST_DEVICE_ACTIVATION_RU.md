# V24 — guest device activation

V23 deployment reached the D1 data review gate, detecting 3 rows in HOTELS_DB.client_notification_devices. The table contains both guest installations and account-linked devices. V24 preserves legitimate unlinked guest installations in place; it does not delete, modify or migrate any device data. Legacy-prefixed, authenticated, linked, malformed and wrong-database rows remain blocking. All other sensitive tables remain blocking. Local trip hint is not a booking association; actual booking tables are checked independently. Logs contain aggregate counts only.

Apply only to Business. Cumulative over V21–V23. Existing Deploy iumrah backend workflow unchanged. No new secrets or resources required for this fix. Deploy checks print provider gaps even before activation. Provider configuration is a separate gate and cannot be bypassed. Live Cloudflare activation and provider deliveries have not been tested here. Do not manually set attestation flags.
