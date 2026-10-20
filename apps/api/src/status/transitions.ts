import type { ContractStatus, FindingStatus } from "@bbm/shared";

/**
 * Allowed finding transitions. Every finding status change in the API and in
 * the event indexer goes through `transitionFinding`; nothing else may decide
 * whether a move is legal.
 *
 * - Flagged -> Submitted: auditor uploads a PoC under an active claim.
 * - Flagged -> Rejected: auditor marks the AI finding a false positive.
 * - Submitted -> Verified: sandbox reproduced the PoC.
 * - Submitted -> Rejected: sandbox failed to reproduce the PoC.
 * - Verified -> Disputed: developer opened a dispute (DisputeOpened).
 * - Verified -> Paid: challenge window passed undisputed (PayoutCredited).
 * - Disputed -> Rejected: dispute ruled against the auditor (a lost dispute).
 * - Disputed -> Verified: dispute ruled for the auditor, or the dispute lapsed.
 * - Paid, Rejected: terminal.
 */
export const FINDING_TRANSITIONS: Readonly<Record<FindingStatus, readonly FindingStatus[]>> = {
  Flagged: ["Submitted", "Rejected"],
  Submitted: ["Verified", "Rejected"],
  Verified: ["Disputed", "Paid"],
  Disputed: ["Verified", "Rejected"],
  Rejected: [],
  Paid: [],
};

/**
 * Allowed contract transitions.
 *
 * - Open -> Claimed: an auditor claims the contract.
 * - Claimed -> Open: the claim expired without a PoC resolving the contract.
 * - Claimed -> Resolved: a finding was Paid.
 * - Open -> Expired, Claimed -> Expired: the bounty deadline passed with no
 *   resolution. An active claim does not extend the deadline.
 * - Resolved, Expired: terminal.
 */
export const CONTRACT_TRANSITIONS: Readonly<Record<ContractStatus, readonly ContractStatus[]>> = {
  Open: ["Claimed", "Expired"],
  Claimed: ["Open", "Resolved", "Expired"],
  Resolved: [],
  Expired: [],
};

export type StatusKind = "finding" | "contract";

/** Thrown when a status move is not in the transition table. */
export class InvalidTransitionError extends Error {
  readonly kind: StatusKind;
  readonly from: string;
  readonly to: string;

  constructor(kind: StatusKind, from: string, to: string) {
    super(`Invalid ${kind} status transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
    this.kind = kind;
    this.from = from;
    this.to = to;
  }
}

function isAllowed<S extends string>(
  table: Readonly<Record<S, readonly S[]>>,
  current: S,
  next: S,
): boolean {
  return table[current]?.includes(next) ?? false;
}

export function canTransitionFinding(current: FindingStatus, next: FindingStatus): boolean {
  return isAllowed(FINDING_TRANSITIONS, current, next);
}

export function canTransitionContract(current: ContractStatus, next: ContractStatus): boolean {
  return isAllowed(CONTRACT_TRANSITIONS, current, next);
}

/** Returns `next` if the finding may move from `current` to it, else throws. */
export function transitionFinding(current: FindingStatus, next: FindingStatus): FindingStatus {
  if (!canTransitionFinding(current, next)) {
    throw new InvalidTransitionError("finding", current, next);
  }
  return next;
}

/** Returns `next` if the contract may move from `current` to it, else throws. */
export function transitionContract(current: ContractStatus, next: ContractStatus): ContractStatus {
  if (!canTransitionContract(current, next)) {
    throw new InvalidTransitionError("contract", current, next);
  }
  return next;
}
