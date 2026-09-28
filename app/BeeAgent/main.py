"""Y BeeAgent: AgentCore runtime for the public Bee-connect website.

No logins, no accounts. A visitor connects their Bee device (device flow),
and gets a chat agent with full beeplex tools running in an isolated
microVM session. One microVM per active session; each session gets its own
BEE_CONFIG_DIR under /tmp, which dies with the microVM.

Payload actions:
  pair         Mint a Bee pairing request (returns pairing URL for the QR).
  pair_status  Poll the pairing: pending | approved | expired.
  chat         Chat with the visitor's Bee data. Payload carries the Bee
               token (the Worker holds it encrypted in KV); the session
               seeds its own config dir from it.
  disconnect   Purge this session's Bee credentials from the microVM.

Money: the Worker enforces the $5/week-per-Bee-account budget, rate limits,
and the 3-strikes ban before invoking. This runtime only does the work.
"""

from __future__ import annotations

import os
import sys

from bedrock_agentcore.runtime import BedrockAgentCoreApp

import bee_pairing
import bee_chat

app = BedrockAgentCoreApp()

_HERE = os.path.dirname(os.path.abspath(__file__))
BEE_BIN = os.environ.get("BEE_CLI") or os.path.join(_HERE, "bee")
try:
    if os.path.isfile(BEE_BIN):
        os.chmod(BEE_BIN, 0o755)
except OSError:
    pass


def _session_id(context) -> str:
    try:
        return str(getattr(context, "session_id", None) or "default-session")
    except Exception:
        return "default-session"


def _config_dir(session_id: str) -> str:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in session_id)[:64]
    path = os.path.join("/tmp", f"bee-{safe or 'default'}")
    os.makedirs(path, exist_ok=True)
    return path


def _bee_env(config_dir: str) -> dict:
    env = dict(os.environ)
    env["BEE_CONFIG_DIR"] = config_dir
    env["BEE_FORCE_FILE_STORE"] = "1"
    env["BEE_CLI"] = BEE_BIN
    env["BEEPLEX_DATA_DIR"] = os.path.join(config_dir, "beeplex-data")
    env.pop("BEEPLEX_DEMO", None)  # never demo mode on the website
    return env


@app.entrypoint
async def invoke(payload, context):
    """Dispatch on payload["action"]. Always returns a JSON-serializable dict."""
    action = (payload or {}).get("action", "chat")
    session_id = _session_id(context)
    config_dir = _config_dir(session_id)
    env = _bee_env(config_dir)

    try:
        if action == "pair":
            return bee_pairing.pair(BEE_BIN, env, config_dir)

        if action == "pair_status":
            return bee_pairing.pair_status(BEE_BIN, env, config_dir)

        if action == "disconnect":
            return bee_pairing.disconnect(config_dir)

        if action == "whoami":
            return bee_pairing.whoami(BEE_BIN, env, config_dir)

        if action == "chat":
            return await bee_chat.chat(BEE_BIN, env, config_dir, payload or {})

        return {"ok": False, "error": f"unknown action: {action}"}
    except Exception as exc:  # never leak a stack trace to the visitor
        return {"ok": False, "error": f"agent error: {type(exc).__name__}"}


if __name__ == "__main__":
    app.run()
