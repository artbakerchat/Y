Module 1: Agent Loop + Tools

Overview
Build a customer service agent that looks up customers, checks orders, and processes refunds - then watch the agent loop  run. The agent loop is the orchestration layer of the harness - the core that every other layer (hooks, memory, deployment) wraps around. This is the foundation for every other module: you'll reuse this same agent and these same tools  throughout the workshop.

Time to complete: 12 minutes

What you'll build
A working agent and a clear view of the loop it runs: Input & Context → Reasoning (LLM) → Tool Selection → Tool Execution → Response.

Before you run the notebook
Open samples/01-agent-loop-tools/module-01-agent-loop-tools.ipynb in Code Editor. If prompted, click Trust, then Select Kernel → Python Environments → /usr/bin/python3.13. Use this same kernel in every module - otherwise cells fail with ModuleNotFoundError: No module named 'strands'. See Setup for details.

Now let's look at some code. The snippets below already live in the module notebook - this page walks through and explains them. You run the cells in the notebook; you don't need to retype anything here.

Architecture
Agent loop flow

The agent loop is the cycle Strands  runs on every request. Following the official Strands terminology:

Input & Context - the user prompt (plus conversation history) enters the loop.
Reasoning (LLM) - the model (Claude on Amazon Bedrock) reasons about what to do.
Tool Selection - if it needs data, the model selects a tool to call.
Tool Execution - your Python function runs; its result feeds back into Reasoning for another round.
Response - once the model has enough information, the loop exits and returns the answer.
You write the tools; Strands runs the loop.

Part 1: Define Your Tools
Tools are plain Python functions decorated  with @tool. The model reads each docstring to decide when to call them - no manual routing, no if/else dispatch.

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

from strands import Agent, tool


@tool
def lookup_customer(customer_id: str) -> str:
    """Look up a customer by their ID.

    Args:
        customer_id: The customer ID (e.g. C-1001)
    """
    customer = CUSTOMERS.get(customer_id)
    if not customer:
        return f"No customer found with ID {customer_id}"
    return (
        f"Customer: {customer['name']}\n"
        f"Email: {customer['email']}\n"
        f"Account Status: {customer['account_status']}"
    )

What this does:

@tool registers the function with the agent and exposes its signature to the model.
The docstring is the model's instruction manual - the first line says what the tool does, and Args: documents each parameter. Write it for the model, not just for humans.
The return value (a string here) becomes the tool result fed back into the loop.
The workshop defines three tools in customer_service_tools.py: lookup_customer, get_order_history, and process_refund. They return mock data so you can focus on agent behavior, not a backend.

Part 2: Create and Run the Agent
Wire the tools into an Agent with a system prompt, then ask it to help a customer.

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

SYSTEM_PROMPT = """You are a customer service agent for an online electronics store.
Be helpful, professional, and concise. Use the available tools to look up customer
information and process requests.

Important guidelines:
- Always verify the customer using lookup_customer before taking action.
- Use tool data to answer questions - don't ask for info you already have.
- Be warm but efficient."""

agent = Agent(
    tools=[lookup_customer, get_order_history, process_refund],
    system_prompt=SYSTEM_PROMPT,
)

result = agent("Hi, I'm customer C-1001. Can you check on my recent orders?")

What this does:

tools=[...] gives the agent its capabilities.
system_prompt sets behavior and guardrails in natural language.
Calling agent(prompt) runs the full loop and returns a result object.
By default Strands uses Amazon Bedrock (Claude), so there are no model arguments to configure here.

Part 3: Inspect the Agent Loop
The loop isn't a black box. Every step is recorded in agent.messages, and result.metrics reports cycles and token usage.

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

import json

print(f"Total messages: {len(agent.messages)}")

for msg in agent.messages:
    role = msg["role"]
    for block in msg.get("content", []):
        if "text" in block:
            print(f"{role}: {block['text'][:100]}")
        elif "toolUse" in block:
            tu = block["toolUse"]
            print(f"tool call: {tu['name']}({json.dumps(tu.get('input', {}))})")

print(f"Cycles: {result.metrics.get_summary()['total_cycles']}")
print(f"Tokens: {result.metrics.accumulated_usage['totalTokens']}")

What this does:

agent.messages is the running conversation - user turns, assistant text, and toolUse / tool-result blocks. Reading it is the best way to understand what the model actually did.
result.metrics exposes the number of loop cycles and total tokens - your first signal for cost and latency.
Key Takeaways
Tools are decorated Python functions - @tool plus a clear docstring is all the model needs.
The system prompt sets behavior - guardrails and tone live in natural language.
Strands defaults to Amazon Bedrock - no provider config needed to start.
The loop is inspectable - agent.messages and result.metrics show every step.
Alternative: Run Python Apps
The notebook is the primary path. To explore the tools as a standalone module:

1
2

cd /workshop/samples/01-agent-loop-tools
pip install -r requirements.txt

Then open module-01-agent-loop-tools.ipynb in Code Editor and run the cells top to bottom.

Multi-turn conversation (chat.py)
In the notebook, each cell is a single turn - you call agent("...") once and read the reply. For a back-and-forth conversation where the agent remembers earlier turns, run the companion script in a terminal:

1
2

cd /workshop/samples/01-agent-loop-tools
python chat.py

Type your messages, and quit (or Ctrl+C) to exit. It reuses one Agent instance, so context persists across turns via agent.messages.

Troubleshooting
Symptom	Resolution
Unable to locate credentials	Confirm AWS credentials: aws sts get-caller-identity
AccessDeniedException on Bedrock	The first call to a model auto-initiates access in the background, which can take a couple of minutes; just re-run the cell and it succeeds. Foundation models are enabled by default - you don't need to request access manually. (Anthropic models need a one-time use-case form per account, submitted automatically on first use.)
ModuleNotFoundError: strands	Run pip install -r requirements.txt in the module folder
Next Steps
The agent works, but it has no guardrails - a runaway loop could call the same tool dozens of times. In Module 2: Hooks, you'll add a rate limiter with deterministic code that intercepts the loop.

Additional Resources
Strands Agents - Quickstart 
Strands Agents - Tools 
Strands Agents - Custom Tools (@tool) 
Amazon Bedrock Documentation 