"""
Profile registry for Forge agents.

This module loads agent profiles from agentcore/profiles.json,
providing a unified source of truth for both JavaScript and Python runtimes.
"""
import json
import os
from pathlib import Path
from typing import Any, Optional


def _get_profiles_path() -> Path:
    """Resolve path to profiles.json from repository root."""
    current_file = Path(__file__).resolve()
    # app/ForgeAgent/forge_profiles.py -> app/ -> . (repo root)
    repo_root = current_file.parent.parent.parent
    profiles_file = repo_root / "agentcore" / "profiles.json"
    
    if not profiles_file.exists():
        raise FileNotFoundError(f"Profile definitions not found at {profiles_file}")
    
    return profiles_file


def load_profiles() -> dict[str, Any]:
    """Load all agent profiles from the shared source of truth."""
    profiles_file = _get_profiles_path()
    with open(profiles_file, 'r') as f:
        data = json.load(f)
    return data.get('profiles', {})


def get_profile(profile_id: str = 'forge') -> Optional[dict[str, Any]]:
    """Get a specific profile by ID."""
    profiles = load_profiles()
    return profiles.get(profile_id)


def list_profiles() -> list[dict[str, str]]:
    """List all available profiles with metadata."""
    profiles = load_profiles()
    return [
        {'id': pid, 'name': p.get('name'), 'description': p.get('description')}
        for pid, p in profiles.items()
    ]


def get_system_prompt(profile_id: str = 'forge') -> str:
    """Get the system prompt for a profile."""
    profile = get_profile(profile_id)
    if not profile:
        raise ValueError(f"Unknown profile: {profile_id}")
    return profile.get('systemPrompt', '')


def get_tool_names(profile_id: str = 'forge') -> list[str]:
    """Get allowed tool names for a profile."""
    profile = get_profile(profile_id)
    if not profile:
        raise ValueError(f"Unknown profile: {profile_id}")
    return profile.get('toolNames', [])


def get_daily_limit(profile_id: str = 'forge') -> int:
    """Get daily request limit for a profile."""
    profile = get_profile(profile_id)
    if not profile:
        raise ValueError(f"Unknown profile: {profile_id}")
    return profile.get('dailyRequestLimit', 8)


def get_max_tool_calls(profile_id: str = 'forge') -> int:
    """Get max tool calls per request for a profile."""
    profile = get_profile(profile_id)
    if not profile:
        raise ValueError(f"Unknown profile: {profile_id}")
    return profile.get('maxToolCallsPerRequest', 3)
