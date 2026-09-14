"""Repository inspection, editing, and local sports tools for the terminal agent."""

import os
import json
import re
import urllib.error
import urllib.request
from contextvars import ContextVar
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from strands import tool

from sports_agent import answer as answer_sports
from sports_agent import prediction_inputs
from conversation_policy import with_conversation_policy


_SKIP_DIRS = {".git", ".venv", "node_modules", "__pycache__", ".data", "dist"}
_SEARCH_TIMEOUT_SECONDS = float(os.getenv("LIVE_SEARCH_TIMEOUT_SECONDS", "30"))
_NFL_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
_PLAY_BY_PLAY_REQUEST = ContextVar("play_by_play_request", default=False)
_WORKER_HEADERS = {
    "accept": "application/json",
    "content-type": "application/json",
    "user-agent": "ForgeAgent/1.0 (+https://larboard.ca)",
}


def local_live_search_configured() -> bool:
    """Return whether local .env/provider credentials are available."""
    return bool(os.getenv("OPENAI_API_KEY", "").strip() or os.getenv("GEMINI_API_KEY", "").strip())


def search_live_web_via_worker(query: str) -> str | None:
    """Ask the Cloudflare Worker to perform both provider searches server-side."""
    worker_url = os.getenv("FORGE_WORKER_URL", "").strip().rstrip("/")
    worker_token = os.getenv("FORGE_WORKER_TOKEN", "").strip()
    if not worker_url or not worker_token:
        return None
    request = urllib.request.Request(
        f"{worker_url}/api/sports/evidence",
        data=json.dumps({"query": query.strip()[:4000]}).encode("utf-8"),
        headers={**_WORKER_HEADERS, "x-forge-worker-token": worker_token},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=_SEARCH_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return str(payload.get("evidence", "Worker returned no live evidence."))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
        return f"Cloudflare Worker sports search failed: {type(error).__name__}: {error}"


def _fetch_nfl_scoreboard_payload(game_date: str):
    """Fetch and validate one date from ESPN's public NFL scoreboard API."""
    try:
        target = date.fromisoformat(game_date)
    except ValueError:
        return None, None, "NFL scoreboard API unavailable: invalid date."
    query_date = target.strftime("%Y%m%d")
    request = urllib.request.Request(
        f"{_NFL_SCOREBOARD_URL}?dates={query_date}",
        headers={"accept": "application/json", "user-agent": "ForgeAgent/1.0 (+https://larboard.ca)"},
    )
    try:
        with urllib.request.urlopen(request, timeout=_SEARCH_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
        return target, None, f"NFL scoreboard API failed: {type(error).__name__}: {error}"
    if not isinstance(payload, dict):
        return target, None, "NFL scoreboard API failed: response was not an object."
    return target, payload, None


def _nfl_api_games(target, payload):
    """Convert ESPN scoreboard events to the repository's local game shape."""
    games = []
    for event in payload.get("events", []):
        competitions = event.get("competitions") or []
        competition = competitions[0] if competitions else {}
        competitors = competition.get("competitors") or []
        by_side = {item.get("homeAway"): item for item in competitors}
        away = by_side.get("away", {})
        home = by_side.get("home", {})
        if not away.get("team", {}).get("displayName") or not home.get("team", {}).get("displayName"):
            continue
        status_type = (competition.get("status") or event.get("status") or {}).get("type", {})
        status_name = str(status_type.get("name") or status_type.get("description", "scheduled")).lower()
        status = "final" if status_name in {"status_final", "final"} else "in_progress" if "progress" in status_name or status_name in {"in", "live"} else "scheduled"
        link_items = event.get("links") or []
        source_url = link_items[0].get("href", "") if link_items else ""
        game = {
            "league": "NFL",
            "date": target.isoformat(),
            "away": away["team"]["displayName"],
            "home": home["team"]["displayName"],
            "status": status,
            "venue": (competition.get("venue") or {}).get("fullName", "venue not listed"),
            "source_urls": [source_url] if source_url.startswith(("https://", "http://")) else [],
        }
        if status in {"final", "in_progress"}:
            try:
                game["away_score"] = int(away.get("score", 0))
                game["home_score"] = int(home.get("score", 0))
            except (TypeError, ValueError):
                pass
        games.append(game)
    return games


def fetch_nfl_scoreboard(game_date: str) -> str:
    """Fetch the NFL scoreboard from ESPN's public schedule API.

    This is deliberately independent of the local JSON snapshot and provider
    search credentials, so a stale local dataset cannot suppress a current
    schedule lookup.
    """
    target, payload, error = _fetch_nfl_scoreboard_payload(game_date)
    if error:
        return error
    games = _nfl_api_games(target, payload)
    if not games:
        return f"ESPN NFL scoreboard API: no games returned for {target.isoformat()}."
    lines = [f"ESPN NFL scoreboard API for {target.isoformat()}:"]
    for game in games:
        status = game["status"].replace("_", " ").title()
        scores = f"{game.get('away_score', '?')}-{game.get('home_score', '?')}"
        lines.append(
            f"- {game['away']} at {game['home']}; status: {status}; score: {scores}; venue: {game['venue']}."
        )
    return "\n".join(lines)


def sync_nfl_schedule_json(game_date: str, repository: Path | None = None) -> str:
    """Merge one API-backed NFL date into the local sports JSON.

    Existing final records are preserved. Scheduled or in-progress records for
    the same matchup are refreshed, and new API games are appended.
    """
    target, payload, error = _fetch_nfl_scoreboard_payload(game_date)
    if error:
        return error
    api_games = _nfl_api_games(target, payload)
    data_path = (repository or Path(__file__).resolve().parent) / "sports_data.json"
    try:
        data = json.loads(data_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as read_error:
        return f"Local sports JSON update failed: {type(read_error).__name__}: {read_error}"
    if not isinstance(data, dict) or not isinstance(data.get("games"), list):
        return "Local sports JSON update failed: games array is missing."
    changed = 0
    added = 0
    for api_game in api_games:
        match = next((item for item in data["games"] if item.get("league") == "NFL" and item.get("date") == api_game["date"] and item.get("away") == api_game["away"] and item.get("home") == api_game["home"]), None)
        if match is None:
            data["games"].append(api_game)
            added += 1
        elif match.get("status") != "final":
            match.update(api_game)
            changed += 1
    data["updated_at"] = target.isoformat()
    data_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return f"Updated {data_path.name}: {added} NFL game(s) added and {changed} non-final game(s) refreshed for {target.isoformat()}. Existing final records were preserved."


def worker_agent_request(prompt: str, agent_id: str = "forge", session_id: str = "local-terminal") -> str:
    """Send a complete local-agent turn through the authenticated Worker gateway."""
    worker_url = os.getenv("FORGE_WORKER_URL", "").strip().rstrip("/")
    worker_token = os.getenv("FORGE_WORKER_TOKEN", "").strip()
    if not worker_url or not worker_token:
        raise RuntimeError("FORGE_WORKER_URL and FORGE_WORKER_TOKEN are required for Worker-backed mode")
    request = urllib.request.Request(
        f"{worker_url}/api/agent-gateway",
        data=json.dumps({"prompt": prompt.strip()[:4000], "agent": agent_id, "session_id": session_id}).encode("utf-8"),
        headers={**_WORKER_HEADERS, "x-forge-worker-token": worker_token},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=100) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if not isinstance(payload.get("answer"), str):
            raise RuntimeError(payload.get("error", "Worker returned no answer"))
        return payload["answer"]
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:240]
        raise RuntimeError(f"Worker request failed ({error.code}): {detail}") from error
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
        raise RuntimeError(f"Worker request failed: {type(error).__name__}: {error}") from error


def set_play_by_play_request(prompt: str):
    """Set whether the current user request explicitly asks for play-by-play."""
    return _PLAY_BY_PLAY_REQUEST.set(bool(re.search(
        r"\b(?:play[- ]by[- ]play|minute[- ]by[- ]minute|minute[- ]to[- ]minute)\b",
        prompt or "",
        re.IGNORECASE,
    )))


def build_repository_tools(root: Path | None = None):
    """Return repository-scoped inspection and focused editing tools."""
    repository = (root or Path.cwd()).resolve()

    def safe_path(relative_path: str) -> Path:
        candidate = (repository / relative_path).resolve()
        try:
            relative = candidate.relative_to(repository)
        except ValueError as error:
            raise ValueError("Path must stay inside the repository") from error
        if any(part in {".git", ".venv", "node_modules", ".data"} for part in relative.parts):
            raise ValueError("That repository area is protected")
        if candidate.name == ".env" or candidate.name.startswith(".env."):
            raise ValueError("Environment files are protected")
        return candidate

    def files():
        for directory, dirnames, filenames in os.walk(repository, followlinks=False):
            dirnames[:] = sorted(name for name in dirnames if name not in _SKIP_DIRS and not (Path(directory) / name).is_symlink())
            for filename in sorted(filenames):
                path = Path(directory) / filename
                if not path.is_symlink():
                    yield path

    @tool
    def find_repository_files(pattern: str = "") -> str:
        """Find repository files whose path contains the supplied case-insensitive text.

        Args:
            pattern: Optional filename or path fragment, such as "sports" or ".py".
        """
        needle = pattern.strip().lower()
        matches = [str(path.relative_to(repository)) for path in files() if not needle or needle in str(path.relative_to(repository)).lower()]
        if not matches:
            return f'No repository files match "{pattern}".'
        shown = matches[:100]
        suffix = f"\nShowing first 100 of {len(matches)} matches." if len(matches) > 100 else ""
        return "\n".join(shown) + suffix

    @tool
    def search_repository(query: str, max_results: int = 20) -> str:
        """Search text files in the repository for a case-insensitive string.

        Args:
            query: Text to search for, such as a function or filename.
            max_results: Maximum matching files to return, from 1 to 50.
        """
        needle = query.strip().lower()
        if not needle:
            return "A non-empty search query is required."
        limit = max(1, min(int(max_results), 50))
        results = []
        for path in files():
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            for number, line in enumerate(text.splitlines(), 1):
                if needle in line.lower():
                    results.append(f"{path.relative_to(repository)}:{number}: {line.strip()[:240]}")
                    break
            if len(results) >= limit:
                break
        return "\n".join(results) if results else f'No text matches "{query}".'

    @tool
    def read_repository_file(path: str) -> str:
        """Read a source file from the repository.

        Args:
            path: Repository-relative path, such as app/ForgeAgent/sports_agent.py.
        """
        target = safe_path(path)
        if not target.is_file():
            return f"File not found: {path}"
        if target.stat().st_size > 500_000:
            return "File is too large to read through this tool."
        return target.read_text(encoding="utf-8")

    @tool
    def replace_repository_text(path: str, old_text: str, new_text: str) -> str:
        """Replace one exact piece of text in a repository source file.

        The replacement must match exactly once, preventing accidental broad edits.
        Args:
            path: Repository-relative path to edit.
            old_text: Existing exact text to replace.
            new_text: Replacement text.
        """
        target = safe_path(path)
        if not target.is_file():
            return f"File not found: {path}"
        content = target.read_text(encoding="utf-8")
        occurrences = content.count(old_text)
        if occurrences != 1:
            return f"Edit not applied: expected one exact match, found {occurrences}."
        target.write_text(content.replace(old_text, new_text), encoding="utf-8")
        return f"Updated {target.relative_to(repository)}."

    @tool
    def local_sports_lookup(prompt: str) -> str:
        """Answer a sports question strictly from the local JSON dataset.

        No web access or model inference is used. If the dataset has no matching
        record, the tool says so rather than guessing.
        Args:
            prompt: The user's sports question.
        """
        result = answer_sports(prompt)
        if result.startswith("No matching local game record"):
            return result + " This only means the local JSON dataset has no matching record; it does not establish that no game occurred."
        return result

    @tool
    def live_web_search_openai(query: str) -> str:
        """Search the live web through OpenAI and return its answer and sources."""
        return search_live_web_openai(query)

    @tool
    def live_web_search_gemini(query: str) -> str:
        """Search the live web through Gemini Google Search grounding."""
        return search_live_web_gemini(query)

    @tool
    def sports_prediction(query: str) -> str:
        """Gather local JSON and live-web evidence for a clearly labeled sports forecast.

        This tool does not assert a future result. The caller must use the local JSON
        inputs first, treat web results as supplemental, and label any forecast and
        uncertainty explicitly.
        Args:
            query: Sports prediction request, including league/team and date if known.
        """
        return build_prediction_evidence(query)

    @tool
    def nfl_results_evidence(game_date: str) -> str:
        """Gather live evidence for completed NFL games on an ISO date.

        Use this before writing a dated result file. It does not create records
        and does not decide whether a game is final.
        Args:
            game_date: Date in YYYY-MM-DD format, for example 2026-09-14.
        """
        return build_nfl_results_evidence(game_date)

    @tool
    def nfl_workflow(start_date: str = "") -> str:
        """Track the NFL schedule, live games, and completed results from a date onward.

        This fetches the public NFL scoreboard API plus OpenAI/Gemini web
        evidence. It also merges the requested date's API schedule into the
        local sports_data.json, preserving existing final records.
        Args:
            start_date: Optional ISO date; defaults to today's America/Vancouver date.
        """
        evidence = build_nfl_workflow_evidence(start_date)
        target = start_date or datetime.now(ZoneInfo("America/Vancouver")).date().isoformat()
        return f"{evidence}\n\nLOCAL JSON ADJUSTMENT\n{sync_nfl_schedule_json(target)}"

    @tool
    def write_nfl_results_json(game_date: str, records_json: str) -> str:
        """Write verified completed NFL game records to a new dated JSON file.

        The records_json object must contain a games array. Every game must be
        final, have integer scores, prediction and actual fields, source URLs,
        and an uncertainty field. Existing dated files are never overwritten.
        Args:
            game_date: Date in YYYY-MM-DD format.
            records_json: JSON object containing the completed game records.
        """
        return write_nfl_results_file(repository, game_date, records_json)

    @tool
    def write_nfl_prediction_json(game_date: str, records_json: str, schedule_evidence: str) -> str:
        """Write forecast records for scheduled NFL games to a new dated JSON file.

        The records_json object must contain a games array. Every game must be a
        scheduled NFL game explicitly present in schedule_evidence, with a
        prediction, source URLs, and an uncertainty note. Call nfl_workflow first.
        This is separate from completed-game result storage and never overwrites an
        existing prediction file.
        Args:
            game_date: Date in YYYY-MM-DD format.
            records_json: JSON object containing the forecast game records.
            schedule_evidence: The unmodified output from nfl_workflow for this date.
        """
        return write_nfl_prediction_file(repository, game_date, records_json, schedule_evidence)

    @tool
    def write_game_play_by_play_json(game_date: str, away: str, home: str, records_json: str) -> str:
        """Write a separately requested game's verified play-by-play to its own JSON file.

        This tool is available only when the user explicitly requested play-by-play
        or minute-by-minute commentary in the current prompt. The records_json
        object must contain an events array; each event needs a minute, category,
        and evidence-based description. Do not infer events absent from sources.
        Args:
            game_date: Game date in YYYY-MM-DD format.
            away: Away team name.
            home: Home team name.
            records_json: JSON object containing the play-by-play events.
        """
        if not _PLAY_BY_PLAY_REQUEST.get():
            return "Write rejected: play-by-play files require an explicit user request in the current prompt."
        return write_game_play_by_play_file(repository, game_date, away, home, records_json)

    return [
        find_repository_files,
        search_repository,
        read_repository_file,
        replace_repository_text,
        local_sports_lookup,
        live_web_search_openai,
        live_web_search_gemini,
        sports_prediction,
        nfl_results_evidence,
        nfl_workflow,
        write_nfl_results_json,
        write_nfl_prediction_json,
        write_game_play_by_play_json,
    ]


def search_live_web_openai(query: str) -> str:
    """Perform an OpenAI web lookup outside the model's optional tool loop."""
    if not os.getenv("OPENAI_API_KEY"):
        if not local_live_search_configured():
            worker_result = search_live_web_via_worker(query)
            if worker_result is not None:
                return worker_result
        return "OpenAI web search is not configured (OPENAI_API_KEY is missing)."
    try:
        from openai import OpenAI

        response = OpenAI(timeout=_SEARCH_TIMEOUT_SECONDS, max_retries=0).responses.create(
            model=os.getenv("OPENAI_SEARCH_MODEL", "gpt-4.1-mini"),
            instructions=with_conversation_policy(
                "Use web search to answer the user's query with current, verifiable information. "
                "Distinguish evidence from uncertainty and include useful source links."
            ),
            input=query.strip()[:4000],
            tools=[{"type": "web_search_preview"}],
        )
        return _with_source_note(response.output_text, _openai_sources(response))
    except Exception as error:
        return f"OpenAI web search failed: {type(error).__name__}: {error}"


def search_live_web_gemini(query: str) -> str:
    """Perform a Gemini Google Search lookup outside the model's optional tool loop."""
    if not os.getenv("GEMINI_API_KEY"):
        if not local_live_search_configured():
            worker_result = search_live_web_via_worker(query)
            if worker_result is not None:
                return worker_result
        return "Gemini web search is not configured (GEMINI_API_KEY is missing)."
    try:
        from google import genai

        client = genai.Client(
            api_key=os.environ["GEMINI_API_KEY"],
            http_options={"timeout": int(_SEARCH_TIMEOUT_SECONDS * 1000)},
        )
        response = client.interactions.create(
            model=os.getenv("GEMINI_SEARCH_MODEL", "gemini-3.6-flash"),
            system_instruction=with_conversation_policy(
                "Use Google Search grounding to answer the user's query with current, "
                "verifiable information. Distinguish evidence from uncertainty and "
                "include useful source links."
            ),
            input=query.strip()[:4000],
            tools=[{"type": "google_search"}],
        )
        return _with_source_note(response.output_text or "Gemini returned no text.", _gemini_sources(response))
    except Exception as error:
        return f"Gemini web search failed: {type(error).__name__}: {error}"


def build_prediction_evidence(query: str) -> str:
    """Combine local prediction inputs with supplemental live provider evidence."""
    local = json.dumps(prediction_inputs(query), ensure_ascii=False, indent=2)
    live = None if local_live_search_configured() else search_live_web_via_worker(query)
    if live is None:
        live = (
            f"[OpenAI live web search — supplemental]\n{search_live_web_openai(query)}\n\n"
            f"[Gemini Google Search — supplemental]\n{search_live_web_gemini(query)}"
        )
    return (
        "PREDICTION INPUTS — NOT A VERIFIED OUTCOME\n"
        "[Local JSON — priority source]\n"
        f"{local}\n\n"
        f"[OpenAI and Gemini live web search — supplemental]\n{live}\n\n"
        "Any conclusion must be labeled as a forecast, include assumptions, and state uncertainty."
    )


def build_nfl_results_evidence(game_date: str) -> str:
    """Collect the live evidence Claude needs before recording NFL results."""
    try:
        target = date.fromisoformat(game_date)
    except ValueError:
        return "Invalid date. Use YYYY-MM-DD."
    query = (
        f"NFL games on {target.isoformat()}: final scores, game status, venue, "
        "and live game commentary. Include official or reputable source URLs. "
        "Do not report scheduled games as final."
    )
    return (
        "RESULT CAPTURE EVIDENCE — NOT YET A JSON RECORD\n"
        "Use only facts corroborated by the live sources below.\n\n"
        "[OpenAI live web search]\n"
        f"{search_live_web_openai(query)}\n\n"
        "[Gemini Google Search]\n"
        f"{search_live_web_gemini(query)}\n"
    )


def write_nfl_prediction_file(repository: Path, game_date: str, records_json: str, schedule_evidence: str = "") -> str:
    """Validate and save immutable forecast records for one NFL date."""
    try:
        target_date = date.fromisoformat(game_date)
    except ValueError:
        return "Write rejected: game_date must use YYYY-MM-DD."
    try:
        payload = json.loads(records_json)
    except json.JSONDecodeError as error:
        return f"Write rejected: records_json is invalid JSON ({error.msg})."
    if not isinstance(schedule_evidence, str) or not schedule_evidence.strip():
        return "Write rejected: current NFL schedule evidence is required; call nfl_workflow first."
    evidence = " ".join(schedule_evidence.lower().split())
    no_games_markers = ("no games", "none scheduled", "no nfl games", "games_count\\\": 0")
    if any(marker in evidence for marker in no_games_markers):
        return f"Write rejected: schedule evidence reports no scheduled NFL games for {game_date}."
    if not isinstance(payload, dict) or not isinstance(payload.get("games"), list):
        return "Write rejected: JSON must be an object with a games array."
    if not payload["games"]:
        return "Write rejected: games must contain at least one NFL forecast."

    errors = []
    for index, game in enumerate(payload["games"]):
        prefix = f"games[{index}]"
        if not isinstance(game, dict):
            errors.append(f"{prefix} must be an object")
            continue
        required = ("league", "date", "away", "home", "status", "prediction", "source_urls", "uncertainty")
        missing = [field for field in required if field not in game]
        if missing:
            errors.append(f"{prefix} missing {', '.join(missing)}")
            continue
        if game["league"].upper() != "NFL" or game["status"].lower() != "scheduled":
            errors.append(f"{prefix} must be a scheduled NFL game")
        if game["date"] != target_date.isoformat():
            errors.append(f"{prefix}.date must equal {target_date.isoformat()}")
        matchup = " ".join(f"{game['away']} at {game['home']}".lower().split())
        if game["date"] not in evidence or matchup not in evidence:
            errors.append(f"{prefix} matchup is not present in the supplied current schedule evidence")
        if not isinstance(game["prediction"], dict) or not game["prediction"]:
            errors.append(f"{prefix}.prediction must be a non-empty object")
        urls = game["source_urls"]
        if not isinstance(urls, list) or not urls or any(not isinstance(url, str) or not url.startswith(("https://", "http://")) for url in urls):
            errors.append(f"{prefix}.source_urls must contain at least one HTTP(S) URL")
        if not isinstance(game["uncertainty"], str) or not game["uncertainty"].strip():
            errors.append(f"{prefix}.uncertainty must be a non-empty string")
    if errors:
        return "Write rejected:\n- " + "\n- ".join(errors)

    payload["updated_at"] = target_date.isoformat()
    payload["generated_by"] = "Claude via Strands/Bedrock"
    payload["data_contract"] = "scheduled NFL forecasts; not verified outcomes"
    destination = repository / "app" / "ForgeAgent" / f"nfl_predictions_{target_date.isoformat()}.json"
    if destination.exists():
        return f"Write rejected: {destination.relative_to(repository)} already exists; existing data was not overwritten."
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return f"Created {destination.relative_to(repository)} with {len(payload['games'])} forecast game(s)."


def write_game_play_by_play_file(repository: Path, game_date: str, away: str, home: str, records_json: str) -> str:
    """Validate and save one immutable play-by-play file for one requested game."""
    try:
        target_date = date.fromisoformat(game_date)
    except ValueError:
        return "Write rejected: game_date must use YYYY-MM-DD."
    if not away.strip() or not home.strip():
        return "Write rejected: away and home team names are required."
    try:
        payload = json.loads(records_json)
    except json.JSONDecodeError as error:
        return f"Write rejected: records_json is invalid JSON ({error.msg})."
    if not isinstance(payload, dict) or not isinstance(payload.get("events"), list):
        return "Write rejected: JSON must be an object with an events array."
    if not payload["events"]:
        return "Write rejected: events must contain at least one verified play."
    errors = []
    categories = {"attack", "chance", "save", "substitution", "foul", "momentum", "goal", "other"}
    for index, event in enumerate(payload["events"]):
        prefix = f"events[{index}]"
        if not isinstance(event, dict):
            errors.append(f"{prefix} must be an object")
            continue
        missing = [field for field in ("minute", "category", "description") if field not in event]
        if missing:
            errors.append(f"{prefix} missing {', '.join(missing)}")
            continue
        if not isinstance(event["minute"], str) or not event["minute"].strip():
            errors.append(f"{prefix}.minute must be a non-empty string")
        if event["category"] not in categories:
            errors.append(f"{prefix}.category is not supported")
        if not isinstance(event["description"], str) or not event["description"].strip():
            errors.append(f"{prefix}.description must be a non-empty string")
    if errors:
        return "Write rejected:\n- " + "\n- ".join(errors)
    payload.update({
        "league": payload.get("league", "MLS"),
        "date": target_date.isoformat(),
        "away": away,
        "home": home,
        "updated_at": target_date.isoformat(),
        "generated_by": "Claude via Strands/Bedrock",
        "data_contract": "verified play-by-play for an explicitly requested game",
    })
    slug = re.sub(r"[^a-z0-9]+", "_", f"{away}_{home}".lower()).strip("_")
    destination = repository / "app" / "ForgeAgent" / f"play_by_play_{target_date.isoformat()}_{slug}.json"
    if destination.exists():
        return f"Write rejected: {destination.relative_to(repository)} already exists; existing data was not overwritten."
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return f"Created {destination.relative_to(repository)} with {len(payload['events'])} play(s)."
def build_nfl_workflow_evidence(start_date: str = "") -> str:
    """Collect a live NFL snapshot beginning on the requested local date."""
    if not start_date:
        start_date = datetime.now(ZoneInfo("America/Vancouver")).date().isoformat()
    try:
        target = date.fromisoformat(start_date)
    except ValueError:
        return "Invalid start_date. Use YYYY-MM-DD."
    query = (
        f"Track every NFL game from {target.isoformat()} onward: upcoming schedule, games in progress, "
        "final scores, venues, and live commentary. Group all games by date. Clearly distinguish "
        "scheduled, live, and final games. Use official or reputable source URLs."
    )
    return (
        "NFL WORKFLOW SNAPSHOT — live evidence, not a final JSON record\n"
        f"Start date: {target.isoformat()}\n\n"
        "[NFL scoreboard API]\n"
        f"{fetch_nfl_scoreboard(target.isoformat())}\n\n"
        "[OpenAI live web search]\n"
        f"{search_live_web_openai(query)}\n\n"
        "[Gemini Google Search]\n"
        f"{search_live_web_gemini(query)}\n\n"
        "Only final games may be written to dated result JSON files."
    )


def write_nfl_results_file(repository: Path, game_date: str, records_json: str) -> str:
    """Validate and save one immutable, dated NFL result dataset."""
    try:
        target_date = date.fromisoformat(game_date)
    except ValueError:
        return "Write rejected: game_date must use YYYY-MM-DD."
    try:
        payload = json.loads(records_json)
    except json.JSONDecodeError as error:
        return f"Write rejected: records_json is invalid JSON ({error.msg})."
    if not isinstance(payload, dict) or not isinstance(payload.get("games"), list):
        return "Write rejected: JSON must be an object with a games array."
    if not payload["games"]:
        return "Write rejected: games must contain at least one completed NFL game."
    errors = []
    for index, game in enumerate(payload["games"]):
        prefix = f"games[{index}]"
        if not isinstance(game, dict):
            errors.append(f"{prefix} must be an object")
            continue
        required = ("league", "date", "away", "home", "status", "away_score", "home_score", "prediction", "actual", "source_urls", "uncertainty")
        missing = [field for field in required if field not in game]
        if missing:
            errors.append(f"{prefix} missing {', '.join(missing)}")
            continue
        if game["league"].upper() != "NFL" or game["status"].lower() != "final":
            errors.append(f"{prefix} must be an NFL final game")
        if game["date"] != target_date.isoformat():
            errors.append(f"{prefix}.date must equal {target_date.isoformat()}")
        if not isinstance(game["away_score"], int) or not isinstance(game["home_score"], int):
            errors.append(f"{prefix} scores must be integers")
        if not isinstance(game["prediction"], dict) or not isinstance(game["actual"], dict):
            errors.append(f"{prefix} prediction and actual must be objects")
        urls = game["source_urls"]
        if not isinstance(urls, list) or not urls or any(not isinstance(url, str) or not url.startswith(("https://", "http://")) for url in urls):
            errors.append(f"{prefix}.source_urls must contain at least one HTTP(S) URL")
        if not isinstance(game["uncertainty"], str) or not game["uncertainty"].strip():
            errors.append(f"{prefix}.uncertainty must be a non-empty string")
    if errors:
        return "Write rejected:\n- " + "\n- ".join(errors)
    payload["updated_at"] = target_date.isoformat()
    payload["generated_by"] = "Claude via Strands/Bedrock"
    payload["data_contract"] = "completed NFL results with prediction/actual provenance"
    destination = repository / "app" / "ForgeAgent" / f"sports_data_{target_date.isoformat()}.json"
    if destination.exists():
        return f"Write rejected: {destination.relative_to(repository)} already exists; existing data was not overwritten."
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return f"Created {destination.relative_to(repository)} with {len(payload['games'])} completed NFL game(s)."


def _with_source_note(answer, sources):
    if not sources:
        return answer
    return answer + "\n\nSources:\n" + "\n".join(f"- {title}: {url}" for title, url in sources)


def _openai_sources(response):
    sources = []
    for item in getattr(response, "output", []) or []:
        for content in getattr(item, "content", []) or []:
            for annotation in getattr(content, "annotations", []) or []:
                url = getattr(annotation, "url", None)
                title = getattr(annotation, "title", None) or url
                if url and (title, url) not in sources:
                    sources.append((title, url))
    return sources


def _gemini_sources(response):
    sources = []
    for step in getattr(response, "steps", []) or []:
        for content in getattr(step, "content", []) or []:
            for annotation in getattr(content, "annotations", []) or []:
                url = getattr(annotation, "url", None)
                title = getattr(annotation, "title", None) or url
                if url and (title, url) not in sources:
                    sources.append((title, url))
    candidates = getattr(response, "candidates", None) or []
    metadata = getattr(candidates[0], "grounding_metadata", None) if candidates else None
    for chunk in getattr(metadata, "grounding_chunks", []) or []:
        web = getattr(chunk, "web", None)
        url = getattr(web, "uri", None)
        title = getattr(web, "title", None) or url
        if url and (title, url) not in sources:
            sources.append((title, url))
    return sources
