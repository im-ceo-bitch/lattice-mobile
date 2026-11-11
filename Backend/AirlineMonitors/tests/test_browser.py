"""Regression tests: async widgets and exact-fare fail-closed behavior.

These tests validate *our browser adapter*, not the current live airline DOM.
"""
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from monitor import browser


class _Delayed:
    def __init__(self, visible_after=3):
        self.visible_after = visible_after
        self.probes = 0
        self.first = self

    def is_visible(self):
        self.probes += 1
        return self.probes >= self.visible_after


class _Page:
    url = 'https://example-airline.test/results'

    def __init__(self, loc=None):
        self.loc = loc or _Delayed()

    def locator(self, selector):
        return self.loc

    def goto(self, *args, **kwargs):
        return _Response()


class _Response:
    status = 200


class BrowserAdapterTests(unittest.TestCase):
    def test_dynamic_control_is_polled_instead_of_immediate_failure(self):
        loc = _Delayed(visible_after=4)
        selected = browser.first_visible(_Page(loc), ['input[data-testid="origin"]'], timeout=1000)
        self.assertIs(selected, loc)
        self.assertGreaterEqual(loc.probes, 4)

    def test_missing_control_reports_explicit_diagnostic(self):
        with self.assertRaisesRegex(browser.SiteChanged, 'CONTROL_NOT_VISIBLE'):
            browser.first_visible(_Page(_Delayed(999)), ['input[missing]'], timeout=5)

    def test_official_flynas_url_is_search_page_not_info_page(self):
        config = Path(__file__).resolve().parents[1] / 'config' / 'flynas.json'
        self.assertEqual(json.loads(config.read_text())['booking_url'], 'https://www.flynas.com/en/flights')

    def test_exact_flight_fare_only(self):
        config = {'booking_url': 'https://example-airline.test/', 'airline_code': 'XY',
                  'provider': 'flynas', 'selectors': {'origin_input': [],
                  'destination_input': [], 'departure_input': [], 'search_button': []}}
        task = {'origin': 'JED', 'destination': 'TAS', 'departure_date': '2026-11-19',
                'flight_number': 'XY633'}
        cards = ['Jeddah JED to Tashkent TAS XY633 Economy SAR 1250',
                 'Jeddah JED to Tashkent TAS XY634 Economy SAR 1200']
        with TemporaryDirectory() as d, patch.object(browser, 'assert_not_blocked'), \
             patch.object(browser, 'select_airport'), patch.object(browser, 'select_departure_date'), \
             patch.object(browser, 'first_visible'), patch.object(browser, '_read_results', return_value=cards):
            result = browser.search_one(_Page(), config, task, Path(d))
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['flight_number'], 'XY633')
        self.assertEqual(result[0]['amount_minor'], 125000)

    def test_other_flight_never_accepted_even_with_price(self):
        config = {'booking_url': 'https://example-airline.test/', 'airline_code': 'XY',
                  'provider': 'flynas', 'selectors': {'origin_input': [],
                  'destination_input': [], 'departure_input': [], 'search_button': []}}
        task = {'origin': 'JED', 'destination': 'TAS', 'departure_date': '2026-11-19',
                'flight_number': 'XY633'}
        with TemporaryDirectory() as d, patch.object(browser, 'assert_not_blocked'), \
             patch.object(browser, 'select_airport'), patch.object(browser, 'select_departure_date'), \
             patch.object(browser, 'first_visible'), patch.object(browser, '_read_results',
                 return_value=['Jeddah JED to Tashkent TAS XY634 Economy SAR 1200']):
            with self.assertRaisesRegex(browser.SiteChanged, 'EXACT_FARE_NOT_PROVEN'):
                browser.search_one(_Page(), config, task, Path(d))


if __name__ == '__main__':
    unittest.main()
