"""Deterministic, privacy-aware operational tools for Good Neighbour roles."""

import json
import re
from collections.abc import Callable

from strands import tool


def build_community_tools(profile_id: str) -> list[Callable[..., str]]:
    if profile_id == "food-bank":
        @tool
        def match_food_bank_shifts(volunteers: list[dict], shifts: list[dict], inventory: list[dict] | None = None, thresholds: list[dict] | None = None) -> str:
            """Match supplied volunteers to shifts by availability and skills; report roster and inventory gaps."""
            assigned: set[str] = set()
            assignments: list[dict] = []
            gaps: list[dict] = []
            for index, shift in enumerate(shifts or []):
                shift_id = str(shift.get("id") or f"shift-{index + 1}")
                slot = str(shift.get("slot") or "")
                required = {str(skill).lower() for skill in shift.get("requiredSkills", [])}
                capacity = max(1, int(shift.get("capacity", 1)))
                matches = []
                for person_index, person in enumerate(volunteers or []):
                    person_id = str(person.get("id") or f"volunteer-{person_index + 1}")
                    skills = {str(skill).lower() for skill in person.get("skills", [])}
                    availability = {str(value) for value in person.get("availability", [])}
                    if person_id not in assigned and (not slot or slot in availability) and required <= skills and len(matches) < capacity:
                        assigned.add(person_id)
                        matches.append({"id": person_id, "name": person.get("name") or person_id})
                assignments.append({"shiftId": shift_id, "volunteers": matches})
                if len(matches) < capacity:
                    gaps.append({"shiftId": shift_id, "missing": capacity - len(matches), "requiredSkills": sorted(required), "slot": slot})
            inventory_gaps = []
            stock = {str(item.get("item", "")).lower(): float(item.get("quantity", 0)) for item in (inventory or [])}
            for threshold in thresholds or []:
                item = str(threshold.get("item", ""))
                minimum = float(threshold.get("minimum", threshold.get("min", 0)))
                quantity = stock.get(item.lower(), 0)
                if item and quantity < minimum:
                    inventory_gaps.append({"item": item, "quantity": quantity, "minimum": minimum})
            return json.dumps({"assignments": assignments, "rosterGaps": gaps, "inventoryGaps": inventory_gaps, "notifications": "No notifications sent; confirm assignments and connect a notification adapter."})

        return [match_food_bank_shifts]

    if profile_id == "nonprofit-helpdesk":
        @tool
        def generate_nonprofit_template(template_type: str, organization: str = "", details: str = "") -> str:
            """Generate an incident report, board memo, or grant tracker template."""
            kind = template_type.lower()
            headings = (["Incident Report", "Date and time", "People involved", "What happened", "Immediate actions", "Follow-up owner"] if "incident" in kind else ["Board Memo", "Decision requested", "Context", "Options considered", "Recommendation", "Next steps"] if "board" in kind else ["Grant Tracker", "Funder and grant", "Deadline", "Deliverables", "Owner", "Status and next action"])
            lines = [f"# {headings[0]}", f"Organization: {organization or '[add]'}"]
            lines.extend(f"## {heading}\n{details if heading == 'Status and next action' and details else '[add]'}" for heading in headings[1:])
            return "\n\n".join(lines)

        @tool
        def search_internal_policies(query: str, documents: list[dict]) -> str:
            """Search supplied policy records and return matching text with supplied citations."""
            needle = query.strip().lower()
            matches = [doc for doc in documents or [] if needle in f"{doc.get('title', '')} {doc.get('text', '')}".lower()]
            if not matches:
                return "No supplied internal policy matched. Do not infer an organizational rule."
            return "\n".join(f"{doc.get('title', 'Untitled')} — {doc.get('text', '')} [Source: {doc.get('source', 'not supplied')}]" for doc in matches[:5])

        return [generate_nonprofit_template, search_internal_policies]

    if profile_id == "mutual-aid":
        @tool
        def sanitize_mutual_aid_intake(text: str) -> str:
            """Redact common contact, precise-location, and sensitive-status details."""
            redacted = re.sub(r"[\w.+-]+@[\w-]+\.[\w.-]+", "[redacted contact]", text or "")
            redacted = re.sub(r"(?:\+?\d[\d\s().-]{7,}\d)", "[redacted contact]", redacted)
            return re.sub(r"\b(?:address|location|diagnosis|medical status|immigration status|shelter)\s*:\s*[^;\n]+", lambda match: f"{match.group(0).split(':')[0]}: [redacted]", redacted, flags=re.IGNORECASE)

        @tool
        def pair_mutual_aid_needs(needs: list[dict], offers: list[dict]) -> str:
            """Pair anonymous needs and offers only after explicit opt-in from both sides."""
            matches = []
            for need in needs or []:
                if need.get("optIn") is not True:
                    continue
                tags = {str(tag).lower() for tag in need.get("tags", [])}
                offer = next((item for item in offers or [] if item.get("optIn") is True and tags.intersection(str(tag).lower() for tag in item.get("tags", []))), None)
                if offer:
                    matches.append({"needId": need.get("id", "anonymous-need"), "offerId": offer.get("id", "anonymous-offer"), "status": "pending-mutual-confirmation"})
            return json.dumps({"matches": matches, "note": "No contact details were shared. Both participants must confirm before connection."})

        return [sanitize_mutual_aid_intake, pair_mutual_aid_needs]

    if profile_id == "civic-knowledge":
        @tool
        def verify_civic_sources(sources: list[dict]) -> str:
            """Verify supplied official HTTPS sources before grounding civic answers."""
            checked = []
            for source in sources or []:
                url = str(source.get("url", ""))
                official = bool(re.search(r"\.(gov|gc\.ca|edu|org)(/|$)", url, re.IGNORECASE))
                checked.append({"title": source.get("title", "Untitled"), "url": url, "verified": source.get("verified") is True and url.startswith("https://") and official})
            grounded = bool(checked) and all(source["verified"] for source in checked)
            return json.dumps({"grounded": grounded, "sources": checked, "instruction": "If grounded is false, state uncertainty and provide an official contact point."})

        return [verify_civic_sources]

    return []
