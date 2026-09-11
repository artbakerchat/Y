"""Offline evaluation helpers for the Forge agent contract.

These checks do not call a model. They make deterministic regressions visible
before an optional LLM-as-judge experiment is run.
"""

from dataclasses import dataclass
from typing import Any


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
    """Return whether expected tool calls occur in order, allowing extra calls."""
    expected_index = 0
    for name in actual:
        if expected_index < len(expected) and name == expected[expected_index]:
            expected_index += 1
    return expected_index == len(expected)


def score_trajectory(name: str, actual: list[str], expected: list[str]) -> EvalResult:
    """Score an ordered tool trajectory as a deterministic contract."""
    passed = trajectory_contains(actual, expected)
    reason = "trajectory passed" if passed else f"expected {expected}, got {actual}"
    return EvalResult(name, passed, 1.0 if passed else 0.0, reason)