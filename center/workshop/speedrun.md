Strands Agents Hands-On: Build Your First Agent
Build a production-ready customer service agent step by step with Strands Agents - the open-source agent harness SDK. Strands is model-agnostic ("any model, any cloud") and runs on Amazon Bedrock by default. You'll start with a three-tool agent and finish by deploying it to Amazon Bedrock AgentCore, adding one capability per module.

What is an agent harness?
An agent harness is the system that lets an agent actually run: the orchestration loop that calls the model, decides which tool to invoke, passes results back, manages the context window, and handles failures - plus the infrastructure underneath it (compute, a code sandbox, secure tool connections, persistent storage, memory, identity, and observability).

Strands Agents is the open-source agent harness SDK. You don't just write a prompt - you build and control the whole harness: the loop, the tools, the hooks, the memory, the guardrails. That's the focus of this workshop. Each module adds one layer of the harness with Strands, and in Module 5 you deploy it to Amazon Bedrock AgentCore Runtime as the hosting layer.

Stage	What you do	With
Build the harness	Assemble the loop, tools, hooks, skills, and memory - controlling each layer	Strands Agents (Modules 1-4)
Run the harness	Host the same harness in production - managed compute, memory, identity, observability	Amazon Bedrock AgentCore Runtime (Module 5)
Go further (optional)	Add multi-agent delegation and automated evals on top of the deployed agent	Strands Agents (Modules 6-7)
Why harness, not just framework
A framework gives you the loop. A harness is the whole system that lets an agent run, and Strands is the open-source SDK for building it with end-to-end control - "build an agent harness, control it end-to-end." You then deploy that harness to Amazon Bedrock AgentCore Runtime  as the hosting layer.

Region Selection
This workshop deploys resources in us-east-1 to ensure Amazon Bedrock model availability. Make sure you're in the correct region before starting.

Costs
At an AWS-run event, the Workshop Studio account is provided at no cost to you. If you run this in your own AWS account, you pay for what you use - mainly Amazon Bedrock model calls (a few cents per module) and, in Module 5, the deployed agent on Amazon Bedrock AgentCore plus its supporting resources. Costs are small for a single run, but follow the Cleanup steps when you finish to avoid ongoing charges. See Amazon Bedrock pricing  and Amazon Bedrock AgentCore pricing .

Other agent frameworks
This workshop uses Strands Agents. The same patterns - tools, hooks, steering, sessions, delegation, evals, and managed deployment - are general agent concepts and carry over to other agent frameworks.

What You'll Build
One agent, built up across modules - each module adds a layer of the harness. By the end it will:

Run the agent loop with custom tools (customer lookup, orders, refunds)
Enforce safety with hooks (a rate limiter) and steering handlers (refund workflow + tone)
Load skills - markdown procedures activated on demand
Remember conversations across restarts with a session manager
Deploy to Amazon Bedrock AgentCore Runtime
Two optional modules then extend that same agent: delegate technical issues to a specialist agent, and validate it with automated evals (output quality + tool trajectory).

Workshop Modules
Module	Topic	Time	What You'll Build
Setup	Environment	10 min	Configure Code Editor and verify Bedrock access
Module 1	Agent Loop + Tools	12 min	Customer service agent with @tool functions; inspect the loop
Module 2	Hooks	10 min	A rate limiter that caps runaway tool calls
Module 3	Skills + Steering	15 min	Workflow skills + refund enforcement + tone guardrail
Module 4	Session Managers	10 min	Persistent memory across restarts
Module 5	Deploy	15 min	Deploy to Amazon Bedrock AgentCore Runtime
Module 6	Multi-Agent (optional)	15 min	Delegate to a tech support specialist
Module 7	Evals (optional)	13 min	Automated output + trajectory testing
Wrap-Up	Next Steps	5 min	Resources and project ideas
Cleanup	Cleanup	5 min	Delete resources to avoid charges
Total duration: ~90 minutes

Prior knowledge
This workshop assumes basic Python and general AWS familiarity. No prior experience with AI agents or LLMs is required. If you get stuck, see the Troubleshooting table in each module or raise your hand during a live session.

Prerequisites
Basic Python programming knowledge
General familiarity with AWS (no deep expertise required)
Understanding of JSON
Workshop Architecture
Your workshop environment includes:

EC2 instance running Amazon Linux 2023 with VS Code (Code Editor)
The repository Python environment with the Strands SDK and dependencies pre-installed
IAM roles with permissions for Amazon Bedrock and AgentCore
Sample code cloned to /workshop
All resources are provisioned automatically when you start the workshop.

Ready to Start?
Click Setup to begin configuring your environment.
