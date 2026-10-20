import type { FindingStatus } from "@bbm/shared";
import {
  applyFindingTransition,
  FindingNotFoundError,
  type FindingStatusReader,
  type FindingStatusWriter,
} from "../status/finding-writer.js";

/** What the indexer needs from the finding store: read to validate, write to apply. */
export type IndexerFindingStore = FindingStatusReader & FindingStatusWriter;

/**
 * Applies a status change implied by an on-chain event through the status
 * machine, so illegal moves are rejected the same way they are for routes.
 * Setting the status a finding already has is a no-op: the indexer can replay
 * a log after a crash between the status write and the applied marker.
 */
export async function applyIndexedStatus(
  store: IndexerFindingStore,
  findingId: string,
  next: FindingStatus,
  at: Date,
): Promise<void> {
  const current = await store.getFindingStatus(findingId);
  if (current === null) throw new FindingNotFoundError(findingId);
  if (current === next) return;
  await applyFindingTransition(store, findingId, next, at.toISOString());
}
