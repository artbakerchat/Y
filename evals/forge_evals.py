"""Offline evaluation helpers for the Forge agent contract.

These checks do not call a model. They make deterministic regressions visible
before an optional LLM-as-judge experiment is run.

Trajectory types
----------------
``score_trajectory``
    Linear: every step in ``expected`` must appear in order; extra tools between
    steps are fine (the original behaviour).

``score_trajectory_with_optional``
    Like a linear trajectory, but individual steps can be marked optional.
    An optional step is a :class:`OptionalStep` wrapper around the tool name.
    The trajectory passes as long as all *required* steps appear in order;
    optional steps are counted if present but never cause failure.

``score_branch_trajectory``
    Branching: the actual trace must satisfy at least one of the supplied
    ``branches``.  Each branch is a list of step names (strings or
    :class:`OptionalStep`).  Use this when the model is legitimately allowed
    to reach the same goal via different tool paths.
"""

from dataclasses import dataclass
from typing import Any


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class OutputCase:
    name: str
    response: str
    required_fragments: tuple[str, ...] = ()
    forbidden_fragments: tuple[str, ...] = ()


@dataclass(frozen=True)
class EvalResult:
    name: str
    passed: bool
    score: float
    reason: str


@dataclass(frozen=True)
class OptionalStep:
    """Wrap a tool name to mark it as optional in a trajectory."""
    name: str


# A trajectory step is either a plain tool name or an OptionalStep.
TrajectoryStep = str | OptionalStep


# ---------------------------------------------------------------------------
# Core helpers
# ---------------------------------------------------------------------------

def score_output(case: OutputCase) -> EvalResult:
    """Score a response against deterministic content expectations."""
    response = case.response.lower()
    missing = [fragment for fragment in case.required_fragments if fragment.lower() not in response]
    present_forbidden = [fragment for fragment in case.forbidden_fragments if fragment.lower() in response]
    if missing:
        return EvalResult(case.name, False, 0.0, f"missing: {', '.join(missing)}")
    if present_forbidden:
        return EvalResult(case.name, False, 0.0, f"forbidden: {', '.join(present_forbidden)}")
    return EvalResult(case.name, True, 1.0, "response contract passed")


def extract_tool_names(messages: list[dict[str, Any]]) -> list[str]:
    """Extract ordered tool-use names from Strands or Bedrock-style messages."""
    names = []
    for message in messages:
        for block in message.get("content", []):
            tool_use = block.get("toolUse") if isinstance(block, dict) else None
            if isinstance(tool_use, dict) and isinstance(tool_use.get("name"), str):
                names.append(tool_use["name"])
    return names


def trajectory_contains(actual: list[str], expected: list[str]) -> bool:
    """Return whether *required* tool calls occur in order, allowing extra calls.

    This is the core matching primitive.  Pass required tool names only;
    strip out optional steps before calling this function.
    """
    expected_index = 0
    for name in actual:
        if expected_index < len(expected) and name == expected[expected_index]:
            expected_index += 1
    return expected_index == len(expected)


# ---------------------------------------------------------------------------
# Trajectory scoring — linear
# ---------------------------------------------------------------------------

def score_trajectory(name: str, actual: list[str], expected: list[str]) -> EvalResult:
    """Score an ordered tool trajectory as a deterministic contract.

    All steps in ``expected`` are required and must appear in order.
    Extra tool calls between steps are allowed.
    """
    passed = trajectory_contains(actual, expected)
    reason = "trajectory passed" if passed else f"expected {expected}, got {actual}"
    return EvalResult(name, passed, 1.0 if passed else 0.0, reason)


# ---------------------------------------------------------------------------
# Trajectory scoring — optional steps
# ---------------------------------------------------------------------------

def score_trajectory_with_optional(
    name: str,
    actual: list[str],
    steps: list[TrajectoryStep],
) -> EvalResult:
    """Score a trajectory that may contain optional steps.

    Required steps (plain strings) must all appear in order.
    Optional steps (:class:`OptionalStep`) are counted when present but
    never cause a failure when absent.

    The returned score reflects the fraction of *all* steps (required +
    optional) that were satisfied, giving partial credit for richer traces.

    Args:
        name: Trajectory name for reporting.
        actual: Ordered list of tool names from the recorded trace.
        steps: Trajectory definition mixing plain strings and OptionalStep.

    Returns:
        :class:`EvalResult` where ``passed`` is True iff all required steps
        are satisfied in order.
    """
    required = [s if isinstance(s, str) else s.name for s in steps if isinstance(s, str)]
    optional = [s.name for s in steps if isinstance(s, OptionalStep)]

    required_ok = trajectory_contains(actual, required)
    optional_hit = [s for s in optional if s in actual]

    total_steps = len(required) + len(optional)
    satisfied = len(required) * int(required_ok) + len(optional_hit)
    score = satisfied / total_steps if total_steps else 1.0

    if not required_ok:
        reason = f"required steps not satisfied in order: {required}, got {actual}"
        return EvalResult(name, False, score, reason)

    if optional:
        optional_note = (
            f"; optional steps present: {optional_hit}"
            if optional_hit
            else f"; optional steps absent: {optional}"
        )
    else:
        optional_note = ""
    return EvalResult(name, True, score, f"trajectory passed{optional_note}")


# ---------------------------------------------------------------------------
# Trajectory scoring — branching
# ---------------------------------------------------------------------------

def score_branch_trajectory(
    name: str,
    actual: list[str],
    branches: list[list[TrajectoryStep]],
) -> EvalResult:
    """Score a trajectory that may follow one of several valid paths.

    The trace passes if *at least one* branch is fully satisfied.  Branches
    are evaluated with optional-step semantics so individual branches can
    contain :class:`OptionalStep` items.

    The best-scoring branch result is returned so partial credit is preserved
    even when every branch fails.

    Args:
        name: Trajectory name for reporting.
        actual: Ordered list of tool names from the recorded trace.
        branches: List of valid execution paths.  Each path is a list of
            plain strings or :class:`OptionalStep` instances.

    Returns:
        :class:`EvalResult` where ``passed`` is True iff at least one branch
        matched.
    """
    if not branches:
        return EvalResult(name, False, 0.0, "no branches defined")

    best: EvalResult | None = None
    for i, branch in enumerate(branches):
        result = score_trajectory_with_optional(f"{name}[branch-{i}]", actual, branch)
        if best is None or result.score > best.score:
            best = result
        if result.passed:
            return EvalResult(name, True, result.score, f"branch {i} matched: {result.reason}")

    assert best is not None  # branches is non-empty, so best is always set
    return EvalResult(name, False, best.score, f"no branch matched; best: {best.reason}")