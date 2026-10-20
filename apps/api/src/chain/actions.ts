import type { Address } from "viem";
import type { FindingStatus } from "@bbm/shared";
import type { ChainActionStore, PayoutDue } from "./action-store.js";
import type { AuditorStakingPort } from "./auditor-staking.js";
import { BOUNTY_STATE_PAID, type BountyEscrowPort } from "./bounty-escrow.js";
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

/** Operator-side chain actions. Each chain write is preceded by a read of the
 * chain state it would change, so a retry after a send whose marker write
 * failed does not send again. */
export interface ChainActions {
  /** True when a chain port is configured. Routes use it to require a
   * 0x-address for auditor ids, since payouts go to that address. */
  readonly chainConfigured: boolean;
  /** Locks the auditor's stake for a claim just made. Throws when the lock
   * cannot be sent or recorded; the caller then releases the claim. */
  lockClaim(contractId: string, auditorId: string): Promise<void>;
  /** Finishes unlocks of claims in 'unlocking' and unlocks claims whose expiry
   * has passed. Returns how many claims were released. Throws the first
   * failure after trying the rest. */
  releaseExpiredLocks(now: Date, contractId?: string): Promise<number>;
  /** The sweep the keeper runs: finishes every claim left in 'unlocking'.
   * Returns how many claims were released. */
  finishPendingUnlocks(): Promise<number>;
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
   * Unlocks the claim lock once. Returns true if this call released a lock. */
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

  /** Per-contract queues in this process. Two unlocks of one claim must never
   * read and send at the same time, or both could see the lock and send. */
  const contractQueues = new Map<string, Promise<unknown>>();
  function serialize<T>(contractId: string, task: () => Promise<T>): Promise<T> {
    const run = (contractQueues.get(contractId) ?? Promise.resolve()).then(task);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    contractQueues.set(contractId, tail);
    void tail.then(() => {
      if (contractQueues.get(contractId) === tail) contractQueues.delete(contractId);
    });
    return run;
  }

  /**
   * Finishes one claim's unlock. Reads activeSubmissions first: zero means
   * the lock is already gone (an earlier send landed), so only the marker is
   * written. The claim stays 'unlocking' until a call here returns, so a
   * failure at any point leaves an intent the sweep finishes.
   */
  async function finishUnlock(contractId: string, auditorId: string): Promise<void> {
    if (!auditorStaking) return;
    const staker = auditorId as Address;
    if ((await auditorStaking.activeSubmissions(staker)) > 0n) {
      await auditorStaking.unlockSubmission(staker);
    }
    await store.markClaimReleased(contractId, auditorId);
  }

  /** Finishes every claim in 'unlocking' for one contract. The caller holds
   * that contract's queue. Returns how many were released. */
  async function finishUnlockingFor(contractId: string): Promise<number> {
    const pending = await store.findUnlockingClaims(contractId);
    for (const claim of pending) {
      await finishUnlock(claim.contractId, claim.auditorId);
    }
    return pending.length;
  }

  /** Finishes every 'unlocking' claim, or those of one contract. Each contract
   * is tried even when an earlier one fails; the first failure is rethrown. */
  async function finishUnlocking(contractId?: string): Promise<number> {
    const pending = await store.findUnlockingClaims(contractId);
    let released = 0;
    let firstError: { err: unknown } | undefined;
    for (const id of new Set(pending.map((claim) => claim.contractId))) {
      try {
        released += await serialize(id, () => finishUnlockingFor(id));
      } catch (err) {
        firstError ??= { err };
      }
    }
    if (firstError) throw firstError.err;
    return released;
  }

  /**
   * Takes the claim's lock (locked -> unlocking) and finishes it. If there is
   * no lock to take, finishes any unlock an earlier attempt left in
   * 'unlocking', so a failed Failed-verdict unlock is retried by the next call.
   * Returns true when this call released a lock.
   */
  async function unlock(
    contractId: string,
    options: { auditorId?: string; expiredBy?: Date },
  ): Promise<boolean> {
    if (!lockEnabled) return false;
    return serialize(contractId, async () => {
      const auditorId = await store.takeClaimUnlock(contractId, options);
      if (auditorId !== null) {
        await finishUnlock(contractId, auditorId);
        return true;
      }
      return (await finishUnlockingFor(contractId)) > 0;
    });
  }

  /** The undo of a lock failed. Persists an 'unlocking' intent so the sweep
   * releases the lock, but only when the chain shows the lock landed (the
   * count rose above `before`). */
  async function recordUndoFailure(contractId: string, auditorId: string, before: bigint): Promise<void> {
    if (!auditorStaking) return;
    let landed = true;
    try {
      landed = (await auditorStaking.activeSubmissions(auditorId as Address)) > before;
    } catch (err) {
      onError(`activeSubmissions read failed after an undo failure on ${contractId}`, err);
    }
    if (!landed) return;
    try {
      const marked = await store.markClaimUnlocking(contractId, auditorId);
      if (!marked) {
        onError(`claim ${contractId} is no longer held by ${auditorId}; its lock needs manual release`, undefined);
      }
    } catch (err) {
      onError(`markClaimUnlocking failed for contract ${contractId}; its lock needs manual release`, err);
    }
  }

  /** Sends recordSubmission only while the bounty counts no submission. */
  async function ensureSubmissionRecorded(port: BountyEscrowPort, contractId: string): Promise<void> {
    const key = onchainId(contractId);
    const bounty = await port.readBounty(key);
    if (bounty.submissionCount > 0n) return;
    await port.recordSubmission(key);
  }

  /** Sends recordVerification only while the bounty's verified finding is not this one. */
  async function ensureVerificationRecorded(
    port: BountyEscrowPort,
    contractId: string,
    findingId: string,
    auditor: Address,
  ): Promise<void> {
    const key = onchainId(contractId);
    const finding = onchainId(findingId);
    const bounty = await port.readBounty(key);
    if (bounty.verifiedFinding.toLowerCase() === finding.toLowerCase()) return;
    await port.recordVerification(key, finding, auditor);
  }

  /** Sends payout only while the bounty is not already Paid for this finding. */
  async function ensurePaid(port: BountyEscrowPort, item: PayoutDue): Promise<void> {
    const key = onchainId(item.contractId);
    const finding = onchainId(item.findingId);
    const bounty = await port.readBounty(key);
    if (
      bounty.state === BOUNTY_STATE_PAID &&
      bounty.verifiedFinding.toLowerCase() === finding.toLowerCase()
    ) {
      return;
    }
    await port.payout(key, finding, item.auditorId as Address);
  }

  return {
    chainConfigured: bountyEscrow !== undefined || auditorStaking !== undefined,

    async lockClaim(contractId, auditorId) {
      if (!lockEnabled || !auditorStaking) return;
      const staker = auditorId as Address;
      // Read before locking, so a failed undo can tell whether the lock landed.
      const before = await auditorStaking.activeSubmissions(staker);
      await auditorStaking.lockSubmission(staker);
      let recorded = false;
      try {
        recorded = await store.markClaimLocked(contractId, auditorId);
      } catch (err) {
        onError(`markClaimLocked failed for contract ${contractId}`, err);
      }
      if (!recorded) {
        // The stake is locked on-chain but the claim cannot record it, so no
        // unlock would ever run. Undo the lock now and let the caller fail.
        try {
          await auditorStaking.unlockSubmission(staker);
        } catch (err) {
          onError(`unlockSubmission failed while undoing a lock on ${contractId}`, err);
          await recordUndoFailure(contractId, auditorId, before);
        }
        throw new Error(`Claim on ${contractId} could not record its lock`);
      }
    },

    async releaseExpiredLocks(at, contractId) {
      if (!lockEnabled) return 0;
      // Pending unlocks go first: a new claim on the contract overwrites the row.
      let unlocked = 0;
      let firstError: { err: unknown } | undefined;
      try {
        unlocked += await finishUnlocking(contractId);
      } catch (err) {
        firstError ??= { err };
      }
      const expired = await store.listExpiredLockedClaims(at, contractId);
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

    async finishPendingUnlocks() {
      if (!lockEnabled) return 0;
      return finishUnlocking();
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
          if (!(await store.isSubmissionRecorded(ref.contractId))) {
            await ensureSubmissionRecorded(bountyEscrow, ref.contractId);
            await store.markSubmissionRecorded(ref.contractId, now());
          }
          await ensureVerificationRecorded(
            bountyEscrow,
            ref.contractId,
            findingId,
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
          await ensurePaid(bountyEscrow, item);
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
