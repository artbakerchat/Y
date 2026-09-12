Module 2: Hooks
Overview
Add a rate limiter to the customer service agent. Hooks  inject deterministic code into the agent loop - before invocations and around tool calls  - without changing the agent's logic. They're how you add safety controls that don't depend on the model "deciding" to behave.

Time to complete: 10 minutes

What you'll build
A RateLimiterHook that caps each tool at N calls per request, so a runaway loop can't call the same tool dozens of times.

Select the repository Python environment
When you open this module's notebook, select the repository's `.venv` kernel (top-right Select Kernel → Python Environments). Use the same environment in every module so the installed Strands packages are available.

Now let's look at some code. The snippets below already live in the module notebook - this page walks through and explains them. You run the cells in the notebook; you don't need to retype anything here.

Architecture
Hooks flow

A hook registers callbacks on lifecycle events in the loop. The RateLimiterHook listens for BeforeToolCallEvent: it counts calls per tool and cancels the call once a tool exceeds its limit - deterministic control that runs every time, regardless of what the model reasons.

Part 1: Build a Rate Limiter Hook
A hook implements HookProvider and registers callbacks for lifecycle events. This one resets counters at the start of each invocation and enforces the limit before every tool call.

1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
24
25
26
27
28
29
30
31
from strands import Agent
from strands.hooks import (
    HookProvider, HookRegistry,
    BeforeInvocationEvent, BeforeToolCallEvent,
)


class RateLimiterHook(HookProvider):
    """Caps each tool at max_calls per agent invocation."""

    def __init__(self, max_calls: int = 3):
        self.max_calls = max_calls
        self.counts: dict[str, int] = {}

    def register_hooks(self, registry: HookRegistry) -> None:
        registry.add_callback(BeforeInvocationEvent, self.reset)
        registry.add_callback(BeforeToolCallEvent, self.check)

    def reset(self, event: BeforeInvocationEvent) -> None:
        """Reset counts at the start of each invocation."""
        self.counts = {}

    def check(self, event: BeforeToolCallEvent) -> None:
        """Enforce the rate limit before each tool call."""
        name = event.tool_use["name"]
        self.counts[name] = self.counts.get(name, 0) + 1
        if self.counts[name] > self.max_calls:
            event.cancel_tool = (
                f"'{name}' hit the {self.max_calls}-call limit. "
                "Do NOT call this tool again."
            )

What this does:

register_hooks binds each callback to an event. BeforeInvocationEvent fires once when the agent starts a request; BeforeToolCallEvent fires before every tool call.
reset clears the per-request counters so limits apply per invocation, not for the agent's lifetime.
check increments the count and, on overflow, sets event.cancel_tool to a message. Strands  skips the tool and feeds that message back to the model as the result - so the model learns why and stops retrying.
Part 2: Attach the Hook to the Agent
Pass hooks via the hooks parameter. The agent calls your code at the right lifecycle points - no change to the tools or system prompt.

1
2
3
4
5
6
7
8
9
10
from customer_service_tools import lookup_customer, get_order_history, process_refund

agent = Agent(
    tools=[lookup_customer, get_order_history, process_refund],
    hooks=[RateLimiterHook(max_calls=3)],
    system_prompt="You are a customer service agent. Be helpful and concise.",
)

# Normal request - well under the limit
result = agent("I'm customer C-1001. What are my recent orders?")

Part 3: Trigger the Rate Limit
Lower the limit and ask for something that forces many tool calls. Watch the hook block the excess.

1
2
3
4
5
6
7
8
9
10
agent = Agent(
    tools=[lookup_customer, get_order_history, process_refund],
    hooks=[RateLimiterHook(max_calls=2)],  # Lower limit to trigger faster
    system_prompt="You are a customer service agent. Be helpful and concise.",
)

result = agent(
    "Look up customers C-1001, C-1002, C-1003, C-1004, and C-1005. "
    "Give me all their details."
)

After the second lookup_customer call, the hook cancels further calls and the model adapts - it stops hammering the tool and reports what it has.

Key Takeaways
Hooks add deterministic control to a probabilistic loop - limits run every time, not when the model feels like it.
HookProvider + register_hooks - bind callbacks to lifecycle events like BeforeInvocationEvent and BeforeToolCallEvent.
event.cancel_tool - skip a tool and tell the model why, so it course-corrects.
Hooks don't touch tools or prompts - they're a separate, reusable layer.
Alternative: Run Python Apps
1
2
cd /workshop/02-hooks
pip install -r requirements.txt

Open module-02-hooks.ipynb in Code Editor and run the cells top to bottom.

Multi-turn conversation (chat.py)
In the notebook, each cell is a single turn. For a back-and-forth conversation with the rate-limited agent, run the companion script in a terminal:

1
2
cd /workshop/02-hooks
python chat.py

Type your messages, and quit (or Ctrl+C) to exit. The rate limiter resets at the start of each turn, and the agent keeps its context across turns.

Next Steps
Hooks give low-level control over the loop. In Module 3: Skills + Steering, you'll add workflow knowledge (skills) and higher-level business-rule enforcement (steering handlers).

Additional Resources
Strands Agents - Hooks 
Strands Agents - Agent Loop 
