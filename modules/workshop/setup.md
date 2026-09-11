Setup
Choose your setup path based on whether you're attending the workshop through AWS Workshop Studio or running it locally.

Which Setup Should I Choose?
Factor	With AWS Account	Without AWS Account
Cost	Free (during workshop event)	Free (Ollama) or ~$0.05-0.15 (cloud providers)
Setup	Automatic (5-10 min)	Manual (10-15 min)
Model Quality	Claude (excellent)	Varies (Ollama good, cloud excellent)
Prerequisites	AWS Workshop Studio access	Python 3.10+, Git
Deployment (Module 5)	AgentCore deploy works	Local-only (skip deploy step)

With AWS Account (Workshop Studio)

Without AWS Account (Local)
What You Get
When you start the workshop, AWS Workshop Studio automatically provisions a complete development environment for you:

✅ Ready-to-Use Development Environment
Browser-based VS Code (Code Editor) - no local installation needed
Workshop repository pre-cloned at /workshop with all examples
Python 3.13 with all dependencies already installed
AWS CLI pre-configured - no credential setup required

✅ Pre-Installed Packages
Strands SDK (strands-agents>=1.42.0) - AI agent framework
Bedrock AgentCore (bedrock-agentcore) - managed runtime + CLI (Module 5)
Strands Evals (strands-agents-evals) - evaluation toolkit (Module 7, optional)
AWS SDK (boto3>=1.35.0) - for AWS integrations

✅ AWS Services Access (No Configuration Needed)
Amazon Bedrock - Claude model ready to use
Amazon Bedrock AgentCore - for the Module 5 deployment
AWS CLI - pre-configured with permissions

✅ Full Workshop Compatibility
All 7 modules work without modification
No API keys to manage
No credential configuration
Accessing Your Environment
Workshop Studio provisions your environment automatically (5-10 minutes) - you don't need to open the AWS Console or CloudFormation. When it's ready, the CodeEditorURL appears in the Event Outputs panel on the left side of this Workshop Studio page. Click that link to open your development environment.

Look in Workshop Studio, not the AWS Console
The CodeEditorURL is shown here in Workshop Studio (left sidebar → Event Outputs). You do not need to visit the CloudFormation console - provisioning happens for you in the background.

Next Steps
Continue to Module 1: Agent Loop + Tools to build your first AI agent.