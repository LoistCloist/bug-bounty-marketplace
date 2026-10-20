import type { Account, Address, Chain, Hash, Hex, PublicClient, Transport, WalletClient } from "viem";
import { bountyEscrowAbi } from "@bbm/shared";
import { awaitSuccess } from "./tx.js";

/** The operator-side view of BountyEscrow the API needs. */
export interface BountyEscrowPort {
  recordSubmission(contractId: Hex): Promise<Hash>;
  recordVerification(contractId: Hex, findingId: Hex, auditor: Address): Promise<Hash>;
  payout(contractId: Hex, findingId: Hex, auditor: Address): Promise<Hash>;
  pendingPayouts(auditor: Address): Promise<bigint>;
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
  };
}
