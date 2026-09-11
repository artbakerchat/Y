"""
Profile registry for Forge agents.

This module loads agent profiles from agentcore/profiles.json,
providing a unified source of truth for both JavaScript and Python runtimes.
"""
import json
import os
from pathlib import Path
from typing import Any


def _get_profiles_path() -> Path:
    """Resolve path to profiles.json from repository root."""
    configured_path = os.getenv("FORGE_PROFILES_PATH")
    if configured_path:
        configured = Path(configured_path)
        if configured.exists():
            return configured
    current_file = Path(__file__).resolve()
    bundled_file = current_file.parent / "profiles.json"
    if bundled_file.exists():
        return bundled_file
    # app/ForgeAgent/forge_profiles.py -> app/ -> . (repo root)
    repo_root = current_file.parent.parent.parent
    profiles_file = repo_root / "agentcore" / "profiles.json"

    if not profiles_file.exists():
        raise FileNotFoundError(f"Profile definitions not found at {profiles_file}")

    return profiles_file


def load_profiles() -> dict[str, Any]:
    """Load all agent profiles from the shared source of truth."""
    profiles_file = _get_profiles_path()
    with open(profiles_file, "r") as f:
        data = json.load(f)
    return data.get("profiles", {})


def get_profile(profile_id: str = "forge") -> dict[str, Any] | None:
    """Get a specific profile by ID, or None if the ID is not registered."""
    profiles = load_profiles()
    return profiles.get(profile_id)


def list_profiles() -> list[dict[str, str | None]]:
    """List all available profiles with their id, name, and description."""
    profiles = load_profiles()
    return [
        {"id": pid, "name": p.get("name"), "description": p.get("description")}
        for pid, p in profiles.items()
    ]


def get_system_prompt(profile_id: str = "forge") -> str:
    """Return the system prompt for the given profile.

    Raises:
        ValueError: If the profile ID is not registered.
    """
    profile = get_profile(profile_id)
    if not profile:
        raise ValueError(f"Unknown profile: {profile_id}")
    return profile.get("systemPrompt", "")


def get_tool_names(profile_id: str = "forge") -> list[str]:
    """Return the allowed tool names for the given profile.

    Raises:
        ValueError: If the profile ID is not registered.
    """
    profile = get_profile(profile_id)
    if not profile:
        raise ValueError(f"Unknown profile: {profile_id}")
    return profile.get("toolNames", [])


def get_daily_limit(profile_id: str = "forge") -> int:
    """Return the daily request limit for the given profile.

    Raises:
        ValueError: If the profile ID is not registered.
    """
    profile = get_profile(profile_id)
    if not profile:
        raise ValueError(f"Unknown profile: {profile_id}")
    return profile.get("dailyRequestLimit", 8)


def get_max_tool_calls(profile_id: str = "forge") -> int:
    """Return the max tool calls per request for the given profile.

    Raises:
        ValueError: If the profile ID is not registered.
    """
    profile = get_profile(profile_id)
    if not profile:
        raise ValueError(f"Unknown profile: {profile_id}")
    return profile.get("maxToolCallsPerRequest", 3)
