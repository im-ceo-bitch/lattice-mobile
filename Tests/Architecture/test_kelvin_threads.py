import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
class KelvinThreadsTests(unittest.TestCase):
    def test_thread_navigation_and_context(self):
        view=(ROOT/'Sources/Views/KelvinView.swift').read_text()
        api=(ROOT/'Sources/Networking/APIClient+Kelvin.swift').read_text()
        backend=(ROOT/'Backend/HotelsWorker/src/kelvin.js').read_text()
        self.assertIn('ForEach(threadList.filter',view)
        self.assertNotIn('ForEach(Array(turns.reversed()))',view)
        self.assertIn('selectThread(UUID().uuidString)',view)
        self.assertIn('threadId: thread',view)
        self.assertIn('"threadId": thread',api)
        self.assertIn('WHERE owner=? AND thread_id=? AND seq<?',backend)
    def test_no_geometry_scroll_feedback_or_global_clip(self):
        view=(ROOT/'Sources/Views/KelvinView.swift').read_text()
        self.assertNotIn('}.clipped()',view)
        self.assertNotIn('.clipShape(RoundedRectangle(cornerRadius: 24 * offset',view)
        self.assertNotIn('.onPreferenceChange(KelvinBottomKey.self) { _ in',view)
        shell=(ROOT/'Sources/Views/KelvinDrawerShell.swift').read_text()
        self.assertIn('struct KelvinDrawerShell',shell)
        self.assertNotIn('.clipped()',shell)
        self.assertNotIn('.scaleEffect(',shell)
        self.assertIn('.toolbar(owner ? .hidden : .visible, for: .tabBar)',view)
        self.assertIn('Text(answer).font(.body).lineSpacing(4).hidden()',view)
    def test_device_status_and_queue(self):
        view=(ROOT/'Sources/Views/KelvinView.swift').read_text()
        self.assertIn('MacBook не в сети',view)
        self.assertIn('MacBook не подключён',view)
        self.assertIn('Последний сигнал:',view)
        self.assertIn('kelvinCancel(id: turn.id)',view)
        self.assertIn('voiceTurn?.status == "running"',view)
if __name__=='__main__': unittest.main()
