import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app" / "ForgeAgent"))
from sports_agent import answer, load_data, prediction_inputs


class SportsAgentTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict("os.environ", {}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)

    def test_worker_secrets_take_priority_over_local_keys(self):
        import json
        from unittest.mock import MagicMock
        from sports_agent import search_openai, search_gemini

        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({"evidence": "Worker evidence"}).encode()
        with patch.dict("os.environ", {
            "FORGE_WORKER_URL": "https://worker.example",
            "FORGE_WORKER_TOKEN": "gateway-access",
            "OPENAI_API_KEY": "unused-local-key",
            "GEMINI_API_KEY": "unused-local-key",
        }), patch("sports_agent.urllib.request.urlopen", return_value=response) as send:
            for lookup in (answer, search_openai, search_gemini):
                self.assertEqual(lookup("Today's NFL games?"), "Worker evidence")
            self.assertEqual(send.call_count, 3)
            request = send.call_args.args[0]
            self.assertEqual(request.full_url, "https://worker.example/api/sports/evidence")
            self.assertEqual(request.get_header("X-forge-worker-token"), "gateway-access")
            self.assertNotIn("unused-local-key", str(request.headers))

    @patch("sports_agent.search_worker_gateway", return_value="Cloudflare Worker live search failed: Unauthorized")
    @patch("sports_agent.search_openai")
    @patch("sports_agent.search_gemini")
    def test_worker_failure_does_not_fall_back_to_local_providers(self, gemini, openai, worker):
        self.assertIn("Worker live search failed", answer("Today's games?"))
        openai.assert_not_called()
        gemini.assert_not_called()

    def test_empty_prompt_raises_value_error(self):
        with self.assertRaises(ValueError):
            answer("")
        with self.assertRaises(ValueError):
            answer("   ")

    def test_load_data_returns_live_structure(self):
        data = load_data()
        self.assertEqual(data["updated_at"], "live")
        self.assertIsInstance(data["games"], list)

    @patch("sports_agent.search_gemini")
    @patch("sports_agent.search_openai")
    @patch("sports_agent._local_credentials_configured", return_value=True)
    def test_answer_uses_openai_and_gemini_apis(self, mock_creds, mock_openai, mock_gemini):
        mock_openai.return_value = "Kansas City Chiefs defeated Denver Broncos 27-20.\n\nSources:\n- ESPN: https://espn.com"
        mock_gemini.return_value = "The Chiefs won 27-20 over the Broncos.\n\nSources:\n- NFL: https://nfl.com"

        result = answer("Who won the NFL game?")
        self.assertIn("[OpenAI Web Search]", result)
        self.assertIn("Kansas City Chiefs defeated Denver Broncos 27-20", result)
        self.assertIn("[Google Gemini Search]", result)
        self.assertIn("The Chiefs won 27-20 over the Broncos", result)
        self.assertIn("https://espn.com", result)
        self.assertIn("https://nfl.com", result)

    @patch("sports_agent.search_gemini")
    @patch("sports_agent.search_openai")
    @patch("sports_agent._local_credentials_configured", return_value=True)
    def test_answer_when_one_provider_unavailable(self, mock_creds, mock_openai, mock_gemini):
        mock_openai.return_value = "OpenAI web search is not configured (OPENAI_API_KEY is missing)."
        mock_gemini.return_value = "The game is scheduled for 5 PM PT."

        result = answer("What time is the game?")
        self.assertIn("[OpenAI Web Search (Unavailable)]", result)
        self.assertIn("[Google Gemini Search]", result)
        self.assertIn("The game is scheduled for 5 PM PT", result)

    @patch("sports_agent.search_gemini")
    @patch("sports_agent.search_openai")
    @patch("sports_agent._local_credentials_configured", return_value=True)
    def test_answer_when_both_providers_unavailable(self, mock_creds, mock_openai, mock_gemini):
        mock_openai.return_value = "OpenAI web search is not configured (OPENAI_API_KEY is missing)."
        mock_gemini.return_value = "Gemini Google Search is not configured (GEMINI_API_KEY is missing)."

        result = answer("What is the score?")
        self.assertIn("Google and OpenAI live search APIs are currently unavailable", result)

    @patch("sports_agent.search_worker_gateway")
    @patch("sports_agent._local_credentials_configured", return_value=False)
    def test_worker_gateway_used_when_local_keys_missing(self, mock_creds, mock_worker):
        mock_worker.return_value = "Live sports evidence from Worker gateway"
        result = answer("Today's games?")
        self.assertEqual(result, "Live sports evidence from Worker gateway")

    @patch("sports_agent.search_gemini")
    @patch("sports_agent.search_openai")
    def test_prediction_inputs_gathers_live_evidence(self, mock_openai, mock_gemini):
        mock_openai.return_value = "OpenAI forecast context"
        mock_gemini.return_value = "Google Search forecast context"

        inputs = prediction_inputs("Predict the Canucks game")
        self.assertEqual(inputs["source"], "google_and_openai_apis")
        self.assertEqual(inputs["openai_evidence"], "OpenAI forecast context")
        self.assertEqual(inputs["gemini_evidence"], "Google Search forecast context")


if __name__ == "__main__":
    unittest.main()

    def test_empty_prompt_rejected(self):
        with self.assertRaises(ValueError):
            answer("   ")


if __name__ == "__main__":
    unittest.main()
