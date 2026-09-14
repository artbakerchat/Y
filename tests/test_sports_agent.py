import json
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app" / "ForgeAgent"))
from sports_agent import answer, load_data


class SportsAgentTests(unittest.TestCase):
    def test_local_dataset_loads(self):
        data = load_data()
        self.assertEqual(data["updated_at"], "2026-09-14")

    def test_score_lookup(self):
        result = answer("What was the Vancouver Canucks score?")
        self.assertIn("Austin FC 2, Vancouver Whitecaps FC 1", result)

    def test_upcoming_schedule(self):
        result = answer("What is the next Canucks game?")
        self.assertIn("Edmonton Oilers at Vancouver Canucks", result)
        self.assertIn("Rogers Arena", result)

    def test_standings_lookup(self):
        result = answer("Show NHL standings")
        self.assertIn("NHL #1 Vancouver Canucks", result)
        self.assertIn("NHL #3 Calgary Flames", result)

    def test_unknown_query_is_honest(self):
        result = answer("Who is the fastest team?")
        self.assertIn("local scores, schedules, and standings", result)

    def test_missing_nfl_date_query_reports_resolved_date(self):
        result = answer("What is the date of today's NFL game?")
        self.assertIn("2026-09-14", result)
        self.assertIn("No live NFL game was found", result)

    @patch("sports_agent.urllib.request.urlopen")
    def test_live_nfl_game_query_uses_espn_scoreboard(self, mock_urlopen):
        payload = {
            "events": [
                {
                    "competitions": [{
                        "status": {"type": {"name": "scheduled", "description": "Scheduled"}},
                        "venue": {"fullName": "Arrowhead Stadium"},
                        "competitors": [
                            {"homeAway": "away", "team": {"displayName": "Denver Broncos"}, "score": 0},
                            {"homeAway": "home", "team": {"displayName": "Kansas City Chiefs"}, "score": 0},
                        ],
                    }],
                }
            ]
        }
        response = Mock()
        response.read.return_value = json.dumps(payload).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = response

        result = answer("What is the date of today's NFL game?")
        self.assertIn("2026-09-14", result)
        self.assertIn("Denver Broncos at Kansas City Chiefs", result)

    @patch("sports_agent.urllib.request.urlopen")
    def test_live_nfl_missing_date_does_not_fallback_to_local_data(self, mock_urlopen):
        response = Mock()
        response.read.return_value = json.dumps({"events": []}).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = response

        result = answer("What is the date of today's NFL game?")
        self.assertIn("No live NFL game was found", result)
        self.assertNotIn("local dataset", result.lower())

    @patch("sports_agent.urllib.request.urlopen")
    def test_live_nfl_today_question_returns_live_game(self, mock_urlopen):
        payload = {
            "events": [{
                "competitions": [{
                    "status": {"type": {"name": "scheduled", "description": "Scheduled"}},
                    "venue": {"fullName": "Arrowhead Stadium"},
                    "competitors": [
                        {"homeAway": "away", "team": {"displayName": "Denver Broncos"}, "score": 0},
                        {"homeAway": "home", "team": {"displayName": "Kansas City Chiefs"}, "score": 0},
                    ],
                }],
            }]
        }
        response = Mock()
        response.read.return_value = json.dumps(payload).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = response

        result = answer("What is the date of today's NFL game?")
        self.assertIn("2026-09-14", result)
        self.assertIn("Denver Broncos at Kansas City Chiefs", result)
        self.assertNotIn("No live NFL game was found", result)

    def test_editorial_recap_format(self):
        result = answer("Give me the NFL drama and blowout recap")
        self.assertIn("High-Stakes & Drama Finishers", result)
        self.assertIn("◌ Detroit Lions 31, New Orleans Saints 30 (OT)", result)
        self.assertIn("Runaways & Blowouts", result)
        self.assertIn("Sunday Night Football (In Progress)", result)

    def test_team_recap_question_returns_narrative(self):
        result = answer("What happened with the Detroit Lions?")
        self.assertIn("Detroit Lions 31, New Orleans Saints 30 (OT)", result)

    def test_empty_prompt_rejected(self):
        with self.assertRaises(ValueError):
            answer("   ")


if __name__ == "__main__":
    unittest.main()
