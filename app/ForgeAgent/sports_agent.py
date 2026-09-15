"""Sports answering agent powered purely by Google and OpenAI APIs."""

import json
import os
import urllib.error
import urllib.request
from typing import Any

from conversation_policy import with_conversation_policy


_SEARCH_TIMEOUT_SECONDS = float(os.getenv("LIVE_SEARCH_TIMEOUT_SECONDS", "30"))
_WORKER_HEADERS = {
    "accept": "application/json",
    "content-type": "application/json",
    "user-agent": "ForgeAgent/1.0 (+https://larboard.ca)",
}


def load_data(path: Any = None) -> dict[str, Any]:
    """Stub retained for backwards compatibility; no static dataset is used."""
    return {"updated_at": "live", "games": [], "standings": []}


def _local_credentials_configured() -> bool:
    return bool(os.getenv("OPENAI_API_KEY", "").strip() or os.getenv("GEMINI_API_KEY", "").strip())


def search_worker_gateway(query: str) -> str | None:
    """Ask the Cloudflare Worker to perform both provider searches server-side."""
    worker_url = os.getenv("FORGE_WORKER_URL", "").strip().rstrip("/")
    worker_token = os.getenv("FORGE_WORKER_TOKEN", "").strip()
    if not worker_url or not worker_token:
        return None
    request = urllib.request.Request(
        f"{worker_url}/api/sports/evidence",
        data=json.dumps({"query": query.strip()[:4000]}).encode("utf-8"),
        headers={**_WORKER_HEADERS, "x-forge-worker-token": worker_token},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=_SEARCH_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return str(payload.get("evidence", "Worker returned no live evidence."))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
        return f"Cloudflare Worker live search failed: {type(error).__name__}: {error}"


def _with_source_note(answer_text: str, sources: list[tuple[str, str]]) -> str:
    if not sources:
        return answer_text
    return answer_text + "\n\nSources:\n" + "\n".join(f"- {title}: {url}" for title, url in sources)


def _openai_sources(response: Any) -> list[tuple[str, str]]:
    sources: list[tuple[str, str]] = []
    for item in getattr(response, "output", []) or []:
        for content in getattr(item, "content", []) or []:
            for annotation in getattr(content, "annotations", []) or []:
                url = getattr(annotation, "url", None)
                title = getattr(annotation, "title", None) or url
                if url and (title, url) not in sources:
                    sources.append((title, url))
    return sources


def _gemini_sources(response: Any) -> list[tuple[str, str]]:
    sources: list[tuple[str, str]] = []
    for step in getattr(response, "steps", []) or []:
        for content in getattr(step, "content", []) or []:
            for annotation in getattr(content, "annotations", []) or []:
                url = getattr(annotation, "url", None)
                title = getattr(annotation, "title", None) or url
                if url and (title, url) not in sources:
                    sources.append((title, url))
    candidates = getattr(response, "candidates", None) or []
    metadata = getattr(candidates[0], "grounding_metadata", None) if candidates else None
    for chunk in getattr(metadata, "grounding_chunks", []) or []:
        web = getattr(chunk, "web", None)
        url = getattr(web, "uri", None)
        title = getattr(web, "title", None) or url
        if url and (title, url) not in sources:
            sources.append((title, url))
    return sources


def search_openai(query: str) -> str:
    """Perform an OpenAI web search lookup for current sports information."""
    worker_result = search_worker_gateway(query)
    if worker_result is not None:
        return worker_result
    if not os.getenv("OPENAI_API_KEY"):
        return "OpenAI web search is not configured (OPENAI_API_KEY is missing)."
    try:
        from openai import OpenAI

        response = OpenAI(timeout=_SEARCH_TIMEOUT_SECONDS, max_retries=0).responses.create(
            model=os.getenv("OPENAI_SEARCH_MODEL", "gpt-4.1-mini"),
            instructions=with_conversation_policy(
                "Use web search to answer the user's sports query with current, verifiable information. "
                "Distinguish evidence from uncertainty and include useful source links."
            ),
            input=query.strip()[:4000],
            tools=[{"type": "web_search_preview"}],
        )
        return _with_source_note(response.output_text, _openai_sources(response))
    except Exception as error:
        return f"OpenAI web search failed: {type(error).__name__}: {error}"


def search_gemini(query: str) -> str:
    """Perform a Google Gemini Search grounding lookup for current sports information."""
    worker_result = search_worker_gateway(query)
    if worker_result is not None:
        return worker_result
    if not os.getenv("GEMINI_API_KEY"):
        return "Gemini Google Search is not configured (GEMINI_API_KEY is missing)."
    try:
        from google import genai

        client = genai.Client(
            api_key=os.environ["GEMINI_API_KEY"],
            http_options={"timeout": int(_SEARCH_TIMEOUT_SECONDS * 1000)},
        )
        response = client.interactions.create(
            model=os.getenv("GEMINI_SEARCH_MODEL", "gemini-3.6-flash"),
            system_instruction=with_conversation_policy(
                "Use Google Search grounding to answer the user's sports query with current, "
                "verifiable information. Distinguish evidence from uncertainty and "
                "include useful source links."
            ),
            input=query.strip()[:4000],
            tools=[{"type": "google_search"}],
        )
        return _with_source_note(response.output_text or "Gemini returned no text.", _gemini_sources(response))
    except Exception as error:
        return f"Gemini Google Search failed: {type(error).__name__}: {error}"


def answer(prompt: str, data: Any = None) -> str:
    """Answer sports questions purely using the Google and OpenAI APIs."""
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("Prompt is required")

    text = prompt.strip()
    worker_res = search_worker_gateway(text)
    if worker_res is not None:
        return worker_res

    openai_res = search_openai(text)
    gemini_res = search_gemini(text)

    openai_failed = "not configured" in openai_res.lower() or "failed" in openai_res.lower()
    gemini_failed = "not configured" in gemini_res.lower() or "failed" in gemini_res.lower()

    if openai_failed and gemini_failed:
        return (
            f"Google and OpenAI live search APIs are currently unavailable.\n\n"
            f"[OpenAI]: {openai_res}\n\n[Google Gemini]: {gemini_res}"
        )

    sections = []
    if not openai_failed:
        sections.append(f"[OpenAI Web Search]\n{openai_res}")
    else:
        sections.append(f"[OpenAI Web Search (Unavailable)]\n{openai_res}")

    if not gemini_failed:
        sections.append(f"[Google Gemini Search]\n{gemini_res}")
    else:
        sections.append(f"[Google Gemini Search (Unavailable)]\n{gemini_res}")

    return "\n\n".join(sections)


def prediction_inputs(prompt: str, data: Any = None) -> dict[str, Any]:
    """Gather live Google and OpenAI search evidence for sports predictions."""
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("Prompt is required")
    text = prompt.strip()
    return {
        "source": "google_and_openai_apis",
        "openai_evidence": search_openai(text),
        "gemini_evidence": search_gemini(text),
        "limitation": "Live search evidence only; no outcome is asserted.",
    }


if __name__ == "__main__":
    print("Live sports assistant powered purely by Google and OpenAI APIs.")
    while True:
        try:
            user_prompt = input("sports> ").strip()
        except EOFError:
            break
        if user_prompt.lower() in {"quit", "exit"}:
            break
        if user_prompt:
            try:
                print(answer(user_prompt))
            except Exception as exc:
                print(f"Error: {exc}")
