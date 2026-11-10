# iumrah AI Intelligence — Gemini 3.8 Flash Free

## Composition
One existing Cloudflare Worker `iumrah-backend`; no new Worker, no new external account, no new Secrets. D1 `iumrah-hotels` stores the privacy-constrained analytics, scheduled insight reports and AI chat history.

- `POST /api/catalog/hotels/intelligence/events`: accepts iOS/Android/Web event batches (whitelist only; no arbitrary properties).
- `GET /api/admin/hotels/intelligence?days=7|14|30`: aggregated metrics + per-platform and per-day breakdown.
- `GET /api/admin/hotels/intelligence/sessions`: pseudonymous session diagnostics.
- `GET /api/admin/hotels/intelligence/reports`: scheduled insights.
- `POST /api/admin/hotels/intelligence/reports/generate`: on-demand insights.
- `GET /api/admin/hotels/intelligence/chat?threadId=<UUID>` and `POST /api/admin/hotels/intelligence/chat`: server-grounded AI chat, history and analytics tools.

All admin routes pass existing `requireStaff` and `superadmin` gate. Agent SQL tools are read-only and do not expose raw visitor IDs. It cannot run code, deploy software, change data or send customer messages.

## Deployment
1. Upload `iumrah-business-update.zip` to the **root** of the iumrah Business repository and allow **Apply iumrah Business ZIP update** to finish.
2. Separately replace `.github/workflows/deploy-iumrah-backend.yml` with the supplied YAML: the ZIP unpacker intentionally ignores workflows.
3. Run **Actions → Deploy iumrah backend** once. The workflow applies additive `0044_business_intelligence.sql` and `0045_intelligence_ai_agent.sql` D1 schemas, compiles and deploys **only** `iumrah-backend`.
4. `GEMINI_API_KEY` should already exist in GitHub Secrets. The same workflow transfers it to the Worker. Do **not** expose it in the clients. No extra D1 secrets.
5. Build and install the updated iumrah Business through the existing iOS workflow, sign in as superadmin, then open **Аналитика → Обзор / Отчёты AI / AI-чат**.

If `401` or `403` appears, verify the site's `iumrah.app` staff authentication, the active Business device-session and superadmin role. Cross-origin Business requests to the unified Worker pass first-party authentication cookie and Business session token; the original login API remains on `iumrah.app`.

## Free-tier budget / safeguards
- The selected model is **only** `gemini-3.8-flash`, with no paid model fallback.
- Chat is capped at **25 attempts per UTC day** for the entire Backend (modify deliberately after observing quota).
- Cron produces one report per day at **08:00 Asia/Tashkent** if at least 10 events from 3 visitors are available.
- Free Gemini API may process submitted aggregate data for product improvement under the provider's policies; never send passports, payment fields, chat transcripts with customers or session/visitor IDs to the model.
- Rate limits are controlled by Google per project and may be lower than this application's cap. A 429 is surfaced as an error instead of automatically charging a paid account.

## Platform coverage
- **iOS:** already has an event collector in the separately delivered `iumrah-beta-update-20261110-intelligence-v1.zip`; build & deploy required.
- **Android:** Backend accepts `platform: android`, but the Flutter app must implement/enable the collector in its own repository. Do not call Android “connected” until real events appear.
- **Web:** a privacy-minded opt-in sample adapter is in `Backend/IumrahBackend/integrations/iumrah-web-analytics.js`. It must be imported from the actual website repo and invoked on route/CTA events. It is NOT currently installed on the live site.
- App Store/Google Play installation and uninstall statistics are separate aggregated store reports, not per-user uninstall callbacks.

## Verification
- Visit the deployed `https://iumrah-backend.helloiumrah.workers.dev/__iumrah/health` (checks bindings only).
- In Business verify metrics after client events arrive, charts display iOS/Android/Web only if events are actually seen, reports generate and chat has a working response.
- The ZIP was tested locally for Node unit tests and Swift syntax; a full Apple Xcode build and real Gemini key/live Cloudflare access still require GitHub Actions / deployment validation.
