Wrap-Up & Next Steps
What You Learned
Congratulations! You built a production-ready customer service agent from scratch and deployed it to Amazon Bedrock AgentCore - adding one capability per module.

Module 1: Agent Loop + Tools

✅ Defined tools as @tool functions with model-readable docstrings
✅ Ran the agent loop and inspected agent.messages and result.metrics
Module 2: Hooks

✅ Added a RateLimiterHook to cap runaway tool calls
✅ Used BeforeInvocationEvent and BeforeToolCallEvent for deterministic control
Module 3: Skills + Steering

✅ Loaded markdown skills on demand with AgentSkills
✅ Enforced a refund workflow with a deterministic steering handler
✅ Added an LLM-based tone guardrail
Module 4: Session Managers

✅ Persisted conversations with FileSessionManager
✅ Restarted the agent and restored memory by session_id
Module 5: Deploy

✅ Wrapped the agent in BedrockAgentCoreApp with @app.entrypoint
✅ Deployed and invoked it with the agentcore CLI
Module 6: Multi-Agent (Optional)

✅ Wrapped a specialist agent as a tool (agents-as-tools)
✅ Let the orchestrator route technical issues by docstring
Module 7: Evals (Optional)

✅ Scored responses with OutputEvaluator (LLM-as-a-judge)
✅ Validated tool order with TrajectoryEvaluator
Resources
Official Documentation
Strands Agents Documentation 
Strands Agents GitHub 
Amazon Bedrock AgentCore Documentation 
AWS Resources
Amazon Bedrock Documentation 
Amazon Bedrock Pricing 
Standards and Protocols
Agent Skills Specification 
Model Context Protocol (MCP) 
Workshop Repository
Full Workshop Code 
All examples and notebooks are in /workshop/samples/ on your Code Editor instance
What to Build Next
You now have a reusable harness. Adapt it to your own domain:

1. IT Helpdesk Agent
Tools: ticket system API, knowledge base search, password reset
Steering: require identity verification before account changes
2. DevOps Assistant
Tools: CloudWatch logs, cost explorer, deployment status
Hooks: approval before any destructive AWS operation
3. Research Assistant
Tools: web search, document reader, citation manager
Sessions: remember research context across days
4. Order Operations Agent
Multi-agent: delegate returns, fraud checks, and shipping to specialists
Evals: trajectory tests for each workflow
Share Your Feedback
Found a bug? Open an issue on the workshop repository 
Have a suggestion? Submit feedback via the workshop portal
Want More?
This is Workshop 1 of a series. A follow-on workshop covers production operations with AgentCore - Gateway and Lambda tools, IAM-authenticated MCP, managed memory, and observability. See the repository for details.

You're Ready to Build
You've built an agent that uses tools, enforces rules, remembers conversations, and runs on managed infrastructure - plus, if you took the optional modules, one that also delegates and is automatically tested. You're ready to build your own.

Next: Cleanup
Head to Cleanup before you finish.

Workshop Studio (provided account): nothing to do - AWS removes everything automatically when the event ends.
Your own AWS account: delete the CloudFormation stack (and any Module 5 deployment) to avoid ongoing charges.