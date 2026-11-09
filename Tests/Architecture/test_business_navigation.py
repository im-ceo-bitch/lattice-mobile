import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class NoLegacyHotelAdminNavigation(unittest.TestCase):
    def test_old_hotel_management_removed_from_all_navigation(self):
        tab = (ROOT / 'Sources/Views/BusinessTabView.swift').read_text()
        sidebar = (ROOT / 'Sources/Views/BusinessSidebar.swift').read_text()
        for text in [tab, sidebar]:
            self.assertNotIn('HotelsView()', text)
            self.assertNotIn('PrimaryHotelsView(', text)
            self.assertNotIn('case .hotels:', text)
            self.assertNotIn('case .primaryHotels:', text)
        self.assertIn('.overview, .bookings, .chats, .flights', tab)

    def test_existing_booking_hotel_records_not_removed(self):
        booking = (ROOT / 'Sources/Views/BookingDetailView.swift').read_text()
        builder = (ROOT / 'Sources/Views/UmrahBuilderView.swift').read_text()
        self.assertIn('updateBookingAssignment', booking)
        self.assertIn('UmrahStayEditor', builder)
        # Hotel selections continue reading the existing compatibility endpoint
        # until a provider-backed server adapter is deployed and verified.
        api = (ROOT / 'Sources/Networking/APIClient.swift').read_text()
        self.assertIn('func hotels()', api)


if __name__ == '__main__':
    unittest.main()
