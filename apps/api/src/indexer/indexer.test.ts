import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Abi, type AbiEvent, type Address, type Hash, type Hex } from "viem";
import { bountyEscrowAbi, disputeResolutionAbi } from "@bbm/shared";
import { loadChainConfig } from "../chain/config.js";
import { onchainId } from "../chain/ids.js";
import type { ChainLog } from "./events.js";
import { MemoryFindingStatusStore } from "../status/memory-finding-status.js";
import type { FindingStatus } from "@bbm/shared";
import { runOnce, startEventIndexer, type EventIndexerOptions, type IndexerChainClient } from "./indexer.js";
import { MemoryIndexerRepository } from "./memory-repository.js";

const ESCROW = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;
const DISPUTES = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" as Address;
const UNWATCHED = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const AUDITOR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const CONTRACT_KEY = `0x${"c1".repeat(32)}` as Hex;
const DISPUTE_KEY = `0x${"d1".repeat(32)}` as Hex;
const FINDING_API_ID = "finding_1";
const FINDING_KEY = onchainId(FINDING_API_ID);
const AT = new Date("2026-10-20T12:00:00Z");

/** Store that records every write so tests can assert on the sequence. */
class RecordingFindingStatus extends MemoryFindingStatusStore {
  readonly calls: { findingId: string; status: FindingStatus; at: string }[] = [];
  readonly statuses = new Map<string, FindingStatus>();

  override async setFindingStatus(findingId: string, status: FindingStatus, changedAt: string): Promise<void> {
    this.calls.push({ findingId, status, at: changedAt });
    this.statuses.set(findingId, status);
    await super.setFindingStatus(findingId, status, changedAt);
  }
}
const CHAIN_ID = 31337;

type LogSpot = Pick<ChainLog, "address" | "blockNumber" | "transactionHash" | "logIndex">;

function txHashFor(blockNumber: bigint): Hash {
  return `0x${blockNumber.toString(16).padStart(64, "0")}` as Hash;
}

/** Builds a log the way the chain would emit it: indexed args as topics, the rest ABI-encoded. */
function makeLog(
  abi: readonly unknown[],
  eventName: string,
  args: Record<string, unknown>,
  spot: LogSpot,
): ChainLog {
  const event = (abi as Abi).find((item): item is AbiEvent => item.type === "event" && item.name === eventName);
  if (!event) throw new Error(`no ${eventName} in ABI`);
  const topics = encodeEventTopics({ abi: [event], eventName, args } as never) as Hex[];
  const nonIndexed = event.inputs.filter((input) => !input.indexed);
  const data = encodeAbiParameters(nonIndexed, nonIndexed.map((input) => args[input.name!])) as Hex;
  return { ...spot, topics, data };
}

const spot = (blockNumber: bigint, logIndex: number, transactionHash = txHashFor(blockNumber)): LogSpot => ({
  address: ESCROW,
  blockNumber,
  transactionHash,
  logIndex,
});

/** A fake chain: fixed head, logs filtered by the requested block range. */
function fakeChain(head: bigint, logs: ChainLog[]) {
  let current = head;
  const getBlockNumber = vi.fn(async () => current);
  const getLogs = vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
    logs.filter((log) => log.blockNumber! >= fromBlock && log.blockNumber! <= toBlock),
  );
  return {
    client: { getBlockNumber, getLogs } as unknown as IndexerChainClient,
    getLogs,
    setHead(next: bigint) {
      current = next;
    },
  };
}

function setup(head: bigint, logs: ChainLog[], overrides: Partial<EventIndexerOptions> = {}) {
  const chain = fakeChain(head, logs);
  const repository = new MemoryIndexerRepository();
  const findingStatus = new RecordingFindingStatus();
  findingStatus.add(FINDING_API_ID, "Submitted", AT.toISOString());
  const options: EventIndexerOptions = {
    chainId: CHAIN_ID,
    client: chain.client,
    contracts: { bountyEscrow: ESCROW, disputeResolution: DISPUTES },
    repository,
    findingStatus,
    listFindingIds: async () => [FINDING_API_ID],
    now: () => AT,
    ...overrides,
  };
  return { chain, repository, findingStatus, options };
}

const verifiedLog = (blockNumber: bigint, logIndex: number, transactionHash?: Hash) =>
  makeLog(
    bountyEscrowAbi,
    "FindingVerified",
    { contractId: CONTRACT_KEY, findingId: FINDING_KEY, auditor: AUDITOR, verifiedAt: 1_900_000_000n },
    spot(blockNumber, logIndex, transactionHash),
  );

describe("runOnce", () => {
  it("advances a finding to Verified from a FindingVerified log", async () => {
    const { options, findingStatus } = setup(10n, [verifiedLog(5n, 0)]);

    const result = await runOnce(options);

    expect(findingStatus.statuses.get(FINDING_API_ID)).toBe("Verified");
    expect(findingStatus.calls).toEqual([{ findingId: FINDING_API_ID, status: "Verified", at: AT.toISOString() }]);
    expect(result).toMatchObject({ fromBlock: 0n, toBlock: 10n, applied: 1, ignored: 0 });
  });

  it("applies a replayed log once", async () => {
    const log = verifiedLog(5n, 0);
    const { options, findingStatus, repository } = setup(10n, [log]);

    await runOnce(options);
    // Rewinding the checkpoint forces the same block to be read again.
    await repository.setCheckpoint(CHAIN_ID, 0n);
    const replay = await runOnce(options);

    expect(findingStatus.calls).toHaveLength(1);
    expect(replay.applied).toBe(0);
    expect(replay.ignored).toBe(1);
  });

  it("re-reads the checkpoint block on the next run and advances it", async () => {
    const { chain, options, repository } = setup(10n, [verifiedLog(5n, 0)]);

    await runOnce(options);
    expect(await repository.getCheckpoint(CHAIN_ID)).toBe(10n);

    chain.setHead(12n);
    const second = await runOnce(options);

    expect(second.fromBlock).toBe(10n);
    expect(second.toBlock).toBe(12n);
    expect(await repository.getCheckpoint(CHAIN_ID)).toBe(12n);
  });

  it("does nothing when the checkpoint is past the confirmed head", async () => {
    const { chain, options, repository } = setup(10n, [], { confirmations: 2n });
    await repository.setCheckpoint(CHAIN_ID, 9n);

    const result = await runOnce(options);

    expect(result.toBlock).toBeNull();
    expect(chain.getLogs).not.toHaveBeenCalled();
  });

  it("reads in bounded block ranges", async () => {
    const { chain, options } = setup(10n, [], { batchSize: 4n });

    await runOnce(options);

    expect(chain.getLogs.mock.calls.map(([args]) => [args.fromBlock, args.toBlock])).toEqual([
      [0n, 3n],
      [4n, 7n],
      [8n, 10n],
    ]);
  });

  it("applies the status sequence Verified, Frozen, then Unfrozen with the auditor losing", async () => {
    const logs = [
      verifiedLog(2n, 0),
      makeLog(bountyEscrowAbi, "Frozen", { contractId: CONTRACT_KEY, findingId: FINDING_KEY }, spot(3n, 0)),
      makeLog(
        bountyEscrowAbi,
        "Unfrozen",
        { contractId: CONTRACT_KEY, findingId: FINDING_KEY, auditorWon: false, verifiedAt: 0n },
        spot(4n, 0),
      ),
    ];
    const { options, findingStatus } = setup(10n, logs);

    await runOnce(options);

    expect(findingStatus.calls.map((c) => c.status)).toEqual(["Verified", "Disputed", "Rejected"]);
  });

  it("maps PayoutCredited to Paid", async () => {
    const logs = [
      verifiedLog(2n, 0),
      makeLog(
        bountyEscrowAbi,
        "PayoutCredited",
        { contractId: CONTRACT_KEY, findingId: FINDING_KEY, auditor: AUDITOR, amount: 10n ** 18n },
        spot(4n, 0),
      ),
    ];
    const { options, findingStatus } = setup(10n, logs);

    await runOnce(options);

    expect(findingStatus.statuses.get(FINDING_API_ID)).toBe("Paid");
  });

  it("returns a lapsed dispute to Verified via the auditor-won unfreeze", async () => {
    // DisputeResolution.lapse unfreezes in the auditor's favour, then emits DisputeLapsed.
    const logs = [
      verifiedLog(2n, 0),
      makeLog(bountyEscrowAbi, "Frozen", { contractId: CONTRACT_KEY, findingId: FINDING_KEY }, spot(3n, 0)),
      makeLog(
        bountyEscrowAbi,
        "Unfrozen",
        { contractId: CONTRACT_KEY, findingId: FINDING_KEY, auditorWon: true, verifiedAt: 0n },
        spot(4n, 0),
      ),
      makeLog(disputeResolutionAbi, "DisputeLapsed", { key: DISPUTE_KEY }, { ...spot(4n, 1), address: DISPUTES }),
    ];
    const { options, findingStatus } = setup(10n, logs);

    await runOnce(options);

    expect(findingStatus.calls.map((c) => c.status)).toEqual(["Verified", "Disputed", "Verified"]);
    expect(findingStatus.statuses.get(FINDING_API_ID)).toBe("Verified");
  });

  it("skips an event that would make an illegal move and keeps indexing past it", async () => {
    // Submitted -> Paid is illegal, so the PayoutCredited is skipped. The
    // later FindingVerified must still apply, or one bad log would stall the chain.
    const logs = [
      makeLog(
        bountyEscrowAbi,
        "PayoutCredited",
        { contractId: CONTRACT_KEY, findingId: FINDING_KEY, auditor: AUDITOR, amount: 10n ** 18n },
        spot(3n, 0),
      ),
      verifiedLog(4n, 0),
    ];
    const { options, findingStatus } = setup(10n, logs);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runOnce(options);

    expect(findingStatus.calls.map((c) => c.status)).toEqual(["Verified"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("skipped PayoutCredited"));
    warn.mockRestore();
  });

  it("ignores events that do not change status, without throwing", async () => {
    const logs = [
      makeLog(
        disputeResolutionAbi,
        "DisputeLapsed",
        { key: DISPUTE_KEY },
        { ...spot(4n, 0), address: DISPUTES },
      ),
      makeLog(
        bountyEscrowAbi,
        "Funded",
        { contractId: CONTRACT_KEY, developer: AUDITOR, amount: 1n, deadline: 2n },
        spot(4n, 1),
      ),
    ];
    const { options, findingStatus } = setup(10n, logs);

    const result = await runOnce(options);

    expect(findingStatus.calls).toEqual([]);
    expect(result).toMatchObject({ applied: 0, ignored: 2 });
  });

  it("ignores an event whose topic matches nothing in the ABI", async () => {
    const unknown: ChainLog = {
      address: ESCROW,
      topics: [`0x${"ee".repeat(32)}` as Hex],
      data: "0x",
      blockNumber: 4n,
      transactionHash: `0x${"ab".repeat(32)}` as Hash,
      logIndex: 0,
    };
    const { options, findingStatus } = setup(10n, [unknown]);

    await expect(runOnce(options)).resolves.toMatchObject({ applied: 0, ignored: 1 });
    expect(findingStatus.calls).toEqual([]);
  });

  it("ignores logs from addresses it does not watch", async () => {
    const stray = makeLog(bountyEscrowAbi, "FindingVerified", {
      contractId: CONTRACT_KEY,
      findingId: FINDING_KEY,
      auditor: AUDITOR,
      verifiedAt: 1n,
    }, { ...spot(4n, 0), address: UNWATCHED });
    const { options, findingStatus } = setup(10n, [stray]);

    await runOnce(options);
    expect(findingStatus.calls).toEqual([]);
  });

  it("ignores a status event for a finding the API does not know", async () => {
    const { options, findingStatus } = setup(10n, [verifiedLog(5n, 0)], {
      listFindingIds: async () => ["finding_other"],
    });

    const result = await runOnce(options);

    expect(findingStatus.calls).toEqual([]);
    expect(result.ignored).toBe(1);
  });
});

describe("startEventIndexer", () => {
  it("does not start without CHAIN_RPC_URL and never creates a client", () => {
    const createClient = vi.fn();
    const config = loadChainConfig({});

    const handle = startEventIndexer({
      config,
      repository: new MemoryIndexerRepository(),
      findingStatus: new RecordingFindingStatus(),
      listFindingIds: async () => [],
      createClient,
    });

    expect(handle).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });
});
