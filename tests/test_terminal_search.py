import sys
import unittest
import json
import tempfile
from datetime import date
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app" / "ForgeAgent"))
from terminal import deterministic_sports_answer, needs_live_search, worker_gateway_state
from terminal_tools import fetch_nfl_scoreboard, sync_nfl_schedule_json


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

    def test_nfl_scoreboard_api_formats_current_games(self):
        payload = {
            "events": [{
                "competitions": [{
                    "competitors": [
                        {"homeAway": "away", "team": {"displayName": "Away Team"}, "score": "17"},
                        {"homeAway": "home", "team": {"displayName": "Home Team"}, "score": "21"},
                    ],
                    "status": {"type": {"description": "Final"}},
                    "venue": {"fullName": "Example Stadium"},
                }],
            }],
        }

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                import json
                return json.dumps(payload).encode()

        with patch("terminal_tools.urllib.request.urlopen", return_value=Response()) as urlopen:
            result = fetch_nfl_scoreboard("2026-09-14")
        self.assertIn("Away Team at Home Team", result)
        self.assertIn("status: Final", result)
        self.assertIn("20260914", urlopen.call_args.args[0].full_url)

    def test_nfl_workflow_sync_preserves_final_records(self):
        payload = {
            "events": [{
                "links": [{"href": "https://example.test/game"}],
                "competitions": [{
                    "competitors": [
                        {"homeAway": "away", "team": {"displayName": "New Away"}},
                        {"homeAway": "home", "team": {"displayName": "New Home"}},
                    ],
                    "status": {"type": {"name": "STATUS_SCHEDULED"}},
                    "venue": {"fullName": "Example Stadium"},
                }],
            }],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sports_data.json"
            path.write_text(json.dumps({
                "updated_at": "2026-09-13",
                "games": [{"league": "NFL", "date": "2026-09-14", "away": "Old Away", "home": "Old Home", "status": "final", "away_score": 10, "home_score": 7}],
                "standings": [],
            }))
            with patch("terminal_tools._fetch_nfl_scoreboard_payload", return_value=(date(2026, 9, 14), payload, None)):
                result = sync_nfl_schedule_json("2026-09-14", Path(directory))
            data = json.loads(path.read_text())
        self.assertIn("1 NFL game(s) added", result)
        self.assertEqual(data["games"][0]["away_score"], 10)
        self.assertEqual(data["games"][1]["away"], "New Away")


if __name__ == "__main__":
    unittest.main()
