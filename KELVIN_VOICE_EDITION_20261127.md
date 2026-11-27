# Kelvin Native Experience 2.1 — Voice Edition

Cumulative overlay for `lattice-mobile-main 5.zip`. Includes all payload files from `iumrah-business-kelvin-native-20261127.zip` with updated Kelvin view and networking. Install only this archive. The old manifest has been superseded by the new manifest; the earlier release notes describe v1, not current v2 behavior.

## Setup
1. In repository Settings → Secrets and variables → Actions, keep `GEMINI_API_KEY` unchanged and use `KELVIN_GEMINI_API_KEY` for Kelvin speech only. Manually update `.github/workflows/deploy-iumrah-backend.yml`: add `KELVIN_GEMINI_API_KEY: ${{ secrets.KELVIN_GEMINI_API_KEY }}` in `jobs.deploy.env` and add `KELVIN_GEMINI_API_KEY` to the existing secret sync loop immediately after `GEMINI_API_KEY`. The ZIP extractor protects workflow files; the updated workflow is supplied separately. Alternatively set the `KELVIN_GEMINI_API_KEY` secret directly on the existing Cloudflare Worker `iumrah-backend`. No fallback to the legacy key. The key is never put into the app or the archive.
2. Upload this `iumrah-business-*.zip` to main. Let Apply iumrah Business ZIP update unpack and commit the archive.
3. Run **Deploy iumrah backend** once, then **iOS Root TestFlight** (the existing workflows). Wait for each to succeed. No schema migration command needed: a small quota table is created on first speech request.
4. In Kelvin, open voice → sliders icon → Voice Kelvin. Choose any of the 30 Google voices; confirm the notice about sending text to Google; tap preview. Charon, Orus, Algenib and Schedar are suggested starting points. The system voice is the initial local setting until explicit cloud consent. Voice selection and speech language persist locally. The status endpoint only checks whether the server key is present; a successful preview is the actual connectivity test.
5. Verify actual audio, recording permission, local language recognition, mute/unmute, text entry, manual stop and resumed recording on your iPhone. Test the case where MacBook is offline: speech preview should not require MacBook, but intelligent answers still do.

## Architecture and privacy
- Existing Kelvin assistant / Mac / shared history stays unchanged. New owner-only `/api/admin/hotels/kelvin/speech` GET status and POST synthesis reuse existing authenticated business-session route. No direct client access to Google or exposure of secrets.
- Gemini `gemini-3.8-flash-tts`, Interactions REST API, complete WAV (24 kHz, mono, 16-bit PCM), store:false. This is **TTS**, not Gemini Live API. The user must opt in before the app sends spoken text to Google; Google Free tier may use submitted data to improve products. Do not send confidential business information to the cloud voice. System voice remains available and is not automatically substituted on a failed cloud request. The provider's pricing/quotas apply. An additional 100 synthesis attempts per owner per UTC day and 1500 UTF-16 units per request are server-side safeguards, not a guarantee of free service. Long answers are split and played sequentially, each chunk counts separately.
- Native voice view: initial microphone permission/start, local STT, microphone mute, stop playback by button, automatic pause detection (recognized words + measured input level), typed input within voice screen, explicit wait cancellation (does not cancel Mac job), audio interruption handling, settings with preview, four recognition locale choices. Local STT availability depends on iOS/device and installed language assets. TTS language is inferred by Gemini. No voice cloning; Yunus is ElevenLabs and is not a Gemini voice. 
- No real simultaneous duplex / automatic voice barge-in. Existing Mac queue and polling remain; text animation remains a visual reveal after full answer. No automatic ChatGPT web control was added. Existing voice orb geometry retained, actual recorded and playback meter used.

## Verification
- 9/9 Kelvin backend tests passed (4 existing + 5 voice tests; actual SQLite and mocked Google HTTP responses). No real Google secret or provider call tested.
- 7/7 Kelvin architecture tests passed. Full architecture suite: 27/31, four failures inherited from prior repository/patch (same baseline failures); not changed by this update.
- Swift frontend parser passed for all Sources. No Xcode/iOS SDK, real build, device testing, or performance verification available in this Linux environment.
- Existing Apply ZIP workflow, signing, bundle identifier and configurator logic unchanged beyond v1 changes. Deployment YAML must be manually updated as described above. New files in Sources are picked up by existing XcodeGen configuration.

Reference: https://ai.google.dev/gemini-api/docs/speech-generation ; https://ai.google.dev/gemini-api/docs/pricing
