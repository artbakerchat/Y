"""Offline sports agent backed by a local, timestamped JSON dataset."""

import json
import os
import re
from datetime import date, timedelta
from pathlib import Path


DEFAULT_DATA_PATH = Path(__file__).with_name("sports_data.json")


def load_data(path=None):
    """Load local sports data; no network or model connection is used."""
    data_path = Path(path or os.getenv("SPORTS_DATA_PATH", DEFAULT_DATA_PATH))
    with data_path.open(encoding="utf-8") as stream:
        data = json.load(stream)
    if not isinstance(data, dict) or not isinstance(data.get("games"), list) or not isinstance(data.get("standings"), list):
        raise ValueError("Sports data must contain games and standings arrays")
    return data


def _team_matches(team, query):
    query = query.lower().strip()
    name = team.lower()
    query_words = set(re.findall(r"[a-z0-9]+", query))
    return query in name or any(part in name for part in query_words if len(part) > 3)


def _find_teams(data, prompt):
    return sorted({team for game in data["games"] for team in (game.get("away"), game.get("home")) if team and _team_matches(team, prompt)}, key=len, reverse=True)


def _format_game(game):
    matchup = f'{game["away"]} at {game["home"]} on {game["date"]}'
    if game.get("status") == "final":
        return f'{matchup}: {game["away"]} {game["away_score"]}, {game["home"]} {game["home_score"]}.'
    if game.get("status") == "in_progress":
        return f'{matchup}: in progress at {game.get("venue", "venue not listed")} ({game.get("away_score", "?")}-{game.get("home_score", "?")}).'
    return f'{matchup}: scheduled at {game.get("venue", "venue not listed")}.'


def _format_missing_game_date(requested_date):
    """Answer date-focused game questions without turning missing data into a fact."""
    return (
        f"The requested date is {requested_date.isoformat()}. "
        "No NFL game is listed for that date in the local dataset; this does not verify the real-world schedule."
    )


def _format_recap(data):
    sections = data.get("recaps", [])
    if not sections:
        return "No local recap data is available."
    return "\n\n".join(
        f'{section["section"]}\n' + "\n".join(f'◌ {game}' for game in section.get("games", []))
        for section in sections
    )


def _recap_team_matches(data, prompt):
    words = set(re.findall(r"[a-z0-9]+", prompt.lower()))
    teams = set()
    for section in data.get("recaps", []):
        for summary in section.get("games", []):
            matchup = summary.split(":", 1)[0]
            for side in re.split(r"\s+at\s+|,|\s+\d+\s+", matchup, flags=re.I):
                side = side.strip(" .()")
                if side and any(token in words for token in re.findall(r"[a-z0-9]+", side.lower()) if len(token) > 3):
                    teams.add(side)
    return bool(teams)


def _requested_date(prompt, data):
    """Resolve simple relative or month/day dates against the dataset date."""
    updated = data.get("updated_at", "")
    try:
        reference = date.fromisoformat(updated)
    except ValueError:
        reference = date.today()
    text = prompt.lower()
    if re.search(r"\btomorrow(?:'s|s)?\b", text):
        return reference + timedelta(days=1)
    if re.search(r"\btoday\b", text):
        return reference
    match = re.search(
        r"\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
        r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
        r"\s+(\d{1,2})(?:st|nd|rd|th)?\b",
        text,
    )
    if not match:
        return None
    month_name = match.group(0).split()[0][:3]
    month = {name: number for number, name in enumerate(
        ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"), 1
    )}[month_name]
    return date(reference.year, month, int(match.group(1)))


def answer(prompt, data=None):
    """Answer a small set of sports questions from local records."""
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("Prompt is required")
    data = data or load_data()
    text = prompt.lower()
    teams = _find_teams(data, prompt)
    league = next((name for name in ("nhl", "mls", "nba", "nfl", "wnba", "mlb") if name in text), None)

    requested_date = _requested_date(prompt, data)
    if (not requested_date and any(word in text for word in (
        "recap", "recaps", "finishers", "blowouts", "runaways", "drama",
        "touchdown", "game summary", "what happened",
    ))) or (not requested_date and _recap_team_matches(data, prompt)):
        return _format_recap(data)

    if any(word in text for word in ("standings", "table", "rank", "record")):
        rows = [row for row in data["standings"] if not league or row.get("league", "").lower() == league]
        if teams:
            rows = [row for row in rows if row.get("team") in teams]
        if not rows:
            return "No matching local standings record was found."
        rows.sort(key=lambda row: (row.get("league", ""), row.get("rank", 999)))
        return "\n".join(f'{row["league"]} #{row["rank"]} {row["team"]}: {row["points"]} points ({row["wins"]}-{row["losses"]}).' for row in rows)

    games = [game for game in data["games"] if not league or game.get("league", "").lower() == league]
    if requested_date:
        games = [game for game in games if game.get("date") == requested_date.isoformat()]
    if teams:
        games = [game for game in games if any(team in (game.get("away"), game.get("home")) for team in teams)]
    if any(word in text for word in ("score", "result", "won", "lost", "game")):
        if "next" in text or "upcoming" in text or "schedule" in text:
            games = [game for game in games if game.get("status") == "scheduled"]
        elif "score" in text or "result" in text or "won" in text or "lost" in text:
            games = [game for game in games if game.get("status") == "final"]
        if not games:
            if requested_date and re.search(r"\b(?:date|today(?:'s|s)?|tomorrow(?:'s|s)?)\b", text):
                return _format_missing_game_date(requested_date)
            return "No matching local game record was found."
        return "\n".join(_format_game(game) for game in sorted(games, key=lambda item: item["date"]))

    available = sorted({row.get("team") for row in data["standings"] if row.get("team")})
    return (
        "I can answer local scores, schedules, and standings, plus football recaps. "
        "Teams in this dataset: " + ", ".join(available) + ". "
        "The local football recap covers drama finishers, low-margin control games, "
        "runaways and blowouts, plus in-progress games."
    )


def prediction_inputs(prompt, data=None):
    """Return JSON-derived inputs for a forecast without making a prediction."""
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("Prompt is required")
    data = data or load_data()
    text = prompt.lower()
    teams = _find_teams(data, prompt)
    league = next((name for name in ("nhl", "mls", "nba", "nfl", "wnba", "mlb") if name in text), None)
    games = [game for game in data["games"] if not league or game.get("league", "").lower() == league]
    if teams:
        games = [game for game in games if any(team in (game.get("away"), game.get("home")) for team in teams)]
    standings = [row for row in data["standings"] if not league or row.get("league", "").lower() == league]
    if teams:
        standings = [row for row in standings if row.get("team") in teams]
    return {
        "source": "local_json",
        "updated_at": data.get("updated_at"),
        "matching_games": games,
        "matching_standings": standings,
        "limitation": "These are inputs only. No local prediction or outcome is asserted.",
    }


if __name__ == "__main__":
    print("Offline sports agent. Data updated:", load_data().get("updated_at", "unknown"))
    while True:
        try:
            prompt = input("sports> ").strip()
        except EOFError:
            break
        if prompt.lower() in {"quit", "exit"}:
            break
        try:
            print(answer(prompt))
        except ValueError as error:
            print(f"Error: {error}")
