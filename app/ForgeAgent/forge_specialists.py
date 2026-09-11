"""Specialist agents exposed through the Forge orchestrator."""

from strands import Agent, tool


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
