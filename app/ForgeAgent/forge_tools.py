"""Palette tools exposed to the Forge agent loop.

The functions are intentionally small and deterministic so the model can use
them to inspect the user's palette without inventing palette state.
"""

import json
from collections.abc import Callable

from strands import tool

from forge_specialists import consult_word_specialist, tech_support_specialist
from community_tools import build_community_tools
from calculator import calculate
from sports_agent import answer as answer_sports


def build_tools(palette: list[str], profile_id: str = "forge", sports_data: dict | None = None, sports_live_evidence: str = "") -> list[Callable[..., str]]:
    """Build the tools for one request with its current palette in scope.

    Args:
        palette: The current session palette — a list of up to 52 word strings.

    Returns:
        A list of Strands-compatible tool callables bound to the supplied palette.
    """

    @tool
    def get_palette() -> str:
        """Return the current word palette for the conversation."""
        if not palette:
            return "The palette is empty."
        return f"Current palette ({len(palette)} words): {', '.join(palette)}"

    @tool
    def search_palette(query: str) -> str:
        """Search the current word palette for a case-insensitive substring.

        Args:
            query: The substring to search for.
        """
        normalized_query = query.strip().lower()
        matches = [word for word in palette if normalized_query in word.lower()]
        if not matches:
            return f'No palette words match "{query}".'
        return f"Found {len(matches)} match(es): {', '.join(matches)}"

    @tool
    def suggest_related_words(theme: str) -> str:
        """Suggest palette words related to a theme.

        Args:
            theme: The theme or concept for the suggestions.
        """
        banks: dict[str, list[str]] = {
            "nature": ["glacier", "canopy", "driftwood", "mesa", "shoreline"],
            "light": ["prism", "glimmer", "radiance", "flicker", "beacon"],
            "motion": ["cascade", "vortex", "drift", "surge", "current"],
            "time": ["epoch", "solstice", "twilight", "meridian", "cycle"],
        }
        normalized_theme = theme.lower()
        key = next((name for name in banks if name in normalized_theme), None)
        words = banks.get(key, ["horizon", "ember", "mosaic", "compass", "echo"])
        return f'Suggested words for theme "{theme}": {", ".join(words)}'

    @tool
    def local_sports_lookup(prompt: str) -> str:
        """Answer sports questions using Google and OpenAI live search APIs."""
        if sports_live_evidence:
            return sports_live_evidence
        return answer_sports(prompt)

    @tool
    def sports_prediction(query: str) -> str:
        """Combine Google and OpenAI live provider evidence for a forecast."""
        return (
            "PREDICTION INPUTS — NOT A VERIFIED OUTCOME\n"
            "[Google and OpenAI live search evidence]\n"
            f"{sports_live_evidence or 'Live sports evidence is unavailable.'}\n\n"
            "Any conclusion must be labeled as an uncertain forecast, include assumptions, state uncertainty, and tell the user if either provider was unavailable."
        )

    @tool
    def web_search(query: str) -> str:
        """Return Worker-provided live web evidence for grounding."""
        if sports_live_evidence:
            return sports_live_evidence
        return "Live web search evidence is unavailable."

    return [
        get_palette,
        search_palette,
        suggest_related_words,
        consult_word_specialist,
        calculate,
        *build_community_tools(profile_id),
        tech_support_specialist,
        local_sports_lookup,
        sports_prediction,
        web_search,
    ]
