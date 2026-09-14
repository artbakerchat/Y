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

from conversation_guidance import ANSWER_QUALITY_GUIDANCE, CONVERSATION_GUIDANCE
from conversation_policy import with_conversation_policy
from forge_harness import configured_model, clean_answer, format_usage_report, usage_from_result
from sports_agent import answer as answer_sports
from terminal_tools import (
    build_prediction_evidence,
    build_nfl_workflow_evidence,
    build_repository_tools,
    search_live_web_gemini,
    search_live_web_openai,
    search_live_web_via_worker,
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
_DATED_QUERY = re.compile(
    r"\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
    r"\s+\d{1,2}(?:st|nd|rd|th)?\b|\b\d{4}-\d{2}-\d{2}\b",
    re.IGNORECASE,
)


def needs_live_search(prompt):
    """Identify requests whose answer can change and should be grounded first."""
    return bool(_CURRENT_INFORMATION_TERMS.search(prompt) or _DATED_QUERY.search(prompt))


def is_prediction_request(prompt):
    return bool(
        re.search(r"\b(predi\w*|forecast|likely|favorite|win|winner|odds)\b", prompt, re.I)
        and re.search(r"\b(game|games|match|matchup|team|teams|nhl|nfl|nba|mlb|mls|wnba|sports?)\b", prompt, re.I)
    )


def is_nfl_workflow_request(prompt):
    return bool(re.search(r"\bnfl\s+workflow\b", prompt, re.I))


def local_time_context():
    """Return an explicit clock reading so relative dates use the user's timezone."""
    timezone_name = os.getenv("USER_TIMEZONE", "America/Vancouver")
    try:
        now = datetime.now(ZoneInfo(timezone_name))
    except Exception:
        timezone_name = "America/Vancouver"
        now = datetime.now(ZoneInfo(timezone_name))
    return f"Local reference time: {now:%A, %B %-d, %Y at %-I:%M %p} ({timezone_name})."


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


async def live_context(prompt):
    """Fetch both providers before invoking a model that may skip optional tools."""
    if not needs_live_search(prompt):
        return ""
    grounded_prompt = f"{prompt}\n{local_time_context()} Resolve relative dates in this timezone."
    if is_nfl_workflow_request(prompt):
        return "\n\n" + await asyncio.to_thread(
            build_nfl_workflow_evidence,
            datetime.now(ZoneInfo(os.getenv("USER_TIMEZONE", "America/Vancouver"))).date().isoformat(),
        )
    if is_prediction_request(prompt):
        return "\n\n" + await asyncio.to_thread(build_prediction_evidence, grounded_prompt)
    worker_result = await asyncio.to_thread(search_live_web_via_worker, grounded_prompt)
    if worker_result is not None:
        local_result, openai_result, gemini_result = await asyncio.gather(
            asyncio.to_thread(answer_sports, grounded_prompt),
            asyncio.to_thread(lambda: worker_result),
            asyncio.to_thread(lambda: worker_result),
        )
    else:
        local_result, openai_result, gemini_result = await asyncio.gather(
            asyncio.to_thread(answer_sports, grounded_prompt),
            asyncio.to_thread(search_live_web_openai, grounded_prompt),
            asyncio.to_thread(search_live_web_gemini, grounded_prompt),
        )
    return (
        "\n\nVERIFIED SPORTS AND LIVE WEB RESULTS (use as evidence; do not invent missing facts):\n"
        f"[Local JSON lookup — authoritative when matching]\n{local_result[:9000]}\n\n"
        f"[OpenAI web search]\n{openai_result[:9000]}\n\n"
        f"[Gemini Google Search]\n{gemini_result[:9000]}\n"
    )


def build_agent(model_id, region, max_tokens):
    system_prompt = with_conversation_policy(
        CONVERSATION_GUIDANCE,
        ANSWER_QUALITY_GUIDANCE,
        "You are being used from an interactive terminal. Answer the current user message directly. "
        "Keep replies concise unless the user asks for detail. Return only the final answer, without "
        "thinking tags or commentary about this system prompt. You may read and edit source files "
        "through the repository tools when the user requests a code change. Make focused edits and "
        "explain what changed. When the user asks about files, code, "
        "the repository, or whether something exists locally, you MUST use the repository "
        "tools before answering. For a question about a local sports agent, search filenames for "
        "sports first, then report the matching path. Never claim that you cannot access the repository "
        "when the repository tools are available. For sports questions, local_sports_lookup and its "
        "local JSON dataset are the primary source of truth; use them first and never override their "
        "records with model memory or web results. If the local tool reports no matching record, say "
        "that plainly, but never infer from that absence that no real-world game occurred. For current "
        "or time-sensitive questions, use the supplied verified live-web "
        "results and cite their sources; do not claim that web access failed unless both result blocks "
        "report a failure. If the live results do not establish a game or other fact, say it cannot "
        "be verified; never fill the gap with memory or a previous answer. Clearly label disagreement "
        "with the local dataset rather than silently replacing local data. If asked to predict a game, "
        "use the sports_prediction evidence, keep local JSON inputs primary, use web evidence only as "
        "supplemental context, and label the result as an uncertain forecast—not a fact.",
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
        "and final statuses separately; only final games may be written to dated JSON files.",
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
            result = None
            usage = {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0}
            set_play_by_play_request(prompt)
            time_context = local_time_context()
            stored_answer = stored_play_by_play_answer(prompt)
            if stored_answer:
                print(f"\nclaude> {stored_answer}\n")
                print(format_usage_report(agent.model.config.get("model_id", args.model if "args" in locals() else "unknown"), usage))
                continue
            evidence = await live_context(prompt)
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
    if not args.direct_bedrock and os.getenv("FORGE_WORKER_URL") and os.getenv("FORGE_WORKER_TOKEN"):
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
    print(f"Using model: {args.model} ({args.region})")
    try:
        asyncio.run(chat(build_agent(args.model, args.region, args.max_tokens)))
    except KeyboardInterrupt:
        # Final fallback for interrupts delivered while asyncio is shutting
        # down, after the request-level handler has had no chance to run.
        print("\ninterrupted> Request cancelled.\n", file=sys.stderr)


if __name__ == "__main__":
    main()
