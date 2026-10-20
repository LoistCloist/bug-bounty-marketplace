import { describe, expect, it, vi } from "vitest";
import type { Address, Hash, Hex } from "viem";
import type { FindingStatus, PoCSubmission } from "@bbm/shared";
import { MemoryContractRepository } from "../contracts/memory-repository.js";
import { MemoryStore } from "../pipeline/memory-repository.js";
import { makeContract, makeFinding } from "../testing/repository-suite.js";
import { createChainActions, type ChainActionsDeps } from "./actions.js";
import type { AuditorStakingPort } from "./auditor-staking.js";
import type { BountyEscrowPort } from "./bounty-escrow.js";
import { onchainId } from "./ids.js";
import { MemoryChainActionStore } from "./memory-action-store.js";
import { InvalidTransitionError } from "../status/transitions.js";

const T0 = new Date("2026-10-20T12:00:00.000Z");
const CLAIM_WINDOW_MS = 600_000;
const AUDITOR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const HASH = `0x${"ab".repeat(32)}` as Hash;

/** Fake ports: plain mocks, no RPC. */
function fakePorts() {
  const bountyEscrow = {
    recordSubmission: vi.fn(async (_contract: Hex) => HASH),
    recordVerification: vi.fn(async (_contract: Hex, _finding: Hex, _auditor: Address) => HASH),
    payout: vi.fn(async (_contract: Hex, _finding: Hex, _auditor: Address) => HASH),
    pendingPayouts: vi.fn(async () => 0n),
  } satisfies BountyEscrowPort & Record<string, unknown>;
  const auditorStaking = {
    stakeOf: vi.fn(async () => 0n),
    activeSubmissions: vi.fn(async () => 0n),
    lockSubmission: vi.fn(async (_auditor: Address) => HASH),
    unlockSubmission: vi.fn(async (_auditor: Address) => HASH),
  } satisfies AuditorStakingPort & Record<string, unknown>;
  return { bountyEscrow, auditorStaking };
}

function setup(options: { lockEnabled?: boolean; withChain?: boolean } = {}) {
  const store = new MemoryStore();
  const repository = new MemoryContractRepository(store);
  const chainStore = new MemoryChainActionStore(store);
  const clock = { now: T0 };
  const ports = fakePorts();
  const withChain = options.withChain ?? true;
  const deps: ChainActionsDeps = {
    store: chainStore,
    bountyEscrow: withChain ? ports.bountyEscrow : undefined,
    auditorStaking: withChain ? ports.auditorStaking : undefined,
    claimLockEnabled: options.lockEnabled ?? true,
    now: () => clock.now,
    onError: () => {},
  };
  const actions = createChainActions(deps);

  let pocCount = 0;
  /** Seeds a finding with a PoC by `auditor`. Status is set directly, so the
   * test controls the starting point. */
  function seedFinding(
    contractId: string,
    status: FindingStatus,
    overrides: Partial<{ challengeWindowExpiresAt: string | null; sandboxStatus: PoCSubmission["sandboxStatus"] }> = {},
  ) {
    const finding = makeFinding(contractId, {
      status,
      statusHistory: [{ status, changedAt: T0.toISOString() }],
      challengeWindowExpiresAt: overrides.challengeWindowExpiresAt ?? null,
    });
    store.findings.set(finding.id, finding);
    pocCount += 1;
    const poc: PoCSubmission = {
      id: `poc_${pocCount}`,
      findingId: finding.id,
      auditorId: AUDITOR,
      testFileReference: `pocs/poc_${pocCount}/x.t.sol`,
      submittedAt: T0.toISOString(),
      sandboxStatus: overrides.sandboxStatus ?? "Pending",
      sandboxLog: null,
    };
    store.pocs.set(poc.id, poc);
    return finding.id;
  }

  async function seedContract() {
    const record = makeContract();
    await repository.insertContract(record);
    return record.contract.id;
  }

  /** Claims the contract as `auditor` and, unless `lock` is false, runs the
   * same lock step the claim route runs. */
  async function claim(contractId: string, auditor: Address = AUDITOR, lock = true) {
    const expiresAt = new Date(clock.now.getTime() + CLAIM_WINDOW_MS);
    const result = await repository.claimContract(contractId, auditor, expiresAt, clock.now);
    if (!result.ok) throw new Error("claim failed in test setup");
    if (lock) await actions.lockClaim(contractId, auditor);
  }

  function advance(ms: number) {
    clock.now = new Date(clock.now.getTime() + ms);
  }

  return { store, chainStore, repository, clock, actions, ports, seedFinding, seedContract, claim, advance };
}

describe("applyVerdict with Passed", () => {
  it("records the submission and the verification, then marks the finding Verified", async () => {
    const { actions, ports, seedFinding, seedContract, claim, store } = setup();
    const contractId = await seedContract();
    const findingId = seedFinding(contractId, "Submitted");
    await claim(contractId);

    const status = await actions.applyVerdict(findingId, "Passed");

    expect(status).toBe("Verified");
    expect(store.findings.get(findingId)?.status).toBe("Verified");
    expect(ports.bountyEscrow.recordSubmission).toHaveBeenCalledWith(onchainId(contractId));
    expect(ports.bountyEscrow.recordVerification).toHaveBeenCalledWith(
      onchainId(contractId),
      onchainId(findingId),
      AUDITOR,
    );
    // The submission is recorded before the verification.
    const submissionOrder = ports.bountyEscrow.recordSubmission.mock.invocationCallOrder[0]!;
    const verificationOrder = ports.bountyEscrow.recordVerification.mock.invocationCallOrder[0]!;
    expect(submissionOrder).toBeLessThan(verificationOrder);
  });

  it("records the submission once per contract, but each verification", async () => {
    const { actions, ports, seedFinding, seedContract, claim } = setup();
    const contractId = await seedContract();
    const first = seedFinding(contractId, "Submitted");
    const second = seedFinding(contractId, "Submitted");
    await claim(contractId);

    await actions.applyVerdict(first, "Passed");
    await actions.applyVerdict(second, "Passed");

    expect(ports.bountyEscrow.recordSubmission).toHaveBeenCalledTimes(1);
    expect(ports.bountyEscrow.recordVerification).toHaveBeenCalledTimes(2);
  });

  it("leaves the status unchanged when the chain call fails, and a retry completes", async () => {
    const { actions, ports, seedFinding, seedContract, claim, store } = setup();
    const contractId = await seedContract();
    const findingId = seedFinding(contractId, "Submitted");
    await claim(contractId);
    ports.bountyEscrow.recordVerification.mockRejectedValueOnce(new Error("rpc unavailable"));

    await expect(actions.applyVerdict(findingId, "Passed")).rejects.toThrow("rpc unavailable");
    expect(store.findings.get(findingId)?.status).toBe("Submitted");

    await expect(actions.applyVerdict(findingId, "Passed")).resolves.toBe("Verified");
    expect(store.findings.get(findingId)?.status).toBe("Verified");
    // The submission was confirmed on the first attempt, so the retry skips it.
    expect(ports.bountyEscrow.recordSubmission).toHaveBeenCalledTimes(1);
  });

  it("rejects an illegal move before any chain call", async () => {
    const { actions, ports, seedFinding, seedContract, store } = setup();
    const contractId = await seedContract();
    const findingId = seedFinding(contractId, "Flagged");

    await expect(actions.applyVerdict(findingId, "Passed")).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
    expect(ports.bountyEscrow.recordSubmission).not.toHaveBeenCalled();
    expect(ports.bountyEscrow.recordVerification).not.toHaveBeenCalled();
    expect(store.findings.get(findingId)?.status).toBe("Flagged");
  });

  it("does nothing when the finding is already Verified", async () => {
    const { actions, ports, seedFinding, seedContract } = setup();
    const contractId = await seedContract();
    const findingId = seedFinding(contractId, "Verified");

    await expect(actions.applyVerdict(findingId, "Passed")).resolves.toBe("Verified");
    expect(ports.bountyEscrow.recordVerification).not.toHaveBeenCalled();
  });
});

describe("applyVerdict with Failed", () => {
  it("unlocks the auditor once and moves the finding to Rejected", async () => {
    const { actions, ports, seedFinding, seedContract, claim, store, advance } = setup();
    const contractId = await seedContract();
    const findingId = seedFinding(contractId, "Submitted");
    await claim(contractId);
    ports.auditorStaking.unlockSubmission.mockClear();

    await expect(actions.applyVerdict(findingId, "Failed")).resolves.toBe("Rejected");
    expect(store.findings.get(findingId)?.status).toBe("Rejected");
    expect(ports.auditorStaking.unlockSubmission).toHaveBeenCalledTimes(1);
    expect(ports.auditorStaking.unlockSubmission).toHaveBeenCalledWith(AUDITOR);

    // A repeat verdict and a later expiry sweep must not unlock again.
    await actions.applyVerdict(findingId, "Failed");
    advance(CLAIM_WINDOW_MS + 1);
    await expect(actions.releaseExpiredLocks(new Date(T0.getTime() + CLAIM_WINDOW_MS + 1))).resolves.toBe(0);
    expect(ports.auditorStaking.unlockSubmission).toHaveBeenCalledTimes(1);
  });

  it("keeps the status when the unlock fails, and a retry unlocks exactly once", async () => {
    const { actions, ports, seedFinding, seedContract, claim, store } = setup();
    const contractId = await seedContract();
    const findingId = seedFinding(contractId, "Submitted");
    await claim(contractId);
    ports.auditorStaking.unlockSubmission.mockRejectedValueOnce(new Error("rpc unavailable"));

    await expect(actions.applyVerdict(findingId, "Failed")).rejects.toThrow("rpc unavailable");
    expect(store.findings.get(findingId)?.status).toBe("Submitted");

    await expect(actions.applyVerdict(findingId, "Failed")).resolves.toBe("Rejected");
    expect(ports.auditorStaking.unlockSubmission).toHaveBeenCalledTimes(2);
    await actions.applyVerdict(findingId, "Failed");
    expect(ports.auditorStaking.unlockSubmission).toHaveBeenCalledTimes(2);
  });
});

describe("claim lock expiry", () => {
  it("unlocks a lapsed claim once; a second run does not unlock again", async () => {
    const { actions, ports, seedContract, claim, advance } = setup();
    const contractId = await seedContract();
    await claim(contractId);
    advance(CLAIM_WINDOW_MS);

    await expect(actions.releaseExpiredLocks(new Date(T0.getTime() + CLAIM_WINDOW_MS))).resolves.toBe(1);
    await expect(actions.releaseExpiredLocks(new Date(T0.getTime() + CLAIM_WINDOW_MS))).resolves.toBe(0);
    expect(ports.auditorStaking.unlockSubmission).toHaveBeenCalledTimes(1);
    expect(ports.auditorStaking.unlockSubmission).toHaveBeenCalledWith(AUDITOR);
  });

  it("does not unlock a claim that has not expired", async () => {
    const { actions, ports, seedContract, claim } = setup();
    const contractId = await seedContract();
    await claim(contractId);

    await expect(actions.releaseExpiredLocks(T0)).resolves.toBe(0);
    expect(ports.auditorStaking.unlockSubmission).not.toHaveBeenCalled();
  });

  it("never unlocks a claim that was never locked", async () => {
    const { actions, ports, seedFinding, seedContract, claim, advance, store } = setup();
    const contractId = await seedContract();
    const findingId = seedFinding(contractId, "Submitted");
    await claim(contractId, AUDITOR, false);
    advance(CLAIM_WINDOW_MS);

    await expect(actions.releaseExpiredLocks(new Date(T0.getTime() + CLAIM_WINDOW_MS))).resolves.toBe(0);
    await actions.applyVerdict(findingId, "Failed");
    expect(store.findings.get(findingId)?.status).toBe("Rejected");
    expect(ports.auditorStaking.unlockSubmission).not.toHaveBeenCalled();
  });
});

describe("CLAIM_LOCK_ENABLED off", () => {
  it("skips lock and unlock, while verdicts still reach the chain", async () => {
    const { actions, ports, seedFinding, seedContract, claim, store } = setup({ lockEnabled: false });
    const contractId = await seedContract();
    const passing = seedFinding(contractId, "Submitted");
    const failing = seedFinding(contractId, "Submitted");
    await claim(contractId);
    expect(ports.auditorStaking.lockSubmission).not.toHaveBeenCalled();

    await actions.applyVerdict(passing, "Passed");
    expect(ports.bountyEscrow.recordVerification).toHaveBeenCalledTimes(1);
    expect(store.findings.get(passing)?.status).toBe("Verified");

    await actions.applyVerdict(failing, "Failed");
    expect(ports.auditorStaking.unlockSubmission).not.toHaveBeenCalled();
    expect(store.findings.get(failing)?.status).toBe("Rejected");
  });
});

describe("dispute resolution", () => {
  it("unlocks the claim lock once when the dispute is resolved", async () => {
    const { actions, ports, seedFinding, seedContract, claim } = setup();
    const contractId = await seedContract();
    const findingId = seedFinding(contractId, "Disputed");
    await claim(contractId);

    await expect(actions.applyDisputeResolved(findingId)).resolves.toBe(true);
    expect(ports.auditorStaking.unlockSubmission).toHaveBeenCalledTimes(1);
    expect(ports.auditorStaking.unlockSubmission).toHaveBeenCalledWith(AUDITOR);

    await expect(actions.applyDisputeResolved(findingId)).resolves.toBe(false);
    expect(ports.auditorStaking.unlockSubmission).toHaveBeenCalledTimes(1);
  });

  it("does not unlock again after a Failed verdict already released the lock", async () => {
    const { actions, ports, seedFinding, seedContract, claim } = setup();
    const contractId = await seedContract();
    const findingId = seedFinding(contractId, "Submitted");
    await claim(contractId);
    await actions.applyVerdict(findingId, "Failed");

    await expect(actions.applyDisputeResolved(findingId)).resolves.toBe(false);
    expect(ports.auditorStaking.unlockSubmission).toHaveBeenCalledTimes(1);
  });
});

describe("runPayoutsOnce", () => {
  it("pays only findings past their window, once each, and leaves a failed payout for the next run", async () => {
    const { actions, ports, seedFinding, seedContract, store, chainStore, clock } = setup();
    const contractId = await seedContract();
    const now = clock.now;
    const past = new Date(now.getTime() - 3_600_000).toISOString();
    const future = new Date(now.getTime() + 3_600_000).toISOString();
    const due1 = seedFinding(contractId, "Verified", { challengeWindowExpiresAt: past, sandboxStatus: "Passed" });
    const due2 = seedFinding(contractId, "Verified", { challengeWindowExpiresAt: past, sandboxStatus: "Passed" });
    const notYet = seedFinding(contractId, "Verified", { challengeWindowExpiresAt: future, sandboxStatus: "Passed" });
    const revertsOnce = seedFinding(contractId, "Verified", { challengeWindowExpiresAt: past, sandboxStatus: "Passed" });
    let failuresLeft = new Set([onchainId(revertsOnce)]);
    ports.bountyEscrow.payout.mockImplementation(async (_c: Hex, finding: Hex) => {
      if (failuresLeft.has(finding)) {
        failuresLeft = new Set();
        throw new Error("execution reverted");
      }
      return HASH;
    });

    await expect(actions.runPayoutsOnce(now)).resolves.toEqual({ due: 3, paid: 2, failed: 1 });
    expect(ports.bountyEscrow.payout).toHaveBeenCalledTimes(3);
    expect(ports.bountyEscrow.payout).toHaveBeenCalledWith(onchainId(contractId), onchainId(due1), AUDITOR);
    expect(ports.bountyEscrow.payout).toHaveBeenCalledWith(onchainId(contractId), onchainId(due2), AUDITOR);

    // Idempotent: the paid findings are not paid again; the reverted one is retried.
    await expect(actions.runPayoutsOnce(now)).resolves.toEqual({ due: 1, paid: 1, failed: 0 });
    expect(ports.bountyEscrow.payout).toHaveBeenCalledTimes(4);
    expect(ports.bountyEscrow.payout).toHaveBeenLastCalledWith(onchainId(contractId), onchainId(revertsOnce), AUDITOR);
    await expect(actions.runPayoutsOnce(now)).resolves.toEqual({ due: 0, paid: 0, failed: 0 });
    expect(ports.bountyEscrow.payout).toHaveBeenCalledTimes(4);

    // The keeper never sets Paid itself, and never touches a finding still inside its window.
    expect(store.findings.get(due1)?.status).toBe("Verified");
    expect(store.findings.get(notYet)?.status).toBe("Verified");
    await expect(chainStore.listPayoutsDue(now)).resolves.toHaveLength(0);
  });
});

describe("no chain configured", () => {
  it("makes no chain calls and reports no payouts", async () => {
    const { actions, seedFinding, seedContract, claim, store } = setup({ withChain: false });
    const contractId = await seedContract();
    const findingId = seedFinding(contractId, "Submitted", { challengeWindowExpiresAt: T0.toISOString(), sandboxStatus: "Passed" });
    await claim(contractId);

    expect(actions.chainConfigured).toBe(false);
    await expect(actions.releaseExpiredLocks(new Date(T0.getTime() + CLAIM_WINDOW_MS * 2))).resolves.toBe(0);
    await expect(actions.applyDisputeResolved(findingId)).resolves.toBe(false);
    await expect(actions.runPayoutsOnce(T0)).resolves.toEqual({ due: 0, paid: 0, failed: 0 });
    // Status still follows the verdict; only the chain steps are skipped.
    await expect(actions.applyVerdict(findingId, "Passed")).resolves.toBe("Verified");
    expect(store.findings.get(findingId)?.status).toBe("Verified");
  });
});
