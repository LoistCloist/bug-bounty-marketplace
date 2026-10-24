import type { FindingStatus } from "@bbm/shared";
import type { ContractRepository } from "../contracts/repository.js";
import type { DisputeRepository } from "../disputes/repository.js";
import type { PipelineRepository } from "../pipeline/repository.js";

/** The indexer's onStatusApplied hook: called after an event moved a finding. */
export type StatusHook = (
  findingId: string,
  status: FindingStatus,
  eventName: string,
) => Promise<void>;

/**
 * Records the outcome of a dispute that ended on-chain. Unfrozen is emitted both
 * when the arbiter rules and when the ruling window lapses (which counts for
 * the auditor), so a dispute nobody ruled on through the API no longer stays
 * Pending in the arbiter's list. A dispute that is already ruled is left as it is.
 */
export function disputeSettler(
  disputes: DisputeRepository,
  arbiterId: string,
  now: () => Date,
): StatusHook {
  return async (findingId, status, eventName) => {
    if (eventName !== "Unfrozen") return;
    const dispute = await disputes.findByFinding(findingId);
    if (!dispute || dispute.ruling !== "Pending") return;
    await disputes.setRuling(
      dispute.id,
      status === "Rejected" ? "AgainstAuditor" : "ForAuditor",
      arbiterId,
      now(),
    );
  };
}

/**
 * Ends the claim of the auditor whose finding a dispute rejected: the bounty
 * goes back to the queue and they may claim another one instead of waiting for
 * the claim to expire. Only that auditor's claim ends (theirs may have expired
 * and someone else claimed the contract since), and only once its stake lock
 * is free or released, so a lock the unlock sweep still has to release is never
 * lost. Runs after the claim lock release hook.
 */
export function rejectedClaimEnder(deps: {
  contracts: Pick<ContractRepository, "releaseClaimIfUnlocked">;
  pipeline: Pick<PipelineRepository, "findFinding" | "findLatestPoc">;
  now: () => Date;
}): StatusHook {
  return async (findingId, status, eventName) => {
    if (eventName !== "Unfrozen" || status !== "Rejected") return;
    const finding = await deps.pipeline.findFinding(findingId, deps.now());
    const poc = await deps.pipeline.findLatestPoc(findingId);
    if (!finding || !poc) return;
    await deps.contracts.releaseClaimIfUnlocked(finding.contractId, poc.auditorId);
  };
}

/** Runs the hooks in order. Each runs even if an earlier one fails; the first
 * failure is rethrown afterwards so the indexer logs it. */
export function composeStatusHooks(...hooks: StatusHook[]): StatusHook {
  return async (findingId, status, eventName) => {
    let failure: unknown = null;
    for (const hook of hooks) {
      try {
        await hook(findingId, status, eventName);
      } catch (err) {
        failure ??= err;
      }
    }
    if (failure) throw failure;
  };
}
