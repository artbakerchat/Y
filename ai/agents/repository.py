"""Bounded access to tracked source in this machine's checkout."""
import os
from pathlib import Path
import subprocess
from strands import tool


def repository_root() -> Path:
    return Path(os.environ.get("AGENT_REPO_DIR", Path(__file__).resolve().parents[2])).resolve()


def tracked_files() -> list[str]:
    result = subprocess.run(["git", "ls-files", "-z"], cwd=repository_root(),
                            capture_output=True, check=True, timeout=10)
    return [name for name in result.stdout.decode().split("\0") if name]


@tool
def list_repository_files(prefix: str = "") -> str:
    """List up to 300 tracked source paths, optionally restricted to a prefix."""
    return "\n".join([name for name in tracked_files() if name.startswith(prefix)][:300])[:16000]


@tool
def read_repository_file(path: str, start_line: int = 1) -> str:
    """Read up to 200 lines of tracked source, starting at a one-based line."""
    root = repository_root()
    target = root / path
    if path not in tracked_files() or target.is_symlink() or not target.resolve().is_relative_to(root):
        return "Only tracked files inside this repository can be read."
    if any(part.startswith(".env") or part in {".git", ".aws", ".ssh"} for part in Path(path).parts):
        return "Credential and environment files cannot be read."
    if start_line < 1 or target.stat().st_size > 1_000_000:
        return "Invalid line number or file exceeds the 1 MB reading limit."
    try:
        lines = target.read_text().splitlines()
    except UnicodeError:
        return "This file is not UTF-8 text."
    return "\n".join(f"{number}: {line}" for number, line in
                     enumerate(lines[start_line - 1:start_line + 199], start_line))[:16000]


REPOSITORY_TOOLS = [list_repository_files, read_repository_file]
