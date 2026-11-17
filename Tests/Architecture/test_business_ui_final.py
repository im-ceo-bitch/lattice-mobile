"""Source contracts for the Business final UI pass; not simulator UI tests."""
from pathlib import Path
import unittest
ROOT = Path(__file__).resolve().parents[2]
def src(path):
    return (ROOT / 'Sources' / path).read_text()
class BusinessFinalUI(unittest.TestCase):
    def test_single_final_action_uses_selected_mode(self):
        builder = src('Views/UmrahBuilderView.swift')
        self.assertIn('finishAsOffer ? "Создать предложение" : "Создать бронирование"', builder)
        self.assertIn('if finishAsOffer || editingOffer != nil { showOfferConfirmation = true; return }', builder)
        self.assertIn('if finishAsOffer || editingOffer != nil', builder)
        self.assertIn('if let issue = store.draft.bookingIssue', builder)
        self.assertIn('store.draft.offerReceipt == nil && store.draft.receipt == nil { footer }', builder)
        self.assertIn('.disabled(submitting || currentIssue != nil)', builder)
    def test_overview_routes_real_queues(self):
        view = src('Views/OverviewView.swift')
        for key in ('availability', 'payment', 'all'):
            self.assertIn(f'navigation.openBookings(filter: "{key}")', view)
        self.assertIn('BookingListFilter(rawValue: raw)', src('Views/BookingsView.swift'))
    def test_unread_count_and_search(self):
        chat = src('Views/ChatsView.swift')
        self.assertIn('return scopedThreads.filter', chat)
        self.assertIn('navigation.unreadChatCount = threads.filter', chat)
        self.assertIn('.badge(navigation.unreadChatCount)', src('Views/BusinessTabView.swift'))
        self.assertIn('navigation.unreadChatCount = 0', src('Views/RootView.swift'))
    def test_quick_reply_only_draft(self):
        section = src('Views/ChatsView.swift').split('private var quickReplies:')[1].split('private func composer')[0]
        self.assertIn('draft = draft.isEmpty', section)
        self.assertNotIn('send()', section)
    def test_status_staging_requires_save(self):
        view = src('Views/BookingDetailView.swift')
        self.assertIn('ForEach(currentStatusTargets) { item in', view)
        self.assertIn('Button { status = item }', view)
        self.assertIn('saving || detail.operation == nil || !hasUnsavedOperations', view)
    def test_semantic_design_and_header(self):
        design = src('Core/Design.swift')
        for fragment in ('static let primary: CGFloat = 56', 'static let tap: CGFloat = 44', 'toolbarColorScheme(.dark', 'accessibilityReduceMotion'):
            self.assertIn(fragment, design)
        builder = src('Views/UmrahBuilderView.swift')
        self.assertIn('private var builderRail: some View', builder)
        self.assertIn('BusinessStageRail(titles: steps', builder)
        self.assertIn('maximumReachable: store.draft.firstIncompleteBuilderStage', builder)
        self.assertIn('BusinessBrandLogo', builder)
        self.assertIn('businessNavigationSurface()', builder)
if __name__ == '__main__': unittest.main()
