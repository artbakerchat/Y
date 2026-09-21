"""Interactive Claude chat through Strands and Amazon Bedrock.

Run from the repository root with:
    .venv/bin/python app/ForgeAgent/terminal.py
"""

import argparse
import asyncio
from datetime import datetime
import json
import os
import re
import sys
import uuid
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

from strands import Agent
from strands.types.exceptions import MaxTokensReachedException

from conversation_guidance import CONVERSATION_GUIDANCE
from conversation_policy import with_conversation_policy
from forge_harness import configured_model, clean_answer, format_usage_report, usage_from_result
from terminal_tools import (
    build_prediction_evidence,
    build_nfl_workflow_evidence,
    build_repository_tools,
    fetch_nfl_scoreboard,
    is_sports_query,
    search_live_web_gemini,
    search_live_web_openai,
    search_live_web_via_worker,
    local_live_search_configured,
    worker_live_search_configured,
    worker_agent_request,
    set_play_by_play_request,
)


# The standalone terminal is commonly started with `npm run claude` and a
# repository .env file. Load it before any live-search request is made; the
# file remains ignored and secrets are never sent to the browser.
load_dotenv(Path(__file__).resolve().parents[2] / ".env")


DEFAULT_CLAUDE_MODEL = "ca.amazon.nova-lite-v1:0"
_CURRENT_INFORMATION_TERMS = re.compile(
    r"\b(today|tomorrow(?:'s|s)?|yesterday|current|currently|latest|live|recent|upcoming|schedule|scheduled|"
    r"score|scores|news|weather|price|prices|stock|stocks|standings|forecast|"
    r"monday|tuesday|wednesday|thursday|friday|saturday|sunday|workflow)\b",
    re.IGNORECASE,
)
_EXPLICIT_LIVE_SEARCH_TERMS = re.compile(
    r"\b(?:search|searched|searching|web|internet|online|google|gemini|openai)\b",
    re.IGNORECASE,
)
_DATED_QUERY = re.compile(
    r"\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
    r"\s+\d{1,2}(?:st|nd|rd|th)?\b|\b\d{4}-\d{2}-\d{2}\b",
    re.IGNORECASE,
)


def needs_live_search(prompt):
    """Identify requests whose answer can change and should be grounded first."""
    return bool(
        _CURRENT_INFORMATION_TERMS.search(prompt)
        or _EXPLICIT_LIVE_SEARCH_TERMS.search(prompt)
        or _DATED_QUERY.search(prompt)
    )


def is_prediction_request(prompt):
    return bool(
        re.search(r"\b(predi\w*|forecast|likely|favorite|win|winner|odds)\b", prompt, re.I)
        and re.search(r"\b(game|games|match|matchup|team|teams|nhl|nfl|nba|mlb|mls|wnba|sports?)\b", prompt, re.I)
    )


def is_nfl_workflow_request(prompt):
    return bool(re.search(r"\bnfl\s+workflow\b", prompt, re.I))


def deterministic_sports_answer(prompt):
    """Sports questions are answered via grounded live evidence."""
    return None


def _parse_next_limit_terminal(prompt: str) -> int | None:
    """Parse an explicit 'next N' or 'N games' limit from a prompt."""
    m = re.search(r"\bnext\s+(\d+)\b|\b(\d+)\s+(?:next\s+)?games?\b", prompt, re.I)
    if m:
        return max(1, min(32, int(m.group(1) or m.group(2))))
    if re.search(r"\bnext\s+game\b", prompt, re.I):
        return 1
    return None


def _parse_week_number_terminal(prompt: str) -> int | None:
    """Parse an explicit 'week N' from a prompt."""
    m = re.search(r"\bweek\s+(\d{1,2})\b", prompt, re.I)
    return int(m.group(1)) if m else None


def deterministic_live_nfl_answer(prompt, recent_prompts=()):
    """Answer current NFL schedule questions directly from ESPN's scoreboard.

    Supports:
    - today's games (filtered by team keywords if present)
    - 'next N games' — return the N soonest scheduled games
    - 'week N' — return only that week's games from the API (when week field present)
    """
    conversation = "\n".join([*recent_prompts[-4:], prompt])
    has_nfl_or_espn = re.search(r"\b(nfl|espn)\b", conversation, re.I)
    has_schedule_term = re.search(r"\b(today(?:'s|s)?|game|schedule|next|upcoming|week|scoreboard|score|scores)\b", conversation, re.I)
    if not has_nfl_or_espn or not has_schedule_term:
        return None
    if is_prediction_request(prompt):
        return None

    today = datetime.now(ZoneInfo(os.getenv("USER_TIMEZONE", "America/Vancouver"))).date().isoformat()
    result = fetch_nfl_scoreboard(today)
    if not result.startswith("ESPN NFL scoreboard API for"):
        return None

    lines = result.splitlines()[1:]
    if not lines:
        return None

    next_limit = _parse_next_limit_terminal(prompt)
    week_number = _parse_week_number_terminal(prompt)

    # Week filter: apply if the API returned week info in lines
    if week_number is not None:
        week_lines = [line for line in lines if re.search(rf"\bwk\s*{week_number}\b", line, re.I)]
        if week_lines:
            return "\n".join(week_lines)
        # API doesn't include week data — fall through to model

    # Team keyword filter (only for plain today queries)
    if next_limit is None and week_number is None:
        words = [w for w in re.findall(r"[a-z0-9]+", prompt.lower()) if len(w) > 3 and w not in {"today", "game", "games", "which", "team", "playing", "schedule", "next", "upcoming", "espn", "scoreboard", "score", "scores"}]
        if words:
            lines = [line for line in lines if any(w in line.lower() for w in words)]

    # Next N: filter to scheduled lines, take first N
    if next_limit is not None:
        scheduled = [line for line in lines if "scheduled" in line.lower()]
        if scheduled:
            return "\n".join(scheduled[:next_limit])
        # No scheduled games on today's scoreboard — not enough info for a deterministic answer
        return None

    return "\n".join(lines) if lines else None


def local_time_context():
    """Return an explicit clock reading so relative dates use the user's timezone."""
    timezone_name = os.getenv("USER_TIMEZONE", "America/Vancouver")
    try:
        now = datetime.now(ZoneInfo(timezone_name))
    except Exception:
        timezone_name = "America/Vancouver"
        now = datetime.now(ZoneInfo(timezone_name))
    return f"Local reference time: {now:%A, %B %-d, %Y at %-I:%M %p} ({timezone_name})."


def worker_gateway_state():
    """Describe whether the local terminal can use the Worker gateway."""
    has_url = bool(os.getenv("FORGE_WORKER_URL", "").strip())
    has_token = bool(os.getenv("FORGE_WORKER_TOKEN", "").strip())
    if has_url and has_token:
        return "configured"
    if has_url or has_token:
        return "incomplete"
    return "missing"


def stored_play_by_play_answer(prompt):
    """Return a matching stored game directly, avoiding an unnecessary tool loop."""
    if not re.search(r"\b(?:play[- ]by[- ]play|minute[- ]by[- ]minute|minute[- ]to[- ]minute)\b", prompt, re.I):
        return None
    words = set(re.findall(r"[a-z0-9]+", prompt.lower()))
    directory = Path(__file__).resolve().parent
    for path in sorted(directory.glob("play_by_play_*.json")):
        try:
            game = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        teams = (str(game.get("away", "")), str(game.get("home", "")))
        aliases = {token.lower() for team in teams for token in re.findall(r"[a-z0-9]+", team.lower()) if len(token) > 3}
        if not words.intersection(aliases):
            continue
        events = game.get("events")
        if not isinstance(events, list) or not events:
            continue
        lines = [
            f"{game.get('away')} {game.get('away_score', '?')} at {game.get('home')} {game.get('home_score', '?')} — {game.get('date')}",
            "Stored verified play-by-play:",
        ]
        lines.extend(f"{event.get('minute')}: {event.get('description')}" for event in events)
        if game.get("uncertainty"):
            lines.append(f"Note: {game['uncertainty']}")
        return "\n".join(lines)
    return None


async def live_context(prompt, prior_prompts=()):
    """Fetch both providers before invoking a model that may skip optional tools."""
    if not needs_live_search(prompt):
        return ""
    prior_context = "\n".join(str(item).strip() for item in prior_prompts[-4:] if str(item).strip())
    context_suffix = f"\nRecent conversation context:\n{prior_context}" if prior_context else ""
    grounded_prompt = f"{prompt}{context_suffix}\n{local_time_context()} Resolve relative dates in this timezone."
    if is_nfl_workflow_request(prompt):
        return "\n\n" + await asyncio.to_thread(
            build_nfl_workflow_evidence,
            datetime.now(ZoneInfo(os.getenv("USER_TIMEZONE", "America/Vancouver"))).date().isoformat(),
        )
    if is_prediction_request(prompt):
        return "\n\n" + await asyncio.to_thread(build_prediction_evidence, grounded_prompt)
    # ESPN's public scoreboard helps ground current NFL answers even when the
    # provider-backed live search is routed through the Worker fallback.
    nfl_api_result = None
    if is_sports_query(prompt) or re.search(r"\b(nfl|espn)\b", prompt, re.IGNORECASE):
        nfl_api_result = await asyncio.to_thread(
            fetch_nfl_scoreboard,
            datetime.now(ZoneInfo(os.getenv("USER_TIMEZONE", "America/Vancouver"))).date().isoformat(),
        )
    worker_result = None
    if not local_live_search_configured():
        worker_result = await asyncio.to_thread(search_live_web_via_worker, grounded_prompt)
    if worker_result is not None:
        openai_result, gemini_result = await asyncio.gather(
            asyncio.to_thread(lambda: worker_result),
            asyncio.to_thread(lambda: worker_result),
        )
    else:
        openai_result, gemini_result = await asyncio.gather(
            asyncio.to_thread(search_live_web_openai, grounded_prompt),
            asyncio.to_thread(search_live_web_gemini, grounded_prompt),
        )
    return (
        "\n\nVERIFIED LIVE WEB RESULTS (from Google and OpenAI APIs; do not invent missing facts):\n"
        f"[NFL scoreboard API]\n{nfl_api_result[:9000] if nfl_api_result else 'Not applicable.'}\n\n"
        f"[OpenAI web search]\n{openai_result[:9000]}\n\n"
        f"[Gemini Google Search]\n{gemini_result[:9000]}\n"
    )


def build_agent(model_id, region, max_tokens):
    system_prompt = with_conversation_policy(
        CONVERSATION_GUIDANCE,
        "You are being used from an interactive terminal. Answer the current user message directly. "
        "Keep replies concise unless the user asks for detail. Return only the final answer, without "
        "thinking tags or commentary about this system prompt. You may read and edit source files "
        "through the repository tools when the user requests a code change. Make focused edits and "
        "explain what changed. When the user asks about files, code, "
        "the repository, or whether something exists locally, you MUST use the repository "
        "tools before answering. Never claim that you cannot access the repository "
        "when the repository tools are available. For sports questions, use local_sports_lookup. "
        "When the user asks for 'next game', 'next N games', or 'upcoming games': return only the "
        "soonest N scheduled games from today onward — do not dump the full season schedule or "
        "include completed games. When the user specifies 'week N', return only that week's games. "
        "Never list Week 15/16/17 games in response to 'next game' unless they are genuinely the "
        "first scheduled games from today. For current or time-sensitive sports questions, use the "
        "supplied scoreboard API and verified live-web "
        "results and cite their sources; do not claim that web access failed unless both result blocks "
        "report a failure. If the live results do not establish a game or other fact, say it cannot "
        "be verified; never fill the gap with memory or a previous answer. If asked to predict a game, "
        "use the sports_prediction evidence gathered from Google and OpenAI APIs, and label the result as an uncertain forecast—not a fact.",
        "When asked to store an NFL forecast, call nfl_workflow first for the requested date and pass "
        "its unmodified output as schedule_evidence to write_nfl_prediction_json. Include only games "
        "explicitly listed there, with a prediction object, source URLs, and an uncertainty note. If "
        "the evidence reports no games, do not create a file. Never use the completed-results writer "
        "for a forecast.",
        "Create a separate play-by-play JSON file only when the user explicitly asks for play-by-play "
        "or minute-by-minute commentary for a specific game. Use write_game_play_by_play_json only "
        "for that explicitly requested game, and include verified attacks, chances, saves, substitutions, "
        "fouls, goals, and momentum shifts. Never invent missing events.",
        "When explaining a previously stored play-by-play, first use find_repository_files with "
        "play_by_play, then read the matching JSON file. Use the game's stored date and events; do not "
        "reinterpret an undated follow-up as today's game or claim it cannot be verified merely because "
        "the current schedule has no game today.",
        "If the user says NFL workflow, interpret it as every NFL game from today's local "
        "America/Vancouver date onward, and use the nfl_workflow evidence. Track scheduled, live, "
        "and final statuses separately. The workflow also refreshes local sports_data.json from the "
        "scoreboard API while preserving existing final records; only final games may be written to "
        "dated result JSON files.",
        "For completed NFL games, use nfl_results_evidence before writing records. Extract only "
        "facts supported by its live sources, then use write_nfl_results_json to create one dated "
        "file per game date. Never record a scheduled or unverified game as final.",
    )
    return Agent(
        model=configured_model(model_id=model_id, region_name=region, max_tokens=max_tokens),
        callback_handler=None,
        system_prompt=system_prompt + " You have repository tools to locate, read, and edit source files. Use them when the user asks about repository code.",
        tools=build_repository_tools(),
    )


async def chat(agent):
    print("Claude via Strands/Bedrock. Type /exit to quit, or press Ctrl-D.\n")
    recent_prompts = []
    while True:
        try:
            prompt = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if not prompt:
            continue
        if prompt.lower() in {"/exit", "/quit"}:
            return
        try:
            recent_prompts.append(prompt)
            recent_prompts = recent_prompts[-4:]
            result = None
            usage = {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0}
            set_play_by_play_request(prompt)
            time_context = local_time_context()
            stored_answer = stored_play_by_play_answer(prompt)
            if stored_answer:
                print(f"\nclaude> {stored_answer}\n")
                print(format_usage_report(agent.model.config.get("model_id", args.model if "args" in locals() else "unknown"), usage))
                continue
            deterministic_answer = deterministic_sports_answer(prompt)
            if deterministic_answer:
                print(f"\nclaude> {deterministic_answer}\n")
                print(format_usage_report(agent.model.config.get("model_id", args.model if "args" in locals() else "unknown"), usage))
                continue
            live_deterministic_answer = deterministic_live_nfl_answer(prompt, recent_prompts[:-1])
            if live_deterministic_answer:
                print(f"\nclaude> {live_deterministic_answer}\n")
                print(format_usage_report(agent.model.config.get("model_id", args.model if "args" in locals() else "unknown"), usage))
                continue
            evidence = await live_context(prompt, recent_prompts[:-1])
            for attempt in range(3):
                try:
                    continuation = (
                        f"{prompt}\n{time_context}\nResolve all relative dates using this local timezone.\n{evidence}"
                        if attempt == 0
                        else "Continue the previous request from where you stopped. Finish the repository inspection or edit, then give a concise summary of the completed work."
                    )
                    result = await agent.invoke_async(continuation)
                    current_usage = usage_from_result(result)
                    for key in usage:
                        usage[key] += current_usage[key]
                    break
                except MaxTokensReachedException:
                    if attempt == 2:
                        raise
            try:
                answer = clean_answer(result)
            except ValueError:
                # Some Bedrock/Strands responses contain only hidden reasoning.
                # Reuse the same agent once so tool state and conversation context survive.
                result = await agent.invoke_async(
                    "The previous response contained no user-facing text. Complete the original request now. "
                    "Use the available tools, then give only a concise final answer; do not emit thinking tags."
                )
                current_usage = usage_from_result(result)
                for key in usage:
                    usage[key] += current_usage[key]
                answer = clean_answer(result)
            print(f"\nclaude> {answer}\n")
            print(format_usage_report(agent.model.config.get("model_id", args.model if "args" in locals() else "unknown"), usage))
        except MaxTokensReachedException:
            print("\nerror> The request exceeded the model token limit after three continuation attempts. Try --max-tokens 5000 or ask for one file/change at a time.\n", file=sys.stderr)
        except asyncio.CancelledError:
            # Ctrl-C while Bedrock is streaming cancels the asyncio task.  This
            # is a BaseException, so the general recoverable-error handler does
            # not catch it and asyncio.run otherwise turns it into a traceback.
            print("\ninterrupted> Request cancelled.\n", file=sys.stderr)
            return
        except KeyboardInterrupt:
            # Some asyncio event-loop implementations surface the same Ctrl-C
            # as KeyboardInterrupt at the await boundary.
            print("\ninterrupted> Request cancelled.\n", file=sys.stderr)
            return
        except Exception as error:  # Keep the REPL alive for recoverable request errors.
            print(f"\nerror> {error}\n", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="Chat with Larboard agents through Cloudflare Worker or local Bedrock.")
    parser.add_argument(
        "--model",
        default=os.getenv("CLAUDE_MODEL_ID", DEFAULT_CLAUDE_MODEL),
        help="Bedrock model or inference-profile ID (default: %(default)s)",
    )
    parser.add_argument("--region", default=os.getenv("AWS_REGION", "ca-central-1"), help="AWS region")
    parser.add_argument("--agent", default=os.getenv("FORGE_AGENT_ID", "forge"), help="Agent profile for Worker-backed mode")
    parser.add_argument("--direct-bedrock", action="store_true", help="Use local Bedrock instead of the Worker gateway")
    parser.add_argument(
        "--max-tokens",
        type=int,
        default=int(os.getenv("CLAUDE_MAX_TOKENS", "3000")),
        help="Maximum output tokens per model call (default: %(default)s)",
    )
    args = parser.parse_args()
    gateway_state = worker_gateway_state()
    if not args.direct_bedrock and gateway_state == "configured":
        print(f"Using Cloudflare Worker gateway: {os.getenv('FORGE_WORKER_URL')} ({args.agent})")
        session_id = f"local-{uuid.uuid4()}"
        print("Type /exit to quit, or press Ctrl-D.\n")
        while True:
            try:
                prompt = input("you> ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                return
            if not prompt:
                continue
            if prompt.lower() in {"/exit", "/quit"}:
                return
            try:
                answer = worker_agent_request(prompt, args.agent, session_id)
                print(f"\nlarboard> {answer}\n")
            except Exception as error:
                print(f"\nerror> {error}\n", file=sys.stderr)
        return
    if not args.direct_bedrock and gateway_state == "incomplete":
        print("Worker gateway disabled: set both FORGE_WORKER_URL and FORGE_WORKER_TOKEN in .env; using direct Bedrock.", file=sys.stderr)
    elif not args.direct_bedrock and gateway_state == "missing":
        print("Worker gateway disabled: FORGE_WORKER_URL and FORGE_WORKER_TOKEN are not set; using direct Bedrock.", file=sys.stderr)
    print(f"Using model: {args.model} ({args.region})")
    try:
        asyncio.run(chat(build_agent(args.model, args.region, args.max_tokens)))
    except KeyboardInterrupt:
        # Final fallback for interrupts delivered while asyncio is shutting
        # down, after the request-level handler has had no chance to run.
        print("\ninterrupted> Request cancelled.\n", file=sys.stderr)


if __name__ == "__main__":
    main()
