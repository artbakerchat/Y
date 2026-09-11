"""Trajectory contracts for Forge's current Worker tools.

These cases describe the observable tool order in the Forge application. They
are intentionally model-agnostic: a recorded Bedrock/Strands message trace can
be scored without making another model call.
"""

from dataclasses import dataclass
from typing import Any

from forge_evals import EvalResult, extract_tool_names, score_trajectory


@dataclass(frozen=True)
class ForgeTrajectoryCase:
    name: str
    expected_tools: tuple[str, ...]
    description: str


FORGE_TRAJECTORIES = (
    ForgeTrajectoryCase(
        "palette-suggestion-after-read",
        ("get_palette", "suggest_related_words"),
        "Suggestions follow a successful read of the current palette.",
    ),
    ForgeTrajectoryCase(
        "palette-search-then-suggestion",
        ("search_palette", "suggest_related_words"),
        "Suggestions may follow a focused palette search.",
    ),
    ForgeTrajectoryCase(
        "word-specialist-delegation",
        ("consult_word_specialist",),
        "Word-craft analysis is delegated through the specialist tool.",
    ),
)


def evaluate_forge_trajectory(
    case: ForgeTrajectoryCase, messages: list[dict[str, Any]]
) -> EvalResult:
    """Score one recorded Forge conversation against a trajectory contract."""
    return score_trajectory(case.name, extract_tool_names(messages), list(case.expected_tools))


def evaluate_all_forge_trajectories(
    traces: dict[str, list[dict[str, Any]]],
) -> list[EvalResult]:
    """Score all supplied traces, including a useful missing-trace failure."""
    results = []
    for case in FORGE_TRAJECTORIES:
        messages = traces.get(case.name, [])
        results.append(evaluate_forge_trajectory(case, messages))
    return results
