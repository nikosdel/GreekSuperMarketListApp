"""Ask a shopping question through a free model running on this PC.

The only network call is to Ollama at 127.0.0.1. There is no API key and
no paid AI service. Prices in the answer have to come from the catalog tools.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass

import httpx

from catalog.tools import TOOL_SPECS, run_tool
from scraper.config import load_dotenv

_SYSTEM = """You compare prices in Greek supermarkets.
Call a tool before you mention any price, shop, or product.
Use only numbers and names that appear in the tool result. If the tool finds nothing, say that in one sentence.
When two shops have the same total, name both.
Answer in the same language as the question.
Do not add descriptions or images.

For two or more products, call cheapest_basket once.
Pass items as separate strings copied from the question. Do not join them and do not translate them.
Example: "tostaki πάριζα 160 και ελαιόλαδο" becomes items ["tostaki πάριζα 160", "ελαιόλαδο"].
Then quote split_total and the cheapest one_shop rows from that result.
"""


@dataclass(frozen=True)
class ToolTrace:
    name: str
    arguments: dict
    result: dict
    source: str = "model"


@dataclass(frozen=True)
class AskResult:
    model: str
    host: str
    answer: str
    traces: list[ToolTrace]
    draft: str | None = None


class LocalModelError(Exception):
    """Ollama is missing, or the chosen free model is not pulled yet."""


def ask(question: str, *, model: str | None = None) -> AskResult:
    text = question.strip()
    if not text:
        raise ValueError("question is empty")
    chosen = model or _model_name()
    host = _host()
    messages: list[dict] = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": text},
    ]
    traces: list[ToolTrace] = []
    items = _items_from_question(text)
    if len(items) >= 2:
        arguments = {"items": items}
        try:
            result = run_tool("cheapest_basket", arguments)
        except (ValueError, TypeError) as exc:
            result = {"error": str(exc)}
        traces.append(
            ToolTrace(
                name="cheapest_basket",
                arguments=arguments,
                result=result,
                source="question",
            )
        )
        messages.append(
            {
                "role": "user",
                "content": (
                    "cheapest_basket already ran for this question:\n"
                    + json.dumps(result, ensure_ascii=False)
                    + "\nUse these figures in your answer."
                ),
            }
        )
    combined = False
    for _round in range(6):
        message = _chat(host, chosen, messages)
        messages.append(message)
        calls = message.get("tool_calls") or []
        if not calls:
            queries = _lookup_queries(traces)
            if not combined and len(queries) >= 2 and not _has_full_basket(traces):
                combined = True
                arguments = {"items": queries}
                try:
                    result = run_tool("cheapest_basket", arguments)
                except (ValueError, TypeError) as exc:
                    result = {"error": str(exc)}
                traces.append(
                    ToolTrace(
                        name="cheapest_basket",
                        arguments=arguments,
                        result=result,
                        source="catalog",
                    )
                )
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "cheapest_basket for the products you looked up:\n"
                            + json.dumps(result, ensure_ascii=False)
                            + "\nAnswer in the user's language from this result. "
                            "Mention every item. If several shops share the lowest one_shop total, name each of them."
                        ),
                    }
                )
                continue
            answer = (message.get("content") or "").strip()
            if not answer:
                raise LocalModelError("The local model returned an empty answer.")
            return _finish(chosen, host, answer, traces)
        for call in calls:
            function = call.get("function") or {}
            name = function.get("name") or ""
            arguments = _arguments(function.get("arguments"))
            try:
                result = run_tool(name, arguments)
            except (ValueError, TypeError) as exc:
                result = {"error": str(exc)}
            traces.append(ToolTrace(name=name, arguments=arguments, result=result))
            messages.append(
                {
                    "role": "tool",
                    "name": name,
                    "content": json.dumps(result, ensure_ascii=False),
                }
            )
    called = "; ".join(
        f"{trace.name} {json.dumps(trace.arguments, ensure_ascii=False)}" for trace in traces
    )
    raise LocalModelError(f"The local model kept calling tools without answering. Calls: {called}")


def _finish(model: str, host: str, draft: str, traces: list[ToolTrace]) -> AskResult:
    basket = _latest_full_basket(traces)
    if basket is None:
        return AskResult(model=model, host=host, answer=draft, traces=traces)
    return AskResult(
        model=model,
        host=host,
        answer=_speak_basket(basket),
        traces=traces,
        draft=draft,
    )


def _latest_full_basket(traces: list[ToolTrace]) -> dict | None:
    found: dict | None = None
    for trace in traces:
        if trace.name != "cheapest_basket" or "error" in trace.result:
            continue
        items = trace.arguments.get("items")
        if isinstance(items, list) and len(items) >= 2:
            found = trace.result
    return found


def _speak_basket(result: dict) -> str:
    lines: list[str] = []
    for line in result.get("lines", []):
        offer = line.get("offer")
        if not offer:
            lines.append(f"{line.get('query')}: no matching product.")
            continue
        unit = offer.get("unit_price_text") or "no unit price"
        lines.append(f"{offer['name']} is {offer['price']} € at {offer['shop']} ({unit}).")
    lines.append(f"Split total: {result.get('split_total')} €.")
    shops = result.get("one_shop") or []
    if not shops:
        lines.append("No single shop sells every chosen product.")
        return "\n".join(lines)
    cheapest = shops[0]["total"]
    tied = [shop["shop"] for shop in shops if shop["total"] == cheapest]
    lines.append(f"One shop: {', '.join(tied)} at {cheapest} €.")
    return "\n".join(lines)


def _chat(host: str, model: str, messages: list[dict]) -> dict:
    tools = [
        {
            "type": "function",
            "function": {
                "name": spec["name"],
                "description": spec["description"],
                "parameters": spec["parameters"],
            },
        }
        for spec in TOOL_SPECS
    ]
    try:
        response = httpx.post(
            f"{host}/api/chat",
            json={
                "model": model,
                "messages": messages,
                "tools": tools,
                "stream": False,
                "options": {"temperature": 0},
            },
            timeout=httpx.Timeout(180.0, connect=3.0),
        )
    except httpx.ConnectError as exc:
        raise LocalModelError(
            "Ollama is not running on this PC. "
            "Install it from https://ollama.com/download, then run "
            f"`ollama pull {model}` and try again. No API key is used."
        ) from exc
    except httpx.TimeoutException as exc:
        raise LocalModelError("The local model took too long to answer.") from exc
    if response.status_code >= 400:
        detail = response.text.strip()
        if response.status_code == 404 and "model" in detail.lower():
            raise LocalModelError(
                f"The free model {model} is not on this PC yet. Run `ollama pull {model}`."
            )
        raise LocalModelError(f"Ollama returned {response.status_code}: {detail}")
    payload = response.json()
    message = payload.get("message")
    if not isinstance(message, dict):
        raise LocalModelError("Ollama returned a response without a message.")
    return message


def _items_from_question(question: str) -> list[str]:
    """Split 'να πάρω A και B' into the two product phrases."""
    match = re.search(r"(?:να πάρω|να παρω|buy)\s+(.+)", question, flags=re.IGNORECASE)
    body = match.group(1) if match else ""
    parts = re.split(r"\s+και\s+|\s+and\s+", body, flags=re.IGNORECASE)
    cleaned = [part.strip(" \t\r\n.;?!؛") for part in parts]
    return [part for part in cleaned if len(part) >= 2]


def _lookup_queries(traces: list[ToolTrace]) -> list[str]:
    """Product phrases the model searched, without a later exact-name repeat."""
    queries: list[str] = []
    chosen_names: set[str] = set()
    for trace in traces:
        if trace.name not in {"compare_product", "search_products"}:
            continue
        query = trace.arguments.get("query")
        if not isinstance(query, str):
            continue
        cleaned = query.strip()
        if not cleaned or cleaned in chosen_names or cleaned in queries:
            continue
        queries.append(cleaned)
        chosen = trace.result.get("chosen_name")
        if isinstance(chosen, str) and chosen.strip():
            chosen_names.add(chosen.strip())
    return queries


def _has_full_basket(traces: list[ToolTrace]) -> bool:
    for trace in traces:
        if trace.name != "cheapest_basket" or "error" in trace.result:
            continue
        items = trace.arguments.get("items")
        if isinstance(items, list) and len(items) >= 2:
            return True
    return False


def _arguments(raw) -> dict:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        parsed = json.loads(raw) if raw.strip() else {}
        if isinstance(parsed, dict):
            return parsed
    raise ValueError("tool arguments must be an object")


def _model_name() -> str:
    load_dotenv()
    return os.environ.get("OLLAMA_MODEL", "qwen2.5:3b")


def _host() -> str:
    load_dotenv()
    return os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
