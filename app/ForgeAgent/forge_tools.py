"""Palette tools exposed to the Forge agent loop.

The functions are intentionally small and deterministic so the model can use
them to inspect the user's palette without inventing palette state.
"""

from strands import tool

from forge_specialists import tech_support_specialist


def build_tools(palette: list[str]):
    """Build the tools for one request with its current palette in scope."""

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
        banks = {
            "nature": ["glacier", "canopy", "driftwood", "mesa", "shoreline"],
            "light": ["prism", "glimmer", "radiance", "flicker", "beacon"],
            "motion": ["cascade", "vortex", "drift", "surge", "current"],
            "time": ["epoch", "solstice", "twilight", "meridian", "cycle"],
        }
        normalized_theme = theme.lower()
        key = next((name for name in banks if name in normalized_theme), None)
        words = banks.get(key, ["horizon", "ember", "mosaic", "compass", "echo"])
        return f'Suggested words for theme "{theme}": {", ".join(words)}'

    return [get_palette, search_palette, suggest_related_words, tech_support_specialist]