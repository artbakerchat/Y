Module 4: Session Managers
Overview
Add file-based persistence to the customer service agent. Stop it, restart it, and watch it remember the previous conversation. A session manager  saves conversation state outside the agent process, so a new agent with the same session_id picks up where the last one left off.

Time to complete: 10 minutes

What you'll build
An agent backed by FileSessionManager that saves conversation history to disk and reloads it on restart.

Select the repository Python environment
When you open this module's notebook, select the repository's `.venv` kernel (top-right Select Kernel → Python Environments). Use the same environment in every module so the installed Strands packages are available.

Now let's look at some code. The snippets below already live in the module notebook - this page walks through and explains them. You run the cells in the notebook; you don't need to retype anything here.

Architecture
Session persistence flow

The session manager persists state separately from the agent. FileSessionManager writes local JSON files (great for development); S3SessionManager stores state in the cloud (for production). Recreate the agent with the same session_id and the prior conversation is restored.

Part 1: The Problem - No Persistence
By default, an agent's memory lives only in memory. Recreate it and the history is gone.

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
from strands import Agent
from customer_service_tools import lookup_customer, get_order_history, process_refund

agent = Agent(
    tools=[lookup_customer, get_order_history, process_refund],
    system_prompt="You are a customer service agent. Use prior context if available.",
)
agent("Hi, I'm customer C-1001. Can you look up my account?")

# Simulate a restart - a brand new instance
agent2 = Agent(
    tools=[lookup_customer, get_order_history, process_refund],
    system_prompt="You are a customer service agent. Use prior context if available.",
)
agent2("What was my account status again?")  # agent2 has no memory of C-1001

agent2 starts with zero messages - it never met C-1001.

Part 2: Add a FileSessionManager
FileSessionManager saves the conversation to disk under a session_id. Pass it via session_manager.

Two different managers
The agent below uses two complementary pieces. A session manager (FileSessionManager) persists the conversation outside the process so it survives restarts - that's this module's focus. A conversation manager (SlidingWindowConversationManager) bounds what's kept in context on each call so it doesn't grow without limit. They solve different problems and work together: one stores history, the other trims what the model sees.

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
from strands import Agent, AgentSkills
from strands.agent.conversation_manager import SlidingWindowConversationManager
from strands.session.file_session_manager import FileSessionManager

session_manager = FileSessionManager(
    session_id="customer-session-001",
    storage_dir="./sessions",
)

agent = Agent(
    tools=[lookup_customer, get_order_history, process_refund],
    plugins=[AgentSkills(skills=["./skills"])],
    system_prompt="You are a customer service agent. Use prior context if available.",
    conversation_manager=SlidingWindowConversationManager(window_size=20),
    # Alternative: context_manager="auto" uses SummarizingConversationManager with
    # proactive compression — smarter than a sliding window but not yet in the official docs.
    session_manager=session_manager,
)

# This interaction is saved to ./sessions automatically
agent("Hi, I'm customer C-1001. Can you look up my account?")

What this does:

session_id is the key under which the conversation is stored - reuse it to resume.
storage_dir is where the JSON files are written.
SlidingWindowConversationManager(window_size=20) keeps the most recent 20 messages in the model's context so it doesn't grow unbounded - persistence and context management work together.
Alternative: context_manager="auto" (available in the SDK) uses SummarizingConversationManager with proactive compression instead of simple truncation — a smarter approach. Check the Strands changelog  for when it lands in the official docs.
Part 3: Restart and Remember
Create a fresh agent with the same session_id. It reloads the saved messages on construction.

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
session_manager_2 = FileSessionManager(
    session_id="customer-session-001",   # same ID
    storage_dir="./sessions",
)

agent_restarted = Agent(
    tools=[lookup_customer, get_order_history, process_refund],
    plugins=[AgentSkills(skills=["./skills"])],
    system_prompt="You are a customer service agent. Use prior context if available.",
    context_manager="auto",
    session_manager=session_manager_2,
)

print(f"Restored messages: {len(agent_restarted.messages)}")
agent_restarted("What orders do I have? You should already know my customer ID.")

The restarted agent already knows it's talking to C-1001 - no need to ask again. FileSessionManager stores state in nested folders under ./sessions/session_<id>/ (session, agent, and per-message JSON files), so explore that tree to see exactly what was saved.

Key Takeaways
Session managers persist state outside the process - memory survives restarts.
session_id is the resume key - same ID, same conversation.
FileSessionManager for local, S3SessionManager for production - same interface, different backend.
Pair it with a conversation manager  - keep context bounded while history persists.
Alternative: Run Python Apps
1
2
cd /workshop/04-session
pip install -r requirements.txt

Open module-04-session-managers.ipynb in Code Editor. Session files are written to a local sessions/ folder.

Multi-turn conversation (chat.py)
In the notebook, each cell is a single turn. For a back-and-forth conversation with the persistent agent, run the companion script in a terminal:

1
2
cd /workshop/04-session
python chat.py

Type your messages, and quit (or Ctrl+C) to exit. Because it uses FileSessionManager, this is also the persistence demo: quit and run it again to restore the conversation. Use --session-id <name> to keep separate sessions.

Next Steps
The agent is persistent and follows rules. It's now complete enough to ship. In Module 5: Deploy, you'll package this same agent and deploy it to Amazon Bedrock AgentCore Runtime with a single CLI command.

Additional Resources
Strands Agents - Session Management 
Strands Agents - Conversation Management 
Amazon S3 Documentation 
