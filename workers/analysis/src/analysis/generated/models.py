# Generated from packages/shared/schema/*.json by scripts/gen-types.sh. DO NOT EDIT.

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, RootModel


class Model(RootModel[Any]):
    root: Any


class ClaimedContractId(RootModel[str]):
    root: str = Field(..., min_length=1)


class AuditorProfile(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str = Field(..., min_length=1)
    address: str = Field(..., pattern="^0x[a-fA-F0-9]{40}$")
    stake: float = Field(..., ge=0.0)
    reputation: float
    claimedContractIds: list[ClaimedContractId]


class Bounty(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str = Field(..., min_length=1)
    contractId: str = Field(..., min_length=1)
    amount: float = Field(..., gt=0.0)
    currency: str = Field(..., min_length=1)
    fundedAt: AwareDatetime
    deadline: AwareDatetime


class Status(StrEnum):
    Open = "Open"
    Claimed = "Claimed"
    Resolved = "Resolved"
    Expired = "Expired"


class Contract(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str = Field(..., min_length=1)
    developerAddress: str = Field(..., pattern="^0x[a-fA-F0-9]{40}$")
    filename: str = Field(..., min_length=1)
    sourceHash: str = Field(..., min_length=1)
    sourceReference: str = Field(..., min_length=1)
    bountyId: str = Field(..., min_length=1)
    status: Status
    createdAt: AwareDatetime
    deadline: AwareDatetime


class Ruling(StrEnum):
    Pending = "Pending"
    ForAuditor = "ForAuditor"
    AgainstAuditor = "AgainstAuditor"


class ArbiterId(RootModel[str]):
    root: str = Field(None, min_length=1)


class Dispute(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str = Field(..., min_length=1)
    findingId: str = Field(..., min_length=1)
    developerId: str = Field(..., min_length=1)
    reason: str = Field(..., min_length=1)
    openedAt: AwareDatetime
    challengeWindowExpiresAt: AwareDatetime
    ruling: Ruling
    ruledAt: AwareDatetime | None
    arbiterId: ArbiterId | None


class Severity(StrEnum):
    Critical = "Critical"
    High = "High"
    Medium = "Medium"
    Low = "Low"
    Informational = "Informational"


class Status1(StrEnum):
    Flagged = "Flagged"
    Submitted = "Submitted"
    Verified = "Verified"
    Disputed = "Disputed"
    Rejected = "Rejected"
    Paid = "Paid"


class StatusHistoryItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    status: Status1
    changedAt: AwareDatetime


class ClaimedByAuditorId(RootModel[str]):
    root: str = Field(None, min_length=1)


class Finding(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str = Field(..., min_length=1)
    contractId: str = Field(..., min_length=1)
    severity: Severity
    slitherDetector: str = Field(..., min_length=1)
    rawOutputReference: str = Field(..., min_length=1)
    llmExplanation: str = Field(..., min_length=1)
    status: Status1
    statusHistory: list[StatusHistoryItem]
    claimedByAuditorId: ClaimedByAuditorId | None
    claimExpiresAt: AwareDatetime | None
    isFalsePositive: bool
    challengeWindowExpiresAt: AwareDatetime | None


class FindingStatus(StrEnum):
    Flagged = "Flagged"
    Submitted = "Submitted"
    Verified = "Verified"
    Disputed = "Disputed"
    Rejected = "Rejected"
    Paid = "Paid"


class SandboxStatus(StrEnum):
    Pending = "Pending"
    Passed = "Passed"
    Failed = "Failed"


class PoCSubmission(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str = Field(..., min_length=1)
    findingId: str = Field(..., min_length=1)
    auditorId: str = Field(..., min_length=1)
    testFileReference: str = Field(..., min_length=1)
    submittedAt: AwareDatetime
    sandboxStatus: SandboxStatus
    sandboxLog: str | None
