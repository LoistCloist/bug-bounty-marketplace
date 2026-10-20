import { describe, expect, it } from "vitest";
import {
  AnalysisStatusSchema,
  AuditorProfileSchema,
  BountySchema,
  CONTRACT_SOURCE_MAX_BYTES,
  ContractSchema,
  ContractSourceFilenameSchema,
  ContractSourceSizeSchema,
  ContractSubmissionFieldsSchema,
  DisputeSchema,
  FindingSchema,
  FindingStatusSchema,
  PoCSubmissionSchema,
  POC_SOURCE_MAX_BYTES,
  PocSourceFilenameSchema,
  PocSourceSizeSchema,
} from "../index";

const now = "2026-09-30T12:00:00.000Z";
const later = "2026-10-30T12:00:00.000Z";
const address = "0x1234567890123456789012345678901234567890";

describe("ContractSchema", () => {
  const valid = {
    id: "contract_1",
    developerAddress: address,
    filename: "Vault.sol",
    sourceHash: "0xdeadbeef",
    sourceReference: "contracts/contract_1/0xdeadbeef.sol",
    bountyId: "bounty_1",
    status: "Open",
    createdAt: now,
    deadline: later,
  };

  it("accepts a well-formed contract", () => {
    expect(ContractSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a missing required field", () => {
    const { filename: _filename, ...missingFilename } = valid;
    expect(ContractSchema.safeParse(missingFilename).success).toBe(false);
  });

  it("rejects an invalid status enum value", () => {
    expect(ContractSchema.safeParse({ ...valid, status: "NotAStatus" }).success).toBe(false);
  });

  it("rejects a malformed address", () => {
    expect(ContractSchema.safeParse({ ...valid, developerAddress: "not-an-address" }).success).toBe(
      false,
    );
  });
});

describe("ContractSourceFilenameSchema", () => {
  it("accepts a .sol filename, case-insensitively", () => {
    expect(ContractSourceFilenameSchema.safeParse("Vault.sol").success).toBe(true);
    expect(ContractSourceFilenameSchema.safeParse("VAULT.SOL").success).toBe(true);
  });

  it("rejects other extensions and a bare .sol-looking suffix", () => {
    expect(ContractSourceFilenameSchema.safeParse("Vault.txt").success).toBe(false);
    expect(ContractSourceFilenameSchema.safeParse("Vault.sol.exe").success).toBe(false);
    expect(ContractSourceFilenameSchema.safeParse("").success).toBe(false);
  });
});

describe("ContractSourceSizeSchema", () => {
  it("accepts sizes from 1 byte up to the limit", () => {
    expect(ContractSourceSizeSchema.safeParse(1).success).toBe(true);
    expect(ContractSourceSizeSchema.safeParse(CONTRACT_SOURCE_MAX_BYTES).success).toBe(true);
  });

  it("rejects an empty file and a file over the limit", () => {
    expect(ContractSourceSizeSchema.safeParse(0).success).toBe(false);
    expect(ContractSourceSizeSchema.safeParse(CONTRACT_SOURCE_MAX_BYTES + 1).success).toBe(false);
  });
});

describe("ContractSubmissionFieldsSchema", () => {
  const valid = {
    developerAddress: address,
    bountyAmount: "2.5",
    currency: "USDC",
    deadline: later,
  };

  it("coerces a multipart string amount to a number", () => {
    const parsed = ContractSubmissionFieldsSchema.parse(valid);
    expect(parsed.bountyAmount).toBe(2.5);
  });

  it("defaults the currency to ETH when omitted", () => {
    const { currency: _currency, ...withoutCurrency } = valid;
    expect(ContractSubmissionFieldsSchema.parse(withoutCurrency).currency).toBe("ETH");
  });

  it("rejects a non-positive or non-numeric bounty amount", () => {
    expect(ContractSubmissionFieldsSchema.safeParse({ ...valid, bountyAmount: "0" }).success).toBe(
      false,
    );
    expect(ContractSubmissionFieldsSchema.safeParse({ ...valid, bountyAmount: "abc" }).success).toBe(
      false,
    );
  });

  it("rejects a malformed developer address and a non-datetime deadline", () => {
    expect(
      ContractSubmissionFieldsSchema.safeParse({ ...valid, developerAddress: "0x123" }).success,
    ).toBe(false);
    expect(ContractSubmissionFieldsSchema.safeParse({ ...valid, deadline: "soon" }).success).toBe(
      false,
    );
  });
});

describe("BountySchema", () => {
  const valid = {
    id: "bounty_1",
    contractId: "contract_1",
    amount: 1000,
    currency: "USDC",
    fundedAt: now,
    deadline: later,
  };

  it("accepts a well-formed bounty", () => {
    expect(BountySchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a non-positive amount", () => {
    expect(BountySchema.safeParse({ ...valid, amount: 0 }).success).toBe(false);
  });

  it("rejects a wrong-typed amount", () => {
    expect(BountySchema.safeParse({ ...valid, amount: "1000" }).success).toBe(false);
  });
});

describe("FindingStatusSchema", () => {
  it("accepts every documented status", () => {
    for (const status of [
      "Flagged",
      "Submitted",
      "Verified",
      "Disputed",
      "Rejected",
      "Paid",
    ]) {
      expect(FindingStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("rejects an unknown status", () => {
    expect(FindingStatusSchema.safeParse("Closed").success).toBe(false);
  });
});

describe("FindingSchema", () => {
  const valid = {
    id: "finding_1",
    contractId: "contract_1",
    severity: "High",
    slitherDetector: "reentrancy-eth",
    rawOutputReference: "s3://bucket/slither/finding_1.json",
    llmExplanation: "This function is vulnerable to a reentrancy attack because ...",
    status: "Flagged",
    statusHistory: [{ status: "Flagged", changedAt: now }],
    claimedByAuditorId: null,
    claimExpiresAt: null,
    isFalsePositive: false,
    challengeWindowExpiresAt: null,
  };

  it("accepts a well-formed finding", () => {
    expect(FindingSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an invalid severity", () => {
    expect(FindingSchema.safeParse({ ...valid, severity: "Catastrophic" }).success).toBe(false);
  });

  it("rejects a missing llmExplanation", () => {
    const { llmExplanation: _llmExplanation, ...missing } = valid;
    expect(FindingSchema.safeParse(missing).success).toBe(false);
  });

  it("accepts a Verified finding with an open challenge window", () => {
    const verified = {
      ...valid,
      status: "Verified",
      challengeWindowExpiresAt: now,
    };
    expect(FindingSchema.safeParse(verified).success).toBe(true);
  });
});

describe("PoCSubmissionSchema", () => {
  const valid = {
    id: "poc_1",
    findingId: "finding_1",
    auditorId: "auditor_1",
    testFileReference: "s3://bucket/poc/poc_1.t.sol",
    submittedAt: now,
    sandboxStatus: "Pending",
    sandboxLog: null,
  };

  it("accepts a well-formed PoC submission", () => {
    expect(PoCSubmissionSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an invalid sandboxStatus", () => {
    expect(PoCSubmissionSchema.safeParse({ ...valid, sandboxStatus: "Running" }).success).toBe(
      false,
    );
  });
});

describe("DisputeSchema", () => {
  const valid = {
    id: "dispute_1",
    findingId: "finding_1",
    developerId: "dev_1",
    reason: "The PoC does not actually reproduce the finding.",
    openedAt: now,
    challengeWindowExpiresAt: later,
    ruling: "Pending",
    ruledAt: null,
    arbiterId: null,
  };

  it("accepts a well-formed dispute", () => {
    expect(DisputeSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an invalid ruling value", () => {
    expect(DisputeSchema.safeParse({ ...valid, ruling: "Undecided" }).success).toBe(false);
  });

  it("rejects a non-datetime openedAt", () => {
    expect(DisputeSchema.safeParse({ ...valid, openedAt: "not-a-date" }).success).toBe(false);
  });
});

describe("AuditorProfileSchema", () => {
  const valid = {
    id: "auditor_1",
    address,
    stake: 500,
    reputation: 12.5,
    claimedContractIds: ["contract_1"],
  };

  it("accepts a well-formed auditor profile", () => {
    expect(AuditorProfileSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a negative stake", () => {
    expect(AuditorProfileSchema.safeParse({ ...valid, stake: -1 }).success).toBe(false);
  });

  it("rejects a malformed address", () => {
    expect(AuditorProfileSchema.safeParse({ ...valid, address: "0x123" }).success).toBe(false);
  });
});

describe("AnalysisStatusSchema", () => {
  const valid = {
    contractId: "contract_1",
    status: "Failed",
    error: "ParserError: Expected ';'",
    findingCount: 0,
    updatedAt: now,
  };

  it("accepts a failed analysis with its error", () => {
    expect(AnalysisStatusSchema.parse(valid)).toEqual(valid);
  });

  it("accepts a running analysis with no error", () => {
    expect(AnalysisStatusSchema.safeParse({ ...valid, status: "Running", error: null }).success).toBe(true);
  });

  it("rejects a negative finding count", () => {
    expect(AnalysisStatusSchema.safeParse({ ...valid, findingCount: -1 }).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(AnalysisStatusSchema.safeParse({ ...valid, status: "Pending" }).success).toBe(false);
  });
});

describe("PoC upload limits", () => {
  it("caps PoC files at 100 KB", () => {
    expect(POC_SOURCE_MAX_BYTES).toBe(102_400);
    expect(PocSourceSizeSchema.safeParse(102_400).success).toBe(true);
    const tooBig = PocSourceSizeSchema.safeParse(102_401);
    expect(tooBig.success).toBe(false);
    expect(tooBig.error?.issues[0]?.message).toBe("PoC file exceeds the 100 KB limit");
  });

  it("rejects an empty PoC file", () => {
    expect(PocSourceSizeSchema.safeParse(0).success).toBe(false);
  });

  it("only accepts .t.sol filenames", () => {
    expect(PocSourceFilenameSchema.safeParse("Exploit.t.sol").success).toBe(true);
    expect(PocSourceFilenameSchema.safeParse("Exploit.T.SOL").success).toBe(true);
    const plain = PocSourceFilenameSchema.safeParse("Exploit.sol");
    expect(plain.success).toBe(false);
    expect(plain.error?.issues[0]?.message).toBe("Filename must end in .t.sol");
  });
});
