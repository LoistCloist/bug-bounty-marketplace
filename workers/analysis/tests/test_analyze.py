from fastapi.testclient import TestClient

from analysis.app import app

client = TestClient(app)


def test_analyze_is_not_implemented_yet() -> None:
    response = client.post(
        "/analyze", json={"contractId": "contract-1", "source": "pragma solidity ^0.8.0;"}
    )
    assert response.status_code == 501
    assert response.json() == {
        "detail": "not implemented: slither + LLM pipeline lands in a later branch"
    }


def test_analyze_rejects_missing_fields() -> None:
    response = client.post("/analyze", json={"contractId": "contract-1"})
    assert response.status_code == 422


def test_analyze_rejects_unknown_fields() -> None:
    response = client.post("/analyze", json={"contractId": "c", "source": "s", "extra": True})
    assert response.status_code == 422
