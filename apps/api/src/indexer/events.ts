import { AbiEventSignatureNotFoundError, decodeEventLog, type Address, type Hash, type Hex } from "viem";
import type { FindingStatus } from "@bbm/shared";

/** The fields of a log the indexer reads. Matches viem's Log shape. */
export interface ChainLog {
  address: Address;
  topics: readonly Hex[];
  data: Hex;
  blockNumber: bigint | null;
  transactionHash: Hash | null;
  logIndex: number | null;
}

/** ABIs keyed by lowercase contract address. */
export type AbiByAddress = ReadonlyMap<string, readonly unknown[]>;

export interface DecodedLog {
  eventName: string;
  args: Record<string, unknown>;
}

/**
 * Decodes a log against the ABI of the contract that emitted it. Returns null
 * for logs the indexer does not know: an address it does not watch, or a
 * topic that matches no event in that contract's ABI. Malformed data for a
 * known event still throws, so a bad decode never passes as a no-op.
 */
export function decodeChainLog(log: ChainLog, abiByAddress: AbiByAddress): DecodedLog | null {
  const abi = abiByAddress.get(log.address.toLowerCase());
  if (!abi) return null;
  try {
    const decoded = decodeEventLog({
      abi: abi as never,
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
    });
    return {
      eventName: String(decoded.eventName),
      args: (decoded.args ?? {}) as Record<string, unknown>,
    };
  } catch (err) {
    if (err instanceof AbiEventSignatureNotFoundError) return null;
    throw err;
  }
}

/** A finding-status change implied by an event, keyed by the on-chain finding id. */
export interface StatusEffect {
  onchainFindingId: Hex;
  status: FindingStatus;
  /** When set, the move applies only from these statuses: a replayed
   * FindingVerified must not undo a later dispute (Disputed → Verified is
   * legal, but only Unfrozen may make it). */
  from?: readonly FindingStatus[];
}

/**
 * Maps a decoded event to the finding status it implies, or null when it has
 * no effect on status:
 * - FindingVerified → Verified
 * - Frozen → Disputed (a dispute froze the payout)
 * - Unfrozen(auditorWon) → Verified if the auditor won, Rejected otherwise
 * - PayoutCredited → Paid
 *
 * DisputeOpened, DisputeRuled and DisputeLapsed are recognised but change no
 * status themselves. DisputeRuled and DisputeLapsed carry only the dispute
 * key, not the finding ids. The Frozen and Unfrozen events emitted alongside
 * them carry the ids and the status change.
 */
export function statusEffectOf(decoded: DecodedLog): StatusEffect | null {
  const { eventName, args } = decoded;
  switch (eventName) {
    case "FindingVerified":
      return { onchainFindingId: args.findingId as Hex, status: "Verified", from: ["Submitted"] };
    case "Frozen":
      return { onchainFindingId: args.findingId as Hex, status: "Disputed" };
    case "Unfrozen":
      return {
        onchainFindingId: args.findingId as Hex,
        status: args.auditorWon ? "Verified" : "Rejected",
      };
    case "PayoutCredited":
      return { onchainFindingId: args.findingId as Hex, status: "Paid" };
    default:
      return null;
  }
}
