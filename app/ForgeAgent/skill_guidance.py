"""Load relevant, profile-authorized instructions without a model filesystem tool."""
import re
from pathlib import Path

# These terms are too broad to distinguish a skill from ordinary conversation.
GENERIC_KEYWORDS = {'request', 'offer', 'neighbour', 'understand', 'explore', 'formal', 'casual'}


def select_skill_guidance(root, profile_id, prompt):
    matches = []
    for path in sorted(Path(root).glob('*/SKILL.md')):
        text = path.read_text()
        parts = text.split('---', 2)
        if len(parts) != 3 or parts[0].strip():
            continue
        metadata = dict(line.split(':', 1) for line in parts[1].splitlines() if ':' in line)
        allowed = [item.strip().strip('\"\'') for item in metadata.get('agents', '').split(',')]
        if '*' not in allowed and profile_id not in allowed:
            continue
        keywords = [item.strip().lower() for item in metadata.get('keywords', '').split(',')]
        score = sum(bool(re.search(r'(?<!\w)' + re.escape(word) + r'(?!\w)', prompt.lower()))
                    for word in keywords if word and word not in GENERIC_KEYWORDS)
        if score:
            matches.append((score, path.name, parts[2].strip()))
    selected = sorted(matches, key=lambda item: -item[0])[:2]
    return '\n\n'.join(body for _, _, body in selected)
