Module 7: Evals (Optional)
Overview
Optional module
This is an optional, advanced extension. You've already built and deployed a complete agent in Modules 1–5. This module adds automated evaluation on top of that same agent - take it if you want to measure quality rigorously, or finish at the Wrap-Up.

Run automated evaluations against the customer service agent: an output eval  (is the response good?) and a trajectory eval  (did it follow the right workflow?). Evals  turn "it seems to work" into measurable, repeatable quality checks - essential before you ship.

Time to complete: 13 minutes

What you'll build
Output evaluation - OutputEvaluator scores responses with LLM-as-a-judge.
Trajectory evaluation - TrajectoryEvaluator checks the agent called tools in the correct order, validating your Module 3 steering handlers.
Select the repository Python environment
When you open this module's notebook, select the repository's `.venv` kernel (top-right Select Kernel → Python Environments). Use the same environment in every module so the installed Strands and eval packages are available.

Now let's look at some code. The snippets below are condensed to highlight the key idea - the complete, runnable version (including the good-vs-bad agent comparison) lives in the module notebook. This page walks through and explains it; you run the cells in the notebook, and don't need to retype anything here.

This module uses the strands-agents-evals package (imported as strands_evals).

Architecture
Evaluation pipeline flow

Test cases run against the agent, then evaluators score the results: the OutputEvaluator judges response quality, the TrajectoryEvaluator validates tool-usage order, and scores aggregate into a pass/fail report.

Part 1: Output Evaluation - Is the Response Good?
The OutputEvaluator uses LLM-as-a-judge to score responses against an expected output and a rubric.

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
38
from strands import Agent
from strands_evals import eval_task, Case, Experiment
from strands_evals.evaluators import OutputEvaluator
from customer_service_tools import lookup_customer, get_order_history, process_refund


@eval_task()
def get_response():
    return Agent(
        tools=[lookup_customer, get_order_history, process_refund],
        system_prompt="You are a customer service agent. Verify the customer first.",
        callback_handler=None,
    )


output_cases = [
    Case[str, str](
        name="order-status-check",
        input="I'm customer C-1001. Where is my USB-C Hub order?",
        expected_output="The USB-C Hub is shipped, tracking TRK-887766, ETA 2025-05-06.",
    ),
    Case[str, str](
        name="unknown-customer",
        input="I'm customer C-9999. What are my orders?",
        expected_output="Inform the customer no account was found and ask them to verify.",
    ),
]

output_evaluator = OutputEvaluator(
    rubric="""Evaluate the response for: (1) Accuracy vs. expected info,
    (2) Tone - professional and empathetic, (3) Completeness.
    Score 1.0 if all met, 0.5 if partial, 0.0 if inadequate.""",
    include_inputs=True,
)

experiment = Experiment[str, str](cases=output_cases, evaluators=[output_evaluator])
report = experiment.run_evaluations(get_response)
report.display()

What this does:

@eval_task() wraps a factory that returns a fresh agent per case.
Case defines an input and the expected_output to judge against.
OutputEvaluator scores each response with the rubric you provide.
Experiment.run_evaluations(...) runs every case and returns a report.
Part 2: Trajectory Evaluation - Did It Follow the Workflow?
The TrajectoryEvaluator checks the sequence of tool calls - perfect for validating that your refund workflow runs in order (lookup_customer → get_order_history → process_refund).

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
38
39
from strands_evals.evaluators import TrajectoryEvaluator
from strands_evals.extractors import tools_use_extractor
from strands_evals.types import TaskOutput


def get_response_with_trajectory(case: Case) -> TaskOutput:
    agent = Agent(
        tools=[lookup_customer, get_order_history, process_refund],
        system_prompt="""When processing refunds you MUST: (1) look up the customer,
        (2) check order history, (3) then process the refund. Always in that order.""",
        callback_handler=None,
    )
    response = agent(case.input)
    trajectory = tools_use_extractor.extract_agent_tools_used_from_messages(agent.messages)
    return TaskOutput(output=str(response), trajectory=trajectory)


trajectory_cases = [
    Case[str, str](
        name="refund-workflow",
        input="Customer C-1001 wants a refund for order ORD-5521 ($79.99). Process it.",
        expected_trajectory=["lookup_customer", "get_order_history", "process_refund"],
    ),
    Case[str, str](
        name="customer-lookup-only",
        input="Look up customer C-1002's account info.",
        expected_trajectory=["lookup_customer"],
    ),
]

trajectory_evaluator = TrajectoryEvaluator(
    rubric="""Did the agent follow the expected tool sequence (extra tools between are OK)?
    Score 1.0 if correct order, 0.5 if wrong order, 0.0 if expected tools missing.""",
    include_inputs=True,
)

experiment = Experiment[str, str](cases=trajectory_cases, evaluators=[trajectory_evaluator])
report = experiment.run_evaluations(get_response_with_trajectory)
report.display()

What this does:

tools_use_extractor pulls the ordered list of tools the agent actually called from agent.messages.
expected_trajectory is the sequence you require.
TrajectoryEvaluator compares the two - a direct, automated test of your steering rules.
Output vs. Trajectory
Eval	Question it answers	Evaluator
Output	Is the final response correct and helpful?	OutputEvaluator
Trajectory	Did the agent call the right tools in order?	TrajectoryEvaluator
Key Takeaways
Evals make quality measurable - Case + Experiment + an evaluator.
Output evals judge the answer - LLM-as-a-judge against a rubric.
Trajectory evals judge the process - verify tool order, validating steering.
Run them in CI - catch regressions before deployment.
Alternative: Run Python Apps
1
2
cd /workshop/07-evals
pip install -r requirements.txt

Open module-07-evals.ipynb in Code Editor and run the cells top to bottom. requirements.txt adds strands-agents-evals.

Next Steps
The agent is validated - and you've already deployed it back in Module 5. That completes the workshop. Continue to the Wrap-Up for a recap and next steps.

Additional Resources
Strands Evals - Quickstart 
Strands Evals - Output Evaluator 
Strands Evals - Trajectory Evaluator 
strands-agents-evals on PyPI 
