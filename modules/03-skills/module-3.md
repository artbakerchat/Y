Module 3: Skills + Steering
Overview
Give the agent workflow knowledge with skills  (markdown procedures it loads on demand) and enforce business rules with steering handlers  - a deterministic refund-workflow enforcer and an LLM-based tone guardrail. Skills suggest the right steps; steering enforces them.

Time to complete: 15 minutes

What you'll build
Skills - SKILL.md files the agent activates for step-by-step procedures.
Deterministic steering - RefundWorkflowHandler blocks process_refund until the customer and order history have been checked.
LLM steering - ToneGuardrailHandler reviews each response for professionalism.
Select the Python 3.13 kernel
When you open this module's notebook, pick the /usr/bin/python3.13 kernel (top-right Select Kernel → Python Environments) - the same one from Module 1. Each notebook asks again, so the person running it knows which to choose. A different kernel fails with ModuleNotFoundError: No module named 'strands'.

Now let's look at some code. The snippets below are condensed to highlight the key idea - the complete, runnable version lives in the module notebook. This page walks through and explains it; you run the cells in the notebook, and don't need to retype anything here.

Architecture
Skills are markdown documents the agent discovers and loads only when relevant, so procedures don't bloat the system prompt:

Skills architecture

Steering handlers sit inside the loop and apply rules every turn - the deterministic RefundWorkflowHandler gates the refund tool, and the LLM-based ToneGuardrailHandler checks each response before it reaches the customer:

Steering flow

Part 1: Skills - Workflow Knowledge
A skill is a SKILL.md file with frontmatter (name, description) and a procedure in the body. The agent reads the descriptions, then loads the full skill only when it's relevant - a pattern called progressive disclosure.

The workshop ships three skills in the skills/ folder:

refund-processing - how to handle refund requests
order-tracking - how to check order status
account-troubleshooting - how to handle account issues
Load them with the AgentSkills plugin:

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
from strands import Agent, AgentSkills
from customer_service_tools import lookup_customer, get_order_history, process_refund

skills_plugin = AgentSkills(skills=["./skills"])

agent = Agent(
    tools=[lookup_customer, get_order_history, process_refund],
    plugins=[skills_plugin],
    system_prompt="You are a customer service agent. Activate the appropriate "
                  "skill for step-by-step guidance.",
)

# The agent activates the refund-processing skill to guide its workflow
result = agent("Hi, I'm customer C-1001. I'd like a refund for my wireless headphones.")

What this does:

AgentSkills(skills=["./skills"]) registers every SKILL.md under that folder.
The agent activates a skill on demand and follows its numbered steps (verify customer → check order → confirm → process refund → set expectations).
Part 2: Deterministic Steering - Enforce the Workflow
Skills are guidance the model can ignore. A steering handler is enforcement it can't. RefundWorkflowHandler subclasses SteeringHandler and blocks process_refund until lookup_customer and get_order_history have both succeeded.

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
32
33
34
35
36
37
from strands.vended_plugins.steering import (
    SteeringHandler, Proceed, Guide, ToolSteeringAction, LedgerProvider,
)


class RefundWorkflowHandler(SteeringHandler):
    """Enforce refund workflow ordering: lookup → orders → refund."""

    name = "refund-workflow"

    def __init__(self):
        super().__init__(context_providers=[LedgerProvider()])

    async def steer_before_tool(self, *, agent, tool_use, **kwargs) -> ToolSteeringAction:
        if tool_use.get("name") != "process_refund":
            return Proceed(reason="Not a refund operation")

        ledger = self.steering_context.data.get("ledger", {})
        tool_calls = ledger.get("tool_calls", [])

        customer_verified = any(
            c["tool_name"] == "lookup_customer" and c["status"] == "success"
            for c in tool_calls
        )
        if not customer_verified:
            return Guide(reason="You must look up the customer with lookup_customer "
                                "before processing a refund.")

        order_checked = any(
            c["tool_name"] == "get_order_history" and c["status"] == "success"
            for c in tool_calls
        )
        if not order_checked:
            return Guide(reason="You must check the order history with "
                                "get_order_history before processing a refund.")

        return Proceed(reason="Refund workflow validated")

What this does:

steer_before_tool runs before each tool call. It returns Proceed to allow the call or Guide to block it and send the model corrective instructions.
LedgerProvider gives the handler a record of prior tool calls and their status - that's how it knows whether the prerequisites ran.
The sample also validates that the refund amount matches the order - see steering_handlers.py for the full version.
Part 3: LLM-Based Steering - Tone Guardrail
Some rules are too fuzzy for if/else. ToneGuardrailHandler subclasses LLMSteeringHandler and uses a second model call to review each response against communication guidelines.

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
from strands.vended_plugins.steering import LLMSteeringHandler


class ToneGuardrailHandler(LLMSteeringHandler):
    """Evaluates response tone and professionalism after each model turn."""

    name = "tone-guardrail"

    def __init__(self):
        super().__init__(
            system_prompt="""You are evaluating a customer service agent's responses.
Ensure the agent:
- Doesn't overpromise or guarantee timelines beyond what the system confirms
- Doesn't blame the customer or other departments
- Acknowledges frustration before jumping to solutions
- Keeps responses concise and actionable
- Never shares internal system details or jargon

If the agent violates any of these, provide specific guidance on what to fix."""
        )

What this does:

LLMSteeringHandler runs steer_after_model - it judges the drafted response and either approves it (Proceed) or returns guidance (Guide) for the agent to revise.
Deterministic vs. LLM steering: use deterministic handlers for hard rules (ordering, validation) and LLM handlers for judgment calls (tone, completeness).
Part 4: Full Agent with Skills + Steering
Steering handlers are plugins , so they go in the same plugins list as skills.

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
agent = Agent(
    tools=[lookup_customer, get_order_history, process_refund],
    plugins=[
        AgentSkills(skills=["./skills"]),
        RefundWorkflowHandler(),
        ToneGuardrailHandler(),
    ],
    system_prompt="You are a customer service agent. Be helpful and concise.",
)

# Steering enforces: lookup → orders → refund - even if asked to skip ahead
result = agent(
    "I'm customer C-1001. I want a refund for order ORD-5521. Please process it."
)

Even with a permissive prompt like "process refunds immediately when asked," the deterministic handler still blocks the shortcut and forces the lookup first.

Key Takeaways
Skills suggest, steering enforces - markdown procedures vs. always-applied handlers.
AgentSkills enables progressive disclosure - load procedures only when relevant.
Deterministic steering for hard rules - steer_before_tool returns Proceed or Guide.
LLM steering for judgment calls - LLMSteeringHandler reviews responses after the model turn.
Both are plugins - they compose in the same plugins=[...] list.
Alternative: Run Python Apps
1
2
cd /workshop/samples/03-skills-steering
pip install -r requirements.txt

Open module-03-skills-steering.ipynb in Code Editor. The steering handlers live in steering_handlers.py and the skills in skills/.

Multi-turn conversation (chat.py)
In the notebook, each cell is a single turn. For a back-and-forth conversation - skills and steering handlers active on every turn - run the companion script in a terminal:

1
2
cd /workshop/samples/03-skills-steering
python chat.py

Type your messages, and quit (or Ctrl+C) to exit. The agent keeps its context across turns, so the refund workflow enforcement plays out over a real conversation.

Next Steps
The agent is smart and safe, but it forgets everything between sessions. In Module 4: Session Managers, you'll add persistence so it remembers previous conversations.

Additional Resources
Strands Agents - Skills 
Strands Agents - Steering 
Strands Agents - Plugins 