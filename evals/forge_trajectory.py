"""Trajectory contracts for Forge's current Worker tools.

These cases describe the observable tool order in the Forge application. They
are intentionally model-agnostic: a recorded Bedrock/Strands message trace can
be scored without making another model call.

Two trajectory types are used here:

``ForgeTrajectoryCase``
    Linear contract — all ``expected_tools`` must appear in the given order.
    Use for sequences that are strictly required (e.g. read before suggest).

``ForgeBranchTrajectoryCase``
    Branching contract — the trace must satisfy *at least one* of the supplied
    ``branches``.  Each branch is a list of step names (strings or
    :class:`~forge_evals.OptionalStep`).  Use when the same goal can be
    legitimately reached via different tool paths.

Both support optional steps through :class:`~forge_evals.OptionalStep` so
traces that call extra tools for telemetry or context enrichment still pass.
"""

from dataclasses import dataclass
from typing import Any

from forge_evals import (
    EvalResult,
    OptionalStep,
    extract_tool_names,
    score_branch_trajectory,
    score_trajectory,
    score_trajectory_with_optional,
)


# ---------------------------------------------------------------------------
# Trajectory case definitions
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ForgeTrajectoryCase:
    """A linear trajectory where every step is required in order."""
    name: str
    expected_tools: tuple[str, ...]
    description: str


@dataclass(frozen=True)
class ForgeBranchTrajectoryCase:
    """A branching trajectory where the trace must satisfy at least one branch.

    Each branch is a list of plain tool-name strings or OptionalStep wrappers.
    The evaluation passes when any single branch matches the actual trace.
    """
    name: str
    branches: tuple[list[str | OptionalStep], ...]
    description: str


# ---------------------------------------------------------------------------
# Trajectory registry
# ---------------------------------------------------------------------------

# Linear contracts — strict required-order sequences.
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

# Branching contracts — the model may legitimately reach the same goal via
# different paths depending on whether the palette is empty, already cached,
# or being searched for the first time.
FORGE_BRANCH_TRAJECTORIES = (
    ForgeBranchTrajectoryCase(
        name="palette-access-before-suggestion",
        branches=(
            # Branch A: full read then suggest (optional search in between).
            ["get_palette", OptionalStep("search_palette"), "suggest_related_words"],
            # Branch B: targeted search then suggest (no full read required).
            ["search_palette", "suggest_related_words"],
        ),
        description=(
            "Before suggesting words the model must access the palette via "
            "get_palette OR search_palette — either path is acceptable."
        ),
    ),
    ForgeBranchTrajectoryCase(
        name="specialist-or-direct-suggestion",
        branches=(
            # Branch A: model delegates to specialist.
            ["consult_word_specialist"],
            # Branch B: model handles suggestion directly without specialist.
            ["get_palette", "suggest_related_words"],
        ),
        description=(
            "Word-craft requests may be satisfied by the specialist tool OR "
            "by a direct get_palette + suggest_related_words sequence."
        ),
    ),
)


# ---------------------------------------------------------------------------
# Evaluation helpers
# ---------------------------------------------------------------------------

def evaluate_forge_trajectory(
    case: ForgeTrajectoryCase, messages: list[dict[str, Any]]
) -> EvalResult:
    """Score one recorded Forge conversation against a linear trajectory contract."""
    return score_trajectory(case.name, extract_tool_names(messages), list(case.expected_tools))


def evaluate_forge_branch_trajectory(
    case: ForgeBranchTrajectoryCase, messages: list[dict[str, Any]]
) -> EvalResult:
    """Score one recorded Forge conversation against a branching trajectory contract."""
    return score_branch_trajectory(
        case.name,
        extract_tool_names(messages),
        [list(branch) for branch in case.branches],
    )


def evaluate_all_forge_trajectories(
    traces: dict[str, list[dict[str, Any]]],
) -> list[EvalResult]:
    """Score all linear trajectory traces, including a useful missing-trace failure."""
    results = []
    for case in FORGE_TRAJECTORIES:
        messages = traces.get(case.name, [])
        results.append(evaluate_forge_trajectory(case, messages))
    return results


def evaluate_all_forge_branch_trajectories(
    traces: dict[str, list[dict[str, Any]]],
) -> list[EvalResult]:
    """Score all branching trajectory traces, including a useful missing-trace failure."""
    results = []
    for case in FORGE_BRANCH_TRAJECTORIES:
        messages = traces.get(case.name, [])
        results.append(evaluate_forge_branch_trajectory(case, messages))
    return results
