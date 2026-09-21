import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app" / "ForgeAgent"))
from sports_agent import answer, load_data, prediction_inputs


class SportsAgentTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict("os.environ", {}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)

    def test_worker_secrets_take_priority_over_local_keys(self):
        import json
        from sports_agent import search_gemini, search_openai

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


# ---------------------------------------------------------------------------
# NFLMeta API tests — all network calls are mocked
# ---------------------------------------------------------------------------

def _make_response(data):
    """Build a minimal SDK-like response object with a .data attribute."""
    resp = MagicMock()
    resp.data = data
    return resp


def _stub_nflmeta_module(live_data=None, standings_data=None, games_data=None, injuries_data=None):
    """Return a stub nflmeta module whose NFLMetaClient is pre-configured."""
    stub = types.ModuleType("nflmeta")
    client = MagicMock()
    stub.NFLMetaClient = MagicMock(return_value=client)

    # live_scores.get()
    client.live_scores.get.return_value = _make_response(live_data or [])

    # standings via client.get("/api/v1/standings", ...)
    def _get(path, query=None):
        if "standings" in path:
            return _make_response(standings_data or [])
        if "games" in path:
            return _make_response(games_data or [])
        return _make_response([])

    client.get.side_effect = _get

    # teams.recent_games(abbr) — same shape as /api/v1/games
    client.teams.recent_games.return_value = _make_response(games_data or [])

    # teams.injuries(abbr, season=..., week=...)
    client.teams.injuries.return_value = _make_response(injuries_data or [])

    # injuries.list(season=..., week=...)
    client.injuries.list.return_value = _make_response(injuries_data or [])

    return stub


class NFLMetaAPITests(unittest.TestCase):
    """Unit tests for nflmeta_api.py; all HTTP is mocked."""

    def setUp(self):
        # Ensure the module under test is freshly imported each time
        for mod in list(sys.modules.keys()):
            if mod.startswith("nflmeta_api"):
                del sys.modules[mod]

    # -----------------------------------------------------------------------
    # fetch_live_scores
    # -----------------------------------------------------------------------

    def test_live_scores_no_key_returns_labeled_message(self):
        import nflmeta_api  # noqa: PLC0415

        with patch.dict("os.environ", {"X-NFLMeta-Key": ""}):
            result = nflmeta_api.fetch_live_scores()
        self.assertIn("unavailable", result.lower())
        self.assertIn("X-NFLMeta-Key", result)

    def test_live_scores_empty_feed(self):
        import nflmeta_api  # noqa: PLC0415

        stub = _stub_nflmeta_module(live_data=[])
        with patch.dict("os.environ", {"X-NFLMeta-Key": "test-key"}):
            with patch.dict(sys.modules, {"nflmeta": stub}):
                result = nflmeta_api.fetch_live_scores()
        self.assertIn("no games", result.lower())

    def test_live_scores_formats_final_game(self):
        import nflmeta_api  # noqa: PLC0415

        games = [
            {
                "away_team": {"abbr": "BUF", "name": "Buffalo Bills", "score": 27},
                "home_team": {"abbr": "MIA", "name": "Miami Dolphins", "score": 20},
                "completed": True,
                "phase": "post",
                "status_detail": "Final",
                "stadium": "Hard Rock Stadium",
                "kickoff_at": "2026-09-14T18:00:00.000Z",
            }
        ]
        stub = _stub_nflmeta_module(live_data=games)
        with patch.dict("os.environ", {"X-NFLMeta-Key": "test-key"}):
            with patch.dict(sys.modules, {"nflmeta": stub}):
                result = nflmeta_api.fetch_live_scores()
        self.assertIn("Buffalo Bills", result)
        self.assertIn("Miami Dolphins", result)
        self.assertIn("Final", result)
        self.assertIn("27-20", result)
        self.assertIn("Hard Rock Stadium", result)

    def test_live_scores_formats_scheduled_game(self):
        import nflmeta_api  # noqa: PLC0415

        games = [
            {
                "away_team": {"abbr": "KC", "name": "Kansas City Chiefs", "score": None},
                "home_team": {"abbr": "DEN", "name": "Denver Broncos", "score": None},
                "completed": False,
                "phase": "pre",
                "status_detail": "Scheduled",
                "stadium": "Empower Field",
                "kickoff_at": "2026-09-21T20:00:00.000Z",
            }
        ]
        stub = _stub_nflmeta_module(live_data=games)
        with patch.dict("os.environ", {"X-NFLMeta-Key": "test-key"}):
            with patch.dict(sys.modules, {"nflmeta": stub}):
                result = nflmeta_api.fetch_live_scores()
        self.assertIn("Kansas City Chiefs", result)
        self.assertIn("Scheduled", result)
        self.assertIn("TBD", result)

    def test_live_scores_sdk_error_returns_labeled_message(self):
        import nflmeta_api  # noqa: PLC0415

        stub = _stub_nflmeta_module()
        stub.NFLMetaClient.return_value.live_scores.get.side_effect = Exception("network error")
        with patch.dict("os.environ", {"X-NFLMeta-Key": "test-key"}):
            with patch.dict(sys.modules, {"nflmeta": stub}):
                result = nflmeta_api.fetch_live_scores()
        self.assertIn("failed", result.lower())
        self.assertIn("network error", result)

    # -----------------------------------------------------------------------
    # fetch_standings
    # -----------------------------------------------------------------------

    def test_standings_no_key_returns_labeled_message(self):
        import nflmeta_api  # noqa: PLC0415

        with patch.dict("os.environ", {"X-NFLMeta-Key": ""}):
            result = nflmeta_api.fetch_standings(2026)
        self.assertIn("unavailable", result.lower())

    def test_standings_formats_rows(self):
        import nflmeta_api  # noqa: PLC0415

        rows = [
            {"team": "Buffalo Bills", "wins": 2, "losses": 0, "division": "AFC East", "win_pct": 1.0},
            {"team": "New England Patriots", "wins": 0, "losses": 2, "division": "AFC East", "win_pct": 0.0},
        ]
        stub = _stub_nflmeta_module(standings_data=rows)
        with patch.dict("os.environ", {"X-NFLMeta-Key": "test-key"}):
            with patch.dict(sys.modules, {"nflmeta": stub}):
                result = nflmeta_api.fetch_standings(season=2026)
        self.assertIn("Buffalo Bills", result)
        self.assertIn("2-0", result)
        self.assertIn("New England Patriots", result)
        self.assertIn("0-2", result)
        self.assertIn("AFC East", result)

    def test_standings_empty_returns_labeled_message(self):
        import nflmeta_api  # noqa: PLC0415

        stub = _stub_nflmeta_module(standings_data=[])
        with patch.dict("os.environ", {"X-NFLMeta-Key": "test-key"}):
            with patch.dict(sys.modules, {"nflmeta": stub}):
                result = nflmeta_api.fetch_standings(season=2026)
        self.assertIn("no data", result.lower())

    # -----------------------------------------------------------------------
    # fetch_team_games
    # -----------------------------------------------------------------------

    def test_team_games_no_key_returns_labeled_message(self):
        import nflmeta_api  # noqa: PLC0415

        with patch.dict("os.environ", {"X-NFLMeta-Key": ""}):
            result = nflmeta_api.fetch_team_games("BUF")
        self.assertIn("unavailable", result.lower())

    def test_team_games_missing_abbr_returns_error(self):
        import nflmeta_api  # noqa: PLC0415

        with patch.dict("os.environ", {"X-NFLMeta-Key": "test-key"}):
            result = nflmeta_api.fetch_team_games("")
        self.assertIn("required", result.lower())

    def test_team_games_formats_results(self):
        import nflmeta_api  # noqa: PLC0415

        games = [
            {
                "awayName": "New York Jets",
                "homeName": "Buffalo Bills",
                "gameDate": "2026-09-14",
                "awayScore": 17,
                "homeScore": 30,
                "stadium": "Highmark Stadium",
                "week": 1,
                "seasonYear": 2026,
            }
        ]
        stub = _stub_nflmeta_module(games_data=games)
        with patch.dict("os.environ", {"X-NFLMeta-Key": "test-key"}):
            with patch.dict(sys.modules, {"nflmeta": stub}):
                result = nflmeta_api.fetch_team_games("BUF", season=2026)
        self.assertIn("New York Jets", result)
        self.assertIn("Buffalo Bills", result)
        self.assertIn("Final", result)
        self.assertIn("17-30", result)
        self.assertIn("Highmark Stadium", result)

    def test_team_games_empty_returns_labeled_message(self):
        import nflmeta_api  # noqa: PLC0415

        stub = _stub_nflmeta_module(games_data=[])
        with patch.dict("os.environ", {"X-NFLMeta-Key": "test-key"}):
            with patch.dict(sys.modules, {"nflmeta": stub}):
                result = nflmeta_api.fetch_team_games("BUF", season=2026)
        self.assertIn("no games found", result.lower())

    # -----------------------------------------------------------------------
    # fetch_schedule
    # -----------------------------------------------------------------------

    def test_schedule_no_key_returns_labeled_message(self):
        import nflmeta_api  # noqa: PLC0415

        with patch.dict("os.environ", {"X-NFLMeta-Key": ""}):
            result = nflmeta_api.fetch_schedule(2026, week=1)
        self.assertIn("unavailable", result.lower())

    def test_schedule_formats_games(self):
        import nflmeta_api  # noqa: PLC0415

        games = [
            {
                "away_team": "Philadelphia Eagles",
                "home_team": "Dallas Cowboys",
                "date": "2026-09-14",
                "status": "scheduled",
                "venue": "AT&T Stadium",
            }
        ]
        stub = _stub_nflmeta_module(games_data=games)
        with patch.dict("os.environ", {"X-NFLMeta-Key": "test-key"}):
            with patch.dict(sys.modules, {"nflmeta": stub}):
                result = nflmeta_api.fetch_schedule(season=2026, week=1)
        self.assertIn("Philadelphia Eagles", result)
        self.assertIn("Dallas Cowboys", result)
        self.assertIn("Scheduled", result)
        self.assertIn("AT&T Stadium", result)

    def test_schedule_empty_returns_labeled_message(self):
        import nflmeta_api  # noqa: PLC0415

        stub = _stub_nflmeta_module(games_data=[])
        with patch.dict("os.environ", {"X-NFLMeta-Key": "test-key"}):
            with patch.dict(sys.modules, {"nflmeta": stub}):
                result = nflmeta_api.fetch_schedule(season=2026, week=1)
        self.assertIn("no games found", result.lower())

    # -----------------------------------------------------------------------
    # fetch_injuries
    # -----------------------------------------------------------------------

    def test_injuries_no_key_returns_labeled_message(self):
        import nflmeta_api  # noqa: PLC0415

        with patch.dict("os.environ", {"X-NFLMeta-Key": ""}):
            result = nflmeta_api.fetch_injuries(2026, week=1)
        self.assertIn("unavailable", result.lower())

    def test_injuries_formats_entries_all_teams(self):
        import nflmeta_api  # noqa: PLC0415

        entries = [
            {
                "player": "Josh Allen",
                "team": "BUF",
                "position": "QB",
                "designation": "Questionable",
                "injury": "Shoulder",
            },
            {
                "player": "Stefon Diggs",
                "team": "BUF",
                "position": "WR",
                "designation": "Out",
                "injury": "Knee",
            },
        ]
        stub = _stub_nflmeta_module(injuries_data=entries)
        with patch.dict("os.environ", {"X-NFLMeta-Key": "test-key"}):
            with patch.dict(sys.modules, {"nflmeta": stub}):
                result = nflmeta_api.fetch_injuries(season=2026, week=1)
        self.assertIn("Josh Allen", result)
        self.assertIn("Questionable", result)
        self.assertIn("Stefon Diggs", result)
        self.assertIn("Out", result)
        self.assertIn("Shoulder", result)

    def test_injuries_team_filter_uses_teams_endpoint(self):
        import nflmeta_api  # noqa: PLC0415

        entries = [
            {
                "player": "Tyreek Hill",
                "team": "MIA",
                "position": "WR",
                "designation": "Doubtful",
                "injury": "Ankle",
            }
        ]
        stub = _stub_nflmeta_module(injuries_data=entries)
        client = stub.NFLMetaClient.return_value
        with patch.dict("os.environ", {"X-NFLMeta-Key": "test-key"}):
            with patch.dict(sys.modules, {"nflmeta": stub}):
                result = nflmeta_api.fetch_injuries(season=2026, week=1, team_abbr="MIA")
        # teams.injuries should be called, not injuries.list
        client.teams.injuries.assert_called_once()
        self.assertIn("Tyreek Hill", result)
        self.assertIn("Doubtful", result)

    def test_injuries_empty_returns_labeled_message(self):
        import nflmeta_api  # noqa: PLC0415

        stub = _stub_nflmeta_module(injuries_data=[])
        with patch.dict("os.environ", {"X-NFLMeta-Key": "test-key"}):
            with patch.dict(sys.modules, {"nflmeta": stub}):
                result = nflmeta_api.fetch_injuries(season=2026, week=1)
        self.assertIn("no injury data found", result.lower())

    # -----------------------------------------------------------------------
    # fetch_nflmeta_snapshot
    # -----------------------------------------------------------------------

    def test_snapshot_combines_live_and_schedule(self):
        import nflmeta_api  # noqa: PLC0415

        with patch("nflmeta_api.fetch_live_scores", return_value="[live stub]"):
            with patch("nflmeta_api.fetch_schedule", return_value="[schedule stub]"):
                result = nflmeta_api.fetch_nflmeta_snapshot("2026-09-14")
        self.assertIn("NFLMeta live scores", result)
        self.assertIn("[live stub]", result)
        self.assertIn("NFLMeta season schedule", result)
        self.assertIn("[schedule stub]", result)
        self.assertIn("2026-09-14", result)

    def test_snapshot_uses_vancouver_date_when_none_given(self):
        import nflmeta_api  # noqa: PLC0415

        with patch("nflmeta_api.fetch_live_scores", return_value="ok"):
            with patch("nflmeta_api.fetch_schedule", return_value="ok"):
                result = nflmeta_api.fetch_nflmeta_snapshot()
        # Should include some date label
        self.assertIn("NFLMeta live scores", result)


if __name__ == "__main__":
    unittest.main()
