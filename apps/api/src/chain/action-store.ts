import type { FindingStatus } from "@bbm/shared";
import type { FindingStatusReader, FindingStatusWriter } from "../status/finding-writer.js";

/** A finding as the chain actions need it. */
export interface FindingChainRef {
  findingId: string;
  contractId: string;
  status: FindingStatus;
  /** Auditor on the finding's latest PoC; null when no PoC was uploaded. */
  auditorId: string | null;
  /** True once BountyEscrow.recordVerification has been confirmed for it. */
  verificationRecorded: boolean;
}

/** A Verified finding whose challenge window has closed and whose payout has
 * not been sent yet. */
export interface PayoutDue {
  findingId: string;
  contractId: string;
  auditorId: string;
}

/**
 * Persistence for chain actions: the claim lock state, and the markers that
 * make each BountyEscrow write happen at most once. Findings are read and
 * written through the shared status interfaces.
 */
export interface ChainActionStore extends FindingStatusReader, FindingStatusWriter {
  findFinding(findingId: string): Promise<FindingChainRef | null>;

  isSubmissionRecorded(contractId: string): Promise<boolean>;
  markSubmissionRecorded(contractId: string, at: Date): Promise<void>;
  markVerificationRecorded(findingId: string, at: Date): Promise<void>;

  /** Sets the current claim to "locked". False when the contract is no longer
   * Claimed by this auditor, in which case nothing is recorded. */
  markClaimLocked(contractId: string, auditorId: string): Promise<boolean>;
  /**
   * Atomically flips a "locked" claim to "released" and returns the auditor
   * whose lock must be unlocked. Returns null, changing nothing, when there is
   * no lock to release: never locked, already released, held by someone else
   * (when `auditorId` is given), or not yet expired (when `expiredBy` is given).
   */
  takeClaimUnlock(
    contractId: string,
    options: { auditorId?: string; expiredBy?: Date },
  ): Promise<string | null>;
  /** Undoes a `takeClaimUnlock` whose on-chain unlock failed. */
  restoreClaimLock(contractId: string, auditorId: string): Promise<void>;
  /** Locked claims whose expiry is at or before `now`. */
  listExpiredLockedClaims(
    now: Date,
    contractId?: string,
  ): Promise<{ contractId: string; auditorId: string }[]>;

  /** Verified findings past their challenge window with no payout sent yet. */
  listPayoutsDue(now: Date): Promise<PayoutDue[]>;
  markPayoutSent(findingId: string, at: Date): Promise<void>;
}
