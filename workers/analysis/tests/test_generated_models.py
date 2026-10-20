import pytest
from pydantic import ValidationError

from analysis.generated.models import Contract, Finding, FindingStatus, Severity

VALID_FINDING = {
    "id": "finding-1",
    "contractId": "contract-1",
    "severity": "High",
    "slitherDetector": "reentrancy-eth",
    "rawOutputReference": "slither/contract-1.json",
    "llmExplanation": "External call before state update allows re-entrancy.",
    "status": "Flagged",
    "statusHistory": [{"status": "Flagged", "changedAt": "2026-01-01T00:00:00Z"}],
    "claimedByAuditorId": None,
    "claimExpiresAt": None,
    "isFalsePositive": False,
    "challengeWindowExpiresAt": "2026-01-08T00:00:00Z",
}


def test_finding_round_trips() -> None:
    finding = Finding.model_validate(VALID_FINDING)
    assert finding.severity is Severity.High
    assert finding.status == FindingStatus.Flagged
    assert finding.statusHistory[0].changedAt.tzinfo is not None
    assert finding.model_dump(mode="json")["slitherDetector"] == "reentrancy-eth"


def test_finding_rejects_unknown_severity() -> None:
    with pytest.raises(ValidationError):
        Finding.model_validate({**VALID_FINDING, "severity": "Catastrophic"})


def test_finding_rejects_extra_fields() -> None:
    with pytest.raises(ValidationError):
        Finding.model_validate({**VALID_FINDING, "payout": 100})


def test_finding_rejects_naive_datetime() -> None:
    with pytest.raises(ValidationError):
        Finding.model_validate({**VALID_FINDING, "challengeWindowExpiresAt": "2026-01-08T00:00:00"})


def test_contract_model_exists() -> None:
    assert "sourceHash" in Contract.model_fields
