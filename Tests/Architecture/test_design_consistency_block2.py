"""Source-level regression contracts; simulator/Xcode validation is separate."""
from pathlib import Path
import re, unittest
ROOT=Path(__file__).resolve().parents[2]
def src(p): return (ROOT/'Sources'/p).read_text()
class Block2(unittest.TestCase):
    def test_world_map_offline_and_accessible(self):
        view=src('Core/BusinessWorldMapHeader.swift')
        rows=re.findall(r'"([01]{100})"',view)
        self.assertEqual(len(rows),43)
        self.assertGreater(sum(row.count('1') for row in rows),800)
        for fragment in ['Canvas','TimelineView','accessibilityReduceMotion','scenePhase != .active','allowsHitTesting(false)','accessibilityHidden(true)']:
            self.assertIn(fragment,view)
        self.assertNotIn('URLSession',view)
        home = (ROOT / 'ClientConfigurator/Sources/Views/Home/HomeDashboardView.swift').read_text()
        self.assertIn('IumrahHomeJourneySearchHero', home)
        self.assertLess(home.index('publishedFlightSection'), home.index('businessConfigurator.homeActions()'))
        self.assertIn('OverviewView()', src('Views/BusinessNativeConfiguratorView.swift'))
    def test_booking_actual_status_and_operations(self):
        view=src('Views/BookingDetailView.swift')
        for fragment in ['BusinessBookingProgress(status: actual)','if let actual = detail.operation?.tripStatus','workspacePicker','case 1:', 'case 2:', 'case 3:', 'hasUnsavedOperations && workspace != 0','DisclosureGroup(isExpanded: $showAdvanced)','transitionDialog = true','await save()','availabilityExpectation(operation)','financesOnly: true']:
            self.assertIn(fragment,view)
        self.assertNotIn('statusBadge(status)',view.split('private func hero(')[1].split('private var currentStatusTargets')[0])
        self.assertIn('status != .cancelled',src('Core/BusinessBookingProgress.swift'))
    def test_booking_queue_preserved(self):
        view=src('Views/BookingsView.swift')
        for key in ['availability','receipt','payment','documents','departure','trip','cancellation','refund','finance_close','unassigned']:
            self.assertIn('"'+key+'"',view)
        self.assertIn('hasLoadedBookings ? "\\(count)" : "—"',view)
        self.assertIn('Button { selectedBooking = booking }',view)
    def test_concierge_is_separate_and_safe(self):
        view=src('Views/BusinessOffersView.swift').split('struct ConciergeRequestsView: View')[1]
        for fragment in ['.searchable(text: $search','selectedID','confirmStatus','changeConciergeRequest(id: item.id, status: state)', 'draft.builderFinishAsOffer = true', ' + ":concierge:" + item.id', 'initial: draft(for: item), preferOffer: true','(1...6).contains(item.adults + item.children + item.infants)','draft.makkah.rooms = item.rooms','draft.includeMedina = item.scope != "makkahOnly"']:
            self.assertIn(fragment,view)
        self.assertNotIn('acceptOffer(',view)
        self.assertNotIn('createManualBooking(',view)
        self.assertIn('ConciergeRequestsView()',src('Views/OverviewView.swift'))
        self.assertIn('ConciergeRequestsView()',src('Views/BusinessOffersView.swift').split('struct ConciergeRequestsView: View')[0])
if __name__=='__main__': unittest.main()
