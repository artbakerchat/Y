"""Deterministic controls for the Forge agent loop."""

from collections.abc import Callable

from strands.hooks import BeforeInvocationEvent, BeforeToolCallEvent, HookProvider, HookRegistry


class RateLimiterHook(HookProvider):
    """Cap each tool at a fixed number of calls per agent invocation.

    Args:
        max_calls: Maximum number of times any single tool may be called
            within one agent invocation.  Must be >= 1.
        on_event: Optional callback invoked with a human-readable message
            each time a tool call is counted or blocked.  Useful for
            structured logging without coupling to a specific logger.
    """

    def __init__(
        self,
        max_calls: int = 3,
        on_event: Callable[[str], None] | None = None,
    ) -> None:
        if max_calls < 1:
            raise ValueError("max_calls must be at least 1")
        self.max_calls: int = max_calls
        self.counts: dict[str, int] = {}
        self.on_event: Callable[[str], None] | None = on_event

    def register_hooks(self, registry: HookRegistry) -> None:
        """Register lifecycle callbacks with the Strands hook registry."""
        registry.add_callback(BeforeInvocationEvent, self.reset)
        registry.add_callback(BeforeToolCallEvent, self.check)

    def reset(self, event: BeforeInvocationEvent) -> None:  # noqa: ARG002
        """Reset per-tool counts when a new request enters the loop."""
        self.counts = {}
        self._emit("rate limiter reset")

    def check(self, event: BeforeToolCallEvent) -> None:
        """Cancel a tool call after it exceeds the per-request limit."""
        name: str = event.tool_use["name"]
        self.counts[name] = self.counts.get(name, 0) + 1
        count = self.counts[name]
        self._emit(f"{name}: call {count}/{self.max_calls}")
        if count > self.max_calls:
            event.cancel_tool = (
                f"'{name}' hit the {self.max_calls}-call limit. "
                "Do not call this tool again; continue with the information already available."
            )
            self._emit(f"blocked {name} after exceeding limit")

    def _emit(self, message: str) -> None:
        """Forward a log message to the caller-supplied callback if set."""
        if self.on_event:
            self.on_event(message)
