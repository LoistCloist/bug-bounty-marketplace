/** Identifies one log: a log is applied at most once per chain. */
export interface AppliedEventKey {
  chainId: number;
  txHash: string;
  logIndex: number;
}

export interface AppliedEvent extends AppliedEventKey {
  eventName: string;
  appliedAt: Date;
}

/** Indexer state: per-chain checkpoints and the set of applied events. */
export interface IndexerRepository {
  /** Last fully processed block for the chain, or null before the first run. */
  getCheckpoint(chainId: number): Promise<bigint | null>;
  setCheckpoint(chainId: number, blockNumber: bigint): Promise<void>;
  hasApplied(key: AppliedEventKey): Promise<boolean>;
  /** Records the event as applied. A second call for the same key is a no-op. */
  markApplied(event: AppliedEvent): Promise<void>;
}
