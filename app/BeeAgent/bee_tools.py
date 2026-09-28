"""Strands tools for the Y BeeAgent chat action.

Each tool shells out to the vendored beeplex package
(`python -m python <command> --json`) -- the same subprocess pattern the
Y Node server uses for its 11 bee_* tools. The subprocess inherits
BEE_CLI (bundled arm64 bee binary), BEE_CONFIG_DIR (this session's
visitor token), and BEEPLEX_DATA_DIR from the ambient environment.

Report/diary tools return generated files as base64 so the Worker can
serve them as downloads without any object store.
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import sys

from strands import tool

TOOL_TIMEOUT_S = 120
MAX_STDOUT = 2 * 1024 * 1024

# Populated by report/diary tools during an agent run; bee_chat.chat()
# drains it into the Worker response. Kept out of the agent's context.
ATTACHMENTS: list[dict] = []

_MIME = {
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".html": "text/html",
    ".md": "text/markdown",
}


def _run_beeplex(command: str, *args: str) -> dict:
    """Run one beeplex command and return its parsed JSON payload."""
    cmd = [sys.executable, "-m", "python", command, "--json", *args]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=TOOL_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        return {"error": f"beeplex {command} timed out after {TOOL_TIMEOUT_S}s"}
    out = (proc.stdout or "")[-MAX_STDOUT:]
    if proc.returncode != 0:
        err = (proc.stderr or "").strip()[-500:]
        return {"error": f"beeplex {command} failed: {err or out[-500:]}"}
    try:
        return json.loads(out)
    except ValueError:
        return {"error": f"beeplex {command} returned non-JSON output"}


def _attach_files(payload: dict) -> dict:
    """Stash generated report files for the Worker response (base64), while
    showing the agent only names/sizes -- a base64 docx would blow the
    context window."""
    files = []
    seen = set()
    candidates = []
    for key in ("files", "paths"):
        for path in payload.get(key) or []:
            candidates.append(path)
    for key in ("file", "path"):
        path = payload.get(key)
        if isinstance(path, str):
            candidates.append(path)
    for path in candidates:
        if not isinstance(path, str) or not os.path.isfile(path):
            continue
        if path in seen:
            continue
        seen.add(path)
        try:
            with open(path, "rb") as fh:
                raw = fh.read()
        except OSError:
            continue
        if len(raw) > 25 * 1024 * 1024:
            continue
        ext = os.path.splitext(path)[1].lower()
        files.append(
            {
                "name": os.path.basename(path),
                "mime": _MIME.get(ext, "application/octet-stream"),
                "size": len(raw),
                "b64": base64.b64encode(raw).decode("ascii"),
            }
        )
    if files:
        ATTACHMENTS.extend(files)
        payload = dict(payload)
        payload["attachments"] = [
            {"name": f["name"], "mime": f["mime"], "size": f["size"]} for f in files
        ]
    return payload


@tool
def bee_status() -> dict:
    """Check the Bee connection for this visitor."""
    return _run_beeplex("status")


@tool
def bee_context(limit: int = 10) -> dict:
    """Catch up on the visitor's recent memories (conversations, summaries)."""
    return _run_beeplex("context", "--limit", str(max(1, min(limit, 50))))


@tool
def bee_search(query: str, semantic: bool = False, limit: int = 10) -> dict:
    """Search the visitor's Bee memories for a topic or phrase."""
    args = [query, "--limit", str(max(1, min(limit, 50)))]
    if semantic:
        args.append("--semantic")
    return _run_beeplex("search", *args)


@tool
def bee_conversations(limit: int = 5, cursor: str = "") -> dict:
    """Browse the visitor's recent Bee conversations."""
    args = ["--limit", str(max(1, min(limit, 50)))]
    if cursor:
        args += ["--cursor", cursor]
    return _run_beeplex("conversations", *args)


@tool
def bee_read(conversation_id: str, offset: int = 0) -> dict:
    """Read a full Bee conversation transcript by its id."""
    return _run_beeplex("read", conversation_id, "--offset", str(max(0, offset)))


@tool
def bee_todos(limit: int = 20) -> dict:
    """List the visitor's commitments and action items from Bee."""
    return _run_beeplex("todos", "--limit", str(max(1, min(limit, 50))))


@tool
def bee_score(limit: int = 5) -> dict:
    """Score recent conversations: engagement, forward motion, depth."""
    return _run_beeplex("score", "--limit", str(max(1, min(limit, 50))))


@tool
def bee_disagree(limit: int = 10) -> dict:
    """Compare Bee's own summaries against beeplex's independent scores; flags disagreements."""
    return _run_beeplex("disagree", "--limit", str(max(1, min(limit, 50))))


@tool
def bee_report(limit: int = 10) -> dict:
    """Generate Word/Excel/PowerPoint reports plus a dashboard for recent conversations.

    Use when the visitor asks for files or a report. Returns the generated
    files inline (base64) so they can be downloaded from the chat.
    """
    payload = _run_beeplex("report", "--limit", str(max(1, min(limit, 50))))
    return _attach_files(payload)


@tool
def bee_diary(limit: int = 3) -> dict:
    """Write today's diary in Bee's reflective voice from listening history."""
    payload = _run_beeplex("diary", "--limit", str(max(1, min(limit, 10))))
    return _attach_files(payload)


@tool
def bee_profile(refresh: bool = False) -> dict:
    """Read the visitor's saved profile; refresh rebuilds it from Bee data."""
    args = ["--full"] if refresh else []
    if refresh:
        args.append("--refresh")
    return _run_beeplex("profile", *args)


BEE_TOOLS = [
    bee_status,
    bee_context,
    bee_search,
    bee_conversations,
    bee_read,
    bee_todos,
    bee_score,
    bee_disagree,
    bee_report,
    bee_diary,
    bee_profile,
]
