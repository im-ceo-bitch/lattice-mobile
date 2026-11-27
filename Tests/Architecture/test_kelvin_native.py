import json, struct, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'Resources/Assets.xcassets'
def source(path): return (ROOT / path).read_text()
def png_size(path):
    with path.open('rb') as f:
        header = f.read(26)
    assert header[:8] == b'\x89PNG\r\n\x1a\n'
    return struct.unpack('>II', header[16:24]), header[25]
class KelvinNativeTests(unittest.TestCase):
    def test_app_identity_retains_bundle(self):
        project = source('project.yml')
        self.assertIn('PRODUCT_BUNDLE_IDENTIFIER: com.iumrah.root', project)
        self.assertIn('INFOPLIST_KEY_CFBundleDisplayName: "Kelvin"', project)
        icons = ASSETS / 'AppIcon.appiconset'
        entries = json.loads((icons / 'Contents.json').read_text())['images']
        for item in entries:
            size, color = png_size(icons / item['filename'])
            n = round(float(item['size'].split('x')[0]) * int(item.get('scale','1x')[0]))
            self.assertEqual(size, (n,n)); self.assertEqual(color, 2)
        self.assertTrue(any(item.get('appearances') for item in entries))
    def test_wordmark_letters(self):
        for theme in ['light', 'dark']:
            full, color = png_size(ASSETS / 'KelvinWordmark.imageset' / (theme+'.png'))
            self.assertEqual(full, (795,208)); self.assertEqual(color, 6)
            letters = [png_size(ASSETS / ('KelvinLetter%d.imageset'%i) / (theme+'.png')) for i in range(7)]
            self.assertEqual(sum(s[0][0] for s in letters), full[0]); self.assertTrue(all(s[0][1]==208 and s[1]==6 for s in letters))
    def test_tabs_and_shared_configurator(self):
        tab = source('Sources/Views/BusinessTabView.swift')
        self.assertIn('selection: BusinessWorkspaceSection = .kelvin', tab)
        self.assertIn('.kelvin, .bookings, .overview, .chats, .account', tab)
        self.assertNotIn('BusinessWorkspaceSection.create', tab)
        home = source('ClientConfigurator/Sources/Views/Home/HomeDashboardView.swift')
        self.assertLess(home.index('publishedFlightSection'), home.index('businessConfigurator.homeActions()'))
        self.assertIn('OverviewView()', source('Sources/Views/BusinessNativeConfiguratorView.swift'))
    def test_voice_and_privacy_contract(self):
        view = source('Sources/Views/KelvinView.swift')
        for fragment in ['AVSpeechSynthesizer()', 'AVAudioPlayer(contentsOf: url)', 'averagePower(forChannel: 0)', 'requiresOnDeviceRecognition = true', 'voiceRequest = id', 'voiceEnabled = false', '!appLock.isLocked', 'scenePhase == .active', 'KelvinVoiceOrb(state: .thinking', 'accessibilityReduceMotion', 'sendTask?.cancel()']:
            self.assertIn(fragment, view)
        self.assertIn('"voice": voice', source('Sources/Networking/APIClient+Kelvin.swift'))
        self.assertIn('ручную', view)
if __name__ == '__main__': unittest.main()
