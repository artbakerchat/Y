"""Bee pairing actions for the Y public website runtime.

The device flow runs the official Bee CLI inside the microVM:
  pair        -> spawn `bee login` (interactive, headless-safe); it mints the
                 pairing request, prints the approval link, and blocks polling
                 for approval. We return the pairing URL from pairing-prod.json.
  pair_status -> pending | approved | expired. Approval is detected by the
                 `token-prod` file the CLI writes (raw token, mode 0o600).
  disconnect  -> kill the login process and wipe the session config dir.

All state lives under /tmp/bee-<session> so it dies with the microVM.
The raw token is returned to the Worker exactly once (on approval); the
Worker encrypts it into Workers KV. Chat sessions receive the token back
in their invocation payload.
"""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import time
from datetime import datetime, timezone

PAIRING_FILE = "pairing-prod.json"
TOKEN_FILE = "token-prod"  # no .json extension; raw token bytes, mode 0o600
PID_FILE = "pair.pid"
LOGIN_TIMEOUT_S = 30


def _read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _proc_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except (OSError, ValueError):
        return False
    return True


def _pair_pid(config_dir: str) -> int | None:
    try:
        with open(os.path.join(config_dir, PID_FILE), "r", encoding="utf-8") as fh:
            return int(fh.read().strip())
    except (OSError, ValueError):
        return None


def _kill_pair_process(config_dir: str) -> None:
    pid = _pair_pid(config_dir)
    if pid and _proc_alive(pid):
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass


def pair(bee_bin: str, env: dict, config_dir: str) -> dict:
    """Mint a new pairing request. Any previous pairing state is discarded."""
    _kill_pair_process(config_dir)
    for stale in (PAIRING_FILE, TOKEN_FILE, PID_FILE):
        try:
            os.remove(os.path.join(config_dir, stale))
        except OSError:
            pass

    stdout_path = os.path.join(config_dir, "pair.out")
    with open(stdout_path, "w", encoding="utf-8") as out:
        proc = subprocess.Popen(
            [bee_bin, "login"],
            env=env,
            stdout=out,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
    with open(os.path.join(config_dir, PID_FILE), "w", encoding="utf-8") as fh:
        fh.write(str(proc.pid))

    # The CLI writes pairing-prod.json within a second or two of minting.
    pairing = None
    for _ in range(40):  # up to ~10s
        pairing = _read_json(os.path.join(config_dir, PAIRING_FILE))
        if pairing and pairing.get("pairingUrl"):
            break
        if proc.poll() is not None:
            break  # died before minting; fall through to the error below
        time.sleep(0.25)

    if not pairing or not pairing.get("pairingUrl"):
        return {"ok": False, "error": "bee login did not mint a pairing request"}

    return {
        "ok": True,
        "pairing_url": pairing.get("pairingUrl"),
        "request_id": pairing.get("requestId"),
        "expires_at": pairing.get("expiresAt"),
    }


def _is_expired(pairing: dict | None) -> bool:
    if not pairing:
        return False
    expires_at = pairing.get("expiresAt")
    if not expires_at:
        return False
    try:
        exp = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
        return datetime.now(timezone.utc) >= exp
    except ValueError:
        return False


def _read_token(config_dir: str) -> str | None:
    try:
        with open(os.path.join(config_dir, TOKEN_FILE), "r", encoding="utf-8") as fh:
            token = fh.read().strip()
            return token or None
    except OSError:
        return None


def pair_status(bee_bin: str, env: dict, config_dir: str) -> dict:
    """Poll the in-flight pairing. Never blocks."""
    token = _read_token(config_dir)
    pairing = _read_json(os.path.join(config_dir, PAIRING_FILE))
    pid = _pair_pid(config_dir)
    alive = _proc_alive(pid) if pid else False

    if token:
        # Approved. Reap the login process if it already exited.
        if not alive and pid:
            try:
                os.remove(os.path.join(config_dir, PID_FILE))
            except OSError:
                pass
        return {
            "ok": True,
            "status": "approved",
            "bee_token": token,
            "request_id": (pairing or {}).get("requestId"),
        }

    if _is_expired(pairing):
        _kill_pair_process(config_dir)
        return {"ok": True, "status": "expired"}

    if not alive and pairing and pairing.get("requestId"):
        # Process died without producing a token and the request is not
        # marked expired: treat as expired so the visitor can retry cleanly.
        return {"ok": True, "status": "expired"}

    return {
        "ok": True,
        "status": "pending",
        "request_id": (pairing or {}).get("requestId"),
        "expires_at": (pairing or {}).get("expiresAt"),
    }


def ensure_login(bee_bin: str, env: dict, config_dir: str, bee_token: str) -> dict:
    """Seed this session's config dir with the visitor's token (raw write,
    same bytes the CLI itself stores: token-prod, mode 0o600). Verifies with
    `bee me --json`: it fails fast on a bad token (socket closed), while
    `bee status` instead retries "Network connection issue" up to 10 times.
    Validity = stdout parses as JSON. A timeout or non-JSON output means the
    token is stale and the visitor must reconnect."""
    token_path = os.path.join(config_dir, TOKEN_FILE)
    fd = os.open(token_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(bee_token)

    try:
        proc = subprocess.run(
            [bee_bin, "me", "--json"],
            env=env,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Bee token check timed out; please reconnect"}
    try:
        profile = json.loads(proc.stdout)
    except ValueError:
        return {"ok": False, "error": "Bee token no longer valid; please reconnect"}
    if not isinstance(profile, dict) or not profile:
        return {"ok": False, "error": "Bee token no longer valid; please reconnect"}
    return {"ok": True}


def disconnect(config_dir: str) -> dict:
    """Purge everything this session stored: token, pairing state, data dir."""
    _kill_pair_process(config_dir)
    shutil.rmtree(config_dir, ignore_errors=True)
    return {"ok": True}


def whoami(bee_bin: str, env: dict, config_dir: str) -> dict:
    """Return the Bee account profile for the session's token.

    The exact JSON shape of `bee me --json` is only known once a real
    login exists, so the full parsed payload is returned and the caller
    picks a stable account id defensively.
    """
    try:
        proc = subprocess.run(
            [bee_bin, "me", "--json"],
            env=env,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "bee me timed out"}
    # NOTE: `bee me` exits 0 even when the token is bad (it prints a socket
    # error to stdout), so validity is judged by JSON parsing, not returncode.
    try:
        profile = json.loads(proc.stdout)
    except ValueError:
        return {"ok": False, "error": "bee me failed: not logged in"}
    if not isinstance(profile, dict) or not profile:
        return {"ok": False, "error": "bee me failed: not logged in"}
    account_id = None
    if isinstance(profile, dict):
        for key in ("id", "userId", "user_id", "sub", "accountId", "email"):
            value = profile.get(key)
            if isinstance(value, str) and value.strip():
                account_id = value.strip()
                break
    return {"ok": True, "account_id": account_id, "profile": profile}
