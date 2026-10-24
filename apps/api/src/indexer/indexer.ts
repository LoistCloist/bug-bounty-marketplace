import { createPublicClient, http, type Address, type Hash, type Hex, type Log, type PublicClient } from "viem";
import { bountyEscrowAbi, disputeResolutionAbi, type FindingStatus } from "@bbm/shared";
import type { ChainConfig } from "../chain/config.js";
import { onchainId } from "../chain/ids.js";
import { decodeChainLog, statusEffectOf, type AbiByAddress, type ChainLog } from "./events.js";
import { applyIndexedStatus, type IndexerFindingStore } from "./finding-status.js";
import { FindingNotFoundError } from "../status/finding-writer.js";
import { InvalidTransitionError } from "../status/transitions.js";
import type { IndexerLock, IndexerRepository, PendingEvent } from "./repository.js";

/** The slice of a viem PublicClient the indexer reads from. */
export type IndexerChainClient = Pick<PublicClient, "getBlockNumber" | "getLogs">;

export interface EventIndexerOptions {
  chainId: number;
  client: IndexerChainClient;
  contracts: { bountyEscrow: Address; disputeResolution: Address };
  repository: IndexerRepository;
  findingStatus: IndexerFindingStore;
  /** Every API finding id. Read at the start of each run, so new findings
   * resolve without a restart. */
  listFindingIds: () => Promise<string[]>;
  /** Single-runner lock. A run that cannot take it does nothing. */
  lock: IndexerLock;
  /** First block to index when no checkpoint exists. Default 0. */
  startBlock?: bigint;
  /** Blocks per getLogs call. Default 1000. */
  batchSize?: bigint;
  /** Blocks behind the head to stop at, to ride out shallow reorgs. Default 0. */
  confirmations?: bigint;
  /** Drop a pending log once it is this many blocks behind the head and its
   * finding is still unknown. Off by default: pending logs are kept until
   * their finding appears. */
  pendingMaxAgeBlocks?: bigint;
  now?: () => Date;
  /** Called after an event's status is applied (e.g. to release a claim lock
   * once a dispute resolves). At most once per event: it runs after the event
   * is marked applied, and a failure is logged, not retried (a claim lock left
   * held is released by the expiry sweep). */
  onStatusApplied?: (findingId: string, status: FindingStatus, eventName: string) => Promise<void>;
}

export interface RunResult {
  /** False when another runner held the lock; nothing was read or written. */
  skipped: boolean;
  /** Block the run started reading from (the checkpoint, or startBlock). Null when skipped. */
  fromBlock: bigint | null;
  /** Last block processed in this run, or null if the run processed nothing. */
  toBlock: bigint | null;
  /** Logs that changed a finding's status, including pending logs that applied this run. */
  applied: number;
  /** Logs that had no status effect, were already applied, or were skipped as illegal moves. */
  ignored: number;
  /** Logs held as pending this run because their finding was unknown. */
  pending: number;
  /** Pending logs dropped by pendingMaxAgeBlocks this run. */
  pruned: number;
}

function minBigint(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function compareLogs(a: Log, b: Log): number {
  const blockA = a.blockNumber ?? 0n;
  const blockB = b.blockNumber ?? 0n;
  if (blockA !== blockB) return blockA < blockB ? -1 : 1;
  return (a.logIndex ?? 0) - (b.logIndex ?? 0);
}

/**
 * One polling pass. Takes the lock first, then:
 * 1. retries every pending log. Their blocks are already behind the
 *    checkpoint, so no block is re-read for them;
 * 2. reads logs from the checkpoint (inclusive, so the last processed block
 *    is re-read and deduplicated) up to head minus confirmations, in bounded
 *    batches.
 * The checkpoint moves only after a batch is fully applied, so a failure
 * mid-batch is retried from the same place.
 */
export async function runOnce(options: EventIndexerOptions): Promise<RunResult> {
  if (!(await options.lock.tryAcquire())) {
    return { skipped: true, fromBlock: null, toBlock: null, applied: 0, ignored: 0, pending: 0, pruned: 0 };
  }
  try {
    return await runLocked(options);
  } finally {
    await options.lock.release();
  }
}

async function runLocked(options: EventIndexerOptions): Promise<RunResult> {
  const { chainId, client, contracts, repository, findingStatus, listFindingIds } = options;
  const batchSize = options.batchSize ?? 1000n;
  const confirmations = options.confirmations ?? 0n;
  const now = options.now ?? (() => new Date());

  const abis: AbiByAddress = new Map<string, readonly unknown[]>([
    [contracts.bountyEscrow.toLowerCase(), bountyEscrowAbi],
    [contracts.disputeResolution.toLowerCase(), disputeResolutionAbi],
  ]);

  const head = await client.getBlockNumber();
  const safeHead = head - confirmations;
  const checkpoint = await repository.getCheckpoint(chainId);
  let cursor = checkpoint ?? options.startBlock ?? 0n;
  const result: RunResult = {
    skipped: false,
    fromBlock: cursor,
    toBlock: null,
    applied: 0,
    ignored: 0,
    pending: 0,
    pruned: 0,
  };

  // On-chain keys are one-way hashes of API ids (chain/ids.ts), so the map
  // back is built from the API's finding ids, once per run.
  const lookup = new Map<Hex, string>();
  for (const findingId of await listFindingIds()) {
    lookup.set(onchainId(findingId), findingId);
  }

  // Pending logs first, before any new block is read and even when there are
  // no new blocks, so a finding created since its event was read gets the
  // status without waiting for the chain to move.
  for (const pending of await repository.listPending(chainId)) {
    const outcome = await applyLog(pendingToChainLog(pending));
    if (outcome === "pending") continue;
    await repository.removePending(pending);
    if (outcome === "applied") result.applied += 1;
    else result.ignored += 1;
  }

  if (options.pendingMaxAgeBlocks !== undefined && safeHead > options.pendingMaxAgeBlocks) {
    const dropped = await repository.prunePending(chainId, safeHead - options.pendingMaxAgeBlocks);
    if (dropped > 0) {
      console.warn(
        `indexer dropped ${dropped} pending logs for unknown findings older than ${options.pendingMaxAgeBlocks} blocks`,
      );
    }
    result.pruned = dropped;
  }

  if (cursor > safeHead) return result;

  while (cursor <= safeHead) {
    const toBlock = minBigint(cursor + batchSize - 1n, safeHead);
    const logs = (await client.getLogs({
      address: [contracts.bountyEscrow, contracts.disputeResolution],
      fromBlock: cursor,
      toBlock,
    })) as Log[];

    for (const log of [...logs].sort(compareLogs)) {
      const outcome = await applyLog(log as ChainLog);
      if (outcome === "applied") result.applied += 1;
      else if (outcome === "pending") result.pending += 1;
      else result.ignored += 1;
    }

    await repository.setCheckpoint(chainId, toBlock);
    result.toBlock = toBlock;
    cursor = toBlock + 1n;
  }

  return result;

  async function applyLog(log: ChainLog): Promise<"applied" | "ignored" | "pending"> {
    const decoded = decodeChainLog(log, abis);
    if (!decoded) return "ignored";
    const effect = statusEffectOf(decoded);
    if (!effect) return "ignored";

    if (log.transactionHash === null || log.logIndex === null || log.blockNumber === null) {
      throw new Error("indexer received a log without transactionHash, logIndex or blockNumber");
    }
    const key = { chainId, txHash: log.transactionHash, logIndex: log.logIndex };
    if (await repository.hasApplied(key)) return "ignored";

    const findingId = lookup.get(effect.onchainFindingId);
    if (findingId === undefined) {
      await holdPending(log);
      return "pending";
    }

    // Status first, then the applied marker. A crash between the two replays
    // this log, so applyIndexedStatus must tolerate re-applying the same status.
    const at = now();
    try {
      await applyIndexedStatus(findingStatus, findingId, effect.status, at, effect.from);
    } catch (err) {
      // The API listed the finding but cannot read it yet: keep the log.
      if (err instanceof FindingNotFoundError) {
        await holdPending(log);
        return "pending";
      }
      // An event that would make an illegal move is recorded as handled and
      // skipped. Throwing here would stop the run before the checkpoint
      // advances, so every later run would hit the same log again.
      if (!(err instanceof InvalidTransitionError)) throw err;
      console.warn(`indexer skipped ${decoded.eventName} for ${findingId}: ${err.message}`);
      await repository.markApplied({ ...key, eventName: decoded.eventName, appliedAt: at });
      await repository.removePending(key);
      return "ignored";
    }
    await repository.markApplied({ ...key, eventName: decoded.eventName, appliedAt: at });
    await repository.removePending(key);
    if (options.onStatusApplied) {
      try {
        await options.onStatusApplied(findingId, effect.status, decoded.eventName);
      } catch (err) {
        console.error(`indexer onStatusApplied failed for ${decoded.eventName} on ${findingId}`, err);
      }
    }
    return "applied";
  }

  async function holdPending(log: ChainLog): Promise<void> {
    await repository.addPending({
      chainId,
      txHash: log.transactionHash as Hash,
      logIndex: log.logIndex as number,
      address: log.address,
      topics: [...log.topics],
      data: log.data,
      blockNumber: log.blockNumber as bigint,
    });
  }
}

function pendingToChainLog(pending: PendingEvent): ChainLog {
  return {
    address: pending.address,
    topics: pending.topics,
    data: pending.data,
    blockNumber: pending.blockNumber,
    transactionHash: pending.txHash as Hash,
    logIndex: pending.logIndex,
  };
}

export interface EventIndexerHandle {
  /** Stops polling and waits for an in-flight run to finish. */
  stop(): Promise<void>;
}

export interface StartEventIndexerOptions {
  config: ChainConfig | null;
  repository: IndexerRepository;
  findingStatus: IndexerFindingStore;
  listFindingIds: () => Promise<string[]>;
  lock: IndexerLock;
  startBlock?: bigint;
  batchSize?: bigint;
  confirmations?: bigint;
  pendingMaxAgeBlocks?: bigint;
  pollIntervalMs?: number;
  /** Defaults to a viem HTTP public client. */
  createClient?: (rpcUrl: string) => IndexerChainClient;
  onStatusApplied?: EventIndexerOptions["onStatusApplied"];
  onError?: (err: unknown) => void;
}

/**
 * Starts the polling loop. Returns null without creating a client when there
 * is no chain config (CHAIN_RPC_URL unset), so the API runs without an
 * indexer exactly as it runs without a chain.
 */
export function startEventIndexer(options: StartEventIndexerOptions): EventIndexerHandle | null {
  const { config } = options;
  if (config === null) return null;

  const client = (options.createClient ?? defaultClient)(config.rpcUrl);
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const onError = options.onError ?? ((err: unknown) => console.error("event indexer run failed", err));
  const runOptions: EventIndexerOptions = {
    chainId: config.chainId,
    client,
    contracts: {
      bountyEscrow: config.bountyEscrowAddress,
      disputeResolution: config.disputeResolutionAddress,
    },
    repository: options.repository,
    findingStatus: options.findingStatus,
    listFindingIds: options.listFindingIds,
    lock: options.lock,
    startBlock: options.startBlock,
    batchSize: options.batchSize,
    confirmations: options.confirmations,
    pendingMaxAgeBlocks: options.pendingMaxAgeBlocks,
    onStatusApplied: options.onStatusApplied,
  };

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const tick = (): void => {
    inFlight = runOnce(runOptions)
      .then(() => undefined)
      .catch(onError)
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, pollIntervalMs);
      });
  };
  tick();

  return {
    async stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      await inFlight;
    },
  };
}

function defaultClient(rpcUrl: string): IndexerChainClient {
  return createPublicClient({ transport: http(rpcUrl) }) as IndexerChainClient;
}
