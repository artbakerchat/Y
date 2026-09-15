import sys
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app" / "ForgeAgent"))
from terminal import needs_live_search, worker_gateway_state
from terminal_tools import build_nfl_workflow_evidence, build_prediction_evidence


class TerminalSearchTests(unittest.TestCase):
    def test_explicit_web_search_is_grounded(self):
        self.assertTrue(needs_live_search("Can you search the web to find out?"))

    def test_explicit_provider_request_is_grounded(self):
        self.assertTrue(needs_live_search("Ask Gemini API."))

    def test_sports_queries_are_grounded(self):
        self.assertTrue(needs_live_search("What is today's NFL game?"))
        self.assertTrue(needs_live_search("Show me current standings."))

    def test_static_request_does_not_require_live_search(self):
        self.assertFalse(needs_live_search("Explain what a touchdown is."))

    def test_worker_gateway_requires_both_settings(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(worker_gateway_state(), "missing")
        with patch.dict("os.environ", {"FORGE_WORKER_URL": "https://larboard.ca"}, clear=True):
            self.assertEqual(worker_gateway_state(), "incomplete")
        with patch.dict("os.environ", {"FORGE_WORKER_URL": "https://larboard.ca", "FORGE_WORKER_TOKEN": "secret"}, clear=True):
            self.assertEqual(worker_gateway_state(), "configured")

    @patch("terminal_tools.search_live_web_gemini", return_value="Gemini schedule evidence")
    @patch("terminal_tools.search_live_web_openai", return_value="OpenAI schedule evidence")
    def test_nfl_workflow_evidence_uses_google_and_openai(self, mock_openai, mock_gemini):
        evidence = build_nfl_workflow_evidence("2026-09-14")
        self.assertIn("NFL WORKFLOW SNAPSHOT", evidence)
        self.assertIn("[OpenAI live web search]", evidence)
        self.assertIn("OpenAI schedule evidence", evidence)
        self.assertIn("[Gemini Google Search]", evidence)
        self.assertIn("Gemini schedule evidence", evidence)

    @patch("terminal_tools.search_live_web_gemini", return_value="Gemini prediction evidence")
    @patch("terminal_tools.search_live_web_openai", return_value="OpenAI prediction evidence")
    @patch("terminal_tools.local_live_search_configured", return_value=True)
    def test_sports_prediction_evidence_uses_google_and_openai(self, mock_creds, mock_openai, mock_gemini):
        evidence = build_prediction_evidence("Super Bowl forecast")
        self.assertIn("PREDICTION INPUTS", evidence)
        self.assertIn("[Google and OpenAI live search evidence]", evidence)
        self.assertIn("OpenAI prediction evidence", evidence)
        self.assertIn("Gemini prediction evidence", evidence)


if __name__ == "__main__":
    unittest.main()
