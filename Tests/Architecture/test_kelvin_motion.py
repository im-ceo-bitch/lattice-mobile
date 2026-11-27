import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
class KelvinMotionTests(unittest.TestCase):
    def test_directional_native_pan(self):
        shell=(ROOT/'Sources/Views/KelvinDrawerShell.swift').read_text()
        for fragment in ['surface.gesture(KelvinHorizontalPan','UIPanGestureRecognizer()', 'gestureRecognizerShouldBegin','velocity(in: pan.view?.window)','translation(in: coordinateView)', 'case .cancelled, .failed', 'KelvinDrawerPhysics.destination', 'presentation.progress ?? progress', 'Transaction(); tx.disablesAnimations = true','Animation.interpolatingSpring','motionID == id','accessibilityReduceMotion']:
            self.assertIn(fragment,shell)
        for fragment in ['.scaleEffect(','.clipped()', 'frame(width: 18)', '.ignoresSafeArea(.keyboard)']:
            self.assertNotIn(fragment,shell)
    def test_native_chrome_and_keyboard(self):
        view=(ROOT/'Sources/Views/KelvinView.swift').read_text()
        for fragment in ['content.safeAreaBar(edge: edge, spacing: 0)', 'content.safeAreaInset(edge: edge, spacing: 0)', 'businessChatGlassSurface(in: RoundedRectangle(cornerRadius: 29', 'BusinessChatGlassContainer(spacing: 6)', '.scrollDismissesKeyboard(.interactively)', '.onScrollPhaseChange', '.onScrollGeometryChange(for: Bool.self)', 'defaultScrollAnchor(nil, for: .sizeChanges)', 'goToBusiness(.overview)', 'goToBusiness(.bookings)', 'goToBusiness(.chats)', 'goToBusiness(.account)']:
            self.assertIn(fragment,view)
        self.assertNotIn('toolbar(showVoice || focused',view)
        self.assertNotIn('Button { focused = false; plugins = true }',view)
        self.assertNotIn('follow = true; focused = false; let id',view)
        style=(ROOT/'Sources/Views/BusinessChatConversationStyle.swift').read_text()
        self.assertIn('content.glassEffect(glass, in: shape)',style)
    def test_history_and_voice_contract_kept(self):
        view=(ROOT/'Sources/Views/KelvinView.swift').read_text()
        self.assertIn('ForEach(threadList.filter',view)
        self.assertIn('threadId: thread',view)
        self.assertIn('KelvinVoiceOrb(state: .thinking',view)
        self.assertIn('KelvinAnswerText(answer: answer, animated: animateAnswers.contains(turn.id)',view)
if __name__=='__main__': unittest.main()
