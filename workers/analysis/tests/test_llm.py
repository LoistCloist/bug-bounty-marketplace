import json

import httpx2 as httpx
import pytest

from analysis.config import Settings
from analysis.findings import DetectorResult
from analysis.llm import (
    MAX_LLM_FINDINGS,
    NullExplainer,
    OpenAICompatibleExplainer,
    explanations_for,
    make_explainer,
)

SOURCE = "pragma solidity ^0.8.19;\ncontract Vault { function withdraw() external {} }\n"
SETTINGS = Settings.from_env(
    {"LLM_ENDPOINT": "https://example.test/openai/v1", "LLM_API_KEY": "k", "LLM_MODEL": "grok-4.6"}
)


def _detector(index: int, check: str = "reentrancy-eth") -> DetectorResult:
    return DetectorResult(
        index=index,
        check=check,
        impact="High",
        confidence="Medium",
        description=f"Slither says {check} #{index}\n",
        raw={"check": check},
    )


def _completion(content: str) -> dict:
    return {
        "id": "chatcmpl-1",
        "object": "chat.completion",
        "created": 0,
        "model": "grok-4.6",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
    }


def _explainer(handler) -> tuple[OpenAICompatibleExplainer, list[dict]]:
    requests: list[dict] = []

    def record(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        return handler(request)

    client = httpx.Client(transport=httpx.MockTransport(record))
    return OpenAICompatibleExplainer(SETTINGS, http_client=client), requests


def _reply(payload) -> callable:
    content = payload if isinstance(payload, str) else json.dumps(payload)
    return lambda request: httpx.Response(200, json=_completion(content))


def test_happy_path_sends_source_and_findings():
    explainer, requests = _explainer(
        _reply({"explanations": [{"index": 0, "explanation": "Funds can be drained."}]})
    )
    assert explainer.explain(SOURCE, [_detector(0)]) == {0: "Funds can be drained."}
    body = requests[0]
    assert body["model"] == "grok-4.6"
    assert body["response_format"] == {"type": "json_object"}
    user = body["messages"][-1]["content"]
    assert SOURCE in user
    assert "reentrancy-eth" in user


def test_timeout_returns_empty():
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    explainer, _ = _explainer(handler)
    assert explainer.explain(SOURCE, [_detector(0)]) == {}


def test_server_error_returns_empty():
    explainer, _ = _explainer(lambda request: httpx.Response(500, json={"error": "x"}))
    assert explainer.explain(SOURCE, [_detector(0)]) == {}


def test_bad_json_returns_empty():
    explainer, _ = _explainer(_reply("not json"))
    assert explainer.explain(SOURCE, [_detector(0)]) == {}


def test_code_fenced_json_is_accepted():
    fenced = '```json\n{"explanations": [{"index": 0, "explanation": "Drainable."}]}\n```'
    explainer, _ = _explainer(_reply(fenced))
    assert explainer.explain(SOURCE, [_detector(0)]) == {0: "Drainable."}


def test_partial_and_blank_entries_dropped():
    explainer, _ = _explainer(
        _reply(
            {
                "explanations": [
                    {"index": 0, "explanation": "   "},
                    {"index": 1, "explanation": "Real text."},
                    {"index": "2", "explanation": "wrong type"},
                    {"explanation": "no index"},
                ]
            }
        )
    )
    detectors = [_detector(0), _detector(1), _detector(2)]
    assert explainer.explain(SOURCE, detectors) == {1: "Real text."}


def test_unknown_index_ignored():
    explainer, _ = _explainer(
        _reply({"explanations": [{"index": 99, "explanation": "Not a finding."}]})
    )
    assert explainer.explain(SOURCE, [_detector(0)]) == {}


def test_caps_at_50_findings():
    explainer, requests = _explainer(_reply({"explanations": []}))
    explainer.explain(SOURCE, [_detector(i, f"check-{i}") for i in range(120)])
    user = requests[0]["messages"][-1]["content"]
    assert MAX_LLM_FINDINGS == 50
    assert "check-49" in user
    assert "check-50" not in user


def test_no_call_when_there_are_no_findings():
    explainer, requests = _explainer(_reply({"explanations": []}))
    assert explainer.explain(SOURCE, []) == {}
    assert requests == []


def test_retries_without_json_mode_when_endpoint_rejects_it():
    def handler(request):
        body = json.loads(request.content)
        if "response_format" in body:
            return httpx.Response(400, json={"error": {"message": "response_format unsupported"}})
        content = json.dumps({"explanations": [{"index": 0, "explanation": "Plain mode."}]})
        return httpx.Response(200, json=_completion(content))

    explainer, requests = _explainer(handler)
    assert explainer.explain(SOURCE, [_detector(0)]) == {0: "Plain mode."}
    assert "response_format" not in requests[-1]


def test_explanations_for_falls_back_to_slither_text():
    detectors = [_detector(0), _detector(1)]
    assert explanations_for(detectors, {0: "LLM text"}) == [
        ("LLM text", "llm"),
        ("Slither says reentrancy-eth #1", "slither"),
    ]


def test_make_explainer_without_key_is_null():
    assert isinstance(make_explainer(Settings.from_env({})), NullExplainer)
    assert NullExplainer().explain(SOURCE, [_detector(0)]) == {}


def test_make_explainer_with_key_is_openai_compatible():
    assert isinstance(make_explainer(SETTINGS), OpenAICompatibleExplainer)


@pytest.mark.parametrize("payload", [{"explanations": "nope"}, ["list"], {"other": []}])
def test_wrong_shapes_return_empty(payload):
    explainer, _ = _explainer(_reply(payload))
    assert explainer.explain(SOURCE, [_detector(0)]) == {}


def test_fallback_never_empty_when_slither_description_is_blank():
    blank = DetectorResult(
        index=0, check="weird-check", impact="Low", confidence="Low", description="  \n", raw={}
    )
    assert explanations_for([blank], {}) == [("Slither flagged weird-check.", "slither")]


def test_llm_timeout_defaults_to_90s_for_reasoning_models():
    # Grok-class reasoning models take ~20-30s on a real contract; analysis is
    # a background job, so a generous timeout costs nothing.
    assert Settings.from_env({}).llm_timeout_s == 90
    assert Settings.from_env({"LLM_TIMEOUT_SECONDS": "45"}).llm_timeout_s == 45
    explainer = OpenAICompatibleExplainer(SETTINGS)
    assert explainer._client.timeout == 90
