Module 5: Deploy to AgentCore Runtime
Overview
Deploy the agent you built in Modules 1–4 to Amazon Bedrock AgentCore Runtime  - a managed runtime for hosting agents with no servers to manage. You bring your existing main.py; the agentcore CLI  packages and deploys it.

Time to complete: 15 minutes

What you'll build
Your existing agent wrapped in BedrockAgentCoreApp with an @app.entrypoint, deployed to AgentCore Runtime and invoked from the CLI and from code (boto3).

Architecture
AgentCore deployment architecture

The agentcore CLI packages your agent code, zips it to an Amazon S3 staging bucket (Direct Code Deploy - no container), and provisions the AgentCore Runtime via AWS CloudFormation. The same customer service agent you built in Modules 1–4 - tools, steering, sessions - now runs inside the Runtime, with no servers to manage.

Deploy (green): you run agentcore deploy; the agent code is packaged to S3 and the Runtime is provisioned.
Invoke (blue): you call agentcore invoke (or the AWS SDK); the hosted agent runs and returns a response.
What is AgentCore?
Amazon Bedrock AgentCore is a managed runtime for hosting AI agents in production - serverless, auto-scaling, with built-in observability. You bring the agent code; AgentCore handles the infrastructure.

Part 1: The Deployment Code (main.py)
The only difference between a local agent and a deployed one is the entry point. Locally you call agent(prompt); on AgentCore you expose a handler that receives a payload and returns a response. The workshop's main.py wraps the same agent - same tools, steering handlers, and conversation manager - behind that handler.

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
from bedrock_agentcore.runtime import BedrockAgentCoreApp

app = BedrockAgentCoreApp()

@app.entrypoint
def invoke(payload, context):
    prompt = payload.get("prompt")
    if not prompt:
        raise ValueError("Missing required field: prompt")
    agent = get_agent()
    response = agent(prompt)
    return str(response).strip()

if __name__ == "__main__":
    app.run()

What this does:

BedrockAgentCoreApp() creates the runtime app.
@app.entrypoint marks the handler AgentCore calls on each invocation - it receives payload (a dict with the user prompt) and context.
Returning str(response).strip() sends the reply back as plain text. (Return a dict like {"response": ...} instead if you want callers to get JSON.)
app.run() lets you run the same file locally as an HTTP server.
The agent inside main.py is exactly the one from earlier modules (it imports customer_service_tools.py and steering_handlers.py). Deployment doesn't rewrite your agent; it wraps it.

Part 2: Install the AgentCore CLI
Already installed in Workshop Studio
On the Workshop Studio Code Editor, the agentcore CLI is already installed - skip this step and go to Part 3. You only need to install it when running the workshop locally from a clone of the repo.

The agentcore CLI  is distributed on npm and needs Node.js 20+. A global install needs root, so use sudo:

1
sudo npm install -g @aws/agentcore

Don't mix the old CLI
An older agentcore CLI shipped in the bedrock-agentcore-starter-toolkit pip package and used a configure command that no longer exists here. If you have it installed, remove it so it doesn't shadow the new one: pip uninstall bedrock-agentcore-starter-toolkit.

Part 3: Deploy with the AgentCore CLI
Run these from /workshop/05-deploy.

Step 1 - Create the project
1
2
cd /workshop/05-deploy
agentcore create

agentcore create is interactive: enter a project name, then at "What would you like to build?" choose Skip ("I'll add resources later"). This creates the project shell (an agentcore/ folder with config + CDK infrastructure). It does not generate agent code - you bring your own next.

Step 2 - Add your agent (Bring Your Own Code)
Move into the project folder the CLI just created, then add the agent:

1
2
cd <project-name>
agentcore add

Choose agent, then walk through the wizard:

Prompt	Choose
Name	MyAgent (or your own)
Type	Bring my own code
Code location	press Enter for the default app/MyAgent/
Entrypoint	press Enter for the default main.py
Build	Direct Code Deploy (zips to S3 - no container)
Model provider	Amazon Bedrock
Advanced	press Enter to accept defaults
Confirm	review and press Enter
Step 3 - Copy your agent code into app/MyAgent/
add created an empty app/MyAgent/ folder. Copy your agent into it:

1
2
cp ../main.py ../customer_service_tools.py ../steering_handlers.py ../requirements.txt app/MyAgent/

(Adjust MyAgent to the name you chose.)

Step 4 - Set up dependencies in app/MyAgent/
agentcore deploy builds from a pyproject.toml in the agent folder (a plain requirements.txt is not enough). Generate it with uv and add the dependencies:

1
2
3
4
cd app/MyAgent
uv init --bare --python 3.13
uv add strands-agents bedrock-agentcore aws-opentelemetry-distro boto3
cd ../..

Why this step matters
uv init --bare creates the pyproject.toml without overwriting your main.py, and uv add writes the dependencies. Skip it and agentcore deploy fails with Required project file not found: .../pyproject.toml.

Step 5 - Test locally with agentcore dev (local machine only)
This step only works on your own computer, not in Workshop Studio
agentcore dev starts a local web UI and tries to open a browser. The Workshop Studio Code Editor environment has no browser/display (no xdg-open), so the inspector can't open there. On Workshop Studio, skip to Step 6 (Deploy) and test with agentcore invoke. Use agentcore dev only when running the workshop locally.

On a local machine:

1
agentcore dev

This starts a local server and opens the agent inspector in your browser (http://localhost:8081). Chat with the agent there to confirm it works, then press Ctrl+C to stop.

Step 6 - Deploy
1
agentcore deploy

This validates the project, synthesizes CloudFormation, zips your code to an Amazon S3 staging bucket, and provisions the AgentCore Runtime. The first deploy takes a few minutes; later updates reuse cached dependencies.

Step 7 - Invoke
1
agentcore invoke "Hi, I'm customer C-1001. What are my recent orders?"

The prompt is a positional argument. Use --session-id to keep context across calls. The session ID must be at least 33 characters - a shorter one fails with a validation error (see Troubleshooting):

1
agentcore invoke --session-id customer-1001-session-refund-000001 "I need a refund for order ORD-5521"

Run agentcore invoke with no prompt to open an interactive chat against the deployed agent.

Part 4: Invoke from Code (boto3)
agentcore invoke is for testing from the terminal. In production you call the deployed runtime with the AWS SDK - same agent, the production path. Get the runtime ARN with agentcore status, then:

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
import json, uuid, boto3

# Paste the ARN from `agentcore status`
agent_arn = "arn:aws:bedrock-agentcore:us-east-1:<account>:runtime/<project>_<name>-XXXXXXXXXX"

client = boto3.client("bedrock-agentcore", region_name="us-east-1")
response = client.invoke_agent_runtime(
    agentRuntimeArn=agent_arn,
    runtimeSessionId=str(uuid.uuid4()),  # must be 33+ chars; a uuid4 satisfies that
    payload=json.dumps({"prompt": "Hi, I'm customer C-1001. What are my recent orders?"}).encode(),
    qualifier="DEFAULT",
)
print("".join(chunk.decode("utf-8") for chunk in response.get("response", [])))

Part 5: Observability
Once deployed, the agent sends telemetry to Amazon CloudWatch - which tools it called, token usage, errors, and latency. aws-opentelemetry-distro (in your dependencies) is what lets AgentCore emit spans and traces; you write no observability code.

Runtime logs are captured automatically under /aws/bedrock-agentcore/. View them with agentcore logs or in the CloudWatch console.
Spans and traces: enable CloudWatch Transaction Search once per account (CloudWatch console → Application Signals (APM) → Transaction search), then view traces on the GenAI Observability page, or with agentcore traces.
The same agent, now observable in production
The metrics you printed locally with result.metrics in Module 1 are now collected for every production invocation - with no extra code, because aws-opentelemetry-distro is in your dependencies.

Key Takeaways
AgentCore wraps your existing agent - the only change is the @app.entrypoint handler.
Bring Your Own Code - agentcore add registers your main.py; you don't rewrite the agent.
The flow is create → add → dev → deploy → invoke - all agentcore commands.
uv init + uv add is required - deploy builds from a pyproject.toml.
Observability is built in - every production invocation is traced to CloudWatch.
Troubleshooting
Symptom	Resolution
unknown command 'configure'	You have the old CLI. Use agentcore create + agentcore add. Uninstall the old toolkit: pip uninstall bedrock-agentcore-starter-toolkit.
agentcore deploy fails with Required project file not found: .../pyproject.toml	The agent folder (app/MyAgent/) has no pyproject.toml. Run Step 4: cd app/MyAgent && uv init --bare --python 3.13 && uv add strands-agents bedrock-agentcore aws-opentelemetry-distro boto3.
npm error code EACCES on npm install -g	A global npm install needs root - use sudo npm install -g @aws/agentcore. (Already installed in Workshop Studio.)
Pydantic / OpenTelemetry ImportError warning when running agentcore	Harmless noise from a stale old-CLI install. Uninstall it: pip uninstall bedrock-agentcore-starter-toolkit.
agentcore deploy fails on region	The region comes from agentcore/aws-targets.json. Make sure its region is us-east-1.
AccessDeniedException on Bedrock	The first call to a model auto-initiates access in the background; wait a couple of minutes and retry.
Value at 'runtimeSessionId' failed to satisfy constraint: Member must have length greater than or equal to 33	The --session-id passed to agentcore invoke is too short - AgentCore requires session IDs of 33+ characters. Use a longer ID (e.g. customer-1001-session-refund-000001) or a UUID.
No bootstrap step needed
The Workshop Studio account is already CDK-bootstrapped when it's provisioned, so agentcore deploy works without any cdk bootstrap step. (If you run this workshop locally in your own account instead, agentcore deploy bootstraps the environment automatically on first use.)

Cleanup
When you're done, tear down the AWS resources this module created. Cleanup is two steps: reset the project config, then deploy the empty state so AWS removes the resources.

1
2
agentcore remove all -y
agentcore deploy

agentcore remove all -y only resets the local config (it does not touch AWS yet); the follow-up agentcore deploy is what actually deletes the AgentCore Runtime and its CloudFormation stack.

Core Path Complete
You've built and deployed a production customer service agent from scratch:

✅ Agent Loop + Tools - core agent with customer service capabilities
✅ Hooks - rate limiting via deterministic code in the loop
✅ Skills + Steering - workflow knowledge and business-rule enforcement
✅ Session Managers - persistent memory across restarts
✅ Deploy - production deployment on AgentCore Runtime, with observability in CloudWatch
Optional Modules
Want to go further? Two advanced extensions build on this same agent:

Module 6: Multi-Agent (Optional) - delegate technical issues to a specialist agent.
Module 7: Evals (Optional) - measure agent quality automatically with LLM-as-a-judge.
Continue to Module 6: Multi-Agent, or jump straight to the Wrap-Up for next steps and resources.

Additional Resources
AgentCore CLI (GitHub) 
Direct code deployment for Python 
Amazon Bedrock AgentCore Documentation 
Strands Agents - Deploy to Bedrock AgentCore (Python) 
