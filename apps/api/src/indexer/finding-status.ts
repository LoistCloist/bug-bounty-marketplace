import type { FindingStatus } from "@bbm/shared";

/**
 * The one thing the indexer needs from the finding state machine. The state
 * machine (plan item 7) implements this. Implementations should be idempotent
 * (setting the status a finding already has is a no-op), because the indexer
 * may call it again for an event whose "applied" row was not yet written when
 * the process stopped.
 */
export interface FindingStatusWriter {
  setStatus(findingId: string, status: FindingStatus, at: Date): Promise<void>;
}

export interface FindingStatusChange {
  findingId: string;
  status: FindingStatus;
  at: Date;
}

/** Process-local writer for tests and in-memory runs. Records every call. */
export class MemoryFindingStatusWriter implements FindingStatusWriter {
  readonly statuses = new Map<string, FindingStatus>();
  readonly calls: FindingStatusChange[] = [];

  async setStatus(findingId: string, status: FindingStatus, at: Date): Promise<void> {
    this.calls.push({ findingId, status, at });
    this.statuses.set(findingId, status);
  }
}
