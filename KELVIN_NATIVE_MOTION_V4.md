# Kelvin Native Motion V4

Cumulative over UI Repair V3, assumes Native Voice V2.1 already installed. If V3 has not been installed, this ZIP includes its separate chat/backend changes. No workflows, signing, API secrets, voice geometry, configurator or app identity changed in V4.

## Architecture
- Single fixed-width chat surface; drawer offset is independent of data, scroll and focus. Native UIKit pan in window coordinates on iOS 18+, directional lock and velocity projection; SwiftUI simultaneous drag fallback on iOS 17. Cancelled gestures restore committed state. Spring retarget samples presentation progress, limits travel and velocity, respects Reduce Motion.
- Native glass surface from existing BusinessChatConversationStyle for composer, header, jump-to-latest and voice controls. Native safeAreaBar on iOS 26, safeAreaInset with material/gradient fallback on older systems. No root clip or keyboard-safe-area override. Native keyboard controls remain in charge. Tab bar hidden throughout Kelvin; all four business destinations remain accessible in drawer and header overflow menu. Other tabs retain their existing tab bar.
- History grouped by thread as in V3. Native ScrollPhase/ScrollGeometry on iOS 18+, no geometry-triggered scrollTo. Programmatic jumps limited to thread/message/status changes while following, or explicit button. Answer reveal no longer tied to drawer state. Still a reveal of whole answer, not streaming tokens.

## Verification run in Linux
- Swift syntax parse of all Sources files (not Apple SDK type-check).
- 20 compiled pure-Swift assertions for motion math, including direction, bounds, reversals, flicks and spring velocity.
- 13 Kelvin source architecture tests, 11 Kelvin backend tests passed.
- No physical iPhone, Apple SDK, Xcode or Instruments in this environment. Do not treat these tests as proof of gesture arbitration, real FPS or runtime layout.

## On-device acceptance required
1. On iPhone 11/13 mini and a supported ProMotion device, open an existing long chat; drag right from left edge, center and right half. Vertical scrolling must not open drawer. Try slow drag below/above half, short fast flick, reverse midway, re-grab while settling. Close by tap and left swipe. Test text selection and editing separately.
2. Rapidly repeat 20 open/close gestures. No content width change, text reflow, unexpected vertical offset or inaccessible status/home indicator. Check landscape and light/dark themes.
3. Open and dismiss keyboard 20 times, type six lines, send, open/close plus popover, and dismiss keyboard by dragging scroll. Header must stay in place; composer must follow keyboard, not disappear. Test on a short and long chat. Verify no loss of draft or unexpected scrolling when history refreshes.
4. While reading older messages, let an answer arrive. Verify no forced jump unless already following. Jump-to-bottom button must work.
5. Open voice mode, interrupt it, return to same chat. Switch to all business destinations via overflow/drawer; return via Kelvin tab. Test Reduce Motion and VoiceOver.
6. Profile Animation Hitches / Core Animation with Instruments on real hardware. A 60 Hz frame budget is 16.7 ms; 120 Hz is 8.3 ms when supported. Do not claim a fixed refresh rate or ChatGPT-equivalent feel until measured and visually accepted.

## Install
Upload this patch only over V2.1 or V3. If V3 backend was not deployed, deploy backend first (V3 schema/thread changes are included). Then run existing iOS Root TestFlight. If V3 backend is already deployed, only iOS build is necessary. MacBook pairing/agent not repaired in V4.
