import type { Address, Hex } from "viem";

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

/** A raw log held back because its finding was unknown when it was read. */
export interface PendingEvent extends AppliedEventKey {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
}

/** Indexer state: per-chain checkpoints, applied events and pending logs. */
export interface IndexerRepository {
  /** Last fully processed block for the chain, or null before the first run. */
  getCheckpoint(chainId: number): Promise<bigint | null>;
  /** Moves the checkpoint forward only. A lower or equal block is a no-op. */
  setCheckpoint(chainId: number, blockNumber: bigint): Promise<void>;
  hasApplied(key: AppliedEventKey): Promise<boolean>;
  /** Records the event as applied. A second call for the same key is a no-op. */
  markApplied(event: AppliedEvent): Promise<void>;
  /** Stores a log for a later retry. A second call for the same key is a no-op. */
  addPending(event: PendingEvent): Promise<void>;
  /** Pending logs for the chain, ordered by block number then log index. */
  listPending(chainId: number): Promise<PendingEvent[]>;
  removePending(key: AppliedEventKey): Promise<void>;
  /** Drops pending logs in blocks below `beforeBlock`. Returns how many were dropped. */
  prunePending(chainId: number, beforeBlock: bigint): Promise<number>;
}

/** Single-runner lock across API replicas. Held for the whole of one run. */
export interface IndexerLock {
  /** True when this caller now holds the lock. Never blocks. */
  tryAcquire(): Promise<boolean>;
  release(): Promise<void>;
}
