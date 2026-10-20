import type { FindingStatus } from "@bbm/shared";
import type { MemoryStore } from "../pipeline/memory-repository.js";
import type { ChainActionStore, FindingChainRef, PayoutDue } from "./action-store.js";

/** In-memory ChainActionStore over the same MemoryStore the repositories use.
 * Tests and the no-DATABASE_URL setup. */
export class MemoryChainActionStore implements ChainActionStore {
  private readonly submissionRecorded = new Set<string>();
  private readonly verificationRecorded = new Set<string>();
  private readonly payoutSent = new Set<string>();

  constructor(private readonly store: MemoryStore) {}

  async getFindingStatus(findingId: string): Promise<FindingStatus | null> {
    return this.store.findings.get(findingId)?.status ?? null;
  }

  async setFindingStatus(findingId: string, status: FindingStatus, changedAt: string): Promise<void> {
    const record = this.store.findings.get(findingId);
    if (!record) throw new Error(`Finding not found: ${findingId}`);
    record.status = status;
    record.statusHistory = [...record.statusHistory, { status, changedAt }];
  }

  async findFinding(findingId: string): Promise<FindingChainRef | null> {
    const record = this.store.findings.get(findingId);
    if (!record) return null;
    const latestPoc = [...this.store.pocs.values()]
      .filter((poc) => poc.findingId === findingId)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
    return {
      findingId,
      contractId: record.contractId,
      status: record.status,
      auditorId: latestPoc?.auditorId ?? null,
      verificationRecorded: this.verificationRecorded.has(findingId),
    };
  }

  async isSubmissionRecorded(contractId: string): Promise<boolean> {
    return this.submissionRecorded.has(contractId);
  }

  async markSubmissionRecorded(contractId: string): Promise<void> {
    this.submissionRecorded.add(contractId);
  }

  async markVerificationRecorded(findingId: string): Promise<void> {
    this.verificationRecorded.add(findingId);
  }

  async markClaimLocked(contractId: string, auditorId: string): Promise<boolean> {
    const stored = this.store.contracts.get(contractId);
    if (!stored || stored.contract.status !== "Claimed" || stored.claimedByAuditorId !== auditorId) {
      return false;
    }
    stored.claimLock = "locked";
    return true;
  }

  async takeClaimUnlock(
    contractId: string,
    options: { auditorId?: string; expiredBy?: Date },
  ): Promise<string | null> {
    const stored = this.store.contracts.get(contractId);
    if (!stored || stored.claimLock !== "locked" || !stored.claimedByAuditorId) return null;
    if (options.auditorId !== undefined && options.auditorId !== stored.claimedByAuditorId) return null;
    if (options.expiredBy !== undefined) {
      if (!stored.claimExpiresAt || stored.claimExpiresAt.getTime() > options.expiredBy.getTime()) {
        return null;
      }
    }
    stored.claimLock = "unlocking";
    return stored.claimedByAuditorId;
  }

  async findUnlockingClaims(contractId?: string): Promise<{ contractId: string; auditorId: string }[]> {
    const out: { contractId: string; auditorId: string }[] = [];
    for (const [id, stored] of this.store.contracts) {
      if (contractId !== undefined && id !== contractId) continue;
      if (stored.claimLock !== "unlocking" || !stored.claimedByAuditorId) continue;
      out.push({ contractId: id, auditorId: stored.claimedByAuditorId });
    }
    return out;
  }

  async markClaimUnlocking(contractId: string, auditorId: string): Promise<boolean> {
    const stored = this.store.contracts.get(contractId);
    if (!stored || stored.claimedByAuditorId !== auditorId) return false;
    stored.claimLock = "unlocking";
    return true;
  }

  async markClaimReleased(contractId: string, auditorId: string): Promise<void> {
    const stored = this.store.contracts.get(contractId);
    if (stored?.claimLock === "unlocking" && stored.claimedByAuditorId === auditorId) {
      stored.claimLock = "released";
    }
  }

  async listExpiredLockedClaims(
    now: Date,
    contractId?: string,
  ): Promise<{ contractId: string; auditorId: string }[]> {
    const out: { contractId: string; auditorId: string }[] = [];
    for (const [id, stored] of this.store.contracts) {
      if (contractId !== undefined && id !== contractId) continue;
      if (stored.claimLock !== "locked" || !stored.claimedByAuditorId || !stored.claimExpiresAt) continue;
      if (stored.claimExpiresAt.getTime() > now.getTime()) continue;
      out.push({ contractId: id, auditorId: stored.claimedByAuditorId });
    }
    return out;
  }

  async listPayoutsDue(now: Date): Promise<PayoutDue[]> {
    const due: PayoutDue[] = [];
    for (const record of this.store.findings.values()) {
      if (record.status !== "Verified" || this.payoutSent.has(record.id)) continue;
      if (!record.challengeWindowExpiresAt) continue;
      if (new Date(record.challengeWindowExpiresAt).getTime() > now.getTime()) continue;
      const passed = [...this.store.pocs.values()]
        .filter((poc) => poc.findingId === record.id && poc.sandboxStatus === "Passed")
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
      if (!passed) continue;
      due.push({ findingId: record.id, contractId: record.contractId, auditorId: passed.auditorId });
    }
    return due;
  }

  async markPayoutSent(findingId: string): Promise<void> {
    this.payoutSent.add(findingId);
  }
}
