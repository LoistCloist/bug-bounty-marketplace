import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from analysis import app as app_module
from analysis.app import app
from analysis.slither_runner import SlitherError

FIXTURES = Path(__file__).parent / "fixtures"
VAULT = (FIXTURES / "Vault.sol").read_text()
REPORT = json.loads((FIXTURES / "vault-slither.json").read_text())


class FakeExplainer:
    def explain(self, source, detectors):
        return {0: "Funds can be drained."}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with TestClient(app) as test_client:
        app.state.explainer = FakeExplainer()
        yield test_client


def test_worker_is_not_started_without_a_database(client):
    assert app.state.worker is None


def test_analyze_returns_findings_with_explanations(client, monkeypatch):
    calls = []

    def fake_slither(source, filename, solc_version, timeout_s=120):
        calls.append((source, filename, solc_version))
        return REPORT

    monkeypatch.setattr(app_module, "run_slither", fake_slither)
    response = client.post("/analyze", json={"contractId": "contract-1", "source": VAULT})

    assert response.status_code == 200
    body = response.json()
    assert body["contractId"] == "contract-1"
    assert body["solcVersion"] == "0.8.28"
    assert calls == [(VAULT.encode(), "contract-1.sol", "0.8.28")]
    first = body["findings"][0]
    assert first["slitherDetector"] == "reentrancy-eth"
    assert first["severity"] == "High"
    assert (first["llmExplanation"], first["explanationSource"]) == ("Funds can be drained.", "llm")
    assert first["rawOutput"]["check"] == "reentrancy-eth"
    assert body["findings"][1]["explanationSource"] == "slither"


def test_analyze_unsupported_pragma_is_422(client):
    response = client.post(
        "/analyze", json={"contractId": "c", "source": "pragma solidity ^0.6.0; contract A {}"}
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "Unsupported Solidity version: ^0.6.0"}


def test_analyze_compile_error_is_422(client, monkeypatch):
    def broken(*args, **kwargs):
        raise SlitherError("Error: Expected type name")

    monkeypatch.setattr(app_module, "run_slither", broken)
    response = client.post("/analyze", json={"contractId": "c", "source": "contract A {"})
    assert response.status_code == 422
    assert response.json() == {"detail": "Error: Expected type name"}


def test_analyze_rejects_missing_fields(client) -> None:
    response = client.post("/analyze", json={"contractId": "contract-1"})
    assert response.status_code == 422


def test_analyze_rejects_unknown_fields(client) -> None:
    response = client.post("/analyze", json={"contractId": "c", "source": "s", "extra": True})
    assert response.status_code == 422


def test_analyze_rejects_sources_over_100_kb(client):
    response = client.post("/analyze", json={"contractId": "c", "source": "a" * 102_401})
    assert response.status_code == 422
    assert response.json()["detail"][0]["type"] == "string_too_long"


def test_lifespan_makes_the_poller_logs_visible(client):
    import logging

    logger = logging.getLogger("analysis")
    assert logger.getEffectiveLevel() <= logging.INFO
    assert logger.handlers
