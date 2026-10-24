import type { Account, Address, Chain, Hash, Hex, PublicClient, Transport, WalletClient } from "viem";
import { bountyEscrowAbi } from "@bbm/shared";
import { awaitSuccess } from "./tx.js";

/** BountyEscrow.BountyState values, as the contract's enum encodes them. */
export const BOUNTY_STATE_NONE = 0;
export const BOUNTY_STATE_OPEN = 1;
export const BOUNTY_STATE_PAID = 2;
export const BOUNTY_STATE_CLOSED = 3;

/** The fields of BountyEscrow.bounties(contractId) the API reads. */
export interface OnchainBounty {
  developer: Address;
  /** Wei held for the bounty. */
  amount: bigint;
  /** Unix seconds. */
  deadline: bigint;
  state: number;
  submissionCount: bigint;
  /** bytes32 zero when no finding is verified. */
  verifiedFinding: Hex;
  verifiedAuditor: Address;
  frozen: boolean;
}

/** The operator-side view of BountyEscrow the API needs. */
export interface BountyEscrowPort {
  recordSubmission(contractId: Hex): Promise<Hash>;
  recordVerification(contractId: Hex, findingId: Hex, auditor: Address): Promise<Hash>;
  payout(contractId: Hex, findingId: Hex, auditor: Address): Promise<Hash>;
  pendingPayouts(auditor: Address): Promise<bigint>;
  /** Reads the bounty's state. Chain actions read it before each write, so a
   * retry never repeats a write the chain already holds. */
  readBounty(contractId: Hex): Promise<OnchainBounty>;
}

export interface BountyEscrowDeps {
  address: Address;
  publicClient: Pick<PublicClient, "readContract" | "waitForTransactionReceipt">;
  /** Must be created with the operator account; these calls are operator-only. */
  walletClient: Pick<WalletClient<Transport, Chain | undefined, Account>, "writeContract">;
}

export function createBountyEscrowPort(deps: BountyEscrowDeps): BountyEscrowPort {
  const { address, publicClient, walletClient } = deps;

  function confirm(hash: Hash, label: string): Promise<Hash> {
    return awaitSuccess(publicClient, hash, label);
  }

  return {
    recordSubmission: async (contractId) =>
      confirm(
        await walletClient.writeContract({
          address,
          abi: bountyEscrowAbi,
          functionName: "recordSubmission",
          args: [contractId],
          chain: undefined,
        }),
        "BountyEscrow.recordSubmission",
      ),
    recordVerification: async (contractId, findingId, auditor) =>
      confirm(
        await walletClient.writeContract({
          address,
          abi: bountyEscrowAbi,
          functionName: "recordVerification",
          args: [contractId, findingId, auditor],
          chain: undefined,
        }),
        "BountyEscrow.recordVerification",
      ),
    payout: async (contractId, findingId, auditor) =>
      confirm(
        await walletClient.writeContract({
          address,
          abi: bountyEscrowAbi,
          functionName: "payout",
          args: [contractId, findingId, auditor],
          chain: undefined,
        }),
        "BountyEscrow.payout",
      ),
    pendingPayouts: (auditor) =>
      publicClient.readContract({
        address,
        abi: bountyEscrowAbi,
        functionName: "pendingPayouts",
        args: [auditor],
      }) as Promise<bigint>,
    readBounty: async (contractId) => {
      // The public getter returns the struct's fields positionally, in the
      // order of the Bounty struct: developer, amount, deadline, state,
      // submissionCount, verifiedFinding, verifiedAuditor, verifiedAt, frozen.
      const [developer, amount, deadline, state, submissionCount, verifiedFinding, verifiedAuditor, , frozen] =
        (await publicClient.readContract({
          address,
          abi: bountyEscrowAbi,
          functionName: "bounties",
          args: [contractId],
        })) as readonly [Address, bigint, bigint, number, bigint, Hex, Address, bigint, boolean];
      return {
        developer,
        amount,
        deadline,
        state: Number(state),
        submissionCount,
        verifiedFinding,
        verifiedAuditor,
        frozen,
      };
    },
  };
}
