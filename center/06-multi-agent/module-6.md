Module 6: Multi-Agent (Optional)
Overview
Optional module
This is an optional, advanced extension. You've already built and deployed a complete agent in Modules 1–5. This module adds delegation on top of that same agent - take it if you want to go further, or skip ahead to the Wrap-Up.

Add agent delegation. When the customer service agent hits a technical issue, it escalates to a tech support specialist - a separate agent with its own tools and system prompt. This is the agents-as-tools  pattern: an orchestrator calls a specialist like any other function.

Time to complete: 15 minutes

What you'll build
An orchestrator agent that delegates device problems to a focused specialist, while handling order and account questions itself.

Select the repository Python environment
When you open this module's notebook, select the repository's `.venv` kernel (top-right Select Kernel → Python Environments). Use the same environment in every module so the installed Strands packages are available.

Now let's look at some code. The snippets below already live in the module notebook - this page walks through and explains them. You run the cells in the notebook; you don't need to retype anything here.

Architecture
Agent delegation flow

With agents-as-tools, the orchestrator treats a specialist agent as just another tool. It delegates a subtask, the specialist runs its own loop (with its own tools), returns findings, and the orchestrator synthesizes the final answer for the customer.

Part 1: Build the Specialist's Tools
The tech support specialist gets tools the orchestrator doesn't have - device diagnostics and compatibility checks.

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
from strands import Agent, tool


@tool
def check_device_compatibility(device: str, issue: str) -> str:
    """Check if a device has known compatibility issues.

    Args:
        device: The device name or model
        issue: Description of the issue
    """
    known_issues = {
        "Wireless Headphones": "Known Bluetooth pairing issue. Fix: reset (hold power 10s), re-pair.",
        "Mechanical Keyboard": "Firmware v2.1 has a key-ghosting bug. Update to v2.3.",
    }
    for name, fix in known_issues.items():
        if name.lower() in device.lower():
            return f"Known issue for {name}: {fix}"
    return f"No known issues for '{device}'. Try standard troubleshooting."


@tool
def run_diagnostic(device: str) -> str:
    """Run a remote diagnostic check on a device.

    Args:
        device: The device name or model to diagnose
    """
    return (
        f"Diagnostic results for {device}:\n"
        f"- Firmware: v2.1 (update available: v2.3)\n"
        f"- Connection: Stable\n"
        f"- Battery: 85%\n"
        f"- Last sync: 2 hours ago\n"
        f"Recommendation: Update firmware to resolve known issues."
    )

Part 2: Wrap the Specialist as a Tool
The @tool decorator turns an entire agent into a callable tool. Inside the function, you build a specialist agent and return its response as a string.

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
@tool
def tech_support_specialist(issue_description: str) -> str:
    """Escalate a technical issue to the tech support specialist agent.
    Use this for device problems, connectivity, or troubleshooting beyond
    basic order/account help.

    Args:
        issue_description: The technical issue, including device name and symptoms
    """
    specialist = Agent(
        tools=[check_device_compatibility, run_diagnostic],
        system_prompt="""You are a tech support specialist for an electronics store.
Diagnose device issues, check compatibility, and provide step-by-step fixes.
Be technical but clear. Always give actionable next steps.""",
        callback_handler=None,  # Silent - don't stream the specialist's output to the user
    )
    return str(specialist(issue_description))

What this does:

The docstring tells the orchestrator when to delegate - this is the routing logic, expressed in natural language.
The specialist is a full Agent with a narrow focus and its own tools.
callback_handler=None runs it silently, so only the orchestrator's final reply reaches the customer.
Returning str(response) hands the specialist's answer back as the tool result.
Part 3: The Orchestrator
The customer service agent now lists tech_support_specialist alongside its own tools. It decides when to delegate based on the prompt.

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
SYSTEM_PROMPT = """You are a customer service agent for an online electronics store.
You handle account lookups, order status, and refunds.

For TECHNICAL issues (device problems, connectivity, firmware, troubleshooting),
delegate to the tech_support_specialist tool with the device name and a clear
description. Then relay the solution to the customer in a friendly, non-technical way."""

orchestrator = Agent(
    tools=[lookup_customer, get_order_history, process_refund, tech_support_specialist],
    system_prompt=SYSTEM_PROMPT,
)

# Technical issue → delegates to the specialist
orchestrator("I'm C-1001. My wireless headphones won't pair with my phone, "
             "even after restarting them.")

# Simple order question → handled directly, no delegation
orchestrator("I'm C-1002. Where is my keyboard order?")

The first prompt triggers delegation; the second stays with the orchestrator. The model routes based on the tool descriptions - you never wrote an if statement.

Key Takeaways
Agents-as-tools - wrap a specialist agent in @tool and the orchestrator calls it like a function.
The docstring is the routing logic - it tells the orchestrator when to delegate.
Specialists are focused - narrow system prompt, only the tools they need.
callback_handler=None keeps sub-agents silent - only the orchestrator's reply reaches the user.
Alternative: Run Python Apps
1
2
cd /workshop/06-multi-agent
pip install -r requirements.txt

Open module-06-multi-agent.ipynb in Code Editor and run the cells top to bottom.

Multi-turn conversation (chat.py)
In the notebook, each cell is a single turn. For a back-and-forth conversation with the orchestrator - which delegates technical issues to the specialist on any turn - run the companion script in a terminal:

1
2
cd /workshop/06-multi-agent
python chat.py

Type your messages, and quit (or Ctrl+C) to exit. The orchestrator keeps its context across turns and routes each message to the specialist or handles it directly.

Next Steps
The agent delegates correctly - but how do you know it behaves correctly at scale? In Module 7: Evals (Optional), you'll write automated evaluations for both output quality and tool trajectories.

Additional Resources
Strands Agents - Agents as Tools 
Strands Agents - Multi-Agent Patterns 
