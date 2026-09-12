"""Validate the repository without making model or AWS calls."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def check_markdown_links() -> list[str]:
    errors = []
    # Restrict this to actual Markdown links. The module guides intentionally
    # show Python snippets outside fenced blocks, and Python calls also use
    # parentheses.
    link_pattern = re.compile(r"\[[^]\n]*\]\(((?:\.\.?/)[^)\n]+)\)")
    for path in ROOT.rglob("*.md"):
        text = re.sub(r"```.*?```", "", path.read_text(encoding="utf-8"), flags=re.S)
        for match in link_pattern.finditer(text):
            target = match.group(1).split("#", 1)[0].strip("<>")
            if not target or "://" in target or target.startswith("mailto:"):
                continue
            if not (path.parent / target).exists():
                errors.append(f"{path.relative_to(ROOT)} -> {target}")
    return errors


def main() -> int:
    errors: list[str] = []

    for path in ROOT.rglob("*.ipynb"):
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"invalid notebook JSON: {path.relative_to(ROOT)}: {exc}")

    errors.extend(check_markdown_links())

    for module in ("03-skills", "04-session"):
        for name in ("account-troubleshooting", "order-tracking", "refund-processing"):
            path = ROOT / module / "skills" / name / "SKILL.md"
            if not path.is_file():
                errors.append(f"missing skill: {path.relative_to(ROOT)}")

    result = subprocess.run(
        ["python", "-m", "compileall", "-q", str(ROOT)],
        cwd=ROOT,
        check=False,
    )
    if result.returncode:
        errors.append("Python compilation failed")

    if errors:
        print("Repository validation failed:")
        print("\n".join(f"- {error}" for error in errors))
        return 1

    print("Repository validation passed: notebooks, links, skills, and Python syntax are valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
