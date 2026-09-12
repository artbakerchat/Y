"""Specialist agents exposed through the Forge orchestrator."""

from strands import Agent, tool


WORD_DETAILS = {
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
        return f'No stored details for "{word}". Proceed with general linguistic knowledge.'
    return (
        f"Word: {word}\n"
        f"Etymology: {entry['etymology']}\n"
        f"Connotation: {entry['connotation']}\n"
        f"Register: {entry['register']}"
    )


@tool
def find_related_words_deep(theme: str) -> str:
    """Find richer, literary vocabulary related to a semantic theme."""
    normalized_theme = theme.strip().lower()
    key = next((name for name in DEEP_WORD_CLUSTERS if name in normalized_theme), "mind")
    return f'Deep vocabulary for theme "{theme}": {", ".join(DEEP_WORD_CLUSTERS[key])}'


@tool
def consult_word_specialist(word: str, aspect: str = "connotation") -> str:
    """Delegate etymology, connotation, or poetic-use analysis to a word specialist.

    Args:
        word: The word to analyse.
        aspect: One of etymology, connotation, or poetic_use.
    """
    focus = {
        "etymology": "Focus on the word's origin, historical evolution, and linguistic roots.",
        "connotation": "Focus on the emotional, cultural, and contextual connotations of the word.",
        "poetic_use": "Focus on how this word is used in poetry: its rhythm, imagery, and mood.",
    }.get(aspect, "Focus on the emotional, cultural, and contextual connotations of the word.")
    specialist = Agent(
        tools=[look_up_word_details, find_related_words_deep],
        system_prompt=(
            "You are a concise word-craft specialist. Use the available tools to look "
            f"up concrete data before responding. {focus} Return only 3–6 sentences "
            "of analysis, with no preamble."
        ),
        callback_handler=None,
    )
    return str(specialist(f"Analyse the word: {word}")).strip()


@tool
def check_device_compatibility(device: str, issue: str) -> str:
    """Check a device for known compatibility issues.

    Args:
        device: The device name or model.
        issue: A description of the compatibility problem.

    Returns:
        A human-readable fix or fallback recommendation.
    """
    known_issues: dict[str, str] = {
        "wireless headphones": "Reset the headphones by holding power for 10 seconds, then pair again.",
        "usb-c hub": "Confirm the laptop supports USB-C alternate mode for the requested display output.",
        "mechanical keyboard": "Update firmware from v2.1 to v2.3 to address key ghosting.",
    }
    normalized_device = device.lower()
    for name, fix in known_issues.items():
        if name in normalized_device:
            return f"Known issue for {name.title()}: {fix} Issue reported: {issue}"
    return f"No known issue for '{device}'. Recommend checking connections, power, and firmware."


@tool
def run_device_diagnostic(device: str) -> str:
    """Run a diagnostic summary for a device.

    Args:
        device: The device name or model to diagnose.

    Returns:
        A formatted diagnostic report with firmware, connection, and battery status.
    """
    return (
        f"Diagnostic results for {device}:\n"
        "- Firmware: v2.1 (update available: v2.3)\n"
        "- Connection: stable\n"
        "- Battery: 85%\n"
        "Recommendation: update firmware and retry the connection."
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
        system_prompt=(
            "You are Forge's technical support specialist. Diagnose device issues, "
            "check compatibility, and give clear, actionable next steps. Be technical "
            "but explain the solution in language a general customer can follow."
        ),
        callback_handler=None,
    )
    return str(specialist(issue_description))
