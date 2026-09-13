# AgentCore deployment

This is the selected deployment target. Eight profiles run in the Python Strands runtime, with a nested language specialist. `agent_id: "word-specialist"` also invokes the specialist directly. The Node harness and EC2 files are optional alternatives.

Verified deployment (2026-09-13): `larboard_forge_agents-5C4THCBvpZ`, version 3, is READY in `ca-central-1`, using the repository artifact `052b8922…`. Live website checks passed for AgentCore routing, conversation recall, and profile isolation. Offline checks passed: the repository JavaScript and Python harness suites (including all eight profile configurations).

The runtime has a shared per-request ceiling of 10 model calls and 6 tool calls, a 90-second deadline, per-tool limits, profile-specific tools and prompts, palette prerequisites, and response cleanup that preserves complete answers, with a default target of 52 words or fewer. Operational input values must appear in user-supplied context; this is a conservative input check, not a complete fact verifier. Logs contain profile/tool names and call counts, not prompt text.

Prepare and test:

The shared conversational policy is bundled in `app/ForgeAgent/conversation_policy.json`. Packaging requires Node.js 22+ to check it against `agentcore/conversation-policy.js` before creating or uploading an artifact. Policy changes take effect in production after redeploying the relevant runtime and Worker artifacts.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
npm test
npm run check
.venv/bin/python scripts/evaluate_agentcore.py
.venv/bin/pip install --target .data/agentcore-package --platform manylinux2014_aarch64 --python-version 3.12 --only-binary=:all: -r requirements.txt
```

Build dependencies in a fresh target directory when versions change. AgentCore requires ARM64-compatible dependencies. This uses the [AWS direct-code deployment workflow](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-code-deploy-python.html).

Deploy with an existing artifact bucket and execution role:

```bash
.venv/bin/python scripts/deploy_agentcore.py --bucket BUCKET --role-arn ROLE_ARN
```

The script uploads a content-addressed ZIP and creates `larboard_forge_agents`. It records the runtime ID/ARN in ignored `.data/agentcore-deployment.json`. Subsequent runs only update that recorded runtime after verifying its name. It never adopts or modifies another runtime merely because it exists. `--package-only` builds without AWS writes.

The deployment identity needs S3 upload and AgentCore create/update/get permissions plus permission to pass the existing role. The runtime role needs read access to the uploaded ZIP, Bedrock model invocation permissions, and logging. This workflow does not alter role policies. AgentCore and Bedrock usage incur charges.

After deployment, wait until `get-agent-runtime` reports `READY`, then run:

```bash
.venv/bin/python scripts/evaluate_agentcore.py --runtime-arn RUNTIME_ARN
```

Keep concrete runtime ARNs in ignored local state or secrets. The website selects AgentCore through its existing `AGENTCORE_RUNTIME_ARN` Worker secret; deploying a runtime does not change that secret automatically.

To connect a verified deployment and test the website:

```bash
node scripts/connect-agentcore.js
node scripts/verify-agentcore-connection.js https://larboard.ca
```

If the Worker has a stale or unauthorized AWS credential set, `node scripts/connect-agentcore.js --sync-aws` synchronizes the currently resolved AWS credentials through Wrangler's secret input. Values are never printed or written to source files. Temporary credentials require renewal before expiry. The deployed connection was tested with the synchronized credentials.

The Worker parses bounded AgentCore SSE responses and uses a stable profile-scoped runtime session derived from the browser session. `src/legacy-global-timer.js` preserves the existing Durable Object implementation solely for deployment compatibility; removing that export would require a separate storage migration. Its old website route remains removed.

Conversation history is isolated by runtime session and profile. With no external session store configured, history uses the runtime's temporary filesystem and survives turns only while that AgentCore session remains alive. It is not durable across runtime replacement or session expiry. Configure `FORGE_SESSION_BUCKET` for S3 persistence or `FORGE_SESSION_TABLE` for DynamoDB, with appropriate permissions and retention. Rate enforcement for public website users remains in the Worker; direct runtime invocations require AWS IAM authorization.

Smoke evaluations exercise all nine roles but do not establish perfect output or factual accuracy. Review answers and traces before broad release.

The [expanded quality report](../../evaluations/2026-09-12/REPORT.md) supersedes smoke checks as evidence about answer quality. The repository improvements are deployed in runtime version 3. Python injects relevant, profile-authorized skill instructions directly, uses a bounded calculator, retains direct specialist history, and allows one repair attempt for empty answers or obvious output-contract failures within the existing request budget. Canada-only Nova Lite remains the default; `quality.env.example` is an explicit global-routing option, not an automatic fallback.
