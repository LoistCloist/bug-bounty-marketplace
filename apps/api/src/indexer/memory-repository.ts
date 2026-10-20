import type { AppliedEvent, AppliedEventKey, IndexerRepository } from "./repository.js";

function eventId(key: AppliedEventKey): string {
  return `${key.chainId}:${key.txHash.toLowerCase()}:${key.logIndex}`;
}

/** Process-local indexer state. The default when DATABASE_URL is unset. */
export class MemoryIndexerRepository implements IndexerRepository {
  private readonly checkpoints = new Map<number, bigint>();
  private readonly applied = new Map<string, AppliedEvent>();

  async getCheckpoint(chainId: number): Promise<bigint | null> {
    return this.checkpoints.get(chainId) ?? null;
  }

  async setCheckpoint(chainId: number, blockNumber: bigint): Promise<void> {
    this.checkpoints.set(chainId, blockNumber);
  }

  async hasApplied(key: AppliedEventKey): Promise<boolean> {
    return this.applied.has(eventId(key));
  }

  async markApplied(event: AppliedEvent): Promise<void> {
    const id = eventId(event);
    if (!this.applied.has(id)) this.applied.set(id, { ...event });
  }
}
