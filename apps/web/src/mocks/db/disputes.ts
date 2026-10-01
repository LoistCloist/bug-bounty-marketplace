import type { Dispute, DisputeRuling } from "@bbm/shared";
import { MOCK_ADDRESSES } from "../../lib/addresses";
import { db } from "./store";
import { nextId } from "./ids";
import { MockApiError } from "./errors";
import { findFindingById, findContractById } from "./contracts";

export function listDisputes(filter?: { ruling?: DisputeRuling }): Dispute[] {
  if (filter?.ruling) {
    return db.disputes.filter((d) => d.ruling === filter.ruling);
  }
  return [...db.disputes];
}

export function findDisputeById(disputeId: string): Dispute | undefined {
  return db.disputes.find((d) => d.id === disputeId);
}

export function findDisputeForFinding(findingId: string): Dispute | undefined {
  return db.disputes.find((d) => d.findingId === findingId);
}

/** Creates the Dispute record for a finding that has just moved to
 * Disputed. The actual Finding status transition is owned by
 * db/contracts.ts (`disputeFinding`); this just records the dispute. */
export function openDispute(findingId: string, developerId: string, reason: string): Dispute {
  const finding = findFindingById(findingId);
  if (!finding) throw new MockApiError(404, `Finding ${findingId} not found`);
  const dispute: Dispute = {
    id: nextId("dispute"),
    findingId,
    developerId,
    reason,
    openedAt: new Date().toISOString(),
    challengeWindowExpiresAt: finding.challengeWindowExpiresAt ?? new Date().toISOString(),
    ruling: "Pending",
    ruledAt: null,
    arbiterId: null,
  };
  db.disputes.push(dispute);
  return dispute;
}

export function ruleOnDispute(
  disputeId: string,
  arbiterId: string,
  ruling: Exclude<DisputeRuling, "Pending">,
): Dispute {
  const dispute = findDisputeById(disputeId);
  if (!dispute) throw new MockApiError(404, `Dispute ${disputeId} not found`);
  if (dispute.ruling !== "Pending") {
    throw new MockApiError(409, `Dispute ${disputeId} has already been ruled on`);
  }

  dispute.ruling = ruling;
  dispute.ruledAt = new Date().toISOString();
  dispute.arbiterId = arbiterId;

  const finding = findFindingById(dispute.findingId);
  if (finding) {
    const auditor = finding.claimedByAuditorId
      ? db.auditorProfiles.find((a) => a.id === finding.claimedByAuditorId)
      : undefined;

    if (ruling === "ForAuditor") {
      finding.status = "Paid";
      finding.statusHistory.push({ status: "Paid", changedAt: dispute.ruledAt });
      const contract = findContractById(finding.contractId);
      if (contract) contract.status = "Resolved";
      if (auditor) auditor.reputation += 1;
    } else {
      finding.status = "Rejected";
      finding.statusHistory.push({ status: "Rejected", changedAt: dispute.ruledAt });
      if (auditor) {
        auditor.reputation -= 1;
        auditor.stake = Math.max(0, auditor.stake - 100);
      }
    }
  }

  return dispute;
}

export function seedDisputesArea(): void {
  // dispute_1: Pending, opened against the already-Disputed finding_5
  // seeded in db/contracts.ts, so the arbiter queue has a concrete item to
  // review from a fresh server start.
  const finding = findFindingById("finding_5");
  db.disputes.push({
    id: nextId("dispute"),
    findingId: "finding_5",
    developerId: MOCK_ADDRESSES.developer,
    reason:
      "The PoC relies on a modified token contract that doesn't match mainnet token behavior; " +
      "this isn't exploitable against the real deployment.",
    openedAt: new Date(Date.now() - 10_000).toISOString(),
    challengeWindowExpiresAt: finding?.challengeWindowExpiresAt ?? new Date().toISOString(),
    ruling: "Pending",
    ruledAt: null,
    arbiterId: null,
  });
}
