import re, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
class KelvinVoiceTests(unittest.TestCase):
    def test_catalog_matches_backend(self):
        swift=(ROOT/'Sources/Views/KelvinVoicePreferences.swift').read_text()
        js=(ROOT/'Backend/HotelsWorker/src/kelvin-voice.js').read_text()
        ids=set(re.findall(r'\.init\(id: "(\w+)"',swift))
        server=set(re.search(r"new Set\('([^']+)'\.split",js).group(1).split())
        self.assertEqual(ids,server); self.assertEqual(len(ids),30)
    def test_authenticated_voice_transport(self):
        api=(ROOT/'Sources/Networking/APIClient+Kelvin.swift').read_text()
        self.assertIn('/api/admin/hotels/kelvin/speech',api)
        self.assertIn('try await perform(request)',api)
        self.assertNotIn('GEMINI_API_KEY',api)
        route=(ROOT/'Backend/HotelsWorker/src/kelvin.js').read_text()
        self.assertLess(route.index('KELVIN_OWNER_SESSION_REQUIRED'),route.index("path==='/speech'"))
    def test_native_voice_session_controls(self):
        view=(ROOT/'Sources/Views/KelvinView.swift').read_text()
        for item in ['voiceTextFocused','toggleMute()','interruptSpeech()','showVoiceSettings','cloudConsentOwner','AVAudioPlayer(data: data)','speechChunks','voiceStartTask?.cancel()','speech.clearTranscript()','AVAudioSession.interruptionNotification','speech.lastVoiceActivity','speech.start(language: language.rawValue)']:
            self.assertIn(item,view)
        self.assertIn('voice: selectedVoice',view)
        self.assertIn('requiresOnDeviceRecognition = true',view)
        self.assertIn('if !showVoiceSettings, let id = voiceRequest',view)
if __name__=='__main__': unittest.main()
