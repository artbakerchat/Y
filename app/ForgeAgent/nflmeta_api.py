"""NFLMeta API integration for live NFL data.

Provides thin wrappers around the NFLMeta Python SDK for live scores,
standings, team game schedules, season schedule, and injury reports.

Auth: The SDK sends X-NFLMeta-Key automatically when api_key is provided.
Key source priority:
  1. X-NFLMeta-Key env var — direct local access.
  2. FORGE_WORKER_URL + FORGE_WORKER_TOKEN — routes through the Worker
     gateway so the key never needs to be present locally.
Base URL: https://nflmeta.org

All functions return plain text suitable for the agent's tool context.
Network failures and missing credentials are returned as labeled messages
rather than exceptions, consistent with the rest of the terminal tools.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

_API_KEY_ENV = "X-NFLMeta-Key"
_BASE_URL = "https://nflmeta.org"
_TIMEOUT = float(os.getenv("LIVE_SEARCH_TIMEOUT_SECONDS", "30"))


def _get_api_key() -> str | None:
    """Return the NFLMeta API key from the environment, or None if absent."""
    return os.getenv(_API_KEY_ENV, "").strip() or None


def _worker_get(path: str, query: dict | None = None):
    """Call the Worker's NFLMeta gateway and return the parsed response data.

    Used when X-NFLMeta-Key is absent but FORGE_WORKER_URL + FORGE_WORKER_TOKEN
    are configured. The Worker holds the NFLMETA_API_KEY secret server-side.

    Returns the parsed data value on success, or raises RuntimeError on failure.
    """
    worker_url = os.getenv("FORGE_WORKER_URL", "").strip().rstrip("/")
    worker_token = os.getenv("FORGE_WORKER_TOKEN", "").strip()
    if not worker_url or not worker_token:
        raise RuntimeError(
            "NFLMeta API key is not configured and no Worker gateway is available. "
            "Set X-NFLMeta-Key, or set FORGE_WORKER_URL and FORGE_WORKER_TOKEN."
        )
    payload = json.dumps({"path": path, "query": query or {}}).encode("utf-8")
    req = urllib.request.Request(
        f"{worker_url}/api/sports/nflmeta",
        data=payload,
        headers={
            "accept": "application/json",
            "content-type": "application/json",
            "user-agent": "ForgeAgent/1.0 (+https://larboard.ca)",
            "x-forge-worker-token": worker_token,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as response:
            envelope = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")[:200]
        raise RuntimeError(f"Worker NFLMeta gateway failed ({err.code}): {detail}") from err
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        raise RuntimeError(f"Worker NFLMeta gateway failed: {type(err).__name__}: {err}") from err
    if not envelope.get("ok"):
        raise RuntimeError(
            f"Worker NFLMeta gateway returned status {envelope.get('status')}: "
            f"{envelope.get('error', 'unknown error')}"
        )
    return envelope.get("data")


def _client():
    """Return an initialized NFLMetaClient, or raise RuntimeError if unconfigured."""
    from nflmeta import NFLMetaClient  # noqa: PLC0415

    key = _get_api_key()
    if not key:
        raise RuntimeError(
            f"NFLMeta API key is not configured. "
            f"Set {_API_KEY_ENV} in your environment or .env file."
        )
    return NFLMetaClient(api_key=key, base_url=_BASE_URL, timeout=_TIMEOUT)


def _api_get(path: str, query: dict | None = None):
    """Fetch a NFLMeta API path, using local SDK or Worker gateway as available.

    Returns the parsed data value from the response envelope.
    Raises RuntimeError when neither a local key nor a Worker gateway is configured.
    """
    if _get_api_key():
        nfl = _client()
        response = nfl.get(path, query=query or {})
        return response.data if hasattr(response, "data") else response
    # No local key — proxy through the Worker.
    return _worker_get(path, query)


def _safe_list(value) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        # Some responses wrap arrays in {"data": [...]}
        for key in ("data", "games", "injuries", "teams", "standings"):
            if isinstance(value.get(key), list):
                return value[key]
    return []


def _unconfigured_message() -> str | None:
    """Return a labeled error string if neither local key nor Worker gateway is set, else None."""
    if _get_api_key():
        return None
    if os.getenv("FORGE_WORKER_URL", "").strip() and os.getenv("FORGE_WORKER_TOKEN", "").strip():
        return None
    return (
        "NFLMeta is not configured. "
        f"Set {_API_KEY_ENV} for direct access, or set FORGE_WORKER_URL and "
        "FORGE_WORKER_TOKEN to route through the Worker gateway."
    )


# ---------------------------------------------------------------------------
# Live scores
# ---------------------------------------------------------------------------

def fetch_live_scores() -> str:
    """Fetch best-effort live NFL scores from NFLMeta.

    Uses a local X-NFLMeta-Key if present, otherwise routes through the
    Worker gateway. Returns a labeled error when neither is configured.
    """
    msg = _unconfigured_message()
    if msg:
        return f"NFLMeta live scores unavailable: {msg}"
    try:
        if _get_api_key():
            nfl = _client()
            response = nfl.live_scores.get()
            games = _safe_list(response.data if hasattr(response, "data") else response)
        else:
            games = _safe_list(_worker_get("/api/v1/live-scores"))

        if not games:
            return "NFLMeta live scores: no games in the current feed."

        lines = ["NFLMeta live scores:"]
        for game in games:
            # away_team and home_team are objects: {"abbr": ..., "name": ..., "score": ...}
            away_obj = game.get("away_team") or {}
            home_obj = game.get("home_team") or {}
            if isinstance(away_obj, dict):
                away = away_obj.get("name") or away_obj.get("abbr") or "Away"
                away_score = away_obj.get("score")
            else:
                away = str(away_obj)
                away_score = game.get("away_score")
            if isinstance(home_obj, dict):
                home = home_obj.get("name") or home_obj.get("abbr") or "Home"
                home_score = home_obj.get("score")
            else:
                home = str(home_obj)
                home_score = game.get("home_score")

            # Determine status from phase/completed/status_detail
            status_detail = str(game.get("status_detail") or "").lower()
            phase = str(game.get("phase") or "").lower()
            completed = game.get("completed")
            if completed or "final" in status_detail or phase == "post":
                status = "Final"
            elif phase in {"in", "live", "active"} or "progress" in status_detail:
                status = "In Progress"
            else:
                status = "Scheduled"

            score_str = (
                f"{away_score}-{home_score}"
                if away_score is not None and home_score is not None
                else "TBD"
            )
            venue = game.get("venue") or game.get("stadium") or "venue not listed"
            date_val = (game.get("kickoff_at") or game.get("date") or game.get("game_date") or "")[:10]
            lines.append(
                f"- {away} at {home}"
                + (f" on {date_val}" if date_val else "")
                + f"; status: {status}; score: {score_str}; venue: {venue}."
            )
        return "\n".join(lines)
    except RuntimeError as err:
        return f"NFLMeta live scores unavailable: {err}"
    except Exception as err:  # noqa: BLE001
        return f"NFLMeta live scores failed: {type(err).__name__}: {err}"


# ---------------------------------------------------------------------------
# Standings
# ---------------------------------------------------------------------------

def fetch_standings(season: int | None = None) -> str:
    """Fetch current or historical NFL standings from NFLMeta.

    Args:
        season: Season year (e.g. 2026). Defaults to the current calendar year.
    """
    msg = _unconfigured_message()
    if msg:
        return f"NFLMeta standings unavailable: {msg}"
    if season is None:
        season = datetime.now(ZoneInfo("America/Vancouver")).year
    try:
        raw = _api_get("/api/v1/standings", query={"season": season})

        # The standings response is a dict with a "grouped" key:
        # {"seasonYear": ..., "grouped": {"AFC": {"East": [...], ...}, "NFC": {...}}}
        rows: list = []
        if isinstance(raw, dict):
            grouped = raw.get("grouped") or {}
            for conference, divisions in grouped.items():
                if isinstance(divisions, dict):
                    for division, teams in divisions.items():
                        if isinstance(teams, list):
                            rows.extend(teams)
            if not rows:
                rows = _safe_list(raw)
        else:
            rows = _safe_list(raw)

        if not rows:
            return f"NFLMeta standings: no data returned for season {season}."

        rows.sort(key=lambda r: (
            r.get("conference", ""),
            r.get("division", ""),
            -(r.get("wins") or 0),
        ))

        lines = [f"NFLMeta NFL standings — season {season}:"]
        current_group = None
        for row in rows:
            conference = row.get("conference", "")
            division = row.get("division", "")
            group = f"{conference} {division}".strip()
            if group and group != current_group:
                lines.append(f"\n{group}")
                current_group = group
            team = row.get("teamName") or row.get("team") or row.get("teamAbbr") or "Unknown"
            wins = row.get("wins", "?")
            losses = row.get("losses", "?")
            ties = row.get("ties")
            record = f"{wins}-{losses}" + (f"-{ties}" if ties else "")
            pct = row.get("win_pct") or row.get("pct")
            pct_str = f" ({pct:.3f})" if isinstance(pct, (int, float)) else ""
            lines.append(f"  {team}: {record}{pct_str}")
        return "\n".join(lines)
    except RuntimeError as err:
        return f"NFLMeta standings unavailable: {err}"
    except Exception as err:  # noqa: BLE001
        return f"NFLMeta standings failed: {type(err).__name__}: {err}"


# ---------------------------------------------------------------------------
# Team games
# ---------------------------------------------------------------------------

def fetch_team_games(team_abbr: str, season: int | None = None) -> str:
    """Fetch the game schedule and results for one NFL team from NFLMeta.

    Args:
        team_abbr: Standard NFL team abbreviation, e.g. "BUF", "KC", "NE".
        season: Season year (e.g. 2026). Defaults to the current calendar year.
    """
    msg = _unconfigured_message()
    if msg:
        return f"NFLMeta team games unavailable: {msg}"
    if not team_abbr or not str(team_abbr).strip():
        return "NFLMeta team games: a team abbreviation is required."
    abbr = str(team_abbr).strip().upper()
    if season is None:
        season = datetime.now(ZoneInfo("America/Vancouver")).year
    try:
        if _get_api_key():
            nfl = _client()
            response = nfl.teams.recent_games(abbr)
            games = _safe_list(response.data if hasattr(response, "data") else response)
        else:
            # Worker gateway: use the /api/v1/games endpoint filtered by team abbreviation
            games = _safe_list(_worker_get("/api/v1/games", query={"season": season, "team": abbr}))

        if season is not None:
            games = [g for g in games if g.get("seasonYear") == season or g.get("season_year") == season]
        if not games:
            return f"NFLMeta team games: no games found for {abbr} in season {season}."

        lines = [f"NFLMeta games for {abbr} — season {season}:"]
        for game in sorted(games, key=lambda g: g.get("gameDate") or g.get("date") or ""):
            away = game.get("awayName") or game.get("away_team") or game.get("away") or "Away"
            home = game.get("homeName") or game.get("home_team") or game.get("home") or "Home"
            date_val = game.get("gameDate") or game.get("date") or game.get("game_date") or "date unknown"
            away_score = game.get("awayScore") if game.get("awayScore") is not None else game.get("away_score")
            home_score = game.get("homeScore") if game.get("homeScore") is not None else game.get("home_score")
            status = "Final" if (away_score is not None and home_score is not None) else "Scheduled"
            score_str = (
                f"{away_score}-{home_score}"
                if away_score is not None and home_score is not None
                else "TBD"
            )
            venue = game.get("stadium") or game.get("venue") or "venue not listed"
            week_num = game.get("week")
            week_str = f" (wk {week_num})" if week_num else ""
            lines.append(
                f"- {away} at {home} on {date_val}{week_str};"
                f" status: {status}; score: {score_str}; venue: {venue}."
            )
        return "\n".join(lines)
    except RuntimeError as err:
        return f"NFLMeta team games unavailable: {err}"
    except Exception as err:  # noqa: BLE001
        return f"NFLMeta team games failed: {type(err).__name__}: {err}"


# ---------------------------------------------------------------------------
# Season schedule (week-based)
# ---------------------------------------------------------------------------

def fetch_schedule(season: int | None = None, week: int | None = None) -> str:
    """Fetch the NFL schedule for a season and optional week from NFLMeta.

    Args:
        season: Season year (e.g. 2026). Defaults to the current calendar year.
        week: Week number (1–18 regular season, 19–22 playoffs). Fetches the
              full season schedule when omitted.
    """
    msg = _unconfigured_message()
    if msg:
        return f"NFLMeta schedule unavailable: {msg}"
    if season is None:
        season = datetime.now(ZoneInfo("America/Vancouver")).year
    try:
        query: dict = {"season": season}
        if week is not None:
            query["week"] = week
        games = _safe_list(_api_get("/api/v1/games", query=query))
        if not games:
            label = f"week {week} of " if week is not None else ""
            return f"NFLMeta schedule: no games found for {label}season {season}."

        week_label = f" week {week}" if week is not None else ""
        lines = [f"NFLMeta NFL schedule — season {season}{week_label}:"]
        for game in games:
            away = game.get("awayName") or game.get("away_team") or game.get("away") or "Away"
            home = game.get("homeName") or game.get("home_team") or game.get("home") or "Home"
            date_val = (
                game.get("gameDate") or game.get("date") or game.get("game_date") or "date unknown"
            )
            away_score = game.get("awayScore") if game.get("awayScore") is not None else game.get("away_score")
            home_score = game.get("homeScore") if game.get("homeScore") is not None else game.get("home_score")
            status = "Final" if (away_score is not None and home_score is not None) else "Scheduled"
            score_str = (
                f"{away_score}-{home_score}"
                if away_score is not None and home_score is not None
                else "TBD"
            )
            venue = game.get("stadium") or game.get("venue") or "venue not listed"
            week_num = game.get("week")
            week_str = f" (wk {week_num})" if week_num and not week else ""
            lines.append(
                f"- {away} at {home} on {date_val}{week_str};"
                f" status: {status}; score: {score_str}; venue: {venue}."
            )
        return "\n".join(lines)
    except RuntimeError as err:
        return f"NFLMeta schedule unavailable: {err}"
    except Exception as err:  # noqa: BLE001
        return f"NFLMeta schedule failed: {type(err).__name__}: {err}"


# ---------------------------------------------------------------------------
# Injuries
# ---------------------------------------------------------------------------

def fetch_injuries(season: int | None = None, week: int | None = None, team_abbr: str | None = None) -> str:
    """Fetch NFL injury reports from NFLMeta.

    Args:
        season: Season year (e.g. 2026). Defaults to the current calendar year.
        week: Reporting week (e.g. 1). Defaults to None (latest available).
        team_abbr: Optional team abbreviation to filter by, e.g. "BUF".
    """
    msg = _unconfigured_message()
    if msg:
        return f"NFLMeta injuries unavailable: {msg}"
    if season is None:
        season = datetime.now(ZoneInfo("America/Vancouver")).year
    try:
        if _get_api_key():
            nfl = _client()
            if team_abbr:
                abbr = str(team_abbr).strip().upper()
                response = nfl.teams.injuries(abbr, season=season, **({"week": week} if week is not None else {}))
            else:
                response = nfl.injuries.list(season=season, **({"week": week} if week is not None else {}))
            entries = _safe_list(response.data if hasattr(response, "data") else response)
        else:
            query: dict = {"season": season}
            if week is not None:
                query["week"] = week
            if team_abbr:
                query["team"] = str(team_abbr).strip().upper()
            entries = _safe_list(_worker_get("/api/v1/injuries", query=query))

        if not entries:
            label_parts = [f"season {season}"]
            if week is not None:
                label_parts.append(f"week {week}")
            if team_abbr:
                label_parts.append(team_abbr.upper())
            return f"NFLMeta injuries: no injury data found for {', '.join(label_parts)}."

        team_label = f" — {team_abbr.upper()}" if team_abbr else ""
        week_label = f" week {week}" if week is not None else ""
        lines = [f"NFLMeta injury report — season {season}{week_label}{team_label}:"]
        for entry in entries:
            player = (
                entry.get("player")
                or entry.get("display_name")
                or entry.get("full_name")
                or "Unknown player"
            )
            team = entry.get("team") or entry.get("team_abbr") or ""
            position = entry.get("position") or entry.get("pos") or ""
            designation = (
                entry.get("designation")
                or entry.get("game_status")
                or entry.get("report_status")
                or "unknown"
            )
            injury = entry.get("injury") or entry.get("injury_type") or entry.get("body_part") or ""
            meta = []
            if team:
                meta.append(team)
            if position:
                meta.append(position)
            if injury:
                meta.append(injury)
            meta_str = " · ".join(meta)
            lines.append(
                f"- {player}"
                + (f" ({meta_str})" if meta_str else "")
                + f": {designation}"
            )
        return "\n".join(lines)
    except RuntimeError as err:
        return f"NFLMeta injuries unavailable: {err}"
    except Exception as err:  # noqa: BLE001
        return f"NFLMeta injuries failed: {type(err).__name__}: {err}"


# ---------------------------------------------------------------------------
# Composite: full NFL workflow snapshot
# ---------------------------------------------------------------------------

def fetch_nflmeta_snapshot(game_date: str | None = None) -> str:
    """Fetch a combined live-scores-and-schedule snapshot from NFLMeta.

    Combines live scores and the current season schedule. Used as a primary
    data source in the nfl_workflow tool. Falls back gracefully when neither
    a local key nor a Worker gateway is configured.

    Args:
        game_date: ISO date string (YYYY-MM-DD), used only for context labeling.
    """
    date_label = game_date or datetime.now(ZoneInfo("America/Vancouver")).date().isoformat()
    live = fetch_live_scores()
    season = datetime.now(ZoneInfo("America/Vancouver")).year
    schedule = fetch_schedule(season=season)

    return (
        f"[NFLMeta live scores — {date_label}]\n"
        f"{live}\n\n"
        f"[NFLMeta season schedule — {season}]\n"
        f"{schedule}"
    )
