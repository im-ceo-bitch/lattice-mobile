"""Design consistency source contracts (not runtime/simulator UI tests)."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
def read(path):
    return (ROOT / 'Sources' / path).read_text()

class DesignConsistency(unittest.TestCase):
    def test_all_explicit_navigation_titles_have_brand_surface(self):
        for p in (ROOT / 'Sources').rglob('*.swift'):
            lines = p.read_text().splitlines()
            for i, line in enumerate(lines):
                if '.navigationTitle(' in line or '.navigationBarTitleDisplayMode(' in line:
                    self.assertIn('businessNavigationSurface()', '\n'.join(lines[max(0, i-1):i+4]), f'{p}:{i+1}')
    def test_native_header_and_notifications(self):
        design = read('Core/Design.swift')
        for fragment in ['static let header = Color.black', 'toolbarColorScheme(.dark', 'toolbarBackground(.visible']:
            self.assertIn(fragment, design)
        composer = read('Views/NotificationsComposerView.swift')
        self.assertNotIn('.toolbar(.hidden, for: .navigationBar)', composer)
        self.assertIn('businessNavigationSurface()', composer)
    def test_palette_and_selection_discipline(self):
        palette = read('Core/BusinessAnimationPalette.swift')
        builder = read('Views/UmrahBuilderView.swift')
        self.assertIn('BusinessAnimationPalette.orbit', read('Core/IumrahOrbitV5.swift'))
        for hue in re.findall(r'0x([0-9A-F]{6})', palette):
            r,g,b = (int(hue[i:i+2],16) for i in (0,2,4))
            self.assertGreaterEqual(b,g); self.assertGreaterEqual(g,r)
        self.assertNotRegex(builder, r'(?<![a-zA-Z])(?:Color\.blue|\.tint\(\.blue\)|\.foregroundStyle\(\.blue\))')
        self.assertNotRegex(builder, r'\.background\([^\n]*BusinessDesign\.securityBlue')
        self.assertIn('sourceButton("Umrah Direct Flights", index: 0)', builder)
        self.assertIn('sourceButton("Aviasales", index: 1)', builder)
    def test_rail_and_price_preview(self):
        builder = read('Views/UmrahBuilderView.swift')
        rail = read('Core/Design.swift').split('struct BusinessStageRail: View')[1].split('struct BusinessChoiceRow')[0]
        self.assertIn('minWidth: BusinessDesign.Size.tap', rail)
        self.assertIn('minHeight: BusinessDesign.Size.tap', rail)
        self.assertIn('index > max(current, maximumReachable)', rail)
        self.assertIn('BusinessConfiguratorPricePreview(draft: store.draft, stage: step)', builder)
        self.assertIn('Text(footerPrice.title)', builder)
        self.assertIn('if let amount = footerPrice.amount', builder)
        self.assertIn('draft.firstIncompleteBuilderStage == 5', read('Core/BusinessConfiguratorPricePreview.swift'))

if __name__ == '__main__': unittest.main()
