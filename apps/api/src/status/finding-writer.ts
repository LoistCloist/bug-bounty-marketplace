import type { FindingStatus } from "@bbm/shared";
import { transitionFinding } from "./transitions.js";

/**
 * The narrow write surface the event indexer depends on. Implementations
 * persist the new status and append a `{ status, changedAt }` history entry.
 */
export interface FindingStatusWriter {
  setFindingStatus(findingId: string, status: FindingStatus, changedAt: string): Promise<void>;
}

/** Read side used only to validate a move before it is written. */
export interface FindingStatusReader {
  getFindingStatus(findingId: string): Promise<FindingStatus | null>;
}

export class FindingNotFoundError extends Error {
  constructor(readonly findingId: string) {
    super(`Finding not found: ${findingId}`);
    this.name = "FindingNotFoundError";
  }
}

/**
 * Reads the finding's current status, validates the move with
 * `transitionFinding`, then writes it. Throws `InvalidTransitionError` before
 * any write if the move is illegal.
 *
 * Note: this is read-then-write. A Postgres-backed store should make the write
 * conditional on the status it read (`WHERE status = $current`) to stay correct
 * under concurrent writers.
 */
export async function applyFindingTransition(
  store: FindingStatusReader & FindingStatusWriter,
  findingId: string,
  next: FindingStatus,
  changedAt: string,
): Promise<FindingStatus> {
  const current = await store.getFindingStatus(findingId);
  if (current === null) throw new FindingNotFoundError(findingId);
  const status = transitionFinding(current, next);
  await store.setFindingStatus(findingId, status, changedAt);
  return status;
}
