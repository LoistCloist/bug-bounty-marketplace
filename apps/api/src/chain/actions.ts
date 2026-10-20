import type { Address } from "viem";
import type { FindingStatus } from "@bbm/shared";
import type { ChainActionStore } from "./action-store.js";
import type { AuditorStakingPort } from "./auditor-staking.js";
import type { BountyEscrowPort } from "./bounty-escrow.js";
import { onchainId } from "./ids.js";
import { FindingNotFoundError, applyFindingTransition } from "../status/finding-writer.js";
import { transitionFinding } from "../status/transitions.js";

export type Verdict = "Passed" | "Failed";

export interface ChainActionsDeps {
  store: ChainActionStore;
  /** Absent when no chain is configured: every BountyEscrow step is skipped. */
  bountyEscrow?: BountyEscrowPort;
  /** Absent when no chain is configured or CLAIM_LOCK_ENABLED is off. */
  auditorStaking?: AuditorStakingPort;
  /** CLAIM_LOCK_ENABLED. Lock and unlock are skipped when false, even with a port. */
  claimLockEnabled: boolean;
  now?: () => Date;
  /** Where best-effort failures are reported. Defaults to console.error. */
  onError?: (message: string, err: unknown) => void;
}

export interface PayoutRunSummary {
  due: number;
  paid: number;
  failed: number;
}

/** Operator-side chain actions. Each one is idempotent: the store records what
 * was confirmed on-chain, so a retry never repeats a completed write. */
export interface ChainActions {
  /** True when a chain port is configured. Routes use it to require a
   * 0x-address for auditor ids, since payouts go to that address. */
  readonly chainConfigured: boolean;
  /** Locks the auditor's stake for a claim just made. Throws when the lock
   * cannot be sent or recorded; the caller then releases the claim. */
  lockClaim(contractId: string, auditorId: string): Promise<void>;
  /** Unlocks claims whose expiry has passed. Returns how many were unlocked.
   * Throws the first failed unlock after trying the rest. */
  releaseExpiredLocks(now: Date, contractId?: string): Promise<number>;
  /**
   * Applies a sandbox verdict to a Submitted finding.
   * Passed: records the submission (once per contract) and the verification
   * on BountyEscrow, then moves the finding to Verified.
   * Failed: unlocks the auditor's claim lock, then moves the finding to Rejected.
   * Chain steps run first. If one throws, the finding status is unchanged and
   * the call can be retried.
   */
  applyVerdict(findingId: string, verdict: Verdict): Promise<FindingStatus>;
  /** Called when a dispute on the finding is resolved (the Unfrozen event).
   * Unlocks the claim lock once. Returns true if an unlock was sent. */
  applyDisputeResolved(findingId: string): Promise<boolean>;
  /** Pays every Verified finding whose challenge window has closed. A failed
   * payout is logged and left for the next run. Does not set Paid: that
   * happens when PayoutCredited is indexed. */
  runPayoutsOnce(now: Date): Promise<PayoutRunSummary>;
}

export function createChainActions(deps: ChainActionsDeps): ChainActions {
  const { store, bountyEscrow, auditorStaking, claimLockEnabled } = deps;
  const now = deps.now ?? (() => new Date());
  const onError =
    deps.onError ?? ((message: string, err: unknown) => console.error(message, err));
  const lockEnabled = claimLockEnabled && auditorStaking !== undefined;

  /**
   * Sends one unlock if the claim holds an unreleased lock. The store flips the
   * lock to released first, so two concurrent callers cannot both unlock. If
   * the on-chain call fails, the lock is restored so a later call retries.
   */
  async function unlock(
    contractId: string,
    options: { auditorId?: string; expiredBy?: Date },
  ): Promise<boolean> {
    if (!lockEnabled || !auditorStaking) return false;
    const auditorId = await store.takeClaimUnlock(contractId, options);
    if (auditorId === null) return false;
    try {
      await auditorStaking.unlockSubmission(auditorId as Address);
    } catch (err) {
      await store.restoreClaimLock(contractId, auditorId).catch((restoreErr: unknown) => {
        onError(`restoreClaimLock failed for contract ${contractId}`, restoreErr);
      });
      throw err;
    }
    return true;
  }

  return {
    chainConfigured: bountyEscrow !== undefined || auditorStaking !== undefined,

    async lockClaim(contractId, auditorId) {
      if (!lockEnabled || !auditorStaking) return;
      await auditorStaking.lockSubmission(auditorId as Address);
      let recorded = false;
      try {
        recorded = await store.markClaimLocked(contractId, auditorId);
      } catch (err) {
        onError(`markClaimLocked failed for contract ${contractId}`, err);
      }
      if (!recorded) {
        // The stake is locked on-chain but the claim cannot record it, so no
        // unlock would ever run. Undo the lock now and let the caller fail.
        await auditorStaking.unlockSubmission(auditorId as Address).catch((err: unknown) => {
          onError(`unlockSubmission failed while undoing a lock on ${contractId}`, err);
        });
        throw new Error(`Claim on ${contractId} could not record its lock`);
      }
    },

    async releaseExpiredLocks(at, contractId) {
      if (!lockEnabled) return 0;
      const expired = await store.listExpiredLockedClaims(at, contractId);
      let unlocked = 0;
      let firstError: { err: unknown } | undefined;
      for (const claim of expired) {
        try {
          if (await unlock(claim.contractId, { auditorId: claim.auditorId, expiredBy: at })) {
            unlocked += 1;
          }
        } catch (err) {
          firstError ??= { err };
        }
      }
      if (firstError) throw firstError.err;
      return unlocked;
    },

    async applyVerdict(findingId, verdict) {
      const ref = await store.findFinding(findingId);
      if (!ref) throw new FindingNotFoundError(findingId);
      const target: FindingStatus = verdict === "Passed" ? "Verified" : "Rejected";
      if (ref.status === target) return target;
      // Reject an illegal move before any chain call is sent.
      transitionFinding(ref.status, target);
      if (ref.auditorId === null) {
        throw new Error(`Finding ${findingId} has no PoC, so it has no auditor`);
      }

      if (verdict === "Passed") {
        if (bountyEscrow && !ref.verificationRecorded) {
          const contractKey = onchainId(ref.contractId);
          if (!(await store.isSubmissionRecorded(ref.contractId))) {
            await bountyEscrow.recordSubmission(contractKey);
            await store.markSubmissionRecorded(ref.contractId, now());
          }
          await bountyEscrow.recordVerification(
            contractKey,
            onchainId(findingId),
            ref.auditorId as Address,
          );
          await store.markVerificationRecorded(findingId, now());
        }
      } else {
        await unlock(ref.contractId, { auditorId: ref.auditorId });
      }

      return applyFindingTransition(store, findingId, target, now().toISOString());
    },

    async applyDisputeResolved(findingId) {
      const ref = await store.findFinding(findingId);
      if (!ref) throw new FindingNotFoundError(findingId);
      return unlock(ref.contractId, { auditorId: ref.auditorId ?? undefined });
    },

    async runPayoutsOnce(at) {
      if (!bountyEscrow) return { due: 0, paid: 0, failed: 0 };
      const due = await store.listPayoutsDue(at);
      const summary: PayoutRunSummary = { due: due.length, paid: 0, failed: 0 };
      for (const item of due) {
        try {
          await bountyEscrow.payout(
            onchainId(item.contractId),
            onchainId(item.findingId),
            item.auditorId as Address,
          );
        } catch (err) {
          summary.failed += 1;
          onError(`payout failed for finding ${item.findingId}; left for the next run`, err);
          continue;
        }
        summary.paid += 1;
        await store.markPayoutSent(item.findingId, at);
      }
      return summary;
    },
  };
}
