import sys
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app" / "ForgeAgent"))
from terminal import deterministic_sports_answer, needs_live_search, worker_gateway_state


class TerminalSearchTests(unittest.TestCase):
    def test_explicit_web_search_is_grounded(self):
        self.assertTrue(needs_live_search("Can you search the web to find out?"))

    def test_explicit_provider_request_is_grounded(self):
        self.assertTrue(needs_live_search("Ask Gemini API."))

    def test_static_request_does_not_require_live_search(self):
        self.assertFalse(needs_live_search("Explain what a touchdown is."))

    def test_worker_gateway_requires_both_settings(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(worker_gateway_state(), "missing")
        with patch.dict("os.environ", {"FORGE_WORKER_URL": "https://larboard.ca"}, clear=True):
            self.assertEqual(worker_gateway_state(), "incomplete")
        with patch.dict("os.environ", {"FORGE_WORKER_URL": "https://larboard.ca", "FORGE_WORKER_TOKEN": "secret"}, clear=True):
            self.assertEqual(worker_gateway_state(), "configured")

    def test_missing_local_nfl_record_falls_through_to_live_search(self):
        with patch("terminal.answer_sports", return_value="The requested date is 2026-09-14. No NFL game is listed for that date in the local dataset; this does not verify the real-world schedule."):
            self.assertIsNone(deterministic_sports_answer("today's NFL game"))


if __name__ == "__main__":
    unittest.main()
