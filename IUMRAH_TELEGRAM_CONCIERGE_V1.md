# iumrah Concierge — V1 cumulative release

Base: Release QA + FCM (2026-11-17). This archive preserves every entry of the base, changing only the files listed in the manifest. Existing workflows are untouched.

## Features
- Four-language conversational intent routing (deterministic, no LLM).
- Quote intake with exact dates, party/room counts, origin airport and contact, explicitly submitted as a Care request rather than a booking. Idempotency key on retries.
- Existing Business offers screen opens an incoming Care / Concierge request queue, with status management.
- Linked booking queries for payment, visa, documents, tickets, hotels, guide, schedule, and current status; data from canonical booking endpoints. No passport or payment files in Telegram chat.
- Explicit manager handoff to the existing booking chat. Manager can reply in the existing Care chat; automatic manager-reply notifications to Telegram are not added in this release.
- Personal offer URL recognition and protected link to existing offer page.
- Existing Telegram status notification and authenticated Mini App remain.

## Verification
`npm run check`: unified backend 177/177, FlightHub 40/40, Package Engine 119/119, Core Migration 20/20. Includes six new Concierge tests (five unit, one webhook integration). Swift syntax parse passed on both changed files. No Xcode compilation, live Telegram provider or production D1 deployment tested.

## Deployment
Upload this archive to Business repository, allow existing apply workflow to finish, then run Deploy iumrah backend. Build Business to see incoming requests. No independent legacy Telegram Worker deployment. Existing Telegram webhook and bot configuration must be operational. The two client apps do not require updates for these changes.

## Known scope / remaining work
- Not a general AI/LLM assistant. Answers are intent-based; unrecognized questions prompt the user to choose an action or contact manager.
- Not automatic live package search/quote calculation; manager completes calculation.
- No proactive scheduled trip reminders, editable pinned live card, event-specific outbound Telegram notifications, or complete Mini App redesign in this release.
- Manager queue uses existing Care API; no automatic push to staff for new Care request or automatic offer delivery.
- Business queue UI is Russian, bot supports four languages.
- Session draft is encrypted and logically expires after 24h; expiry is not a physical purge. Care requests persist as CRM records.
- Existing HotelsWorker known failures are not addressed here.
