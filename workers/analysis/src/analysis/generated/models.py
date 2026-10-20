# Generated from packages/shared/schema/*.json by scripts/gen-types.sh. DO NOT EDIT.

from __future__ import annotations

from enum import StrEnum
from typing import Annotated

from pydantic import AwareDatetime, ConfigDict, Field

from analysis.schema_base import BaseModel

ClaimedContractId = Annotated[str, Field(min_length=1)]


class AuditorProfile(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(min_length=1)]
    address: Annotated[str, Field(pattern="^0x[a-fA-F0-9]{40}$")]
    stake: Annotated[float, Field(ge=0.0)]
    reputation: float
    claimedContractIds: list[ClaimedContractId]


class Bounty(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(min_length=1)]
    contractId: Annotated[str, Field(min_length=1)]
    amount: Annotated[float, Field(gt=0.0)]
    currency: Annotated[str, Field(min_length=1)]
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
    id: Annotated[str, Field(min_length=1)]
    developerAddress: Annotated[str, Field(pattern="^0x[a-fA-F0-9]{40}$")]
    filename: Annotated[str, Field(min_length=1)]
    sourceHash: Annotated[str, Field(min_length=1)]
    sourceReference: Annotated[str, Field(min_length=1)]
    bountyId: Annotated[str, Field(min_length=1)]
    status: Status
    createdAt: AwareDatetime
    deadline: AwareDatetime


class Ruling(StrEnum):
    Pending = "Pending"
    ForAuditor = "ForAuditor"
    AgainstAuditor = "AgainstAuditor"


class Dispute(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(min_length=1)]
    findingId: Annotated[str, Field(min_length=1)]
    developerId: Annotated[str, Field(min_length=1)]
    reason: Annotated[str, Field(min_length=1)]
    openedAt: AwareDatetime
    challengeWindowExpiresAt: AwareDatetime
    ruling: Ruling
    ruledAt: AwareDatetime | None
    arbiterId: Annotated[str | None, Field(min_length=1)]


class Severity(StrEnum):
    Critical = "Critical"
    High = "High"
    Medium = "Medium"
    Low = "Low"
    Informational = "Informational"


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
    id: Annotated[str, Field(min_length=1)]
    findingId: Annotated[str, Field(min_length=1)]
    auditorId: Annotated[str, Field(min_length=1)]
    testFileReference: Annotated[str, Field(min_length=1)]
    submittedAt: AwareDatetime
    sandboxStatus: SandboxStatus
    sandboxLog: str | None


class StatusHistoryItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    status: FindingStatus
    changedAt: AwareDatetime


class Finding(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(min_length=1)]
    contractId: Annotated[str, Field(min_length=1)]
    severity: Severity
    slitherDetector: Annotated[str, Field(min_length=1)]
    rawOutputReference: Annotated[str, Field(min_length=1)]
    llmExplanation: Annotated[str, Field(min_length=1)]
    status: FindingStatus
    statusHistory: list[StatusHistoryItem]
    claimedByAuditorId: Annotated[str | None, Field(min_length=1)]
    claimExpiresAt: AwareDatetime | None
    isFalsePositive: bool
    challengeWindowExpiresAt: AwareDatetime | None
