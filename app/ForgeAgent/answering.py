"""Bounded recovery when a model returns internal analysis but no public answer."""
from forge_harness import clean_answer
from strands.types.exceptions import MaxTokensReachedException
import re


def requested_word_limit(prompt):
    number = r'(one|two|three|four|five|six|seven|eight|nine|ten|\d+)'
    match = re.search(r'(?:at most|no more than|just|only|exactly)\s+' + number + r'\s+words?\b', prompt, re.I)
    if not match:
        match = re.search(r'\b' + number + r'\s+words?\s+or\s+(?:fewer|less)\b', prompt, re.I)
    if not match:
        return None
    value = match[1].lower()
    return int(value) if value.isdigit() else ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'].index(value) + 1


def needs_repair(prompt, answer):
    limit = requested_word_limit(prompt)
    if limit and len(answer.split()) > limit:
        return True
    if re.search(r'^\s*(?:No tools?(?: use)?(?: is| are)? (?:needed|required)\b|Action:\s*\w+\(|<calculate\b)', answer, re.I):
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
    try:
        result = await agent.invoke_async(prompt)
    except MaxTokensReachedException:
        # Strands retains the partial message; continue once inside the same budget.
        result = ''
    try:
        answer = clean_answer(result)
    except ValueError:
        answer = ''
    if answer and not needs_repair(prompt, answer):
        return answer
    limit = requested_word_limit(prompt)
    if answer and limit and len(answer.split()) > limit:
        # Preserve context and meaning; never cut a requested draft mid-sentence.
        result = await agent.invoke_async(
            f"Rewrite your last answer in at most {limit} words. Keep the same facts "
            "and answer the current request. Give only the answer, with no greeting or explanation."
        )
        return clean_answer(result)
    # Reuse the agent and its shared request budget; never retry indefinitely.
    result = await agent.invoke_async(
        "Provide a complete final answer to the original request now. Aim for 52 "
        "words or fewer unless completeness or the requested format needs more. Follow its requested number of items and put each on a separate line. "
        "If it asks for a draft with unknown or conflicting facts, draft it now using "
        "clear placeholders for those fields. Conflicting dates are alternative dates, "
        "not a multi-day event: use [date to be confirmed]. Do not invent facts or ask for them again. "
        "Give the answer itself, without XML, file paths, or tool-planning commentary."
    )
    return clean_answer(result)
