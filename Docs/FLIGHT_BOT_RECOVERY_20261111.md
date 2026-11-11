# iumrah — airline monitor repair, 11 November 2026

## Confirmed production symptom
Business reported **C6 21 checked / 21 failed**, **HY 13 checked / 13 failed**, **XY 25 checked / 25 failed**, with **zero exact site fares**. Thus the scheduled GitHub job reached the backend and reported, but fare verification failed. `site_changed` is a generic parser status, not proof all three websites changed simultaneously.

## Changes in this cumulative overlay

- Fix `first_visible`: Playwright `locator.is_visible(timeout=...)` is an immediate check; that parameter does **not** wait. Poll all selector alternatives for asynchronous UIs with a shared deadline.
- Move Flynas from informational `/en/book-flight` to live flight search `/en/flights` (official page contains `Origin`, `Destination`, `SEARCH FLIGHTS`).
- HY select fallback: consider only visible selects that actually contain the requested airport as an option, never language/currency controls.
- Wait for results asynchronously instead of only three seconds; distinguish explicit no-fare screens from unreadable result cards.
- Enforce exact flight number, origin, destination, and unique currency/price matching; never invent tariffs or treat another flight as the requested flight.
- Put first failing stage (`origin_airport`, `destination_airport`, `departure_date`, `submit_search`, `wait_results`, `exact_fare_matching`) in the D1 `monitor_runs.message` and per-flight attempts. Create `.png` and `.json` GitHub artifacts without cookies/HTML tokens.
- Stop a provider run after three identical consecutive browser failures; do not consume 25 searches when the form itself is broken.
- Business labels this as **Сбой поиска**, avoiding unsupported claim that the external website changed.
- **No `.github/workflows` files**, database resets, Workers or GitHub secrets are included.

## Installation and live validation

1. Use the existing `apply-zip.yml` extractor to apply `iumrah-business-update.zip` in `lattice-mobile`.
2. No backend deployment is needed **for the Python monitor and local Swift status label changes only**. This archive is cumulative; if the previous backend patch was never deployed, run the existing manual `Deploy iumrah backend` workflow once for those backend changes. The existing `flight-monitors` job runs only on GitHub `schedule` at 08:00/20:00 Tashkent. Manual workflow dispatch deploys backend, **not** the browser bots.
3. After the next scheduled run, inspect `Actions → Deploy iumrah backend → Update existing airline prices (provider)`.
4. Open uploaded `airline-<provider>-<run-number>` artifact → `diagnostics/<flight>-<route>-<date>.json` and `.png`. Fields `error`, `page_url`, and `visible_text_excerpt` distinguish missing controls, blocked pages, unsupported calendars, and genuine unmatchable fares. Also read `output/<provider>/latest.json` `first_problem`, `failure_stages`, `calibration_required`.
5. In Business read source status and the first error after a run. If the exact fare is still zero, supply **one actual GitHub artifact/log for each provider** to calibrate selectors against the current DOM; local unit tests alone cannot verify external websites.
6. Independently, the screenshot reports `IGNAV_API_KEY` and `AVIASALES_DATA_TOKEN` absent in `iumrah-backend`. Configure the genuine provider keys as Cloudflare Worker secrets only if you possess them. The airline monitor fix does not create or replace credentials.

## Scope of verification

`python -m unittest discover -s tests -v`: local parser/adapter tests, including dynamic control and strict flight identity.

`npm run check` from `Backend/IumrahBackend`: existing unified backend and flight hub regressions.

**Not yet verified:** actual airline-site browser automation, server-side D1 price changes, scheduled run after patch, or APNs. Do not claim a live price until a legitimate exact offer has been ingested.
