import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
class KelvinCoreMerge(unittest.TestCase):
    def test_native_voice_exact_lookup_and_post_await_fence(self):
        source=(ROOT/'Sources/Views/KelvinView.swift').read_text()
        lookup=source.index('else { turn = try await APIClient.shared.kelvinTurn(id: id) }')
        guard=source.index('voiceRequest == id, !showVoiceSettings else { return }',lookup)
        self.assertLess(guard,source.index('speak(answer)',guard))
        self.assertIn('login == auth.user?.login',source[lookup:guard])
        self.assertIn('!Task.isCancelled',source[lookup:guard])
    def test_memory_and_reports_are_real_api_calls(self):
        source=(ROOT/'Sources/Views/KelvinView.swift').read_text()
        api=(ROOT/'Sources/Networking/APIClient+Kelvin.swift').read_text()
        for method in ['kelvinRecords','kelvinSaveRecord','kelvinCorrectRecord','kelvinDeleteRecord','kelvinConfirmRecord','kelvinInsights']:
            self.assertIn('APIClient.shared.'+method,source)
            self.assertIn('func '+method,api)
        self.assertIn('.sheet(isPresented: $showInsights)',source)
        self.assertIn('showMemory = false; showInsights = false',source)
    def test_provider_route_and_protocol_coexist(self):
        route=(ROOT/'Backend/HotelsWorker/src/kelvin.js').read_text()
        for path in ['/speech','/turn','/records','/insights','/diagnostics','/autonomy','/care']:
            self.assertIn("path==='"+path+"'",route)
        workflow=(ROOT/'.github/workflows/deploy-iumrah-backend.yml').read_text()
        self.assertIn('KELVIN_GEMINI_API_KEY: ${{ secrets.KELVIN_GEMINI_API_KEY }}',workflow)
