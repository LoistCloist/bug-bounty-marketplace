import { describe, expect, it } from "vitest";
import { MemoryContractRepository } from "../contracts/memory-repository.js";
import { MemoryDisputeRepository } from "../disputes/memory-repository.js";
import { MemoryPipelineRepository, MemoryStore } from "../pipeline/memory-repository.js";
import { makeContract, makeFinding } from "../testing/repository-suite.js";
import { composeStatusHooks, disputeSettler, rejectedClaimEnder } from "./dispute-settler.js";

const AT = new Date("2026-10-24T12:00:00.000Z");

async function pendingDispute(repo: MemoryDisputeRepository, findingId = "finding_1") {
  return repo.create({
    id: `dispute_${findingId}`,
    findingId,
    contractId: "contract_1",
    developerId: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    reason: "bad PoC",
    ruling: "Pending",
    arbiterId: null,
    openedAt: "2026-10-24T11:00:00.000Z",
    ruledAt: null,
    challengeWindowExpiresAt: "2026-10-24T11:01:00.000Z",
  } as never);
}

describe("disputeSettler", () => {
  it("records a ruling against the auditor when Unfrozen rejects the finding", async () => {
    const repo = new MemoryDisputeRepository();
    await pendingDispute(repo);
    await disputeSettler(repo, "0xArbiter", () => AT)("finding_1", "Rejected", "Unfrozen");
    expect(await repo.findByFinding("finding_1")).toMatchObject({
      ruling: "AgainstAuditor",
      arbiterId: "0xArbiter",
      ruledAt: AT.toISOString(),
    });
  });

  it("records a ruling for the auditor when Unfrozen keeps the finding Verified (a ruling or a lapse)", async () => {
    const repo = new MemoryDisputeRepository();
    await pendingDispute(repo);
    await disputeSettler(repo, "0xArbiter", () => AT)("finding_1", "Verified", "Unfrozen");
    expect((await repo.findByFinding("finding_1"))?.ruling).toBe("ForAuditor");
  });

  it("leaves an already ruled dispute and other events alone", async () => {
    const repo = new MemoryDisputeRepository();
    const d = await pendingDispute(repo);
    await repo.setRuling(d.id, "ForAuditor", "0xArbiter", AT);
    const settle = disputeSettler(repo, "0xOther", () => new Date("2027-01-01T00:00:00.000Z"));
    await settle("finding_1", "Rejected", "Unfrozen");
    await settle("finding_2", "Paid", "PayoutCredited");
    expect(await repo.findByFinding("finding_1")).toMatchObject({
      ruling: "ForAuditor",
      arbiterId: "0xArbiter",
    });
  });
});

const AUDITOR = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

async function claimedContractWithFinding() {
  const store = new MemoryStore();
  const contracts = new MemoryContractRepository(store);
  const pipeline = new MemoryPipelineRepository(store);
  const record = makeContract();
  await contracts.insertContract(record);
  await contracts.claimContract(record.contract.id, AUDITOR, new Date(AT.getTime() + 600_000), AT);
  const finding = makeFinding(record.contract.id, { status: "Rejected" });
  store.findings.set(finding.id, finding);
  const other = makeContract();
  await contracts.insertContract(other);
  return {
    contracts,
    pipeline,
    contractId: record.contract.id,
    findingId: finding.id,
    otherId: other.contract.id,
  };
}

describe("rejectedClaimEnder", () => {
  it("ends the auditor's claim when a dispute rejects the finding, so they can claim again", async () => {
    const { contracts, pipeline, contractId, findingId, otherId } =
      await claimedContractWithFinding();
    await rejectedClaimEnder({ contracts, pipeline, now: () => AT })(
      findingId,
      "Rejected",
      "Unfrozen",
    );
    expect(await contracts.findActiveClaim(contractId, AT)).toBeNull();
    expect((await contracts.findContractById(contractId, AT))?.status).toBe("Open");
    expect(
      (await contracts.claimContract(otherId, AUDITOR, new Date(AT.getTime() + 600_000), AT)).ok,
    ).toBe(true);
  });

  it("keeps the claim when the auditor won or the event is not a dispute resolution", async () => {
    const { contracts, pipeline, contractId, findingId } = await claimedContractWithFinding();
    const end = rejectedClaimEnder({ contracts, pipeline, now: () => AT });
    await end(findingId, "Verified", "Unfrozen");
    await end(findingId, "Rejected", "FindingRejected");
    expect(await contracts.findActiveClaim(contractId, AT)).toMatchObject({ auditorId: AUDITOR });
  });
});

describe("composeStatusHooks", () => {
  it("runs every hook even when one fails, then reports the failure", async () => {
    const calls: string[] = [];
    const hook = composeStatusHooks(
      async () => {
        calls.push("a");
        throw new Error("a failed");
      },
      async () => {
        calls.push("b");
      },
    );
    await expect(hook("finding_1", "Paid", "PayoutCredited")).rejects.toThrow("a failed");
    expect(calls).toEqual(["a", "b"]);
  });
});
