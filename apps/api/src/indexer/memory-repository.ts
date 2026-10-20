import type {
  AppliedEvent,
  AppliedEventKey,
  IndexerLock,
  IndexerRepository,
  PendingEvent,
} from "./repository.js";

function eventId(key: AppliedEventKey): string {
  return `${key.chainId}:${key.txHash.toLowerCase()}:${key.logIndex}`;
}

/** Process-local indexer state. The default when DATABASE_URL is unset. */
export class MemoryIndexerRepository implements IndexerRepository {
  private readonly checkpoints = new Map<number, bigint>();
  private readonly applied = new Map<string, AppliedEvent>();
  private readonly pending = new Map<string, PendingEvent>();

  async getCheckpoint(chainId: number): Promise<bigint | null> {
    return this.checkpoints.get(chainId) ?? null;
  }

  async setCheckpoint(chainId: number, blockNumber: bigint): Promise<void> {
    const current = this.checkpoints.get(chainId);
    if (current === undefined || current < blockNumber) this.checkpoints.set(chainId, blockNumber);
  }

  async hasApplied(key: AppliedEventKey): Promise<boolean> {
    return this.applied.has(eventId(key));
  }

  async markApplied(event: AppliedEvent): Promise<void> {
    const id = eventId(event);
    if (!this.applied.has(id)) this.applied.set(id, { ...event });
  }

  async addPending(event: PendingEvent): Promise<void> {
    const id = eventId(event);
    if (!this.pending.has(id)) this.pending.set(id, { ...event, topics: [...event.topics] });
  }

  async listPending(chainId: number): Promise<PendingEvent[]> {
    return [...this.pending.values()]
      .filter((event) => event.chainId === chainId)
      .sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
        return a.logIndex - b.logIndex;
      });
  }

  async removePending(key: AppliedEventKey): Promise<void> {
    this.pending.delete(eventId(key));
  }

  async prunePending(chainId: number, beforeBlock: bigint): Promise<number> {
    let dropped = 0;
    for (const [id, event] of this.pending) {
      if (event.chainId === chainId && event.blockNumber < beforeBlock) {
        this.pending.delete(id);
        dropped += 1;
      }
    }
    return dropped;
  }
}

/** Process-local lock. Always acquires, so one process runs one indexer. */
export class MemoryIndexerLock implements IndexerLock {
  async tryAcquire(): Promise<boolean> {
    return true;
  }

  async release(): Promise<void> {}
}
