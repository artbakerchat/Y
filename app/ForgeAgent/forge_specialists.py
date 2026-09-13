"""Specialist agents exposed through the Forge orchestrator."""

from strands import Agent, tool
from forge_harness import HarnessHook, configured_model, clean_answer
from forge_hooks import RateLimiterHook
from conversation_guidance import ANSWER_QUALITY_GUIDANCE
from conversation_policy import with_conversation_policy
from answering import answer_request
from calculator import calculate


WORD_DETAILS = {
    "sincere": {
        "etymology": "From Latin sincerus, meaning pure or genuine. The deeper origin is uncertain. The without-wax story is unsupported folk etymology.",
        "connotation": "Honesty and the absence of pretence.",
        "register": "neutral",
        "source": "https://www.etymonline.com/word/sincere",
    },
    "anchor": {
        "etymology": "Old English ancor, from Latin ancora, from Greek ankura. Related to the Greek ankos (bend).",
        "connotation": "Stability, grounding, constraint. Often connotes security but also immobility or being held back.",
        "register": "neutral / figurative in literary contexts",
    },
    "aurora": {
        "etymology": "Latin aurora (dawn). Cognate with Greek eos. Used since Classical Latin for the goddess of dawn.",
        "connotation": "Luminous beauty, rarity, renewal. Carries a sense of the sublime and the natural spectacular.",
        "register": "formal / poetic",
    },
    "cascade": {
        "etymology": "French cascade, from Italian cascata, from cascare (to fall). Entered English in the 17th century.",
        "connotation": "Abundance, inevitable progression, sometimes overwhelm. Strong visual and auditory imagery.",
        "register": "neutral / figurative",
    },
    "echo": {
        "etymology": "Latin echo, from Greek ēkhō. Derived from the myth of the nymph Echo. Also a common noun for reflected sound.",
        "connotation": "Repetition, longing, absence. Implies that something once full is now only a trace.",
        "register": "neutral / poetic",
    },
    "ember": {
        "etymology": "Old English æmerge (ashes, embers). Related to Old High German eimuria. No Latin root.",
        "connotation": "Dying warmth, persistence, potential for revival. Melancholic but not extinguished.",
        "register": "poetic / literary",
    },
    "horizon": {
        "etymology": "Latin horizon, from Greek horizōn (bounding circle), from horizein (to bound, limit). From horos (boundary).",
        "connotation": "Possibility, distance, the limit of the known. Carries optimism but also unreachability.",
        "register": "neutral / figurative",
    },
    "solitude": {
        "etymology": "Latin solitudo (loneliness, a lonely place), from solus (alone). In English since the 14th century.",
        "connotation": "Chosen aloneness vs. loneliness. Carries dignity when voluntary; melancholy when imposed.",
        "register": "formal / literary",
    },
}

DEEP_WORD_CLUSTERS = {
    "light": ["luminous", "aureate", "lambent", "incandescent", "phosphorescent", "crepuscular", "scintilla"],
    "dark": ["tenebrous", "umbral", "stygian", "cimmerian", "murk", "penumbra", "gloaming"],
    "water": ["riparian", "littoral", "pelagic", "thalassic", "lacustrine", "brackish", "abyssal"],
    "movement": ["peripatetic", "kinetic", "sinuous", "undulant", "mercurial", "flux", "torrent"],
    "silence": ["susurrus", "hush", "mute", "taciturn", "laconic", "quiescent", "still"],
    "time": ["ephemeral", "transient", "sempiternal", "diurnal", "vestigial", "archaic", "nascent"],
    "nature": ["sylvan", "arboreal", "lithic", "alluvial", "verdant", "boreal", "tidal"],
    "mind": ["liminal", "numinous", "ineffable", "noetic", "apophatic", "subliminal", "lucid"],
}


@tool
def look_up_word_details(word: str) -> str:
    """Look up stored etymology, connotation, and register data for a word."""
    entry = WORD_DETAILS.get(word.strip().lower())
    if not entry:
        return f'No stored reference for "{word}". A lookup found no evidence. Distinguish general knowledge from verified claims; do not invent an origin or citation.'
    return (
        f"Word: {word}\n"
        f"Etymology: {entry['etymology']}\n"
        f"Connotation: {entry['connotation']}\n"
        f"Register: {entry['register']}"
        + (f"\nReference: {entry['source']}" if entry.get('source') else "")
    )


@tool
def find_related_words_deep(theme: str) -> str:
    """Find richer, literary vocabulary related to a semantic theme."""
    normalized_theme = theme.strip().lower()
    key = next((name for name in DEEP_WORD_CLUSTERS if name in normalized_theme), "mind")
    return f'Deep vocabulary for theme "{theme}": {", ".join(DEEP_WORD_CLUSTERS[key])}'


@tool
async def consult_word_specialist(word: str, aspect: str = "connotation") -> str:
    """Delegate etymology, connotation, or poetic-use analysis to a word specialist.

    Args:
        word: The word to analyse.
        aspect: One of etymology, connotation, or poetic_use.
    """
    if not isinstance(word, str) or not word.strip() or len(word) > 100:
        raise ValueError("A word of 1–100 characters is required")
    if aspect not in {"etymology", "connotation", "poetic_use"}:
        raise ValueError("Unknown specialist aspect")
    return await run_word_specialist(f"Analyse the word: {word}", aspect=aspect)


async def run_word_specialist(prompt: str, history=None, aspect: str | None = None) -> str:
    """Accept a complete direct question and retained conversation context."""
    focus = {
        "etymology": "Focus on the word's origin, historical evolution, and linguistic roots.",
        "connotation": "Focus on the emotional, cultural, and contextual connotations of the word.",
        "poetic_use": "Focus on how this word is used in poetry: its rhythm, imagery, and mood.",
    }.get(aspect, "Answer the direct question in simple words.")
    specialist = Agent(
        model=configured_model(),
        messages=history,
        hooks=[HarnessHook("word-specialist"), RateLimiterHook(max_calls=3)],
        tools=[look_up_word_details, find_related_words_deep, calculate],
        system_prompt=with_conversation_policy(
            "You are a concise word-craft specialist. Answer the actual question; do not "
            "treat a complete request as a single word to define. Use tools when needed to look "
            f"up concrete data before responding. {focus} Favor simple noun-verb "
            "combinations, clear concrete wording, and a natural spoken flow. Do not "
            "over-focus on grammatical or syntactic correctness; prioritize language "
            "that feels easy to say and understand. Use only as much detail as requested. "
            "Return only the final answer. Aim for 52 words or fewer unless completeness or the requested format needs more, "
            "without internal thinking tags. Stored entries are limited notes, not verified sources. "
            "If evidence is missing, acknowledge uncertainty and never invent a word origin. "
            f"{ANSWER_QUALITY_GUIDANCE}"
        ),
        callback_handler=None,
    )
    return await answer_request(specialist, prompt)


@tool
def check_device_compatibility(device: str, issue: str) -> str:
    """Suggest general troubleshooting checks without inspecting a device.

    Args:
        device: The device name or model.
        issue: A description of the compatibility problem.

    Returns:
        A human-readable fix or fallback recommendation.
    """
    known_issues: dict[str, str] = {
        "wireless headphones": "Check the manufacturer's pairing and reset instructions for the exact model.",
        "usb-c hub": "Confirm the laptop supports USB-C alternate mode for the requested display output.",
        "mechanical keyboard": "Check the exact model's support page for troubleshooting and firmware information.",
    }
    normalized_device = device.lower()
    for name, fix in known_issues.items():
        if name in normalized_device:
            return f"General suggestion for {name}: {fix} No device or support page was checked. Issue reported: {issue}"
    return f"No stored guidance for '{device}'. Check connections, power, and the manufacturer's instructions. No device was inspected."


@tool
def run_device_diagnostic(device: str) -> str:
    """Explain that this tool cannot inspect or diagnose a physical device.

    Args:
        device: The device name or model to diagnose.

    Returns:
        An explicit capability limitation, without invented device readings.
    """
    return (
        f"No diagnostic was performed on {device}. This tool cannot access the device. "
        "Firmware, connection, and battery status are unknown. Use the device's own diagnostics or manufacturer instructions."
    )


@tool
def tech_support_specialist(issue_description: str) -> str:
    """Delegate device, connectivity, firmware, or troubleshooting issues.

    Use this for technical problems beyond basic word-palette, account, or order
    help. Include the device name and the symptoms in the issue description.

    Args:
        issue_description: The device problem and observed symptoms.

    Returns:
        A structured diagnosis and recommended resolution from the specialist agent.
    """
    specialist = Agent(
        tools=[check_device_compatibility, run_device_diagnostic],
        system_prompt=with_conversation_policy(
            "You are Forge's technical support specialist. Diagnose device issues, "
            "check compatibility, and give clear, actionable next steps. Be technical "
            "but explain the solution in language a general customer can follow."
        ),
        callback_handler=None,
    )
    return str(specialist(issue_description))
