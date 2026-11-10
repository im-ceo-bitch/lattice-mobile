import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

class FlightHubSwiftErrorHandlingRegression(unittest.TestCase):
    def test_reload_and_loadmore_use_state_property_not_immutable_catch_binding(self):
        source = (ROOT / "Sources/Views/FlightHubMonitorView.swift").read_text(encoding="utf-8")
        self.assertIn("self.error = error.localizedDescription", source)
        self.assertEqual(source.count("self.error = error.localizedDescription"), 2)
        self.assertNotRegex(source, r"catch\s*\{\s*error\s*=")

if __name__ == "__main__":
    unittest.main()
