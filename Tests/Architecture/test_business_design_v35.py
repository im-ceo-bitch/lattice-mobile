"""V35 source contracts and compiled layout policy, not an Xcode UI test."""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
def source(name):
    return (ROOT / 'Sources' / name).read_text()
class BusinessDesignContracts(unittest.TestCase):
    def test_chat_composer_safe_area(self):
        chat = source('Views/ChatsView.swift')
        self.assertIn('.safeAreaInset(edge: .bottom, spacing: 0)', chat)
        self.assertNotIn('composerPanelHeight', chat)
        self.assertNotIn('ignoresSafeArea(.container, edges: .bottom)', chat)
        self.assertNotIn('.toolbarBackground(.hidden, for: .navigationBar)', chat)
        self.assertIn('BusinessDesign.primaryControl', source('Views/BusinessChatConversationStyle.swift'))
    def test_chat_defaults_to_all_threads(self):
        chat = source('Views/ChatsView.swift')
        self.assertIn('filter: ChatFilter = .all', chat)
        self.assertIn('case .all: return threads', chat)
    def test_drawer_scroll_and_width(self):
        drawer = source('Views/BusinessSidebar.swift')
        self.assertNotIn('UIScreen.main.bounds', drawer)
        self.assertIn('layout.availableSize.width', drawer)
        self.assertIn('private var drawerContent: some View {\n        ScrollView', drawer)
        self.assertIn('.accessibilityHidden(sidebar.isOpen)', drawer)
    def test_login(self):
        login = source('Views/LoginView.swift')
        for fragment in ['Text("Логин")', 'Text("Пароль")', '.focused($focusedField, equals: .login)', '.focused($focusedField, equals: .password)', 'if focusedField == nil', '.scrollDismissesKeyboard(.interactively)']:
            self.assertIn(fragment, login)
        self.assertNotIn('.ignoresSafeArea', login)
    def test_detail_panes(self):
        for name in ['BookingsView', 'ChatsView', 'ClientArchiveView']:
            self.assertIn('BusinessAdaptivePaneHost {', source(f'Views/{name}.swift'))
    def test_shared_heading(self):
        for name in ['OverviewView', 'BookingsView', 'ChatsView', 'FlightCurationView']:
            text = source(f'Views/{name}.swift')
            self.assertIn('BusinessPageHeading(', text)
            if name != 'OverviewView':
                self.assertIn('.businessNavigationSurface()', text)
            else:
                self.assertIn('OverviewView()', source('Views/BusinessNativeConfiguratorView.swift'))
    @unittest.skipUnless(shutil.which('swiftc'), 'Swift compiler required')
    def test_compiled_layout_policy(self):
        layout = source('Core/BusinessAdaptiveLayout.swift').split('private struct BusinessAdaptiveLayoutKey')[0]
        layout = layout.replace('import SwiftUI', '''import Foundation
        enum UserInterfaceSizeClass: Sendable { case compact, regular }
        struct GridItem { enum Size { case adaptive(minimum: CGFloat, maximum: CGFloat) }; enum Alignment { case top }; init(_ size: Size, spacing: CGFloat, alignment: Alignment) {} }
        ''').replace('#if targetEnvironment(macCatalyst)', '#if V35_CATALYST')
        checks = '''
        func resolve(_ width: CGFloat, _ sizeClass: UserInterfaceSizeClass? = .regular) -> BusinessAdaptiveLayout {
            BusinessAdaptiveLayout.resolve(size: CGSize(width: width, height: 800), horizontalSizeClass: sizeClass)
        }
        for width in [320.0, 375.0, 414.0, 600.0, 719.0] {
            precondition(resolve(CGFloat(width)).isCompact)
            precondition(!resolve(CGFloat(width)).usesWorkspaceNavigation)
            precondition(!resolve(CGFloat(width)).supportsTwoPaneWorkspace)
        }
        precondition(resolve(720).usesWorkspaceNavigation)
        precondition(!resolve(979).supportsTwoPaneWorkspace)
        precondition(resolve(980).supportsTwoPaneWorkspace)
        precondition(resolve(900).supportsDenseDashboard)
        precondition(!resolve(899).supportsDenseDashboard)
        precondition(resolve(1440).listPaneWidth == 420)
        #if V35_CATALYST
        precondition(resolve(1024).isDesktop)
        precondition(resolve(980).layoutClass == .regular)
        #else
        precondition(resolve(1024).layoutClass == .wide)
        precondition(resolve(800, .compact).isCompact)
        #endif
        print("layout policy: PASS")
        '''
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'main.swift'
            path.write_text(layout + checks)
            for flags in [[], ['-D', 'V35_CATALYST']]:
                exe = str(Path(d) / 'layout-test')
                subprocess.run(['swiftc', *flags, str(path), '-o', exe], check=True, timeout=30)
                subprocess.run([exe], check=True, timeout=5)
if __name__ == '__main__':
    unittest.main()
