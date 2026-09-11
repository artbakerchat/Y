"""Steering handlers for the Forge agent loop.

Two patterns from Module 3 (Skills + Steering), adapted for the palette domain:

PaletteReadyHandler — deterministic
    Blocks suggest_related_words until the palette has been read at least once
    in the current request (via get_palette or search_palette).  This mirrors
    RefundWorkflowHandler's approach: enforce prerequisite tool ordering with
    hard code rather than trusting the model to remember the rule.

ToneGuardrailHandler — LLM-based
    Reviews each drafted response for tone.  It mirrors the Worker-side
    best-effort quality review and the Module 3 ToneGuardrailHandler: use a
    second model call for judgment calls that are too fuzzy for if/else.

Both handlers are SteeringHandler / LLMSteeringHandler subclasses and register
as plugins in _agent_for_palette().
"""

from strands.vended_plugins.steering import (
    LLMSteeringHandler,
    LedgerProvider,
    Proceed,
    Guide,
    SteeringHandler,
    ToolSteeringAction,
)


class PaletteReadyHandler(SteeringHandler):
    """Block suggest_related_words until the palette has been inspected.

    The palette tools form a natural two-step flow:
      1. get_palette or search_palette — read what the user has.
      2. suggest_related_words        — build on it.

    Calling suggest_related_words without first reading the palette risks
    suggestions that ignore or contradict what the user already has.  This
    handler enforces the prerequisite deterministically so the model cannot
    skip ahead even with a permissive prompt.
    """

    name = "palette-ready"

    def __init__(self) -> None:
        super().__init__(context_providers=[LedgerProvider()])

    async def steer_before_tool(
        self, *, agent, tool_use, **kwargs
    ) -> ToolSteeringAction:
        if tool_use.get("name") != "suggest_related_words":
            return Proceed(reason="Not a palette suggestion call")

        ledger = self.steering_context.data.get("ledger", {})
        tool_calls: list[dict] = ledger.get("tool_calls", [])

        palette_read = any(
            call["tool_name"] in {"get_palette", "search_palette"}
            and call["status"] == "success"
            for call in tool_calls
        )

        if not palette_read:
            return Guide(
                reason=(
                    "You must call get_palette (or search_palette) before "
                    "calling suggest_related_words so the suggestions build "
                    "on what the user already has in their palette."
                )
            )

        return Proceed(reason="Palette read confirmed — suggestions allowed")


class ToneGuardrailHandler(LLMSteeringHandler):
    """Review each drafted response for tone and focus.

    Mirrors the Worker-side quality review and the Module 3 ToneGuardrailHandler.
    Uses a second model call (LLMSteeringHandler runs steer_after_model) to
    catch problems that are too subjective for deterministic rules:
    over-promising, scope drift, or unhelpful vagueness.
    """

    name = "tone-guardrail"

    def __init__(self) -> None:
        super().__init__(
            system_prompt=(
                "You are reviewing a response from Forge, a focused word specialist. "
                "Forge helps users explore meaning, nuance, connotation, etymology, "
                "and precise word choice. Evaluate the response against these rules:\n\n"
                "1. FOCUS — stays on the user's word or language topic; does not drift "
                "into generic life coaching, broad brainstorming, or unrelated advice.\n"
                "2. HONESTY — never invents palette entries or presents guesses as facts.\n"
                "3. CONCISION — gives concrete examples and asks at most one follow-up "
                "question; does not pad with filler or over-qualify.\n"
                "4. TONE — warm and direct; does not lecture, moralize, or over-promise.\n\n"
                "If the response satisfies all four rules, approve it. "
                "If it violates any rule, provide a single, specific instruction on "
                "what to fix — do not rewrite the response yourself."
            )
        )
