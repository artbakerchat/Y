"""Shared request controls for the AgentCore parent and language specialist."""

import os
import re
import time
from contextvars import ContextVar
from dataclasses import dataclass, field

from botocore.config import Config
from strands.hooks import BeforeModelCallEvent, BeforeToolCallEvent, HookProvider
from strands.models import BedrockModel


@dataclass
class RequestBudget:
    model_calls: int = 0
    tool_calls: int = 0
    deadline: float = field(default_factory=lambda: time.monotonic() + 90)
    trace: list = field(default_factory=list)


request_budget = ContextVar("forge_request_budget", default=None)


def configured_model(model_id=None, region_name=None, max_tokens=700):
    """Create the shared Strands Bedrock model configuration.

    The optional arguments let local tools select a model without changing the
    deployment default used by the AgentCore runtime.
    """
    return BedrockModel(
        model_id=model_id or os.getenv("BEDROCK_MODEL_ID", "ca.amazon.nova-lite-v1:0"),
        region_name=region_name or os.getenv("AWS_REGION", "ca-central-1"),
        max_tokens=max_tokens,
        temperature=0.2,
        boto_client_config=Config(connect_timeout=10, read_timeout=60, retries={"max_attempts": 1}),
    )


def clean_answer(value):
    text = re.sub(r"<(think|thinking|analysis)\b[^>]*>[\s\S]*?</\1>", "", str(value), flags=re.I)
    text = re.sub(r"<(think|thinking|analysis)\b[^>]*>[\s\S]*$", "", text, flags=re.I).strip()
    text = re.sub(r"</?(answer|final|response)\b[^>]*>", "", text, flags=re.I).strip()
    if not text:
        raise ValueError("Model returned no user-facing answer")
    return text


_MODEL_PRICES_PER_MILLION = {
    "nova-lite": (0.06, 0.24),
}


def usage_from_result(result):
    """Return provider-reported usage for the current Agent.invoke_async call."""
    invocation = getattr(getattr(result, "metrics", None), "latest_agent_invocation", None)
    usage = getattr(invocation, "usage", None)
    if not usage:
        return {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0}
    return {
        "inputTokens": int(usage.get("inputTokens", 0) or 0),
        "outputTokens": int(usage.get("outputTokens", 0) or 0),
        "totalTokens": int(usage.get("totalTokens", 0) or 0),
    }


def usage_cost(model_id, usage):
    """Estimate Bedrock cost in USD from token usage; prices are per million tokens."""
    model_key = model_id.lower()
    prices = next((value for key, value in _MODEL_PRICES_PER_MILLION.items() if key in model_key), None)
    input_price = os.getenv("BEDROCK_INPUT_PRICE_PER_MILLION")
    output_price = os.getenv("BEDROCK_OUTPUT_PRICE_PER_MILLION")
    if input_price is not None and output_price is not None:
        prices = (float(input_price), float(output_price))
    if prices is None:
        return None
    return (usage["inputTokens"] * prices[0] + usage["outputTokens"] * prices[1]) / 1_000_000


def format_usage_report(model_id, usage):
    """Format a concise, user-visible usage and cost report."""
    cost = usage_cost(model_id, usage)
    estimate = f"${cost:.6f}" if cost is not None else "unavailable; configure BEDROCK_*_PRICE_PER_MILLION"
    return (
        f"usage> model={model_id} input_tokens={usage['inputTokens']} "
        f"output_tokens={usage['outputTokens']} total_tokens={usage['totalTokens']} "
        f"estimated_bedrock_cost_usd={estimate} "
        "(web-search provider charges, if any, are not included)"
    )


class HarnessHook(HookProvider):
    def __init__(self, profile_id, supplied_text=""):
        self.profile_id = profile_id
        self.supplied_text = supplied_text.lower()

    def register_hooks(self, registry):
        registry.add_callback(BeforeModelCallEvent, self.before_model)
        registry.add_callback(BeforeToolCallEvent, self.before_tool)

    def budget(self):
        budget = request_budget.get()
        if budget is None:
            raise RuntimeError("Missing request budget")
        if time.monotonic() >= budget.deadline:
            raise TimeoutError("Agent request timed out")
        return budget

    def before_model(self, event):
        budget = self.budget()
        budget.model_calls += 1
        if budget.model_calls > 10:
            raise RuntimeError("Model call budget exhausted")

    def before_tool(self, event):
        budget = self.budget()
        budget.tool_calls += 1
        if budget.tool_calls > 6:
            raise RuntimeError("Tool call budget exhausted")
        name = event.tool_use["name"]
        if name in {"match_food_bank_shifts", "pair_mutual_aid_needs", "verify_civic_sources", "search_internal_policies"}:
            def leaves(value):
                if isinstance(value, dict):
                    return [leaf for child in value.values() for leaf in leaves(child)]
                if isinstance(value, list):
                    return [leaf for child in value for leaf in leaves(child)]
                return [str(value).lower()]
            facts = leaves(event.tool_use.get("input", {}))
            if not facts or any(fact not in self.supplied_text for fact in facts):
                event.cancel_tool = "Records contain facts not supplied by the user. Ask for the records; do not invent inputs."
        budget.trace.append({"agent_id": self.profile_id, "tool": name, "blocked": bool(event.cancel_tool)})
