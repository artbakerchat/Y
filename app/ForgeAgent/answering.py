"""Bounded recovery when a model returns internal analysis but no public answer."""
from forge_harness import clean_answer
import re


def needs_repair(prompt, answer):
    if re.fullmatch(r'No tools?(?: use)?(?: is| are)? (?:needed|required)[.!]?', answer, re.I):
        return True
    if answer == '/dev/null' or re.fullmatch(r'\S*/SKILL\.md', answer):
        return True
    # A draft with explicitly unknown details can use placeholders immediately.
    if (re.search(r'\b(write|draft|rewrite)\b', prompt, re.I)
            and re.search(r'not yet|not set|without guessing|unknown|unconfirmed', prompt, re.I)
            and answer.endswith('?') and len(answer.split()) < 25):
        return True
    requested = re.search(r'exactly (three|[1-9])\b.*\bline\b', prompt, re.I)
    if requested:
        count = 3 if requested[1].lower() == 'three' else int(requested[1])
        lines = [line for line in answer.splitlines() if line.strip()]
        listed = [line for line in lines if re.match(r'^\s*(?:\d+[.)]|[-*])\s+', line)]
        return len(listed or lines) != count
    return False


async def answer_request(agent, prompt):
    result = await agent.invoke_async(prompt)
    try:
        answer = clean_answer(result)
    except ValueError:
        answer = ''
    if answer and not needs_repair(prompt, answer):
        return answer
    # Reuse the agent and its shared request budget; never retry indefinitely.
    result = await agent.invoke_async(
        "Provide a complete final answer to the original request now, in at most 52 "
        "words. Follow its requested number of items and put each on a separate line. "
        "If it asks for a draft with unknown or conflicting facts, draft it now using "
        "clear placeholders for those fields. Conflicting dates are alternative dates, "
        "not a multi-day event: use [date to be confirmed]. Do not invent facts or ask for them again. "
        "Give the answer itself, without XML, file paths, or tool-planning commentary."
    )
    return clean_answer(result)
