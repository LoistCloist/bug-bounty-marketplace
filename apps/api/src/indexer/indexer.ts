import { createPublicClient, http, type Address, type Hex, type Log, type PublicClient } from "viem";
import { bountyEscrowAbi, disputeResolutionAbi } from "@bbm/shared";
import type { ChainConfig } from "../chain/config.js";
import { onchainId } from "../chain/ids.js";
import { decodeChainLog, statusEffectOf, type AbiByAddress, type ChainLog } from "./events.js";
import { applyIndexedStatus, type IndexerFindingStore } from "./finding-status.js";
import type { IndexerRepository } from "./repository.js";

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
  /** First block to index when no checkpoint exists. Default 0. */
  startBlock?: bigint;
  /** Blocks per getLogs call. Default 1000. */
  batchSize?: bigint;
  /** Blocks behind the head to stop at, to ride out shallow reorgs. Default 0. */
  confirmations?: bigint;
  now?: () => Date;
}

export interface RunResult {
  /** Block the run started reading from (the checkpoint, or startBlock). */
  fromBlock: bigint;
  /** Last block processed in this run, or null if the run processed nothing. */
  toBlock: bigint | null;
  /** Logs that changed a finding's status. */
  applied: number;
  /** Logs that were unknown, had no status effect, were already applied, or
   * referenced no known finding. */
  ignored: number;
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
 * One polling pass. Reads logs from the checkpoint (inclusive, so the last
 * processed block is re-read and deduplicated) up to head minus confirmations,
 * in bounded batches. The checkpoint moves only after a batch is fully applied,
 * so a failure mid-batch is retried from the same place.
 */
export async function runOnce(options: EventIndexerOptions): Promise<RunResult> {
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
  const result: RunResult = { fromBlock: cursor, toBlock: null, applied: 0, ignored: 0 };
  if (cursor > safeHead) return result;

  // On-chain keys are one-way hashes of API ids (chain/ids.ts), so the map
  // back is built from the API's finding ids, once per run.
  const lookup = new Map<Hex, string>();
  for (const findingId of await listFindingIds()) {
    lookup.set(onchainId(findingId), findingId);
  }

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
      else result.ignored += 1;
    }

    await repository.setCheckpoint(chainId, toBlock);
    result.toBlock = toBlock;
    cursor = toBlock + 1n;
  }

  return result;

  async function applyLog(log: ChainLog): Promise<"applied" | "ignored"> {
    const decoded = decodeChainLog(log, abis);
    if (!decoded) return "ignored";
    const effect = statusEffectOf(decoded);
    if (!effect) return "ignored";

    if (log.transactionHash === null || log.logIndex === null) {
      throw new Error("indexer received a log without transactionHash or logIndex; pending logs cannot be indexed");
    }
    const key = { chainId, txHash: log.transactionHash, logIndex: log.logIndex };
    if (await repository.hasApplied(key)) return "ignored";

    const findingId = lookup.get(effect.onchainFindingId);
    if (findingId === undefined) return "ignored";

    // Status first, then the applied marker. A crash between the two replays
    // this log, so applyIndexedStatus must tolerate re-applying the same status.
    const at = now();
    await applyIndexedStatus(findingStatus, findingId, effect.status, at);
    await repository.markApplied({ ...key, eventName: decoded.eventName, appliedAt: at });
    return "applied";
  }
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
  startBlock?: bigint;
  batchSize?: bigint;
  confirmations?: bigint;
  pollIntervalMs?: number;
  /** Defaults to a viem HTTP public client. */
  createClient?: (rpcUrl: string) => IndexerChainClient;
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
    startBlock: options.startBlock,
    batchSize: options.batchSize,
    confirmations: options.confirmations,
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
