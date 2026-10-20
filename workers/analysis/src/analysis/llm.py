"""Plain-English explanations of Slither findings from an LLM.

Advisory only: the explanation text is the only thing the LLM affects. It never
changes a finding's status, severity or count, and any failure falls back to
Slither's own description (R3, R15).
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Sequence
from typing import Any, Literal, Protocol

import httpx2
import openai

from .config import Settings
from .findings import DetectorResult

log = logging.getLogger(__name__)

MAX_LLM_FINDINGS = 50
_TIMEOUT_S = 30

SYSTEM_PROMPT = (
    "You explain Slither static-analysis findings to the developer who wrote the "
    "Solidity contract. Your output is advisory only. For each finding write at most "
    "120 words in plain English: what is wrong, how it could be exploited, and how "
    "to fix it. Reply with JSON only, in exactly this shape: "
    '{"explanations":[{"index":<int>,"explanation":<string>}]}'
)

_FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL)


class Explainer(Protocol):
    def explain(self, source: str, detectors: Sequence[DetectorResult]) -> dict[int, str]: ...


class NullExplainer:
    """Used when no LLM is configured: every finding falls back to Slither text."""

    def explain(self, source: str, detectors: Sequence[DetectorResult]) -> dict[int, str]:
        return {}


def _user_prompt(source: str, detectors: Sequence[DetectorResult]) -> str:
    findings = [
        {
            "index": d.index,
            "check": d.check,
            "impact": d.impact,
            "confidence": d.confidence,
            "description": d.description.strip(),
        }
        for d in detectors
    ]
    return (
        "Contract source:\n```solidity\n"
        f"{source}\n```\n\n"
        f"Findings:\n{json.dumps(findings, indent=2)}"
    )


def _parse(content: str | None, valid: set[int]) -> dict[int, str]:
    if not content:
        return {}
    fenced = _FENCE.match(content)
    try:
        data: Any = json.loads(fenced.group(1) if fenced else content)
    except json.JSONDecodeError:
        return {}
    entries = data.get("explanations") if isinstance(data, dict) else None
    if not isinstance(entries, list):
        return {}
    result: dict[int, str] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        index, text = entry.get("index"), entry.get("explanation")
        if isinstance(index, bool) or not isinstance(index, int) or index not in valid:
            continue
        if isinstance(text, str) and text.strip():
            result[index] = text.strip()
    return result


class OpenAICompatibleExplainer:
    """One chat-completions call per contract against an OpenAI-compatible
    endpoint (e.g. Azure AI Foundry's /openai/v1). Never raises."""

    def __init__(self, settings: Settings, http_client: httpx2.Client | None = None) -> None:
        self._model = settings.llm_model
        self._client = openai.OpenAI(
            base_url=settings.llm_endpoint,
            api_key=settings.llm_api_key,
            http_client=http_client,
            timeout=_TIMEOUT_S,
            max_retries=1,
        )

    def explain(self, source: str, detectors: Sequence[DetectorResult]) -> dict[int, str]:
        batch = list(detectors)[:MAX_LLM_FINDINGS]
        if not batch:
            return {}
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _user_prompt(source, batch)},
        ]
        try:
            content = self._complete(messages, json_mode=True)
        except openai.BadRequestError:
            # Some deployments reject response_format; the prompt already asks for JSON.
            try:
                content = self._complete(messages, json_mode=False)
            except openai.OpenAIError as err:
                log.warning("LLM explanation failed: %s", err)
                return {}
        except openai.OpenAIError as err:
            log.warning("LLM explanation failed: %s", err)
            return {}
        return _parse(content, {d.index for d in batch})

    def _complete(self, messages: list[dict[str, str]], json_mode: bool) -> str | None:
        extra: dict[str, Any] = {"response_format": {"type": "json_object"}} if json_mode else {}
        response = self._client.chat.completions.create(
            model=self._model, messages=messages, **extra
        )
        return response.choices[0].message.content if response.choices else None


def make_explainer(settings: Settings) -> Explainer:
    if settings.llm_configured:
        return OpenAICompatibleExplainer(settings)
    return NullExplainer()


def explanations_for(
    detectors: Sequence[DetectorResult], explained: dict[int, str]
) -> list[tuple[str, Literal["llm", "slither"]]]:
    """One (text, source) pair per detector: the LLM's text when it gave a
    usable one, otherwise Slither's own description."""
    return [
        (explained[d.index], "llm")
        if d.index in explained
        else (d.description.strip() or f"Slither flagged {d.check}.", "slither")
        for d in detectors
    ]
