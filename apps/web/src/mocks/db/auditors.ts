import type { AuditorProfile, Contract, Finding, PoCSubmission } from "@bbm/shared";
import { MOCK_ADDRESSES } from "../../lib/addresses";
import { db } from "./store";
import { nextId } from "./ids";
import { scheduleOnce } from "./scheduler";
import { SANDBOX_DELAY_MS, CLAIM_WINDOW_MS } from "./timing";
import { MockApiError } from "./errors";
import { armChallengeWindow, findContractById, findFindingById } from "./contracts";

/** Fixed id of the single seeded auditor profile. Exported so db/contracts.ts
 * can pre-assign claims to this auditor in its own seed data. */
export const SEED_AUDITOR_ID = "auditor_1";

/** Finding ids whose PoC is seeded/designed to fail sandbox re-run, landing
 * the finding in Rejected instead of Verified. */
const FORCE_REJECT_FINDING_IDS = new Set<string>();

function timestamp(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

export function findAuditorById(auditorId: string): AuditorProfile | undefined {
  return db.auditorProfiles.find((a) => a.id === auditorId);
}

export interface QueueItem extends Contract {
  bounty: { amount: number; currency: string };
}

export function listQueue(sort?: "deadline" | "bounty"): QueueItem[] {
  const open = db.contracts.filter((c) => c.status === "Open");
  const items: QueueItem[] = open.map((c) => {
    const bounty = db.bounties.find((b) => b.contractId === c.id);
    return { ...c, bounty: { amount: bounty?.amount ?? 0, currency: bounty?.currency ?? "ETH" } };
  });
  if (sort === "deadline") {
    items.sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
  } else if (sort === "bounty") {
    items.sort((a, b) => b.bounty.amount - a.bounty.amount);
  }
  return items;
}

export function claimContract(contractId: string, auditorId: string): Contract {
  const contract = findContractById(contractId);
  if (!contract) throw new MockApiError(404, `Contract ${contractId} not found`);
  if (contract.status !== "Open") {
    throw new MockApiError(409, `Contract ${contractId} is not open to claim`);
  }
  const auditor = findAuditorById(auditorId);
  if (!auditor) throw new MockApiError(404, `Auditor ${auditorId} not found`);

  contract.status = "Claimed";
  const claimExpiresAt = timestamp(CLAIM_WINDOW_MS);
  for (const finding of db.findings.filter((f) => f.contractId === contractId)) {
    finding.claimedByAuditorId = auditorId;
    finding.claimExpiresAt = claimExpiresAt;
  }
  if (!auditor.claimedContractIds.includes(contractId)) {
    auditor.claimedContractIds.push(contractId);
  }
  return contract;
}

export function postStake(auditorId: string, amount: number): AuditorProfile {
  const auditor = findAuditorById(auditorId);
  if (!auditor) throw new MockApiError(404, `Auditor ${auditorId} not found`);
  if (amount <= 0) throw new MockApiError(400, "Stake amount must be positive");
  auditor.stake += amount;
  return auditor;
}

function resolveSandbox(pocId: string, findingId: string): void {
  const poc = db.pocSubmissions.find((p) => p.id === pocId);
  const finding = findFindingById(findingId);
  if (!poc || !finding) return;

  if (FORCE_REJECT_FINDING_IDS.has(findingId)) {
    poc.sandboxStatus = "Failed";
    poc.sandboxLog =
      "forge test: FAIL - exploit assertion did not revert as expected; PoC does not " +
      "reproduce the finding against the current contract state.";
    finding.status = "Rejected";
    finding.statusHistory.push({ status: "Rejected", changedAt: timestamp() });
    return;
  }

  poc.sandboxStatus = "Passed";
  poc.sandboxLog = "forge test: PASS - exploit reproduced, invariant violated as described.";
  finding.status = "Verified";
  finding.statusHistory.push({ status: "Verified", changedAt: timestamp() });
  armChallengeWindow(findingId);
}

export function submitPoc(
  findingId: string,
  auditorId: string,
  testFilename: string,
): PoCSubmission {
  const finding = findFindingById(findingId);
  if (!finding) throw new MockApiError(404, `Finding ${findingId} not found`);
  if (finding.status !== "Flagged" && finding.status !== "Submitted") {
    throw new MockApiError(400, `Finding ${findingId} is not awaiting a PoC`);
  }

  const pocId = nextId("poc");
  const poc: PoCSubmission = {
    id: pocId,
    findingId,
    auditorId,
    testFileReference: `mock://pocs/${pocId}/${testFilename}`,
    submittedAt: timestamp(),
    sandboxStatus: "Pending",
    sandboxLog: null,
  };
  db.pocSubmissions.push(poc);

  finding.status = "Submitted";
  finding.statusHistory.push({ status: "Submitted", changedAt: timestamp() });

  scheduleOnce(`sandbox:${pocId}`, SANDBOX_DELAY_MS, () => resolveSandbox(pocId, findingId));

  return poc;
}

export function markFalsePositive(findingId: string, _auditorId: string): Finding {
  const finding = findFindingById(findingId);
  if (!finding) throw new MockApiError(404, `Finding ${findingId} not found`);
  finding.isFalsePositive = true;
  finding.status = "Rejected";
  finding.statusHistory.push({ status: "Rejected", changedAt: timestamp() });
  return finding;
}

export function seedAuditorsArea(): void {
  db.auditorProfiles.push({
    id: SEED_AUDITOR_ID,
    address: MOCK_ADDRESSES.auditor,
    stake: 5_000,
    reputation: 12,
    claimedContractIds: ["contract_2", "contract_3"],
  });

  // poc_1: already Passed, backing finding_3 (the Verified/auto-pay demo).
  db.pocSubmissions.push({
    id: nextId("poc"),
    findingId: "finding_3",
    auditorId: SEED_AUDITOR_ID,
    testFileReference: "mock://pocs/poc_1/ReentrancyExploit.t.sol",
    submittedAt: new Date(Date.now() - 15_000).toISOString(),
    sandboxStatus: "Passed",
    sandboxLog: "forge test: PASS - exploit reproduced, invariant violated as described.",
  });

  // poc_2: Pending against finding_4, seeded to resolve Failed in ~3s -
  // the "sandbox rejects it" scenario.
  const pendingPocId = nextId("poc");
  db.pocSubmissions.push({
    id: pendingPocId,
    findingId: "finding_4",
    auditorId: SEED_AUDITOR_ID,
    testFileReference: "mock://pocs/poc_2/SelfdestructExploit.t.sol",
    submittedAt: new Date(Date.now() - 1_000).toISOString(),
    sandboxStatus: "Pending",
    sandboxLog: null,
  });
  FORCE_REJECT_FINDING_IDS.add("finding_4");
  scheduleOnce(`sandbox:${pendingPocId}`, SANDBOX_DELAY_MS, () =>
    resolveSandbox(pendingPocId, "finding_4"),
  );

  // poc_3: Passed, backing finding_5 (already Disputed - seeded in
  // db/disputes.ts) so the arbiter has a sandbox log to review.
  db.pocSubmissions.push({
    id: nextId("poc"),
    findingId: "finding_5",
    auditorId: SEED_AUDITOR_ID,
    testFileReference: "mock://pocs/poc_3/UnusedReturnExploit.t.sol",
    submittedAt: new Date(Date.now() - 50_000).toISOString(),
    sandboxStatus: "Passed",
    sandboxLog: "forge test: PASS - exploit reproduced, invariant violated as described.",
  });
}
